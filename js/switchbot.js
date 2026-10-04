/* ============================================================
   SwitchBot の温湿度計から「温度・湿度」を取り出して表示する

   SwitchBot の API はブラウザから直接呼べない。
   （CORS＝よそのサイトからの読み取り許可、が出ていないため）
   そこで間に「中継役」を1つ置き、このファイルはその中継役だけを叩く。
   中継役は Vercel 用（api/switchbot.js）と
   Cloudflare Workers 用（switchbot-proxy/worker.js）の2種類を用意してある。
   作り方は README の「室温・湿度を出す（SwitchBot）」を参照。

   中継役には ?all=1 を付けて、温湿度計をまとめて（室内と屋外など）もらう。
     { "devices": [ { "name": "リビング", "temperature": 24.3, "humidity": 52, "main": true, ... },
                    { "name": "屋外", "temperature": 18.6, ... } ] }
   古い中継役は ?all=1 を知らないので、1台ぶんの形で返ってくる。それも読めるようにしてある。
     { "temperature": 24.3, "humidity": 52, "name": "リビング" }
     { "body": { "temperature": 24.3, "humidity": 52 } }   ← SwitchBot の生の形

   1枚目・2枚目の小さな室温には「室内」の1台目を出す。
   全部の台は EC.getSensors() と sensorsupdate イベントで、温湿度の画面（js/sensors.js）に渡す。

   どの台を「室内」「屋外」として出すかは、機種と名前から推し量る。
   違っていれば設定ダイアログで選び直せる（端末ごとに localStorage に保存）。

   中継URLは設定ダイアログで入力し、localStorage に保存する。
   URL に ?sb=https://... を付けた場合はそちらが優先。
   未設定のときは室温の表示そのものが出ないので、見た目は元のまま。
   ============================================================ */
(function () {
  'use strict';

  var EC = window.EC || {};
  var KEY = 'echo-clock-switchbot';
  var ROLE_KEY = 'echo-clock-switchbot-roles';

  var INTERVAL = 5 * 60 * 1000;    // 通常の再取得：5分（室温はゆっくりしか変わらない）
  var RETRY = 60 * 1000;           // 失敗したときの再試行：1分
  var STALE = 30 * 60 * 1000;      // これより古い値は表示しない：30分
  var TIMEOUT = 10 * 1000;         // 中継役の応答を待つ上限：10秒

  // 屋外に置いていそうな名前（SwitchBot アプリで付けた名前から推し量る）
  var OUTDOOR_NAME = /外|ベランダ|バルコニー|庭|outdoor|outside/i;

  // 機種名を、画面に出す呼び名にする
  var TYPE_NAMES = [
    [/WoIOSensor/i, '防水温湿度計'],
    [/CO2/i, 'CO2センサー'],
    [/MeterPro/i, '温湿度計Pro'],
    [/MeterPlus/i, '温湿度計プラス'],
    [/Meter/i, '温湿度計'],
    [/Hub\s?2/i, 'ハブ2'],
    [/Hub\s?3/i, 'ハブ3']
  ];

  var $ = function (id) { return document.getElementById(id); };

  // 室温を出す場所（1枚目と2枚目）。無くても動くようにしておく。
  var views = [
    { box: $('roomHome'), t: $('roomHomeT'), h: $('roomHomeH') },
    { box: $('roomAnalog'), t: $('roomAnalogT'), h: $('roomAnalogH') }
  ];

  var ui = {
    form: $('sbForm'), url: $('sbUrl'), save: $('sbSave'), state: $('sbState'), devs: $('sbDevs')
  };

  var endpoint = '';
  var devices = [];      // [{ id, name, type, main, temperature, humidity, battery, co2, error }]
  var multi = false;     // 中継役がまとめて返したか（古い中継役なら false）
  var lastAt = 0;        // 最後に取得できた時刻
  var lastError = null;  // 直前の取得の失敗理由（成功したら null）
  var roles = loadRoles();
  var timer = null;
  var failed = false;    // 直前の取得が失敗したか（同じ知らせを何度も出さないため）

  // ---------- 小さな道具 ----------
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /** 候補のキーを順に見て、最初に見つかった数値を返す */
  function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] in obj) {
        var n = num(obj[keys[i]]);
        if (n !== null) return n;
      }
    }
    return null;
  }

  function fmtTemp(v) {
    if (v === null) return '--°';
    // 小数第1位まで。ただし .0 のときは整数で見せる
    var r = Math.round(v * 10) / 10;
    return (r % 1 === 0 ? String(r) : r.toFixed(1)) + '°';
  }

  function fmtHum(v) {
    return v === null ? '--%' : Math.round(v) + '%';
  }

  function hasValue(d) {
    return !!d && (d.temperature !== null || d.humidity !== null);
  }

  function typeName(type) {
    for (var i = 0; i < TYPE_NAMES.length; i++) {
      if (TYPE_NAMES[i][0].test(type || '')) return TYPE_NAMES[i][1];
    }
    return type || '';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 保存と読み込み ----------
  function loadEndpoint() {
    var q = (new URLSearchParams(location.search).get('sb') || '').trim();
    if (q) return q;
    try { return (localStorage.getItem(KEY) || '').trim(); } catch (e) { return ''; }
  }

  function saveEndpoint(v) {
    try {
      if (v) localStorage.setItem(KEY, v);
      else localStorage.removeItem(KEY);
    } catch (e) { /* 保存できなくても、そのセッション中は動く */ }
  }

  function loadRoles() {
    try {
      var o = JSON.parse(localStorage.getItem(ROLE_KEY) || '{}');
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }

  function saveRoles() {
    try { localStorage.setItem(ROLE_KEY, JSON.stringify(roles)); } catch (e) { /* 無視 */ }
  }

  // ---------- 室内か屋外か ----------
  /** 機種と名前から推し量る。防水温湿度計（WoIOSensor）と「外」「ベランダ」などの名前は屋外 */
  function guessRole(d) {
    if (/WoIOSensor/i.test(d.type || '')) return 'out';
    if (OUTDOOR_NAME.test(d.name || '')) return 'out';
    return 'in';
  }

  /** 'in'（室内）/ 'out'（屋外）/ 'off'（出さない） */
  function roleOf(d) {
    // 古い中継役の1台は、これまでどおり室温として扱う
    if (!multi) return 'in';
    var r = roles[d.id];
    return (r === 'in' || r === 'out' || r === 'off') ? r : guessRole(d);
  }

  /** 1枚目・2枚目に出す1台：室内のうち、中継役の先頭（main）を優先 */
  function homeDevice() {
    var list = devices.filter(function (d) { return hasValue(d) && roleOf(d) === 'in'; });
    var main = list.filter(function (d) { return d.main; })[0];
    return main || list[0] || null;
  }

  function isFresh() {
    return lastAt > 0 && (Date.now() - lastAt) < STALE;
  }

  // ---------- 表示 ----------
  function render() {
    var d = isFresh() ? homeDevice() : null;

    for (var i = 0; i < views.length; i++) {
      var v = views[i];
      if (!v.box) continue;
      v.box.hidden = !d;
      if (!d) continue;
      if (v.t) v.t.textContent = fmtTemp(d.temperature);
      if (v.h) v.h.textContent = fmtHum(d.humidity);
      v.box.title = (d.name || '室内') + '　' +
        EC.pad2(new Date(lastAt).getHours()) + ':' +
        EC.pad2(new Date(lastAt).getMinutes()) + ' 更新' +
        (d.battery !== null ? '　電池 ' + d.battery + '%' : '');
    }
  }

  /** 温湿度の画面などに、新しい値が来たことを知らせる */
  function notify() {
    try {
      document.dispatchEvent(new CustomEvent('sensorsupdate', { detail: snapshot() }));
    } catch (e) { /* 古い環境では何もしない */ }
  }

  function snapshot() {
    return {
      configured: !!endpoint,
      multi: multi,
      at: lastAt,
      fresh: isFresh(),
      error: lastError,
      devices: devices.map(function (d) {
        return {
          id: d.id, name: d.name, type: d.type, typeName: typeName(d.type), main: d.main,
          role: roleOf(d), temperature: d.temperature, humidity: d.humidity,
          battery: d.battery, co2: d.co2, error: d.error
        };
      })
    };
  }

  // ---------- 取得 ----------
  /** 1台ぶんを、そろえた形にする */
  function normalize(b, fallbackId) {
    return {
      id: String(b.deviceId || fallbackId),
      name: b.name || b.deviceName || '',
      type: b.deviceType || '',
      main: !!b.main,
      temperature: pick(b, ['temperature', 'temp', 'temperature_c', 'tempC']),
      humidity: pick(b, ['humidity', 'humi', 'relative_humidity']),
      battery: pick(b, ['battery']),
      co2: pick(b, ['co2', 'CO2']),
      error: b.error ? String(b.error) : null
    };
  }

  /** 中継役が返した JSON から、温湿度計ごとの値を取り出す */
  function parse(json) {
    if (!json || typeof json !== 'object') throw new Error('JSON が読めませんでした');

    // まとめて返す新しい中継役
    if (Array.isArray(json.devices)) {
      var list = json.devices.map(function (b, i) { return normalize(b || {}, 'dev' + i); });
      if (!list.some(hasValue)) {
        throw new Error(json.error || (list[0] && list[0].error) || '温度・湿度が入っていませんでした');
      }
      return { multi: true, devices: list };
    }

    // SwitchBot の生レスポンス（{ statusCode, body }）にも対応する
    if (json.statusCode !== undefined && json.statusCode !== 100) {
      throw new Error('SwitchBot がエラーを返しました（statusCode ' + json.statusCode + '）');
    }
    var b = (json.body && typeof json.body === 'object') ? json.body : json;
    var one = normalize(b, 'main');
    if (!hasValue(one)) throw new Error('温度・湿度が入っていませんでした');
    if (!one.name) one.name = json.name || '';
    one.main = true;
    return { multi: false, devices: [one] };
  }

  /** 中継役を1回だけ叩く。成功すれば値、失敗すれば例外。 */
  function request(url) {
    // 途中で固まったときのために、時間切れを用意する
    var ctrl = null;
    var kill = null;
    try { ctrl = new AbortController(); } catch (e) { /* 非対応なら時間切れなし */ }

    var opts = { cache: 'no-store' };
    if (ctrl) {
      opts.signal = ctrl.signal;
      kill = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    }

    // all=1 で温湿度計をまとめてもらう。_= は中継役側のキャッシュ避け
    var sep = url.indexOf('?') >= 0 ? '&' : '?';

    return fetch(url + sep + 'all=1&_=' + Date.now(), opts)
      .then(function (r) {
        if (kill) clearTimeout(kill);
        if (r.ok) return r.json();
        // 中継役が理由を書いてくれていれば、それを伝える
        return r.json().catch(function () { return {}; }).then(function (j) {
          throw new Error('中継役が HTTP ' + r.status + ' を返しました' + (j && j.error ? '（' + j.error + '）' : ''));
        });
      })
      .then(parse)
      .catch(function (err) {
        if (kill) clearTimeout(kill);
        throw err;
      });
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (endpoint) timer = setTimeout(fetchRoom, ms);
  }

  function fetchRoom() {
    if (!endpoint) return;
    var target = endpoint;

    request(target)
      .then(function (data) {
        if (target !== endpoint) return;   // 取得中に設定が変わったら捨てる
        devices = data.devices;
        multi = data.multi;
        lastAt = Date.now();
        lastError = null;
        failed = false;
        render();
        setState('ok');
        notify();
        schedule(INTERVAL);
      })
      .catch(function (err) {
        if (target !== endpoint) return;
        console.warn('[switchbot]', err);
        if (!failed) {
          failed = true;
          if (EC.toast) EC.toast('室温の取得に失敗しました（自動で再試行します）');
        }
        lastError = (err && err.message) || '原因不明';
        setState('err', err);
        render();                          // 古くなっていれば隠れる
        notify();
        schedule(RETRY);
      });
  }

  // ---------- 設定ダイアログ ----------
  function setState(kind, err) {
    if (!ui.state) return;
    ui.state.classList.remove('is-ok', 'is-err');
    renderDevices();

    // 入力そのものが正しくないとき。まだ保存していないので、そのまま伝える。
    if (kind === 'bad') {
      ui.state.classList.add('is-err');
      ui.state.textContent = (err && err.message) || '入力を確認してください';
      return;
    }
    if (!endpoint) {
      ui.state.textContent = '未設定です。中継URLを入れると、室温と湿度が時計の下に出ます。';
      return;
    }
    if (kind === 'ok' && devices.length) {
      ui.state.classList.add('is-ok');
      var ok = devices.filter(hasValue);
      ui.state.textContent = '取得できました：' + ok.map(function (d) {
        return (d.name ? d.name + ' ' : '') + fmtTemp(d.temperature) + ' ' + fmtHum(d.humidity);
      }).join('　／　') + (multi ? '' : '（中継役が古いため1台だけ。README の手順で更新すると、屋外なども出せます）');
      return;
    }
    if (kind === 'err') {
      ui.state.classList.add('is-err');
      ui.state.textContent = '取得できません：' + (err && err.message ? err.message : '原因不明') +
        '（URLと、中継役が動いているかを確認してください）';
      return;
    }
    ui.state.textContent = '取得中…';
  }

  /** 温湿度計ごとに「室内／屋外／出さない」を選ぶ欄 */
  function renderDevices() {
    if (!ui.devs) return;
    var list = multi ? devices : [];
    ui.devs.hidden = !list.length;
    if (!list.length) { ui.devs.innerHTML = ''; return; }

    var CHOICES = [['in', '室内'], ['out', '屋外'], ['off', '出さない']];
    ui.devs.innerHTML = list.map(function (d) {
      var r = roleOf(d);
      var val = d.error ? '取得できません' : fmtTemp(d.temperature) + ' ' + fmtHum(d.humidity);
      return '<li class="sb-dev">' +
        '<div class="sb-dev-name"><b>' + esc(d.name || '温湿度計') + '</b>' +
        '<span>' + esc(typeName(d.type)) + '　' + esc(val) + '</span></div>' +
        '<div class="sb-seg" role="radiogroup" aria-label="' + esc(d.name || '温湿度計') + 'の出し方">' +
        CHOICES.map(function (c) {
          var on = c[0] === r;
          return '<button type="button" role="radio" aria-checked="' + on + '"' +
            (on ? ' class="is-on"' : '') +
            ' data-id="' + esc(d.id) + '" data-role="' + c[0] + '">' + c[1] + '</button>';
        }).join('') +
        '</div></li>';
    }).join('');
  }

  if (ui.devs) {
    ui.devs.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-role]') : null;
      if (!b) return;
      var id = b.getAttribute('data-id');
      var dev = devices.filter(function (d) { return d.id === id; })[0];
      var r = b.getAttribute('data-role');
      // 推し量った結果と同じなら覚えない（名前を変えたときに推し量り直せるように）
      if (dev && guessRole(dev) === r) delete roles[id];
      else roles[id] = r;
      saveRoles();
      renderDevices();
      render();
      notify();
    });
  }

  function applyEndpoint(v) {
    endpoint = v;
    saveEndpoint(v);
    devices = [];
    multi = false;
    lastAt = 0;
    lastError = null;
    failed = false;
    clearTimeout(timer);
    render();
    notify();

    if (!endpoint) {
      setState('none');
      return;
    }
    setState('loading');
    fetchRoom();
  }

  function onSubmit(e) {
    e.preventDefault();
    var v = (ui.url.value || '').trim();

    if (v) {
      // 中継役を同じ場所に置いた場合（Vercel など）は /api/switchbot のようにも書ける
      if (!/^(https?:\/\/|\/)/i.test(v)) {
        setState('bad', new Error('https:// で始まる URL か、/api/switchbot のように / で始まる道すじを入れてください'));
        return;
      }
      // https のページから http を読むと、ブラウザが止めてしまう
      if (location.protocol === 'https:' && /^http:\/\//i.test(v)) {
        setState('bad', new Error('このページは https なので、中継URLも https にしてください'));
        return;
      }
    }
    applyEndpoint(v);
  }

  // ---------- 起動 ----------
  endpoint = loadEndpoint();
  if (ui.url) ui.url.value = endpoint;
  if (ui.form) ui.form.addEventListener('submit', onSubmit);
  setState(endpoint ? 'loading' : 'none');
  render();

  if (endpoint) fetchRoom();

  // 画面が戻ってきたとき、値が古ければ取り直す
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !endpoint) return;
    if (!lastAt || (Date.now() - lastAt) > INTERVAL) fetchRoom();
  });

  // 他のファイルから室温を使えるようにしておく
  EC.getRoom = function () {
    var d = isFresh() ? homeDevice() : null;
    if (!d) return null;
    return {
      temperature: d.temperature,
      humidity: d.humidity,
      name: d.name,
      battery: d.battery,
      at: lastAt
    };
  };

  /** 温湿度計すべて（温湿度の画面用） */
  EC.getSensors = snapshot;

  /** 設定ダイアログを開いて、中継URLの欄を見せる */
  EC.openSensorSettings = function () {
    if (EC.openSettings) EC.openSettings({ noFocus: true });
    var box = ui.form && ui.form.parentNode;
    if (box && box.scrollIntoView) {
      try { box.scrollIntoView({ block: 'nearest' }); } catch (e) { box.scrollIntoView(false); }
    }
  };
})();
