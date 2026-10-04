/* ============================================================
   室内と屋外の温度・湿度（SwitchBot）の画面（5枚目）

   上：温湿度計ごとのカード。いまの温度・湿度、1時間での変化、今日の最高・最低。
       室内のカードには不快指数、屋外のカードには室内との差を添える。
   下：変化のグラフ（気温／湿度、24時間／7日間）。タップした時刻の値も見られる。

   SwitchBot の API には、過去の記録を読む口が無い。
   そこで、この時計が値を受け取るたび（5分おき）にブラウザへ書きため、グラフにする。
   記録は端末ごと。時計を開いていなかった時間は線が途切れる。7日より古いものは消す。

   値の取得は js/switchbot.js が受け持つ。ここでは sensorsupdate イベントで受け取るだけ。
   ============================================================ */
(function () {
  'use strict';

  var EC = window.EC || {};
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    slide: document.querySelector('.slide-env'),
    cards: $('envCards'), plot: $('envPlot'), svg: $('envSvg'), tip: $('envTip'), msg: $('envMsg'),
    metric: $('envMetric'), range: $('envRange'), stamp: $('envStamp'), setupBtn: $('envSetupBtn')
  };
  if (!ui.slide || !ui.cards || !ui.plot) return;

  var LOG_KEY = 'echo-clock-env-log';
  var VIEW_KEY = 'echo-clock-env-view';
  var KEEP_MIN = 7 * 24 * 60 + 60;   // 記録を残す長さ（分）：7日と少し
  var MIN_GAP = 4;                    // これより短い間隔では書きたさない（分）
  var MAX_CARDS = 3;                  // 画面に並べる台数の上限
  var TAP_TIME = 600;                 // これより長く押したものはタップとみなさない（ミリ秒）
  var TIP_TIME = 8000;                // タップした時刻の表示を消すまで（ミリ秒）

  // 線の色。室内は暖かい色、屋外は涼しい色
  var IN_COLORS = ['#ffb46e', '#d7a6ff'];
  var OUT_COLORS = ['#7cc4ff', '#8fe3c8'];

  // 不快指数の目安（日本で一般に使われている区分）
  var DI_LABELS = [
    [55, '寒い'], [60, '肌寒い'], [65, '何も感じない'], [70, '快い'],
    [75, '暑くない'], [80, 'やや暑い'], [85, '暑くて汗が出る'], [Infinity, '暑くてたまらない']
  ];

  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  var visible = false;
  var view = loadView();            // { metric: 't' | 'h', range: 24 | 168 }
  var log = loadLog();              // { 機器ID: [[分, 温度×10, 湿度], ...] }
  var shown = [];                   // いま画面に出している台（色つき）
  var cursor = null;                // タップした時刻（ミリ秒）
  var cursorTimer = null;
  var lastMinute = -1;

  // ---------- 小さな道具 ----------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** 温度を小数第1位まで。マイナスは字幅のそろった「−」で */
  function f1(v) {
    var r = Math.round(v * 10) / 10;
    return (r < 0 ? '−' : '') + Math.abs(r).toFixed(1);
  }

  /** 差を「+0.4」「−1.2」の形に */
  function signed(v) {
    var r = Math.round(v * 10) / 10;
    if (r === 0) return '±0.0';
    return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(1);
  }

  function hmOf(t) {
    var d = new Date(t);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function mdOf(t, withWeek) {
    var d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate() + (withWeek ? '(' + WEEK[d.getDay()] + ')' : '');
  }

  function discomfort(t, h) {
    return 0.81 * t + 0.01 * h * (0.99 * t - 14.3) + 46.3;
  }

  function diLabel(di) {
    for (var i = 0; i < DI_LABELS.length; i++) if (di < DI_LABELS[i][0]) return DI_LABELS[i][1];
    return '';
  }

  /** 中継役が返した失敗理由を、短い言葉にする */
  function errText(e) {
    if (/statusCode 161/.test(e)) return '機器がオフライン';
    if (/statusCode 171/.test(e)) return 'ハブがオフライン';
    return '取得できません';
  }

  // ---------- 保存 ----------
  function loadView() {
    var v = { metric: 't', range: 24 };
    try {
      var o = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
      if (o.metric === 'h') v.metric = 'h';
      if (o.range === 168) v.range = 168;
    } catch (e) { /* 既定のまま */ }
    return v;
  }

  function saveView() {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* 無視 */ }
  }

  function loadLog() {
    try {
      var o = JSON.parse(localStorage.getItem(LOG_KEY) || 'null');
      if (o && o.v === 1 && o.d && typeof o.d === 'object') return o.d;
    } catch (e) { /* 壊れていれば空から始める */ }
    return {};
  }

  function saveLog() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify({ v: 1, d: log })); } catch (e) { /* 容量不足などは諦める */ }
  }

  /** 受け取った値を書きためる。「出さない」にした台も書いておく（あとで戻したときのため） */
  function record(snap) {
    if (!snap || !snap.fresh || !snap.at) return;
    var m = Math.floor(snap.at / 60000);
    var changed = false;

    snap.devices.forEach(function (d) {
      if (d.error || (!isNum(d.temperature) && !isNum(d.humidity))) return;
      var arr = log[d.id] || (log[d.id] = []);
      var last = arr[arr.length - 1];
      if (last && m - last[0] < MIN_GAP) return;      // 同じ値を二重に書かない
      arr.push([
        m,
        isNum(d.temperature) ? Math.round(d.temperature * 10) : null,
        isNum(d.humidity) ? Math.round(d.humidity) : null
      ]);
      changed = true;
    });

    // 7日より古いものを捨てる
    var cut = m - KEEP_MIN;
    Object.keys(log).forEach(function (id) {
      var arr = log[id];
      var i = 0;
      while (i < arr.length && arr[i][0] < cut) i++;
      if (i) { arr.splice(0, i); changed = true; }
      if (!arr.length) { delete log[id]; changed = true; }
    });

    if (changed) saveLog();
  }

  // ---------- 記録から読み出す ----------
  /** minutesAgo 分前ごろ（前後 tol 分）の温度。無ければ null */
  function tempAgo(id, minutesAgo, tol) {
    var arr = log[id];
    if (!arr) return null;
    var target = Math.round(Date.now() / 60000) - minutesAgo;
    var best = null, bestGap = tol + 1;
    for (var i = arr.length - 1; i >= 0; i--) {
      var p = arr[i];
      if (p[0] < target - tol) break;
      var g = Math.abs(p[0] - target);
      if (p[1] !== null && g < bestGap) { best = p; bestGap = g; }
    }
    return best ? best[1] / 10 : null;
  }

  /** 今日（0時から）の最高・最低気温とその時刻 */
  function todayRange(id) {
    var arr = log[id] || [];
    var mid = new Date();
    mid.setHours(0, 0, 0, 0);
    var m0 = Math.floor(mid.getTime() / 60000);
    var hi = null, lo = null, first = null, n = 0;
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      if (p[0] < m0 || p[1] === null) continue;
      if (!first) first = p;
      n++;
      if (!hi || p[1] > hi[1]) hi = p;
      if (!lo || p[1] < lo[1]) lo = p;
    }
    // 記録が少なすぎるうちは出さない（「最高も最低もいまの値」になってしまうため）
    if (n < 3) return null;
    return {
      hi: hi[1] / 10, hiAt: hi[0] * 60000,
      lo: lo[1] / 10, loAt: lo[0] * 60000,
      // 0時台の途中から記録が始まっていれば、いつからの値かを添える
      from: (first[0] - m0 > 30) ? first[0] * 60000 : null
    };
  }

  // ---------- どの台を出すか ----------
  function pickShown(snap) {
    var list = snap.devices.filter(function (d) { return d.role !== 'off'; });
    var ins = list.filter(function (d) { return d.role === 'in'; });
    var outs = list.filter(function (d) { return d.role === 'out'; });
    // 室内は、1枚目に出しているもの（main）を先頭に
    ins.sort(function (a, b) { return (b.main ? 1 : 0) - (a.main ? 1 : 0); });

    var ni = 0, no = 0;
    return ins.concat(outs).slice(0, MAX_CARDS).map(function (d) {
      var c = {};
      for (var k in d) c[k] = d[k];
      c.color = d.role === 'out' ? OUT_COLORS[no++ % OUT_COLORS.length] : IN_COLORS[ni++ % IN_COLORS.length];
      return c;
    });
  }

  // ---------- カード ----------
  function cardHtml(d, ref, snap) {
    var out = d.role === 'out';
    var roleName = out ? '屋外' : '室内';
    var ok = snap.fresh && !d.error;
    var t = ok && isNum(d.temperature) ? d.temperature : null;
    var h = ok && isNum(d.humidity) ? d.humidity : null;

    // 見出し：色の印（グラフの線と同じ色）・アイコン・室内／屋外・名前・1時間の変化
    var head = '<div class="ec-head">' +
      '<i class="ec-dot" style="background:' + d.color + '"></i>' +
      '<svg class="ec-ic" aria-hidden="true"><use href="#' + (out ? 'i-tree' : 'i-home') + '"/></svg>' +
      '<span class="ec-role">' + roleName + '</span>' +
      (d.name && d.name !== roleName ? '<span class="ec-name">' + esc(d.name) + '</span>' : '');

    var ago = t !== null ? tempAgo(d.id, 60, 15) : null;
    if (ago !== null) {
      var diff = t - ago;
      // 0.2°以上動いたときだけ矢印と色を付ける（センサーの細かな揺れで目立たせない）
      var txt = diff >= 0.2 ? '▲' + Math.abs(diff).toFixed(1)
        : diff <= -0.2 ? '▼' + Math.abs(diff).toFixed(1) : signed(diff);
      var cls = diff >= 0.2 ? ' up' : (diff <= -0.2 ? ' down' : '');
      head += '<span class="ec-trend' + cls + '" title="1時間前との差">' +
        txt + '°<small>/1時間</small></span>';
    }
    head += '</div>';

    // いまの値
    var main = '<div class="ec-main">' +
      '<span class="ec-temp">' + (t !== null ? f1(t) : '--') + '<span class="ec-deg">°</span></span>' +
      '<span class="ec-hum"><svg aria-hidden="true"><use href="#i-drop"/></svg>' +
      (h !== null ? Math.round(h) : '--') + '<span class="ec-pct">%</span></span>' +
      '</div>';

    // 今日の最高・最低
    var stats = '';
    var r = todayRange(d.id);
    if (r) {
      stats = '<div class="ec-stats">' +
        '<span><span class="k">最高</span>' + f1(r.hi) + '°<small>' + hmOf(r.hiAt) + '</small></span>' +
        '<span><span class="k">最低</span>' + f1(r.lo) + '°<small>' + hmOf(r.loAt) + '</small></span>' +
        (r.from ? '<span class="ec-from">' + hmOf(r.from) + 'から</span>' : '') +
        '</div>';
    }

    // ひとこと
    var notes = [];
    if (d.error) {
      notes.push('<span class="warn">' + errText(d.error) + '</span>');
    } else if (!snap.fresh) {
      notes.push('<span class="warn">' + (snap.at ? '最後の取得 ' + hmOf(snap.at) : '取得中…') + '</span>');
    } else if (out) {
      var rt = ref && ref !== d && snap.fresh && !ref.error && isNum(ref.temperature) ? ref.temperature : null;
      if (t !== null && rt !== null) {
        var gap = Math.round((t - rt) * 10) / 10;
        notes.push(Math.abs(gap) < 0.3 ? '<span>室内とほぼ同じ</span>'
          : '<span>室内より <b>' + Math.abs(gap).toFixed(1) + '°</b> ' + (gap < 0 ? '低い' : '高い') + '</span>');
      }
    } else if (t !== null && h !== null) {
      var di = Math.round(discomfort(t, h));
      notes.push('<span>不快指数 <b>' + di + '</b> ' + diLabel(di) + '</span>');
      if (h < 40) notes.push('<span>乾燥ぎみ</span>');
      else if (h >= 70) notes.push('<span>湿気が多め</span>');
    }
    if (ok && isNum(d.co2)) {
      notes.push('<span' + (d.co2 >= 1000 ? ' class="warn"' : '') + '>CO2 ' + Math.round(d.co2) + 'ppm</span>');
    }
    if (isNum(d.battery) && d.battery <= 20) {
      notes.push('<span class="warn">電池 ' + Math.round(d.battery) + '%</span>');
    }
    // notes はそれぞれ span で包む（flex の中では、むき出しの文字の前後の空白が消えるため）
    var note = notes.length ? '<div class="ec-note">' + notes.join('') + '</div>' : '';

    return '<li class="env-card' + (ok ? '' : ' is-dim') + '">' + head + main + stats + note + '</li>';
  }

  /** 屋外の台が無いときに、その場所に出す案内 */
  function placeholderHtml(snap) {
    var text, sub;
    if (!snap.multi) {
      text = '屋外の温湿度計';
      sub = '中継役を新しくすると、ここに出せます（README の「室内と屋外の温湿度」）';
    } else if (snap.devices.length > 1) {
      // 2台以上あるのに屋外が無い＝どれかを「屋外」にすれば出せる
      text = '屋外の温湿度計';
      sub = '設定で「屋外」を選ぶと、ここに出ます';
    } else {
      text = '屋外の温湿度計はありません';
      sub = 'SwitchBot アプリに追加すると、ここに出ます';
    }
    return '<li class="env-card is-ph"><button type="button" class="ec-ph" data-act="settings">' +
      '<svg class="ec-ic" aria-hidden="true"><use href="#i-tree"/></svg>' +
      '<span class="ec-ph-t">' + text + '</span><span class="ec-ph-s">' + sub + '</span></button></li>';
  }

  function renderCards(snap) {
    shown = pickShown(snap);
    var ref = shown.filter(function (d) { return d.role === 'in'; })[0] || null;
    var html = shown.map(function (d) { return cardHtml(d, ref, snap); }).join('');

    var hasOut = shown.some(function (d) { return d.role === 'out'; });
    if (!shown.length) {
      // まだ1度も取れていない
      html = '<li class="env-card is-ph"><div class="ec-ph">' +
        '<span class="ec-ph-t">' + (snap.error ? '取得できません' : '取得中…') + '</span>' +
        '<span class="ec-ph-s">' + esc(snap.error || 'SwitchBot から温度と湿度を読んでいます') + '</span></div></li>';
    } else if (!hasOut && shown.length < MAX_CARDS) {
      html += placeholderHtml(snap);
    }

    ui.cards.innerHTML = html;
    ui.cards.className = 'env-cards n' + Math.max(1, ui.cards.children.length);
  }

  // ---------- グラフ ----------
  /** 目盛りの間隔を 1・2・5 の倍数から選ぶ */
  function niceStep(span, count) {
    var raw = span / count;
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }

  /** ある台の、期間内の点 [[ミリ秒, 値], ...] */
  function pointsOf(id, x0) {
    var arr = log[id] || [];
    var k = view.metric === 'h' ? 2 : 1;
    var div = view.metric === 'h' ? 1 : 10;
    var pts = [];
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i][0] * 60000;
      if (t >= x0 && arr[i][k] !== null) pts.push([t, arr[i][k] / div]);
    }
    // 7日間は30分ごとの平均にする（線が細かく揺れすぎないように）
    if (view.range > 24) {
      var BIN = 30 * 60000, out = [], cur = null;
      pts.forEach(function (p) {
        var b = Math.floor(p[0] / BIN);
        if (!cur || cur.b !== b) {
          if (cur) out.push([cur.t / cur.n, cur.v / cur.n]);
          cur = { b: b, t: 0, v: 0, n: 0 };
        }
        cur.t += p[0]; cur.v += p[1]; cur.n++;
      });
      if (cur) out.push([cur.t / cur.n, cur.v / cur.n]);
      pts = out;
    }
    return pts;
  }

  /** 時刻 t にいちばん近い点（tol ミリ秒以内） */
  function nearest(pts, t, tol) {
    var best = null, bestGap = tol;
    for (var i = 0; i < pts.length; i++) {
      var g = Math.abs(pts[i][0] - t);
      if (g <= bestGap) { best = pts[i]; bestGap = g; }
    }
    return best;
  }

  var geo = null;   // 直前に描いたときの寸法（タップ位置から時刻を出すのに使う）

  function drawChart() {
    var W = ui.plot.clientWidth, H = ui.plot.clientHeight;
    if (!W || !H) return;

    var fs = parseFloat(window.getComputedStyle(ui.plot).fontSize) || 12;
    var unit = view.metric === 'h' ? '%' : '°';
    var now = Date.now();
    var span = view.range * 3600000;
    var x0 = now - span;
    var pad = { l: fs * 3, r: fs * 0.9, t: fs * 0.9, b: fs * 1.9 };
    var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    var gapMax = (view.range > 24 ? 80 : 20) * 60000;   // これより間があいたら線を切る

    var series = shown.map(function (d) {
      return { color: d.color, name: d.name || (d.role === 'out' ? '屋外' : '室内'), pts: pointsOf(d.id, x0) };
    });

    var vals = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { vals.push(p[1]); }); });

    var count = vals.length;
    var msg = (count < 2 && shown.length)
      ? 'グラフの記録をためています。この時計を開いている間、5分ごとに記録します（記録は端末ごと）。'
      : '';
    ui.msg.textContent = msg;
    ui.msg.hidden = !msg;

    // 縦軸の範囲（少なくとも 温度4°・湿度10% の幅をとる）
    var lo = count ? Math.min.apply(null, vals) : 0;
    var hi = count ? Math.max.apply(null, vals) : 1;
    var minSpan = view.metric === 'h' ? 10 : 4;
    if (hi - lo < minSpan) {
      var c = (hi + lo) / 2;
      lo = c - minSpan / 2;
      hi = c + minSpan / 2;
    }
    var step = niceStep(hi - lo, ph > fs * 9 ? 4 : 3);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    if (view.metric === 'h') { lo = Math.max(0, lo); hi = Math.min(100, hi); }
    if (hi <= lo) hi = lo + step;

    // 線が上下の端に貼り付かないよう、目盛りの外に少しだけ余白をとる
    var room = (hi - lo) * 0.05;
    var X = function (t) { return pad.l + (t - x0) / span * pw; };
    var Y = function (v) { return pad.t + (hi + room - v) / (hi - lo + room * 2) * ph; };
    geo = { x0: x0, span: span, pad: pad, pw: pw, W: W, series: series, gapMax: gapMax };

    var s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';

    // 塗りのグラデーション
    s += '<defs>';
    series.forEach(function (se, i) {
      s += '<linearGradient id="envFill' + i + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="' + se.color + '" stop-opacity="0.22"/>' +
        '<stop offset="1" stop-color="' + se.color + '" stop-opacity="0"/></linearGradient>';
    });
    s += '</defs>';

    // 横の目盛り線と数字
    var digits = step < 1 ? 1 : 0;
    for (var v = lo; v <= hi + step / 1000; v += step) {
      var y = Y(v).toFixed(1);
      s += '<line class="gl" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="yl" x="' + (pad.l - fs * 0.5) + '" y="' + y + '" dy="0.35em">' +
        (v < 0 ? '−' : '') + Math.abs(v).toFixed(digits) + unit + '</text>';
    }

    // 時刻の目盛り
    var bottom = H - pad.b;
    var xl = '';
    if (view.range <= 24) {
      // 3時間ごと。0時は日付にする
      var d0 = new Date(x0);
      d0.setMinutes(0, 0, 0);
      for (var t = d0.getTime() + 3600000; t <= now; t += 3600000) {
        var hr = new Date(t).getHours();
        if (hr % 3) continue;
        var x = X(t);
        s += '<line class="gl' + (hr === 0 ? ' gl0' : '') + '" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) +
          '" y1="' + pad.t + '" y2="' + bottom + '"/>';
        if (x - pad.l < fs * 1.2 || W - pad.r - x < fs * 1.2) continue;   // 端で切れる数字は出さない
        xl += '<text class="xl" x="' + x.toFixed(1) + '" y="' + (H - fs * 0.45).toFixed(1) + '">' +
          (hr === 0 ? mdOf(t) : hr + '時') + '</text>';
      }
    } else {
      // 1日ごと。線は0時、日付は昼に
      var d1 = new Date(x0);
      d1.setHours(0, 0, 0, 0);
      for (var day = d1.getTime(); day <= now; day = new Date(day).setDate(new Date(day).getDate() + 1)) {
        var xs = X(day);
        if (day > x0) {
          s += '<line class="gl gl0" x1="' + xs.toFixed(1) + '" x2="' + xs.toFixed(1) +
            '" y1="' + pad.t + '" y2="' + bottom + '"/>';
        }
        var a = Math.max(pad.l, xs);
        var b = Math.min(W - pad.r, X(new Date(day).setDate(new Date(day).getDate() + 1)));
        if (b - a < fs * 4.2) continue;                                      // 狭すぎる日は日付を省く
        xl += '<text class="xl" x="' + ((a + b) / 2).toFixed(1) + '" y="' + (H - fs * 0.45).toFixed(1) + '">' +
          mdOf(day + 12 * 3600000, b - a > fs * 5.6) + '</text>';
      }
    }
    s += xl;

    // 線と塗り
    series.forEach(function (se, i) {
      var segs = [], cur = [];
      se.pts.forEach(function (p, k) {
        if (k && p[0] - se.pts[k - 1][0] > gapMax) { segs.push(cur); cur = []; }
        cur.push([X(p[0]), Y(p[1])]);
      });
      if (cur.length) segs.push(cur);

      var line = '', area = '';
      segs.forEach(function (sg) {
        if (sg.length === 1) {
          s += '<circle cx="' + sg[0][0].toFixed(1) + '" cy="' + sg[0][1].toFixed(1) + '" r="' + (fs * 0.18).toFixed(1) +
            '" fill="' + se.color + '"/>';
          return;
        }
        var pts = sg.map(function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); });
        line += 'M' + pts.join('L');
        area += 'M' + sg[0][0].toFixed(1) + ' ' + bottom + 'L' + pts.join('L') +
          'L' + sg[sg.length - 1][0].toFixed(1) + ' ' + bottom + 'Z';
      });
      if (area) s += '<path d="' + area + '" fill="url(#envFill' + i + ')"/>';
      if (line) s += '<path class="ln" d="' + line + '" stroke="' + se.color + '"/>';

      // いちばん新しい点
      var lp = se.pts[se.pts.length - 1];
      if (lp && now - lp[0] < gapMax) {
        s += '<circle class="end" cx="' + X(lp[0]).toFixed(1) + '" cy="' + Y(lp[1]).toFixed(1) +
          '" r="' + (fs * 0.32).toFixed(1) + '" fill="' + se.color + '"/>';
      }
    });

    // タップした時刻
    var tipHtml = '';
    if (cursor !== null && cursor >= x0 && cursor <= now) {
      var cx = X(cursor).toFixed(1);
      s += '<line class="cur" x1="' + cx + '" x2="' + cx + '" y1="' + pad.t + '" y2="' + bottom + '"/>';
      var tol = view.range > 24 ? 50 * 60000 : 15 * 60000;
      var rows = '';
      series.forEach(function (se) {
        var p = nearest(se.pts, cursor, tol);
        if (!p) return;
        s += '<circle class="hit" cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) +
          '" r="' + (fs * 0.38).toFixed(1) + '" stroke="' + se.color + '"/>';
        rows += '<span class="tr"><i style="background:' + se.color + '"></i>' + esc(se.name) + '<b>' +
          (view.metric === 'h' ? Math.round(p[1]) + '%' : f1(p[1]) + '°') + '</b></span>';
      });
      tipHtml = '<span class="tt">' + (view.range > 24 ? mdOf(cursor, true) + ' ' : '') + hmOf(cursor) + '</span>' +
        (rows || '<span class="tr">記録なし</span>');
    }

    s += '</svg>';
    ui.svg.innerHTML = s;

    // 値の吹き出し（線の上に重ならないよう上端に。左右ははみ出さないよう寄せる）
    ui.tip.hidden = !tipHtml;
    if (tipHtml) {
      ui.tip.innerHTML = tipHtml;
      var tw = ui.tip.offsetWidth;
      var left = Math.max(0, Math.min(W - tw, X(cursor) - tw / 2));
      ui.tip.style.left = left.toFixed(1) + 'px';
    }
  }

  // ---------- まとめて描く ----------
  function render() {
    var snap = EC.getSensors ? EC.getSensors() : null;
    var setup = !snap || !snap.configured;
    ui.slide.classList.toggle('is-setup', setup);
    if (setup) return;

    renderCards(snap);

    if (ui.stamp) {
      ui.stamp.classList.toggle('is-err', !!snap.error);
      ui.stamp.textContent = snap.error
        ? (snap.at ? hmOf(snap.at) + ' 以降 取得できません（再試行中）' : '取得できません（再試行中）')
        : (snap.at ? hmOf(snap.at) + ' 更新' : '');
    }

    syncButtons();
    drawChart();
  }

  function syncButtons() {
    [[ui.metric, view.metric], [ui.range, String(view.range)]].forEach(function (pair) {
      if (!pair[0]) return;
      Array.prototype.forEach.call(pair[0].querySelectorAll('[data-v]'), function (b) {
        var on = b.getAttribute('data-v') === pair[1];
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    });
  }

  // ---------- 操作 ----------
  function onSeg(box, apply) {
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-v]') : null;
      if (!b) return;
      apply(b.getAttribute('data-v'));
      cursor = null;
      saveView();
      render();
    });
  }
  onSeg(ui.metric, function (v) { view.metric = v === 'h' ? 'h' : 't'; });
  onSeg(ui.range, function (v) { view.range = v === '168' ? 168 : 24; });

  // カードの案内（屋外が無いとき）・未設定のときのボタン → 設定を開く
  ui.slide.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act="settings"]') : null;
    if (b && EC.openSensorSettings) EC.openSensorSettings();
  });
  if (ui.setupBtn) {
    ui.setupBtn.addEventListener('click', function () {
      if (EC.openSensorSettings) EC.openSensorSettings();
    });
  }

  /** グラフをタップした位置の時刻を出す */
  function showAt(clientX) {
    if (!geo) return;
    var r = ui.plot.getBoundingClientRect();
    var x = clientX - r.left;
    if (x < geo.pad.l - 4 || x > geo.W - geo.pad.r + 4) { hideCursor(); return; }
    cursor = geo.x0 + Math.max(0, Math.min(1, (x - geo.pad.l) / geo.pw)) * geo.span;
    drawChart();
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(hideCursor, TIP_TIME);
  }

  function hideCursor() {
    clearTimeout(cursorTimer);
    if (cursor === null) return;
    cursor = null;
    drawChart();
  }

  // スワイプの処理が指を捕まえるため、グラフ自身には click が届かない。
  // そこで画面全体で指の動きを見て、グラフの上で「動かさずに離した」ものをタップとする。
  function tapMove() {
    return Math.max(10, Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.02));
  }
  function inPlot(x, y) {
    var r = ui.plot.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  if (window.PointerEvent) {
    var tap = null;
    document.addEventListener('pointerdown', function (e) {
      if (!visible || e.isPrimary === false || (e.button != null && e.button !== 0) ||
          document.querySelector('.overlay:not([hidden])') || !inPlot(e.clientX, e.clientY)) {
        tap = null;
        return;
      }
      tap = { x: e.clientX, y: e.clientY, id: e.pointerId, at: Date.now() };
    }, true);
    document.addEventListener('pointermove', function (e) {
      var lim = tapMove();
      if (tap && (Math.abs(e.clientX - tap.x) > lim || Math.abs(e.clientY - tap.y) > lim)) tap = null;
    }, true);
    document.addEventListener('pointerup', function (e) {
      if (!tap || tap.id !== e.pointerId) return;
      var t = tap;
      tap = null;
      if (Date.now() - t.at > TAP_TIME) return;
      var lim = tapMove();
      if (Math.abs(e.clientX - t.x) > lim || Math.abs(e.clientY - t.y) > lim) return;
      showAt(e.clientX);
    }, true);
    document.addEventListener('pointercancel', function () { tap = null; }, true);
  } else {
    ui.plot.addEventListener('click', function (e) { if (visible) showAt(e.clientX); });
  }

  // ---------- 更新のきっかけ ----------
  document.addEventListener('sensorsupdate', function (e) {
    record(e.detail);
    if (visible) render();
  });

  document.addEventListener('slidechange', function (e) {
    var mine = Array.prototype.indexOf.call(document.querySelectorAll('.slide'), ui.slide);
    visible = !!(e.detail && e.detail.index === mine);
    if (visible) render();
    else hideCursor();
  });

  // 表示中は1分ごとに描き直す（グラフの右端＝いまが進むので）
  if (EC.onSecond) {
    EC.onSecond(function () {
      if (!visible || document.hidden) return;
      var m = Math.floor(Date.now() / 60000);
      if (m === lastMinute) return;
      lastMinute = m;
      render();
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!visible) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });

  if (EC.getSensors) record(EC.getSensors());
  if (EC.getSlide && EC.getSlide() === Array.prototype.indexOf.call(document.querySelectorAll('.slide'), ui.slide)) {
    visible = true;
    render();
  }
})();
