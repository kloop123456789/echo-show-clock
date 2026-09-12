/* ============================================================
   SwitchBot の温湿度計から「室温・湿度」を取り出して表示する

   SwitchBot の API はブラウザから直接呼べない。
   （CORS＝よそのサイトからの読み取り許可、が出ていないため）
   そこで間に「中継役」を1つ置き、このファイルはその中継役だけを叩く。
   中継役は Vercel 用（api/switchbot.js）と
   Cloudflare Workers 用（switchbot-proxy/worker.js）の2種類を用意してある。
   作り方は README の「室温・湿度を出す（SwitchBot）」を参照。

   中継役が返す JSON（どの書き方でも読めるようにしてある）:
     { "temperature": 24.3, "humidity": 52, "name": "リビング" }
     { "body": { "temperature": 24.3, "humidity": 52 } }   ← SwitchBot の生の形

   中継URLは設定ダイアログで入力し、localStorage に保存する。
   URL に ?sb=https://... を付けた場合はそちらが優先。
   未設定のときは室温の表示そのものが出ないので、見た目は元のまま。
   ============================================================ */
(function () {
  'use strict';

  var EC = window.EC || {};
  var KEY = 'echo-clock-switchbot';

  var INTERVAL = 5 * 60 * 1000;    // 通常の再取得：5分（室温はゆっくりしか変わらない）
  var RETRY = 60 * 1000;           // 失敗したときの再試行：1分
  var STALE = 30 * 60 * 1000;      // これより古い値は表示しない：30分
  var TIMEOUT = 10 * 1000;         // 中継役の応答を待つ上限：10秒

  var $ = function (id) { return document.getElementById(id); };

  // 室温を出す場所（1枚目と2枚目）。無くても動くようにしておく。
  var views = [
    { box: $('roomHome'), t: $('roomHomeT'), h: $('roomHomeH') },
    { box: $('roomAnalog'), t: $('roomAnalogT'), h: $('roomAnalogH') }
  ];

  var ui = {
    form: $('sbForm'), url: $('sbUrl'), save: $('sbSave'), state: $('sbState')
  };

  var endpoint = '';
  var last = null;       // { temperature, humidity, name, battery, at }
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

  // ---------- 表示 ----------
  function render() {
    var fresh = !!last && (Date.now() - last.at) < STALE &&
      (last.temperature !== null || last.humidity !== null);

    for (var i = 0; i < views.length; i++) {
      var v = views[i];
      if (!v.box) continue;
      v.box.hidden = !fresh;
      if (!fresh) continue;
      if (v.t) v.t.textContent = fmtTemp(last.temperature);
      if (v.h) v.h.textContent = fmtHum(last.humidity);
      v.box.title = (last.name || '室内') + '　' +
        EC.pad2(new Date(last.at).getHours()) + ':' +
        EC.pad2(new Date(last.at).getMinutes()) + ' 更新' +
        (last.battery !== null ? '　電池 ' + last.battery + '%' : '');
    }
  }

  // ---------- 取得 ----------
  /** 中継役が返した JSON から、室温・湿度を取り出す */
  function parse(json) {
    if (!json || typeof json !== 'object') throw new Error('JSON が読めませんでした');

    // SwitchBot の生レスポンス（{ statusCode, body }）にも対応する
    if (json.statusCode !== undefined && json.statusCode !== 100) {
      throw new Error('SwitchBot がエラーを返しました（statusCode ' + json.statusCode + '）');
    }
    var b = (json.body && typeof json.body === 'object') ? json.body : json;

    var temperature = pick(b, ['temperature', 'temp', 'temperature_c', 'tempC']);
    var humidity = pick(b, ['humidity', 'humi', 'relative_humidity']);
    if (temperature === null && humidity === null) {
      throw new Error('温度・湿度が入っていませんでした');
    }

    return {
      temperature: temperature,
      humidity: humidity,
      name: b.name || b.deviceName || json.name || '',
      battery: pick(b, ['battery']),
      at: Date.now()
    };
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

    // 中継役側のキャッシュ避け
    var sep = url.indexOf('?') >= 0 ? '&' : '?';

    return fetch(url + sep + '_=' + Date.now(), opts)
      .then(function (r) {
        if (kill) clearTimeout(kill);
        if (!r.ok) throw new Error('中継役が HTTP ' + r.status + ' を返しました');
        return r.json();
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
        last = data;
        failed = false;
        render();
        setState('ok');
        schedule(INTERVAL);
      })
      .catch(function (err) {
        if (target !== endpoint) return;
        console.warn('[switchbot]', err);
        if (!failed) {
          failed = true;
          if (EC.toast) EC.toast('室温の取得に失敗しました（自動で再試行します）');
        }
        setState('err', err);
        render();                          // 古くなっていれば隠れる
        schedule(RETRY);
      });
  }

  // ---------- 設定ダイアログ ----------
  function setState(kind, err) {
    if (!ui.state) return;
    ui.state.classList.remove('is-ok', 'is-err');

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
    if (kind === 'ok' && last) {
      ui.state.classList.add('is-ok');
      ui.state.textContent = '取得できました：' +
        (last.name ? last.name + '　' : '') + fmtTemp(last.temperature) + '　' + fmtHum(last.humidity);
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

  function applyEndpoint(v) {
    endpoint = v;
    saveEndpoint(v);
    last = null;
    failed = false;
    clearTimeout(timer);
    render();

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
    if (!last || (Date.now() - last.at) > INTERVAL) fetchRoom();
  });

  // 他のファイルから室温を使えるようにしておく
  EC.getRoom = function () {
    if (!last || (Date.now() - last.at) >= STALE) return null;
    return {
      temperature: last.temperature,
      humidity: last.humidity,
      name: last.name,
      battery: last.battery,
      at: last.at
    };
  };
})();
