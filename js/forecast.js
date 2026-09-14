/* ============================================================
   天気の詳細画面

   予報の部分（1枚目の現在の天気・時間ごと・3日間、2枚目の天気と3日間）を
   タップすると開く。日付を切り替えながら、3時間ごとの気温・降水確率・
   降水量・風と、その日のまとめを見られる。

   下の帯には、データの出どころ（Open-Meteo）と、
   その地点で実際に使われている予報モデルを出す。

   タップの見分けかたは nixie.js と同じ方式。
   スワイプ（app.js）は指をトラック全体で捕まえるので click は使えない。
   押してから離すまで、ほとんど動かず短ければタップとみなす。
   ============================================================ */
(function () {
  'use strict';

  var EC = window.EC || {};
  var W = EC.wx;
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    overlay: $('wxDetail'), tabs: $('wxTabs'), sum: $('wxSum'),
    grid: $('wxGrid'), source: $('wxSource'), close: $('wxClose')
  };
  if (!W || !ui.overlay) return;

  var SLOT = 3;                  // 何時間ごとに並べるか
  var AUTO_CLOSE = 60 * 1000;    // 触らなければ閉じる（つけっぱなしの時計を覆い続けないように）
  var TAP_MOVE = 10;             // これより動いたらスワイプ（app.js の判定とそろえる）
  var TAP_TIME = 500;            // これより長く押したらタップではない

  var state = { date: null, pick: null };
  var idleTimer = null;
  var pressOnBackdrop = false;   // 外側で押し始めたか
  var lastFocus = null;

  // ---------- 表示用の小道具 ----------
  var DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
    '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];

  /** 風向き（度）を16方位に。風が「吹いてくる」方角 */
  function dirName(deg) {
    if (!W.isNum(deg)) return '';
    return DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  }

  /** 紫外線の強さ（気象庁の区分） */
  function uvLevel(v) {
    if (!W.isNum(v)) return '';
    var r = Math.round(v);
    if (r <= 2) return '弱い';
    if (r <= 5) return '中程度';
    if (r <= 7) return '強い';
    if (r <= 10) return '非常に強い';
    return '極端に強い';
  }

  function mm(v) {
    if (!W.isNum(v)) return '--';
    if (v < 0.05) return '0';
    if (v < 10) return String(Math.round(v * 10) / 10);
    return String(Math.round(v));
  }

  function temp(v) { return W.isNum(v) ? W.round(v) + '°' : '--°'; }

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function pick(arr, i) { return arr && i >= 0 && i < arr.length ? arr[i] : null; }

  // ---------- 予報モデルの見分け ----------
  // Open-Meteo の既定（best_match）は、地点ごとに一番細かいモデルを自動で選ぶ。
  // 日本国内では「気象庁 MSM」か「ECMWF の 9km モデル」のどちらかになることを、
  // 2026年9月に各地の値を1時間ずつ突き合わせて確かめた（README 参照）。
  // 返ってくる格子点の緯度経度が MSM の格子（0.05° × 0.0625°）に乗っていれば MSM。
  function onGrid(v, step) {
    var q = v / step;
    return Math.abs(q - Math.round(q)) < 0.01;
  }

  function modelOf(d) {
    if (d.timezone !== 'Asia/Tokyo' || !W.isNum(d.latitude) || !W.isNum(d.longitude)) {
      return { text: '地点に合わせて Open-Meteo が自動で選択', jma: false };
    }
    if (onGrid(d.latitude, 0.05) && onGrid(d.longitude, 0.0625)) {
      return { text: 'およそ3日先まで気象庁メソモデル（MSM・5km）、その先は ECMWF（欧州・9km）', jma: true };
    }
    return { text: 'ECMWF（欧州中期予報センター・9km）', jma: false };
  }

  // ---------- データの切り出し ----------
  function forecast() {
    var f = EC.getForecast && EC.getForecast();
    return f && f.data && f.data.daily && f.data.hourly ? f : null;
  }

  /** その日の 0時・3時・…・21時 のまとまりを作る */
  function slotsOf(d, date) {
    var hr = d.hourly;
    var times = hr.time || [];
    var start = times.indexOf(date + 'T00:00');
    var out = [];
    if (start < 0) return out;

    for (var s = 0; s < 24 / SLOT; s++) {
      var i = start + s * SLOT;
      if (i >= times.length) break;

      // 降水確率はその3時間の最大、降水量はその3時間の合計
      var pop = null, rain = null;
      for (var k = 0; k < SLOT && i + k < times.length; k++) {
        var p = pick(hr.precipitation_probability, i + k);
        if (W.isNum(p)) pop = pop === null ? p : Math.max(pop, p);
        var r = pick(hr.precipitation, i + k);
        if (W.isNum(r)) rain = (rain || 0) + r;
      }

      out.push({
        hour: s * SLOT,
        temp: pick(hr.temperature_2m, i),
        code: pick(hr.weather_code, i),
        isDay: pick(hr.is_day, i) === 1,
        pop: pop,
        rain: rain,
        wind: pick(hr.wind_speed_10m, i),
        dir: pick(hr.wind_direction_10m, i)
      });
    }
    return out;
  }

  function dateLabel(dateStr) {
    var d = W.parseLocal(dateStr);
    return d ? (d.getMonth() + 1) + '月' + d.getDate() + '日（' + W.WEEK[d.getDay()] + '）' : '';
  }

  function weekClass(dateStr) {
    var d = W.parseLocal(dateStr);
    if (!d) return '';
    return d.getDay() === 0 ? ' sun' : (d.getDay() === 6 ? ' sat' : '');
  }

  // ---------- 描画 ----------
  function renderTabs(d) {
    var daily = d.daily;
    var times = daily.time || [];
    var frag = document.createDocumentFragment();

    for (var n = 0; n < times.length; n++) {
      var date = times[n];
      var on = date === state.date;
      var b = h('button', 'wx-tab' + (on ? ' is-on' : '') + weekClass(date));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('data-date', date);

      var dt = W.parseLocal(date);
      var label = n === 0 ? '今日' : n === 1 ? '明日' : (dt ? dt.getDate() + '（' + W.WEEK[dt.getDay()] + '）' : '--');
      b.appendChild(h('span', 'l', label));

      var m = h('span', 'm');
      m.appendChild(W.svgIcon(W.icon(pick(daily.weather_code, n), true), ''));
      m.appendChild(h('b', '', temp(pick(daily.temperature_2m_max, n))));
      m.appendChild(h('i', '', temp(pick(daily.temperature_2m_min, n))));
      b.appendChild(m);

      frag.appendChild(b);
    }
    ui.tabs.replaceChildren(frag);
  }

  function kv(dl, key, value, unit, note) {
    var row = h('div', 'kv');
    row.appendChild(h('dt', '', key));
    var dd = h('dd');
    dd.appendChild(document.createTextNode(value));
    if (unit) dd.appendChild(h('small', '', unit));
    if (note) dd.appendChild(h('span', 'note', note));
    row.appendChild(dd);
    dl.appendChild(row);
  }

  function renderSummary(d) {
    var daily = d.daily;
    var n = (daily.time || []).indexOf(state.date);
    var frag = document.createDocumentFragment();

    frag.appendChild(h('div', 'wx-date' + weekClass(state.date), dateLabel(state.date)));

    var main = h('div', 'wx-main');
    main.appendChild(W.svgIcon(W.icon(pick(daily.weather_code, n), true), 'wx-icon'));
    var txt = h('div', 'wx-main-t');
    txt.appendChild(h('div', 'wx-desc', W.label(pick(daily.weather_code, n))));
    var hl = h('div', 'wx-hl');
    hl.appendChild(h('span', 'hi', temp(pick(daily.temperature_2m_max, n))));
    hl.appendChild(h('span', 'lo', temp(pick(daily.temperature_2m_min, n))));
    txt.appendChild(hl);
    main.appendChild(txt);
    frag.appendChild(main);

    var dl = h('dl', 'wx-kv');
    var pop = pick(daily.precipitation_probability_max, n);
    var wind = pick(daily.wind_speed_10m_max, n);
    var uv = pick(daily.uv_index_max, n);
    kv(dl, '降水確率', W.isNum(pop) ? String(pop) : '--', '%');
    kv(dl, '降水量', mm(pick(daily.precipitation_sum, n)), 'mm');
    kv(dl, '最大風速', W.isNum(wind) ? wind.toFixed(1) : '--', 'm/s', dirName(pick(daily.wind_direction_10m_dominant, n)));
    kv(dl, '紫外線', W.isNum(uv) ? String(Math.round(uv)) : '--', '', uvLevel(uv));
    kv(dl, '日の出', W.hhmm(pick(daily.sunrise, n)), '');
    kv(dl, '日の入', W.hhmm(pick(daily.sunset, n)), '');
    frag.appendChild(dl);

    ui.sum.replaceChildren(frag);
  }

  function renderGrid(d) {
    var slots = slotsOf(d, state.date);
    var today = (d.daily.time || [])[0];
    var isToday = state.date === today;
    var nowSlot = isToday ? Math.floor(new Date().getHours() / SLOT) : -1;
    var pickSlot = -1;
    if (state.pick && state.pick.slice(0, 10) === state.date) {
      var ph = W.parseLocal(state.pick);
      if (ph) pickSlot = Math.floor(ph.getHours() / SLOT);
    }

    // 行の見出し
    var labels = h('div', 'wx-labels');
    labels.appendChild(h('div', 'r r-time', SLOT + '時間ごと'));
    labels.appendChild(h('div', 'r r-icon'));
    labels.appendChild(h('div', 'r r-temp', '気温'));
    labels.appendChild(h('div', 'r r-pop', '降水確率'));
    var rl = h('div', 'r r-rain', '降水量');
    rl.appendChild(h('small', '', 'mm'));
    labels.appendChild(rl);
    var wl = h('div', 'r r-wind', '風');
    wl.appendChild(h('small', '', 'm/s'));
    labels.appendChild(wl);

    var cols = h('div', 'wx-cols');
    cols.style.gridTemplateColumns = 'repeat(' + Math.max(slots.length, 1) + ', minmax(0, 1fr))';

    // 気温の折れ線の高さ（上下に数字の余白を残す）
    var temps = slots.map(function (s) { return s.temp; }).filter(W.isNum);
    var tMin = Math.min.apply(null, temps);
    var tMax = Math.max.apply(null, temps);
    function yOf(t) {
      if (!W.isNum(t)) return null;
      if (tMax === tMin) return 58;
      return 85 - ((t - tMin) / (tMax - tMin)) * 52;   // 33%〜85% の間に収める
    }

    var points = [];
    slots.forEach(function (s, i) {
      var col = h('div', 'wx-col' +
        (i < nowSlot ? ' is-past' : '') +
        (i === nowSlot ? ' is-now' : '') +
        (i === pickSlot ? ' is-pick' : ''));

      col.appendChild(h('div', 'r r-time', i === nowSlot ? 'いま' : s.hour + '時'));

      var ic = h('div', 'r r-icon');
      ic.appendChild(W.svgIcon(W.icon(s.code, s.isDay), ''));
      col.appendChild(ic);

      var tp = h('div', 'r r-temp');
      var y = yOf(s.temp);
      if (y !== null) {
        var dot = h('span', 'dot');
        dot.style.top = y + '%';
        tp.appendChild(dot);
        var v = h('span', 'v', temp(s.temp));
        v.style.top = y + '%';
        tp.appendChild(v);
        points.push(((i + 0.5) / slots.length * 100).toFixed(2) + ',' + y.toFixed(2));
      }
      col.appendChild(tp);

      col.appendChild(h('div', 'r r-pop' + (s.pop ? '' : ' zero'), W.isNum(s.pop) ? s.pop + '%' : '--'));
      col.appendChild(h('div', 'r r-rain' + (s.rain >= 0.05 ? '' : ' zero'), mm(s.rain)));

      var wd = h('div', 'r r-wind');
      wd.appendChild(h('span', 'ws', W.isNum(s.wind) ? String(Math.round(s.wind)) : '--'));
      wd.appendChild(h('span', 'wd', dirName(s.dir)));
      col.appendChild(wd);

      cols.appendChild(col);
    });

    // 気温の折れ線（列の中心を結ぶ）
    if (points.length > 1) {
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'wx-line');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      var line = document.createElementNS(ns, 'polyline');
      line.setAttribute('points', points.join(' '));
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(line);
      cols.insertBefore(svg, cols.firstChild);
    }

    ui.grid.replaceChildren(labels, cols);
    revealColumn(labels);
  }

  /** 表が横に流れる幅のとき（縦画面）、「いま」か選んだ時間の列が見えるようにする */
  function revealColumn(labels) {
    var box = ui.grid.parentNode;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    var col = ui.grid.querySelector('.wx-col.is-pick') || ui.grid.querySelector('.wx-col.is-now');
    if (!col) { box.scrollLeft = 0; return; }
    var b = box.getBoundingClientRect();
    var c = col.getBoundingClientRect();
    var lw = labels.getBoundingClientRect().width;
    // 見出しの右側に残る幅の、まんなかあたりに来るように
    box.scrollLeft += (c.left - b.left) - lw - Math.max(0, (b.width - lw - c.width) / 2);
  }

  function renderSource(f) {
    var d = f.data;
    var model = modelOf(d);
    var frag = document.createDocumentFragment();

    var p1 = h('p', 'src-main');
    p1.appendChild(h('span', 'k', 'データ'));
    var a = h('a', '', 'Open-Meteo.com');
    a.href = 'https://open-meteo.com/';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    p1.appendChild(a);
    p1.appendChild(h('span', 'k k2', '予報モデル'));
    p1.appendChild(h('span', 'model' + (model.jma ? ' jma' : ''), model.text));
    frag.appendChild(p1);

    var at = f.fetchedAt;
    var p2 = h('p', 'src-note',
      '降水確率は、多数の計算を重ねたアンサンブル予報から出した値で、気象庁発表の降水確率とは別のものです' +
      (at ? '　・　' + EC.pad2(at.getHours()) + ':' + EC.pad2(at.getMinutes()) + ' 取得' : ''));
    frag.appendChild(p2);

    ui.source.replaceChildren(frag);
  }

  function render() {
    var f = forecast();
    if (!f) return;
    var times = f.data.daily.time || [];
    if (times.indexOf(state.date) < 0) state.date = times[0];   // 日付が変わっていたら今日へ

    renderTabs(f.data);
    renderSummary(f.data);
    renderGrid(f.data);
    renderSource(f);
  }

  // ---------- 開く・閉じる ----------
  function bumpIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(close, AUTO_CLOSE);
  }

  function open(date, pickTime, opts) {
    var f = forecast();
    if (!f) {
      if (EC.toast) EC.toast('天気を取得中です。少し待ってからもう一度どうぞ');
      return;
    }
    state.date = date || f.data.daily.time[0];
    state.pick = pickTime || null;
    lastFocus = document.activeElement;

    // 先に表示してから描く（隠れたままだと列の位置が測れず、縦画面で「いま」へ寄せられない）。
    // 同じ処理の中で済むので、前回の中身が一瞬見えることはない
    ui.source.classList.remove('is-flash');
    ui.overlay.hidden = false;
    render();
    pressOnBackdrop = false;
    bumpIdle();

    // 「Open-Meteo」を押して開いたときは、出どころの帯を目立たせる
    if (opts && opts.source) {
      void ui.source.offsetWidth;   // アニメーションをやり直すため
      ui.source.classList.add('is-flash');
    }
    // キーボードで開いたときだけ、閉じるボタンへ移る（タッチでは枠が出て目障りなため）
    if (opts && opts.keyboard) {
      try { ui.close.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
    }
  }

  function close() {
    if (ui.overlay.hidden) return;
    ui.overlay.hidden = true;
    clearTimeout(idleTimer);
    state.pick = null;
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
    }
    lastFocus = null;
  }

  function selectDate(date) {
    state.date = date;
    state.pick = null;
    render();
    // 選んだタブが見えるように（縦画面ではタブが横に流れるため）
    var on = ui.tabs.querySelector('.wx-tab.is-on');
    if (on && on.scrollIntoView) {
      try { on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* 無視 */ }
    }
  }

  function shiftDate(step) {
    var f = forecast();
    if (!f) return;
    var times = f.data.daily.time || [];
    var i = times.indexOf(state.date) + step;
    if (i >= 0 && i < times.length) selectDate(times[i]);
  }

  /** タップされた場所に応じて、どの日を開くか決める */
  function openFrom(node, keyboard) {
    var f = forecast();
    var today = f ? f.data.daily.time[0] : null;
    var kind = node.getAttribute('data-wx');

    if (kind === 'hour') {
      var t = node.getAttribute('data-time') || '';
      open(t.slice(0, 10), t, { keyboard: keyboard });
    } else if (kind === 'day') {
      open(node.getAttribute('data-date'), null, { keyboard: keyboard });
    } else if (kind === 'source') {
      open(today, null, { source: true, keyboard: keyboard });
    } else {
      open(today, null, { keyboard: keyboard });
    }
  }

  // ---------- タップの見分け ----------
  function anyOverlayOpen() { return !!document.querySelector('.overlay:not([hidden])'); }

  function targetOf(node) {
    return node && node.closest ? node.closest('.stage [data-wx]') : null;
  }

  /** 今表示している画面の中の要素か（切り替えの途中で、流れていく画面を触った場合は除く） */
  function onCurrentSlide(node) {
    var slide = node.closest('.slide');
    if (!slide || !EC.getSlide) return true;
    return Array.prototype.indexOf.call(document.querySelectorAll('.slide'), slide) === EC.getSlide();
  }

  var gesture = null;

  function begin(target, x, y, id) {
    if (anyOverlayOpen() || document.body.classList.contains('nixie-mode')) { gesture = null; return; }
    var t = targetOf(target);
    gesture = t ? { target: t, x: x, y: y, id: id, at: Date.now() } : null;
  }
  function moveTo(x, y) {
    if (gesture && (Math.abs(x - gesture.x) > TAP_MOVE || Math.abs(y - gesture.y) > TAP_MOVE)) gesture = null;
  }
  function end(x, y, id) {
    if (!gesture || gesture.id !== id) return;
    moveTo(x, y);
    var g = gesture;
    gesture = null;
    if (!g || Date.now() - g.at > TAP_TIME || anyOverlayOpen() || !onCurrentSlide(g.target)) return;
    openFrom(g.target);
  }

  if (window.PointerEvent) {
    document.addEventListener('pointerdown', function (e) {
      if (e.isPrimary === false || (e.button != null && e.button !== 0)) { gesture = null; return; }
      begin(e.target, e.clientX, e.clientY, e.pointerId);
    }, true);
    document.addEventListener('pointermove', function (e) { moveTo(e.clientX, e.clientY); }, true);
    document.addEventListener('pointerup', function (e) { end(e.clientX, e.clientY, e.pointerId); }, true);
    document.addEventListener('pointercancel', function () { gesture = null; }, true);
  } else {
    // 古い環境：スワイプもタッチイベントで動くので、click の宛先は正しい
    document.addEventListener('click', function (e) {
      if (anyOverlayOpen()) return;
      var t = targetOf(e.target);
      if (t && onCurrentSlide(t)) openFrom(t);
    });
  }

  // キーボードでも開ける（Enter / スペース）
  document.addEventListener('keydown', function (e) {
    if (!ui.overlay.hidden) {
      bumpIdle();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); shiftDate(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); shiftDate(-1); }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.getAttribute &&
        e.target.getAttribute('data-wx') && !anyOverlayOpen()) {
      e.preventDefault();
      openFrom(e.target, true);
    }
  });

  // ---------- 画面の中の操作 ----------
  ui.close.addEventListener('click', close);

  ui.tabs.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.wx-tab') : null;
    if (b) selectDate(b.getAttribute('data-date'));
  });

  // 外側（暗い部分）で押して、外側で離したら閉じる。
  // 中から指を滑らせて外で離したときや、開いたときの指の離れでは閉じない
  ui.overlay.addEventListener('pointerdown', function (e) {
    pressOnBackdrop = e.target === ui.overlay;
    bumpIdle();   // 触っている間は自動で閉じない
  });
  ui.overlay.addEventListener('click', function (e) {
    var ok = pressOnBackdrop || !window.PointerEvent;
    pressOnBackdrop = false;
    if (ok && e.target === ui.overlay) close();
  });

  // 天気が更新されたら、開いている画面も描き直す
  document.addEventListener('weatherupdate', function () {
    if (!ui.overlay.hidden) render();
  });

  EC.openWeatherDetail = function (date) { open(date || null, null); };
})();
