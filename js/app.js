/* ============================================================
   Echo Clock & Weather
   時計＋天気予報（Open-Meteo API / APIキー不要）

   - 時刻は 1 秒ごとに更新
   - 天気は 10 分ごとに再取得（失敗しても直前の表示を保持）
   - 場所は localStorage に保存。URL の ?lat=&lon=&name= が最優先
   ============================================================ */
'use strict';

(function () {
  // ---------- 古いブラウザ対策 ----------
  // Echo Show の Silk ブラウザなど、replaceChildren 未対応の環境を補う
  if (!Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
      for (var i = 0; i < arguments.length; i++) {
        var n = arguments[i];
        this.appendChild(typeof n === 'string' ? document.createTextNode(n) : n);
      }
    };
  }

  // ---------- 設定 ----------
  var DEFAULT_PLACE = { name: '東京', lat: 35.6895, lon: 139.6917 };
  var WEATHER_INTERVAL = 10 * 60 * 1000;   // 天気の再取得：10分
  var RETRY_INTERVAL = 60 * 1000;          // 失敗時の再試行：1分
  var HOURLY_COUNT = 8;                    // 時間ごとの表示コマ数
  var DAILY_COUNT = 3;                     // 日ごとの表示日数
  var STORAGE_KEY = 'echo-clock-place';

  var API_FORECAST = 'https://api.open-meteo.com/v1/forecast';
  var API_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    body: document.body,
    hm: $('hm'), sec: $('sec'), date: $('date'),
    placeBtn: $('placeBtn'), placeName: $('placeName'),
    updated: $('updated'), sunRow: $('sunRow'),
    nowIcon: $('nowIcon'), nowTemp: $('nowTemp'), nowDesc: $('nowDesc'),
    dFeel: $('dFeel'), dPop: $('dPop'), dHum: $('dHum'), dWind: $('dWind'),
    hourly: $('hourly'), hourlyTitle: $('hourlyTitle'), daily: $('daily'),
    track: $('track'), dots: $('dots'), stage: document.querySelector('.stage'),
    analog: $('analog'), handH: $('handH'), handM: $('handM'), handS: $('handS'),
    analogTicks: $('analogTicks'), analogNums: $('analogNums'),
    aDate: $('aDate'), aTime: $('aTime'), aIcon: $('aIcon'), aTemp: $('aTemp'),
    aDesc: $('aDesc'), aMini: $('aMini'), aPlace: $('aPlace'),
    toast: $('toast'), fsBtn: $('fsBtn'),
    settings: $('settings'), searchForm: $('searchForm'), searchInput: $('searchInput'),
    results: $('results'), geoBtn: $('geoBtn'), closeBtn: $('closeBtn')
  };

  // ---------- 天気コード（WMO）→ 表示名・アイコン ----------
  // [日本語名, 昼アイコン, 夜アイコン, 背景クラス]
  var WMO = {
    0:  ['快晴',       'i-sun',        'i-moon',        'clear'],
    1:  ['晴れ',       'i-sun',        'i-moon',        'clear'],
    2:  ['薄曇り',     'i-cloud-sun',  'i-cloud-moon',  'partly'],
    3:  ['曇り',       'i-cloud',      'i-cloud',       'cloudy'],
    45: ['霧',         'i-fog',        'i-fog',         'cloudy'],
    48: ['霧氷',       'i-fog',        'i-fog',         'cloudy'],
    51: ['弱い霧雨',   'i-drizzle',    'i-drizzle',     'rain'],
    53: ['霧雨',       'i-drizzle',    'i-drizzle',     'rain'],
    55: ['強い霧雨',   'i-drizzle',    'i-drizzle',     'rain'],
    56: ['着氷性霧雨', 'i-sleet',      'i-sleet',       'rain'],
    57: ['着氷性霧雨', 'i-sleet',      'i-sleet',       'rain'],
    61: ['小雨',       'i-rain',       'i-rain',        'rain'],
    63: ['雨',         'i-rain',       'i-rain',        'rain'],
    65: ['大雨',       'i-heavy-rain', 'i-heavy-rain',  'rain'],
    66: ['着氷性の雨', 'i-sleet',      'i-sleet',       'rain'],
    67: ['着氷性の雨', 'i-sleet',      'i-sleet',       'rain'],
    71: ['小雪',       'i-snow',       'i-snow',        'snow'],
    73: ['雪',         'i-snow',       'i-snow',        'snow'],
    75: ['大雪',       'i-snow',       'i-snow',        'snow'],
    77: ['細氷',       'i-snow',       'i-snow',        'snow'],
    80: ['にわか雨',   'i-rain',       'i-rain',        'rain'],
    81: ['にわか雨',   'i-rain',       'i-rain',        'rain'],
    82: ['激しい雨',   'i-heavy-rain', 'i-heavy-rain',  'rain'],
    85: ['にわか雪',   'i-snow',       'i-snow',        'snow'],
    86: ['にわか雪',   'i-snow',       'i-snow',        'snow'],
    95: ['雷雨',       'i-thunder',    'i-thunder',     'storm'],
    96: ['雷雨(雹)',   'i-thunder',    'i-thunder',     'storm'],
    99: ['雷雨(雹)',   'i-thunder',    'i-thunder',     'storm']
  };
  var WMO_UNKNOWN = ['---', 'i-cloud', 'i-cloud', 'cloudy'];

  function wmo(code) { return WMO[code] || WMO_UNKNOWN; }
  function wmoLabel(code) { return wmo(code)[0]; }
  function wmoIcon(code, isDay) { return wmo(code)[isDay ? 1 : 2]; }
  function wmoClass(code) { return wmo(code)[3]; }

  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  // ---------- 小さなユーティリティ ----------
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function round(n) { return Math.round(Number(n)); }
  function isNum(n) { return typeof n === 'number' && isFinite(n); }

  /** Open-Meteo が返す "2026-09-06T14:00" をローカル時刻扱いで Date に変換 */
  function parseLocal(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  }

  function hhmm(dateStr) {
    var d = parseLocal(dateStr);
    return d ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '--:--';
  }

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 6000);
  }

  function svgIcon(id, cls) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function setUse(svgEl, id) {
    var use = svgEl.querySelector('use');
    if (use) use.setAttribute('href', '#' + id);
  }

  // ---------- 時計 ----------
  var secondSubs = [];   // 1秒ごとに呼ぶ処理（tools.js から登録される）

  function tick() {
    var now = new Date();
    var hm = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    var dateText = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' +
      now.getDate() + '日（' + WEEK[now.getDay()] + '）';

    el.hm.textContent = hm;
    el.sec.textContent = pad2(now.getSeconds());
    el.date.textContent = dateText;

    // アナログ時計の脇に出す日付と時刻
    el.aTime.textContent = hm;
    el.aDate.textContent = dateText;

    for (var i = 0; i < secondSubs.length; i++) {
      try { secondSubs[i](now); } catch (e) { console.warn('[tick]', e); }
    }
  }

  /** 秒の境目に合わせて 1 秒ごとに更新（ずれを溜めない） */
  function startClock() {
    tick();
    setTimeout(function loop() {
      tick();
      setTimeout(loop, 1000 - (Date.now() % 1000));
    }, 1000 - (Date.now() % 1000));
  }

  // ---------- 背景（時間帯 × 天気） ----------
  var PERIOD_CLASSES = ['period-dawn', 'period-day', 'period-dusk', 'period-night'];
  var WX_CLASSES = ['wx-clear', 'wx-partly', 'wx-cloudy', 'wx-rain', 'wx-snow', 'wx-storm'];

  var PALETTE = {
    'dawn-clear':   ['#1a1a40', '#4c3b74', '#a8695a'],
    'day-clear':    ['#0a3f86', '#1565b8', '#2f8ac9'],
    'day-partly':   ['#123a63', '#2a5f92', '#4180ad'],
    'day-cloudy':   ['#2b3746', '#44546a', '#5c6d83'],
    'day-rain':     ['#1b283a', '#2d3e56', '#41566f'],
    'day-snow':     ['#38455a', '#54637a', '#707f95'],
    'day-storm':    ['#161d2b', '#2a3550', '#3e3558'],
    'dusk-clear':   ['#221c45', '#663d64', '#b16043'],
    'night-clear':  ['#070b1e', '#12193a', '#0a0f24'],
    'night-partly': ['#080c20', '#161e42', '#0d1229'],
    'night-cloudy': ['#0d1220', '#1e2740', '#141a2c'],
    'night-rain':   ['#0a1120', '#182338', '#101828'],
    'night-snow':   ['#111a2c', '#25324a', '#18202f'],
    'night-storm':  ['#080b16', '#1d1f3a', '#0f1020']
  };

  function periodOf(now, sunrise, sunset) {
    var t = now.getTime();
    if (sunrise && sunset) {
      var sr = sunrise.getTime(), ss = sunset.getTime(), h = 60 * 60 * 1000;
      if (t >= sr - h && t < sr + h) return 'dawn';
      if (t >= sr + h && t < ss - h) return 'day';
      if (t >= ss - h && t < ss + h) return 'dusk';
      return 'night';
    }
    var hh = now.getHours();
    if (hh >= 5 && hh < 7) return 'dawn';
    if (hh >= 7 && hh < 17) return 'day';
    if (hh >= 17 && hh < 19) return 'dusk';
    return 'night';
  }

  function applyTheme(period, wxClass) {
    // 背景を固定する設定のときは、色も光も変えない
    if (FIXED_BG) return;
    PERIOD_CLASSES.forEach(function (c) { el.body.classList.remove(c); });
    WX_CLASSES.forEach(function (c) { el.body.classList.remove(c); });
    el.body.classList.add('period-' + period);
    el.body.classList.add('wx-' + wxClass);

    // 朝夕は「晴れ」系の色を共有し、荒天ならその天気色を優先
    var key = period + '-' + wxClass;
    if (!PALETTE[key]) {
      if (period === 'dawn' || period === 'dusk') {
        key = (wxClass === 'clear' || wxClass === 'partly')
          ? period + '-clear'
          : 'day-' + wxClass;
      } else {
        key = 'night-' + wxClass;
      }
    }
    var p = PALETTE[key] || PALETTE['night-clear'];
    var s = document.documentElement.style;
    s.setProperty('--bg1', p[0]);
    s.setProperty('--bg2', p[1]);
    s.setProperty('--bg3', p[2]);
  }

  // ---------- 場所の保存・読み込み ----------
  function loadPlace() {
    // 1) URL パラメータが最優先
    var q = new URLSearchParams(location.search);
    var lat = parseFloat(q.get('lat'));
    var lon = parseFloat(q.get('lon'));
    if (isNum(lat) && isNum(lon)) {
      return { name: q.get('name') || (lat.toFixed(2) + ', ' + lon.toFixed(2)), lat: lat, lon: lon };
    }
    // 2) 前回選んだ場所
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && isNum(saved.lat) && isNum(saved.lon) && saved.name) return saved;
    } catch (e) { /* 壊れていたら無視 */ }
    // 3) 既定値
    return DEFAULT_PLACE;
  }

  function savePlace(p) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) { /* 保存できなくても動く */ }
  }

  // ---------- 背景の明るさ ----------
  // ?bg=fixed を付けると、時間帯や天気で背景の色を変えない。
  // 24時間つけっぱなしにする画面で、明るさが変わるのを避けたいとき用。
  var FIXED_BG = (function () {
    var v = (new URLSearchParams(location.search).get('bg') || '').toLowerCase();
    return v === 'fixed' || v === 'dark';
  })();
  if (FIXED_BG) document.body.classList.add('bg-fixed');

  // ---------- 時間ごとの表示間隔 ----------
  // 既定は 2 時間おき（8コマ＝16時間先まで）。?step=1 で 1 時間おき。
  var STEP = (function () {
    var s = parseInt(new URLSearchParams(location.search).get('step'), 10);
    return (s === 1 || s === 2 || s === 3) ? s : 2;
  })();

  // ---------- 天気の取得 ----------
  var place = loadPlace();
  var weatherTimer = null;
  var lastData = null;

  function forecastUrl(p) {
    var params = new URLSearchParams({
      latitude: p.lat,
      longitude: p.lon,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
      hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
      timezone: 'auto',
      wind_speed_unit: 'ms',
      forecast_days: '4'
    });
    return API_FORECAST + '?' + params.toString();
  }

  function fetchWeather() {
    var target = place;
    fetch(forecastUrl(target), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (target !== place) return;   // 取得中に場所が変わったら破棄
        lastData = data;
        render(data);
        el.toast.hidden = true;
        schedule(WEATHER_INTERVAL);
      })
      .catch(function (err) {
        toast('天気の取得に失敗しました（自動で再試行します）');
        console.warn('[weather]', err);
        schedule(RETRY_INTERVAL);
      });
  }

  function schedule(ms) {
    clearTimeout(weatherTimer);
    weatherTimer = setTimeout(fetchWeather, ms);
  }

  // ---------- 描画 ----------
  function render(d) {
    var cur = d.current || {};
    var hourly = d.hourly || {};
    var daily = d.daily || {};
    var now = new Date();

    // 現在の天気
    var isDay = cur.is_day === 1 || cur.is_day === true;
    var code = cur.weather_code;
    el.nowTemp.textContent = isNum(cur.temperature_2m) ? round(cur.temperature_2m) : '--';
    el.nowDesc.textContent = wmoLabel(code);
    setUse(el.nowIcon, wmoIcon(code, isDay));

    el.dFeel.textContent = isNum(cur.apparent_temperature) ? round(cur.apparent_temperature) + '°' : '--°';
    el.dHum.textContent = isNum(cur.relative_humidity_2m) ? round(cur.relative_humidity_2m) + '%' : '--%';
    el.dWind.textContent = isNum(cur.wind_speed_10m) ? cur.wind_speed_10m.toFixed(1) + ' m/s' : '-- m/s';

    // 現在時刻に最も近い hourly のインデックス
    var times = hourly.time || [];
    var startIdx = 0;
    for (var i = 0; i < times.length; i++) {
      var t = parseLocal(times[i]);
      if (t && t.getTime() <= now.getTime()) startIdx = i; else break;
    }

    // 直近の降水確率は hourly から
    var pops = hourly.precipitation_probability || [];
    el.dPop.textContent = isNum(pops[startIdx]) ? pops[startIdx] + '%' : '--%';

    // 日の出・日の入り
    var sunrises = daily.sunrise || [];
    var sunsets = daily.sunset || [];
    if (sunrises[0] && sunsets[0]) {
      el.sunRow.innerHTML =
        '<span><span class="k">日の出</span>' + hhmm(sunrises[0]) + '</span>' +
        '<span><span class="k">日の入</span>' + hhmm(sunsets[0]) + '</span>';
    } else {
      el.sunRow.textContent = '';
    }

    renderHourly(hourly, startIdx);
    renderDaily(daily);
    renderAnalogSide(cur, daily, isDay, code);

    // 背景テーマ
    applyTheme(periodOf(now, parseLocal(sunrises[0]), parseLocal(sunsets[0])), wmoClass(code));

    el.updated.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ' 更新';
    el.placeName.textContent = place.name;
    document.title = round(cur.temperature_2m) + '° ' + wmoLabel(code) + ' - ' + place.name;
  }

  /** アナログ時計の右側にある天気まとめ */
  function renderAnalogSide(cur, daily, isDay, code) {
    setUse(el.aIcon, wmoIcon(code, isDay));
    el.aTemp.textContent = isNum(cur.temperature_2m) ? round(cur.temperature_2m) : '--';
    el.aDesc.textContent = wmoLabel(code);
    el.aPlace.textContent = place.name;

    var times = daily.time || [];
    var codes = daily.weather_code || [];
    var maxs = daily.temperature_2m_max || [];
    var mins = daily.temperature_2m_min || [];

    var frag = document.createDocumentFragment();
    for (var n = 0; n < 3 && n < times.length; n++) {
      var li = document.createElement('li');

      var d = document.createElement('span');
      d.className = 'd';
      var dt = parseLocal(times[n]);
      if (n === 0) d.textContent = '今日';
      else if (n === 1) d.textContent = '明日';
      else d.textContent = dt ? WEEK[dt.getDay()] : '--';
      li.appendChild(d);

      li.appendChild(svgIcon(wmoIcon(codes[n], true), ''));

      var t = document.createElement('span');
      t.className = 't';
      t.appendChild(document.createTextNode((isNum(maxs[n]) ? round(maxs[n]) : '--') + '°'));
      var lo = document.createElement('span');
      lo.className = 'lo';
      lo.textContent = (isNum(mins[n]) ? round(mins[n]) : '--') + '°';
      t.appendChild(lo);
      li.appendChild(t);

      frag.appendChild(li);
    }
    el.aMini.replaceChildren(frag);
  }

  function renderHourly(hourly, startIdx) {
    var times = hourly.time || [];
    var temps = hourly.temperature_2m || [];
    var pops = hourly.precipitation_probability || [];
    var codes = hourly.weather_code || [];
    var days = hourly.is_day || [];

    el.hourlyTitle.textContent = STEP === 1 ? '1時間ごと' : STEP + '時間ごと';

    var frag = document.createDocumentFragment();
    for (var n = 0; n < HOURLY_COUNT; n++) {
      var i = startIdx + n * STEP;
      if (i >= times.length) break;

      var li = document.createElement('li');
      li.className = 'cell' + (n === 0 ? ' now' : '');

      var d = parseLocal(times[i]);
      var label = document.createElement('div');
      label.className = 't';
      label.textContent = (n === 0) ? 'いま' : (d ? d.getHours() + '時' : '--');
      li.appendChild(label);

      li.appendChild(svgIcon(wmoIcon(codes[i], days[i] === 1), 'ic'));

      var tp = document.createElement('div');
      tp.className = 'tp';
      tp.textContent = (isNum(temps[i]) ? round(temps[i]) : '--') + '°';
      li.appendChild(tp);

      li.appendChild(popEl(pops[i]));
      frag.appendChild(li);
    }
    el.hourly.replaceChildren(frag);
  }

  function renderDaily(daily) {
    var times = daily.time || [];
    var codes = daily.weather_code || [];
    var maxs = daily.temperature_2m_max || [];
    var mins = daily.temperature_2m_min || [];
    var pops = daily.precipitation_probability_max || [];

    var frag = document.createDocumentFragment();
    for (var n = 0; n < DAILY_COUNT && n < times.length; n++) {
      var li = document.createElement('li');
      li.className = 'cell';

      var d = parseLocal(times[n]);
      var label = document.createElement('div');
      label.className = 't';
      if (n === 0) label.textContent = '今日';
      else if (n === 1) label.textContent = '明日';
      else label.textContent = d ? (d.getMonth() + 1) + '/' + d.getDate() + '（' + WEEK[d.getDay()] + '）' : '--';
      li.appendChild(label);

      li.appendChild(svgIcon(wmoIcon(codes[n], true), 'ic'));

      var tp = document.createElement('div');
      tp.className = 'tp';
      tp.appendChild(document.createTextNode((isNum(maxs[n]) ? round(maxs[n]) : '--') + '°'));
      var lo = document.createElement('span');
      lo.className = 'lo';
      lo.textContent = (isNum(mins[n]) ? round(mins[n]) : '--') + '°';
      tp.appendChild(lo);
      li.appendChild(tp);

      li.appendChild(popEl(pops[n]));
      frag.appendChild(li);
    }
    el.daily.replaceChildren(frag);
  }

  function popEl(v) {
    var pp = document.createElement('div');
    var val = isNum(v) ? v : 0;
    pp.className = 'pp' + (val === 0 ? ' none' : '');
    pp.appendChild(svgIcon('i-drop', ''));
    pp.appendChild(document.createTextNode(val + '%'));
    return pp;
  }

  /** 骨組みだけ先に出しておき、取得後に本物と差し替える */
  function renderSkeleton() {
    function cells(list, count) {
      var frag = document.createDocumentFragment();
      for (var i = 0; i < count; i++) {
        var li = document.createElement('li');
        li.className = 'cell skeleton';
        li.innerHTML = '<div class="t">--</div>';
        li.appendChild(svgIcon('i-cloud', 'ic'));
        var tp = document.createElement('div');
        tp.className = 'tp';
        tp.textContent = '--°';
        li.appendChild(tp);
        li.appendChild(popEl(null));
        frag.appendChild(li);
      }
      list.replaceChildren(frag);
    }
    cells(el.hourly, HOURLY_COUNT);
    cells(el.daily, DAILY_COUNT);
    el.placeName.textContent = place.name;
    el.aPlace.textContent = place.name;
  }

  // ---------- 場所の設定ダイアログ ----------
  var settingsFocus = null;
  function openSettings() {
    settingsFocus = document.activeElement;
    el.settings.hidden = false;
    el.results.replaceChildren();
    el.searchInput.value = '';
    setTimeout(function () { if (!el.settings.hidden) el.searchInput.focus(); }, 50);
  }
  function closeSettings() {
    el.settings.hidden = true;
    if (settingsFocus && settingsFocus.focus) settingsFocus.focus();
  }

  function msgItem(text) {
    var li = document.createElement('li');
    li.className = 'msg';
    li.textContent = text;
    return li;
  }

  function searchPlace(q) {
    el.results.replaceChildren(msgItem('検索中…'));
    var url = API_GEOCODE + '?' + new URLSearchParams({
      name: q, count: '8', language: 'ja', format: 'json'
    }).toString();

    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var list = (data && data.results) || [];
        if (!list.length) {
          el.results.replaceChildren(
            msgItem('見つかりませんでした。ローマ字（例：Osaka、Kyoto）でもお試しください。')
          );
          return;
        }
        var frag = document.createDocumentFragment();
        list.forEach(function (r) {
          var li = document.createElement('li');
          var btn = document.createElement('button');
          btn.type = 'button';

          var main = document.createElement('span');
          main.textContent = r.name;
          var sub = document.createElement('span');
          sub.className = 'sub';
          sub.textContent = [r.admin1, r.country].filter(Boolean).join(' / ');
          btn.appendChild(main);
          btn.appendChild(sub);

          btn.addEventListener('click', function () {
            setPlace({ name: r.name, lat: r.latitude, lon: r.longitude });
            closeSettings();
          });
          li.appendChild(btn);
          frag.appendChild(li);
        });
        el.results.replaceChildren(frag);
      })
      .catch(function () {
        el.results.replaceChildren(msgItem('検索に失敗しました。通信状態をご確認ください。'));
      });
  }

  function setPlace(p) {
    place = p;
    lastData = null;
    savePlace(p);
    el.placeName.textContent = p.name;
    el.aPlace.textContent = p.name;
    el.updated.textContent = '';
    renderSkeleton();
    clearTimeout(weatherTimer);
    fetchWeather();
  }

  function useGeolocation() {
    if (!navigator.geolocation) {
      el.results.replaceChildren(msgItem('この端末では現在地を取得できません。'));
      return;
    }
    el.results.replaceChildren(msgItem('現在地を取得中…'));
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lat = pos.coords.latitude, lon = pos.coords.longitude;
        // 逆ジオコーディングは使わず、近い都市名を軽く引く
        setPlace({ name: '現在地', lat: lat, lon: lon });
        closeSettings();
      },
      function () {
        el.results.replaceChildren(msgItem('現在地を取得できませんでした（位置情報の許可をご確認ください）。'));
      },
      { timeout: 10000, maximumAge: 600000 }
    );
  }

  // ---------- イベント ----------
  el.placeBtn.addEventListener('click', openSettings);
  el.closeBtn.addEventListener('click', closeSettings);
  el.geoBtn.addEventListener('click', useGeolocation);
  el.settings.addEventListener('click', function (e) {
    if (e.target === el.settings) closeSettings();
  });
  function submitSearch(e) {
    if (e) e.preventDefault();
    var q = el.searchInput.value.trim();
    if (q) searchPlace(q);
  }
  el.searchForm.addEventListener('submit', submitSearch);
  // 一部の組み込みブラウザでは form の submit が発火しないため保険をかける
  el.searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.keyCode === 13) submitSearch(e);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.settings.hidden) closeSettings();
  });

  el.fsBtn.addEventListener('click', function () {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () { /* 拒否されても無視 */ });
    }
  });

  // スリープ復帰・再接続時は即座に更新
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { tick(); schedule(0); }
  });
  window.addEventListener('online', function () { schedule(0); });

  // ---------- アナログ時計 ----------
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /** 目盛りと数字を作る（HTML を汚さないよう JS で組み立てる） */
  function buildAnalog() {
    var i, a, r1, line, t;
    for (i = 0; i < 60; i++) {
      a = i * 6 * Math.PI / 180;
      r1 = (i % 5 === 0) ? 79 : 84.5;
      line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', (100 + r1 * Math.sin(a)).toFixed(2));
      line.setAttribute('y1', (100 - r1 * Math.cos(a)).toFixed(2));
      line.setAttribute('x2', (100 + 88 * Math.sin(a)).toFixed(2));
      line.setAttribute('y2', (100 - 88 * Math.cos(a)).toFixed(2));
      line.setAttribute('class', 'tick' + (i % 5 === 0 ? ' major' : ''));
      el.analogTicks.appendChild(line);
    }
    for (i = 1; i <= 12; i++) {
      a = i * 30 * Math.PI / 180;
      t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', (100 + 66 * Math.sin(a)).toFixed(2));
      t.setAttribute('y', (100 - 66 * Math.cos(a)).toFixed(2));
      t.setAttribute('class', 'num');
      t.textContent = String(i);
      el.analogNums.appendChild(t);
    }
  }

  /** 針の向きを更新。秒針はなめらかに動かす */
  function updateAnalog(now) {
    var sec = now.getSeconds() + now.getMilliseconds() / 1000;
    var min = now.getMinutes() + sec / 60;
    var hour = (now.getHours() % 12) + min / 60;
    el.handH.setAttribute('transform', 'rotate(' + (hour * 30).toFixed(3) + ' 100 100)');
    el.handM.setAttribute('transform', 'rotate(' + (min * 6).toFixed(3) + ' 100 100)');
    el.handS.setAttribute('transform', 'rotate(' + (sec * 6).toFixed(3) + ' 100 100)');
  }

  var analogRaf = 0;
  function startAnalog() {
    if (analogRaf) return;
    (function loop() {
      updateAnalog(new Date());
      analogRaf = requestAnimationFrame(loop);
    })();
  }
  function stopAnalog() {
    if (analogRaf) { cancelAnimationFrame(analogRaf); analogRaf = 0; }
  }

  // ---------- スライダー ----------
  var SLIDE_COUNT = document.querySelectorAll('.slide').length || 1;
  var slideIndex = 0;

  function goTo(i, animate) {
    slideIndex = Math.max(0, Math.min(SLIDE_COUNT - 1, i));
    if (animate === false) el.track.classList.add('dragging');
    el.track.style.transform = 'translateX(' + (-100 * slideIndex) + '%)';
    if (animate === false) {
      void el.track.offsetWidth;              // 反映してから transition を戻す
      el.track.classList.remove('dragging');
    }
    var dots = el.dots.children;
    for (var n = 0; n < dots.length; n++) {
      if (n === slideIndex) dots[n].classList.add('is-on');
      else dots[n].classList.remove('is-on');
    }
    // アナログ時計は表示中だけ動かす（無駄な描画を避ける）
    if (slideIndex === 1) { updateAnalog(new Date()); startAnalog(); }
    else stopAnalog();

    // 表示中の画面が変わったことを他のファイルに知らせる
    try {
      document.dispatchEvent(new CustomEvent('slidechange', { detail: { index: slideIndex } }));
    } catch (e) { /* 古い環境では何もしない */ }
  }

  /** ボタンや入力欄の上から始まったドラッグはスライドさせない */
  function isControl(node) {
    while (node && node !== el.track) {
      var tag = node.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' ||
          tag === 'TEXTAREA' || tag === 'LABEL' || tag === 'A') return true;
      if (node.classList && node.classList.contains('no-swipe')) return true;
      node = node.parentNode;
    }
    return false;
  }

  function initSwipe() {
    // 指を離すときの判定に使う値
    var MOVE_RATIO = 0.08;   // これだけ動かせば必ず切り替える（画面幅に対する割合）
    var FLICK_SPEED = 0.28;  // 素早く払ったと判断する速さ（px/ミリ秒）
    var FLICK_MIN = 18;      // 払いと認めるための最小の移動量（px）
    var LOCK_AT = 10;        // 縦か横かを決めるまでの移動量（px）

    var startX = 0, startY = 0, dx = 0, active = false, decided = false, width = 1;
    var lastX = 0, lastT = 0, startT = 0, speed = 0, pointer = null;

    function down(e) {
      if (e.button != null && e.button !== 0) return;
      if (isControl(e.target)) return;
      active = true; decided = false; dx = 0; speed = 0;
      startX = lastX = e.clientX;
      startY = e.clientY;
      lastT = startT = Date.now();
      width = el.stage.getBoundingClientRect().width || 1;
      el.track.classList.add('dragging');
      // 指が要素の外に出ても追いかけられるようにする
      pointer = (e.pointerId == null) ? null : e.pointerId;
      if (pointer != null && el.track.setPointerCapture) {
        try { el.track.setPointerCapture(pointer); } catch (err) { /* 非対応なら無視 */ }
      }
    }

    function move(e) {
      if (!active) return;
      var mx = e.clientX - startX, my = e.clientY - startY;

      if (!decided) {
        if (Math.abs(mx) < LOCK_AT && Math.abs(my) < LOCK_AT) return;
        // 明らかに縦に振れた指だけスライド扱いをやめる。
        // 少しの縦ぶれで取りこぼさないよう、余裕をもたせている
        if (Math.abs(my) > Math.abs(mx) * 1.3) { stop(false); return; }
        decided = true;
      }

      // 指の速さを覚えておく（軽く払っただけでも切り替えられるように）
      var now = Date.now(), dt = now - lastT;
      if (dt > 0) {
        speed = ((e.clientX - lastX) / dt) * 0.6 + speed * 0.4;
        lastX = e.clientX;
        lastT = now;
      }

      dx = mx;
      // 端では引っぱりを弱くして、これ以上ないことを伝える
      if ((slideIndex === 0 && dx > 0) || (slideIndex === SLIDE_COUNT - 1 && dx < 0)) dx *= 0.32;
      el.track.style.transform =
        'translateX(calc(' + (-100 * slideIndex) + '% + ' + dx.toFixed(1) + 'px))';
      if (e.cancelable) e.preventDefault();
    }

    /** 指を離したとき。commit が false なら元の位置に戻すだけ */
    function stop(commit) {
      if (!active) return;
      active = false;
      el.track.classList.remove('dragging');
      if (pointer != null && el.track.releasePointerCapture) {
        try { el.track.releasePointerCapture(pointer); } catch (err) { /* 無視 */ }
      }
      pointer = null;

      var moved = dx;
      dx = 0;
      if (!commit || !decided) { goTo(slideIndex); return; }

      // ゆっくり大きく動かした場合と、素早く払った場合のどちらでも切り替える。
      // 払いの速さは、直近の速さと全体の平均の大きいほうで見る
      var elapsed = Math.max(1, Date.now() - startT);
      var fastest = Math.max(Math.abs(speed), Math.abs(moved) / elapsed);
      var far = Math.abs(moved) >= width * MOVE_RATIO;
      var flick = fastest >= FLICK_SPEED && Math.abs(moved) >= FLICK_MIN;

      if ((far || flick) && moved < 0) goTo(slideIndex + 1);
      else if ((far || flick) && moved > 0) goTo(slideIndex - 1);
      else goTo(slideIndex);
    }

    if (window.PointerEvent) {
      el.track.addEventListener('pointerdown', down);
      el.track.addEventListener('pointermove', move, { passive: false });
      el.track.addEventListener('pointerup', function () { stop(true); });
      el.track.addEventListener('pointercancel', function () { stop(false); });
      // pointerleave では止めない。指が少し外に出ただけで
      // 切り替わらなくなるのを防ぐため
    } else {
      // 古い環境向け：タッチイベントで同じことをする
      el.track.addEventListener('touchstart', function (e) {
        down({ target: e.target, clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
      }, { passive: true });
      el.track.addEventListener('touchmove', function (e) {
        move({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY,
               cancelable: e.cancelable, preventDefault: function () { e.preventDefault(); } });
      }, { passive: false });
      el.track.addEventListener('touchend', function () { stop(true); });
      el.track.addEventListener('touchcancel', function () { stop(false); });
    }

    // 点をタップしても移動できる
    el.dots.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.dot') : null;
      if (b) goTo(parseInt(b.getAttribute('data-i'), 10));
    });

    // キーボードの左右でも移動できる（動作確認用）
    document.addEventListener('keydown', function (e) {
      if (!el.settings.hidden || !$('picker').hidden || !$('ringing').hidden ||
          el.body.classList.contains('nixie-mode')) return;
      if (e.key === 'ArrowRight') goTo(slideIndex + 1);
      else if (e.key === 'ArrowLeft') goTo(slideIndex - 1);
    });
  }

  // ---------- 画面を消させない ----------
  // 端末まかせにすると、一定時間で画面が暗くなったり消えたりする。
  // 表示している間はずっと点灯を保つよう頼んでおく（対応端末のみ）。
  var wakeLock = null;

  function keepScreenOn() {
    try {
      if (!navigator.wakeLock || wakeLock || document.hidden) return;
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        lock.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () { /* 非対応・拒否されても表示は続く */ });
    } catch (e) { /* 無視 */ }
  }

  // 画面が戻ったときや操作されたときに取り直す（一度切れても復帰できるように）
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) keepScreenOn();
  });
  document.addEventListener('pointerdown', keepScreenOn);
  window.addEventListener('focus', keepScreenOn);
  // 端末側の都合で解除されることがあるので、定期的に取り直す
  setInterval(keepScreenOn, 60 * 1000);

  // ---------- 他ファイルへ渡す共通の道具 ----------
  window.EC = {
    pad2: pad2,
    toast: toast,
    goTo: goTo,
    onSecond: function (fn) { secondSubs.push(fn); },
    getSlide: function () { return slideIndex; },
    openSettings: openSettings,
    keepScreenOn: keepScreenOn,
    getWeather: function () {
      var cur = lastData && lastData.current;
      return {
        name: place.name,
        temperature: cur && isNum(cur.temperature_2m) ? round(cur.temperature_2m) : null,
        description: cur ? wmoLabel(cur.weather_code) : '天気を取得中',
        icon: cur ? wmoIcon(cur.weather_code, cur.is_day === 1 || cur.is_day === true) : 'i-cloud'
      };
    }
  };

  // ---------- 起動 ----------
  applyTheme(periodOf(new Date(), null, null), 'clear');
  keepScreenOn();
  buildAnalog();
  initSwipe();
  goTo(0, false);
  renderSkeleton();
  startClock();
  fetchWeather();
})();
