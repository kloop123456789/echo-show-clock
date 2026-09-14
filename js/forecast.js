/* ============================================================
   天気の詳細画面

   予報の部分（1枚目の現在の天気・時間ごと・3日間、2枚目の天気と3日間）を
   タップすると開く。日付を切り替えながら、その日のまとめと3時間ごとの予報を見られる。

   データは app.js が「画面用にそろえた形」にしたものを読む（気象庁でも Open-Meteo でも同じ）。
   気象庁のときは、3時間ごとの予報は明日いっぱいまで。その先の日は週間予報（1日ごと）を出す。

   下の帯には、データの出どころを出す。

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

  var COLS = 8;                  // 3時間ごとの列の数（24時間分）
  var AUTO_CLOSE = 60 * 1000;    // 触らなければ閉じる（つけっぱなしの時計を覆い続けないように）
  var TAP_MOVE = 10;             // これより動いたらスワイプ（app.js の判定とそろえる）
  var TAP_TIME = 500;            // これより長く押したらタップではない

  // 行の高さ（--u の倍数）。雨量の行は、値のある元のときだけ出す
  var ROW_H = { time: 3.2, icon: 4.4, temp: 9, pop: 3.2, rain: 3.2, wind: 4.6 };

  // 週間予報の信頼度（気象庁の説明より）
  var RELIABILITY = {
    A: '確度が高い（適中率が明日の予報並み）',
    B: '確度がやや高い（適中率が4日先の予報と同程度）',
    C: '確度が低い（予報が変わる可能性がBより高い）'
  };

  var state = { date: null, pick: null };
  var idleTimer = null;
  var pressOnBackdrop = false;   // 外側で押し始めたか
  var lastFocus = null;

  // ---------- 表示用の小道具 ----------
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

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

  /** 気象庁の文言を短くする（「１．５メートル　後　１メートル」→「1.5m→1m」） */
  function compact(s) {
    return String(s || '')
      .replace(/[０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/メートル/g, 'm')
      .replace(/\s*後\s*/g, '→')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
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

  // ---------- データの切り出し ----------
  function forecast() {
    var wx = EC.getForecast && EC.getForecast();
    return wx && wx.days && wx.days.length ? wx : null;
  }

  function dayOf(wx, date) {
    for (var i = 0; i < wx.days.length; i++) if (wx.days[i].date === date) return wx.days[i];
    return null;
  }

  /**
   * 3時間ごとの列を作る。
   * 今日は「いま」を含む3時間から24時間分（日付をまたぐ）、ほかの日はその日の 0時〜21時。
   * Open-Meteo（1時間ごと）は3時間ずつにまとめる：降水確率は最大、雨量は合計、ほかは始めの時刻の値。
   */
  function columnsOf(wx, date) {
    var groups = [];
    var byKey = {};
    (wx.slots || []).forEach(function (s) {
      if (!s.key || !s.time) return;
      var d = s.key.slice(0, 10);
      var hr = Math.floor(+s.key.slice(11, 13) / 3) * 3;
      var gk = d + 'T' + pad2(hr);
      var g = byKey[gk];
      if (!g) {
        g = byKey[gk] = {
          key: gk, date: d, hour: hr, time: s.time,
          icon: s.icon, label: s.label, temp: s.temp,
          wind: s.wind, windRange: s.windRange, windDir: s.windDir,
          pop: null, rain: null,
          // 気象庁の降水確率は6時間ごとなので、同じまとまりの列を横につなげて見せる
          popBlock: wx.step >= 3 ? s.popBlock : gk
        };
        groups.push(g);
      }
      if (W.isNum(s.pop)) g.pop = g.pop === null ? s.pop : Math.max(g.pop, s.pop);
      if (W.isNum(s.rain)) g.rain = (g.rain || 0) + s.rain;
    });

    if (date === wx.days[0].date) {
      var t = Date.now(), start = -1;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].time.getTime() <= t) start = i; else break;
      }
      return groups.slice(Math.max(start, 0), Math.max(start, 0) + COLS);
    }
    return groups.filter(function (g) { return g.date === date; }).slice(0, COLS);
  }

  // ---------- 描画 ----------
  function renderTabs(wx) {
    var frag = document.createDocumentFragment();
    wx.days.forEach(function (d, n) {
      var on = d.date === state.date;
      var b = h('button', 'wx-tab' + (on ? ' is-on' : '') + weekClass(d.date));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('data-date', d.date);

      var dt = W.parseLocal(d.date);
      var label = n === 0 ? '今日' : n === 1 ? '明日' : (dt ? dt.getDate() + '（' + W.WEEK[dt.getDay()] + '）' : '--');
      b.appendChild(h('span', 'l', label));

      var m = h('span', 'm');
      m.appendChild(W.svgIcon(d.icon || 'i-cloud', ''));
      m.appendChild(h('b', '', temp(d.hi)));
      m.appendChild(h('i', '', temp(d.lo)));
      b.appendChild(m);

      frag.appendChild(b);
    });
    ui.tabs.replaceChildren(frag);
  }

  function kv(dl, key, value, unit, note, cls) {
    var row = h('div', 'kv' + (cls ? ' ' + cls : ''));
    row.appendChild(h('dt', '', key));
    var dd = h('dd');
    dd.appendChild(document.createTextNode(value));
    if (unit) dd.appendChild(h('small', '', unit));
    if (note) dd.appendChild(h('span', 'note', note));
    row.appendChild(dd);
    dl.appendChild(row);
  }

  function renderSummary(wx, d) {
    var frag = document.createDocumentFragment();

    frag.appendChild(h('div', 'wx-date' + weekClass(d.date), dateLabel(d.date)));

    var main = h('div', 'wx-main');
    main.appendChild(W.svgIcon(d.icon || 'i-cloud', 'wx-icon'));
    var txt = h('div', 'wx-main-t');
    txt.appendChild(h('div', 'wx-desc', d.label || '--'));
    var hl = h('div', 'wx-hl');
    hl.appendChild(h('span', 'hi', temp(d.hi)));
    hl.appendChild(h('span', 'lo', temp(d.lo)));
    txt.appendChild(hl);
    // 今日の最高・最低は、発表の時間を過ぎるとアメダスの実測で補っている
    var obs = d.hiObserved && d.loObserved ? '最高・最低は実測値' : d.hiObserved ? '最高は実測値' : d.loObserved ? '最低は実測値' : '';
    if (obs) txt.appendChild(h('div', 'wx-obs', obs));
    main.appendChild(txt);
    frag.appendChild(main);

    // 気象庁の予報文（今日〜明後日）
    if (d.text && d.text.replace(/\s/g, '') !== (d.label || '').replace(/\s/g, '')) {
      frag.appendChild(h('p', 'wx-text', d.text));
    }

    // その元が持っている項目だけを並べる（日の出・日の入りは必ず最後）
    var items = [];
    if (W.isNum(d.pop)) items.push(['降水確率', String(d.pop), '%']);
    if (W.isNum(d.rain)) items.push(['降水量', mm(d.rain), 'mm']);
    if (W.isNum(d.windMax)) items.push(['最大風速', d.windMax.toFixed(1), 'm/s', d.windMaxDir]);
    if (W.isNum(d.uv)) items.push(['紫外線', String(Math.round(d.uv)), '', uvLevel(d.uv)]);
    if (d.wave) items.push(['波', compact(d.wave), '', '', 'wrap']);
    if (d.reliability) items.push(['信頼度', d.reliability, '']);

    var dl = h('dl', 'wx-kv');
    items.slice(0, 4).forEach(function (it) { kv(dl, it[0], it[1], it[2], it[3], it[4]); });
    kv(dl, '日の出', W.hm(d.sunrise), '');
    kv(dl, '日の入', W.hm(d.sunset), '');
    frag.appendChild(dl);

    ui.sum.replaceChildren(frag);
  }

  function renderGrid(wx, d) {
    var cols = columnsOf(wx, d.date);
    var box = ui.grid;
    box.className = 'wx-grid';

    // 3時間ごとの予報が無い日（気象庁の週間予報の日）
    if (!cols.length) {
      renderWeekInfo(wx, d);
      return;
    }

    var isToday = d.date === wx.days[0].date;
    var pickIdx = -1;
    if (state.pick) {
      var pk = state.pick.slice(0, 10) + 'T' + pad2(Math.floor(+state.pick.slice(11, 13) / 3) * 3);
      cols.forEach(function (c, i) { if (c.key === pk) pickIdx = i; });
    }
    var hasRain = cols.some(function (c) { return W.isNum(c.rain); });
    var rows = ['time', 'icon', 'temp', 'pop'].concat(hasRain ? ['rain'] : []).concat(['wind']);
    var rowOf = {};
    rows.forEach(function (r, i) { rowOf[r] = i + 1; });

    box.style.gridTemplateColumns = 'var(--wx-label-w) repeat(' + cols.length + ', minmax(0, 1fr))';
    box.style.gridTemplateRows = rows.map(function (r) { return 'calc(var(--u) * ' + ROW_H[r] + ')'; }).join(' ');

    var frag = document.createDocumentFragment();
    function cell(cls, row, col, text, span) {
      var n = h('div', 'g ' + cls, text);
      n.style.gridRow = String(row);
      n.style.gridColumn = span ? col + ' / span ' + span : String(col);
      frag.appendChild(n);
      return n;
    }

    // 「いま」「選んだ時間」の列の帯（セルより下に敷く）
    if (isToday) {
      var band = h('div', 'wx-band is-now');
      band.style.gridColumn = '2';
      band.style.gridRow = '1 / -1';
      frag.appendChild(band);
    }
    if (pickIdx >= 0) {
      var pb = h('div', 'wx-band is-pick');
      pb.style.gridColumn = String(pickIdx + 2);
      pb.style.gridRow = '1 / -1';
      frag.appendChild(pb);
    }

    // 行の見出し
    cell('lab r-time', rowOf.time, 1, '3時間ごと');
    cell('lab r-icon', rowOf.icon, 1, '');
    cell('lab r-temp', rowOf.temp, 1, '気温');
    cell('lab r-pop', rowOf.pop, 1, '降水確率');
    if (hasRain) cell('lab r-rain', rowOf.rain, 1, '降水量').appendChild(h('small', '', 'mm'));
    cell('lab r-wind', rowOf.wind, 1, '風').appendChild(h('small', '', 'm/s'));

    // 時刻・天気・風
    cols.forEach(function (c, i) {
      var col = i + 2;
      var dayStart = i > 0 && c.date !== cols[i - 1].date;
      var label = (isToday && i === 0) ? 'いま' : (dayStart ? '明日' + c.hour + '時' : c.hour + '時');
      var t = cell('r-time' + (i === 0 && isToday ? ' is-now' : '') + (dayStart ? ' day-start' : ''), rowOf.time, col, label);
      t.setAttribute('data-col', String(i));

      var ic = cell('r-icon', rowOf.icon, col, '');
      ic.appendChild(W.svgIcon(c.icon || 'i-cloud', ''));
      ic.title = c.label || '';

      var wd = cell('r-wind', rowOf.wind, col, '');
      var speed = c.windRange || (W.isNum(c.wind) ? String(Math.round(c.wind)) : '--');
      wd.appendChild(h('span', 'ws', speed));
      wd.appendChild(h('span', 'wd', c.windDir || ''));

      if (hasRain) cell('r-rain' + (c.rain >= 0.05 ? '' : ' zero'), rowOf.rain, col, mm(c.rain));

      if (dayStart) {
        var line = h('div', 'wx-dayline');
        line.style.gridColumn = String(col);
        line.style.gridRow = '1 / -1';
        frag.appendChild(line);
      }
    });

    // 降水確率：同じまとまりの列はつなげて1つにする
    for (var i = 0; i < cols.length;) {
      var j = i + 1;
      while (j < cols.length && cols[j].popBlock === cols[i].popBlock) j++;
      var p = cols[i].pop;
      cell('r-pop' + (p ? '' : ' zero') + (j - i > 1 ? ' joined' : ''), rowOf.pop, i + 2,
        W.isNum(p) ? p + '%' : '--', j - i);
      i = j;
    }

    // 気温の折れ線（列の中心を結ぶ）
    var tband = cell('r-temp tband', rowOf.temp, 2, '', cols.length);
    var temps = cols.map(function (c) { return c.temp; }).filter(W.isNum);
    var tMin = Math.min.apply(null, temps), tMax = Math.max.apply(null, temps);
    function yOf(v) {
      if (!W.isNum(v)) return null;
      if (tMax === tMin) return 58;
      return 85 - ((v - tMin) / (tMax - tMin)) * 52;   // 33%〜85% の間に収める
    }
    var points = [];
    cols.forEach(function (c, i) {
      var y = yOf(c.temp);
      if (y === null) return;
      var x = (i + 0.5) / cols.length * 100;
      var dot = h('span', 'dot');
      dot.style.left = x + '%';
      dot.style.top = y + '%';
      tband.appendChild(dot);
      var v = h('span', 'v', temp(c.temp));
      v.style.left = x + '%';
      v.style.top = y + '%';
      tband.appendChild(v);
      points.push(x.toFixed(2) + ',' + y.toFixed(2));
    });
    if (points.length > 1) {
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'wx-line');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      var pl = document.createElementNS(ns, 'polyline');
      pl.setAttribute('points', points.join(' '));
      pl.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(pl);
      tband.insertBefore(svg, tband.firstChild);
    }

    box.replaceChildren(frag);

    // 気象庁の風の予報文（今日〜明後日）
    if (d.windText) {
      var p2 = h('p', 'wx-wind-text');
      p2.appendChild(h('span', 'k', '風'));
      p2.appendChild(document.createTextNode(d.windText));
      box.appendChild(p2);
      p2.style.gridColumn = '1 / -1';
    }

    revealColumn(pickIdx >= 0 ? pickIdx : (isToday ? 0 : -1));
  }

  /** 週間予報だけの日：数字を大きめに並べる */
  function renderWeekInfo(wx, d) {
    var box = ui.grid;
    box.className = 'wx-grid wx-week';
    box.style.gridTemplateColumns = '';
    box.style.gridTemplateRows = '';
    var frag = document.createDocumentFragment();

    var dl = h('dl', 'wx-week-list');
    function row(k, v, note) {
      var r = h('div', 'wk');
      r.appendChild(h('dt', '', k));
      var dd = h('dd', '', v);
      if (note) dd.appendChild(h('small', '', note));
      r.appendChild(dd);
      dl.appendChild(r);
    }
    row('降水確率', W.isNum(d.pop) ? d.pop + '%' : '--');
    row('最高気温', temp(d.hi), d.hiRange ? '予想範囲 ' + d.hiRange[0] + '〜' + d.hiRange[1] + '°' : '');
    row('最低気温', temp(d.lo), d.loRange ? '予想範囲 ' + d.loRange[0] + '〜' + d.loRange[1] + '°' : '');
    if (d.reliability) row('信頼度', d.reliability, RELIABILITY[d.reliability] || '');
    if (W.isNum(d.normalHi) && W.isNum(d.normalLo)) {
      row('平年値', '最高 ' + d.normalHi.toFixed(1) + '°　最低 ' + d.normalLo.toFixed(1) + '°');
    }
    frag.appendChild(dl);
    frag.appendChild(h('p', 'wx-week-note',
      'この日は1日ごとの週間天気予報です。3時間ごとの予報は、気象庁の発表の翌日いっぱいまでの分です（5時・11時・17時に更新）。'));
    box.replaceChildren(frag);
  }

  /** 表が横に流れる幅のとき（縦画面）、「いま」か選んだ時間の列が見えるようにする */
  function revealColumn(index) {
    var scroller = ui.grid.parentNode;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    var t = index >= 0 ? ui.grid.querySelector('.r-time[data-col="' + index + '"]') : null;
    if (!t) { scroller.scrollLeft = 0; return; }
    var b = scroller.getBoundingClientRect();
    var c = t.getBoundingClientRect();
    var lab = ui.grid.querySelector('.lab');
    var lw = lab ? lab.getBoundingClientRect().width : 0;
    // 見出しの右側に残る幅の、まんなかあたりに来るように
    scroller.scrollLeft += (c.left - b.left) - lw - Math.max(0, (b.width - lw - c.width) / 2);
  }

  function renderSource(wx) {
    var frag = document.createDocumentFragment();
    var c = wx.credit || { lines: [], note: '' };

    var p1 = h('p', 'src-main');
    (c.lines || []).forEach(function (ln, i) {
      p1.appendChild(h('span', 'k' + (i ? ' k2' : ''), ln.k));
      if (ln.href) {
        var a = h('a', ln.strong ? 'strong' : '', ln.text);
        a.href = ln.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        p1.appendChild(a);
      } else {
        p1.appendChild(h('span', 'model' + (ln.strong ? ' strong' : ''), ln.text));
      }
    });
    frag.appendChild(p1);

    var at = wx.fetchedAt;
    frag.appendChild(h('p', 'src-note',
      (c.note || '') + (at ? '　・　' + pad2(at.getHours()) + ':' + pad2(at.getMinutes()) + ' 取得' : '')));

    ui.source.replaceChildren(frag);
  }

  function render() {
    var wx = forecast();
    if (!wx) return;
    if (!dayOf(wx, state.date)) state.date = wx.days[0].date;   // 日付が変わっていたら今日へ
    var d = dayOf(wx, state.date);

    ui.overlay.classList.toggle('src-jma', wx.source === 'jma');
    renderTabs(wx);
    renderSummary(wx, d);
    renderGrid(wx, d);
    renderSource(wx);
  }

  // ---------- 開く・閉じる ----------
  function bumpIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(close, AUTO_CLOSE);
  }

  function open(date, pickTime, opts) {
    var wx = forecast();
    if (!wx) {
      if (EC.toast) EC.toast('天気を取得中です。少し待ってからもう一度どうぞ');
      return;
    }
    state.date = date || wx.days[0].date;
    state.pick = pickTime || null;
    lastFocus = document.activeElement;

    // 先に表示してから描く（隠れたままだと列の位置が測れず、縦画面で「いま」へ寄せられない）。
    // 同じ処理の中で済むので、前回の中身が一瞬見えることはない
    ui.source.classList.remove('is-flash');
    ui.overlay.hidden = false;
    render();
    pressOnBackdrop = false;
    bumpIdle();

    // 出どころの表記を押して開いたときは、出どころの帯を目立たせる
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
    var wx = forecast();
    if (!wx) return;
    var times = wx.days.map(function (d) { return d.date; });
    var i = times.indexOf(state.date) + step;
    if (i >= 0 && i < times.length) selectDate(times[i]);
  }

  /** タップされた場所に応じて、どの日を開くか決める */
  function openFrom(node, keyboard) {
    var wx = forecast();
    var today = wx ? wx.days[0].date : null;
    var kind = node.getAttribute('data-wx');

    if (kind === 'hour') {
      // 時間ごとのコマは、どれも「今日」の24時間の中にある
      var t = node.getAttribute('data-time') || '';
      open(today, t, { keyboard: keyboard });
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
