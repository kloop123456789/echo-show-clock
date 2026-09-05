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
  function tick() {
    var now = new Date();
    el.hm.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    el.sec.textContent = pad2(now.getSeconds());
    el.date.textContent =
      now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日' +
      '（' + WEEK[now.getDay()] + '）';
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

    // 背景テーマ
    applyTheme(periodOf(now, parseLocal(sunrises[0]), parseLocal(sunsets[0])), wmoClass(code));

    el.updated.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ' 更新';
    el.placeName.textContent = place.name;
    document.title = round(cur.temperature_2m) + '° ' + wmoLabel(code) + ' - ' + place.name;
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
  }

  // ---------- 場所の設定ダイアログ ----------
  function openSettings() {
    el.settings.hidden = false;
    el.results.replaceChildren();
    el.searchInput.value = '';
    setTimeout(function () { el.searchInput.focus(); }, 50);
  }
  function closeSettings() { el.settings.hidden = true; }

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
    savePlace(p);
    el.placeName.textContent = p.name;
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

  // ---------- 起動 ----------
  applyTheme(periodOf(new Date(), null, null), 'clear');
  renderSkeleton();
  startClock();
  fetchWeather();
})();
