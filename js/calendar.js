/* ============================================================
   Echo Clock & Weather - カレンダー

   - 月ごとに、日本の季節にちなんだ意匠（松、梅、桜、鯉のぼり…）を表示
   - 日本の祝日を計算して赤く表示（振替休日・国民の休日も含む）
   - 前後の月を見たあとは、画面を離れると今月に戻る
   ============================================================ */
'use strict';

(function () {
  var EC = window.EC || {};
  var $ = function (id) { return document.getElementById(id); };

  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  var CELLS = 42;   // 6週ぶん。高さを一定に保つため常に6行出す

  /* ============================================================
     月ごとの意匠と季節の言葉
     ============================================================ */
  var MONTHS = [
    {
      wafu: '睦月', season: '冬', color: '#e9a83c',
      note: '初日の出と松に、新しい年を迎える',
      art:
        '<circle cx="80" cy="40" r="24" fill="#e9a83c"/>' +
        '<path d="M12 112C32 102 50 88 66 68" stroke="#6b4f3c" stroke-width="4" ' +
        'fill="none" stroke-linecap="round"/>' +
        pineTuft(28, 102, -42, 17) + pineTuft(46, 88, -30, 19) +
        pineTuft(64, 70, -22, 17) + pineTuft(34, 94, -100, 13)
    },
    {
      wafu: '如月', season: '冬', color: '#e98aa8',
      note: '梅がほころび、春の気配がただよう',
      art: petals(5, 60, 50, 15, 13, '#e98aa8', 'round') +
        '<circle cx="60" cy="50" r="6.5" fill="#f7e6b0"/>' +
        '<g stroke="#f7e6b0" stroke-width="2" stroke-linecap="round">' +
        '<path d="M60 50l-8-7M60 50l8-7M60 50l-9 4M60 50l9 4M60 50v10"/></g>' +
        '<path d="M14 106C34 96 48 80 55 63" stroke="#8a6650" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
    },
    {
      wafu: '弥生', season: '春', color: '#f08fb0',
      note: '桃の花が咲き、ひな祭りの季節',
      art: petals(5, 60, 52, 16, 14, '#f08fb0', 'point') +
        '<circle cx="60" cy="52" r="6" fill="#fff0c8"/>' +
        '<path d="M60 68v34" stroke="#6f9a63" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M60 84c-10 0-16-5-18-12 9-2 15 2 18 12z" fill="#6f9a63"/>' +
        '<path d="M60 96c10 0 16-5 18-12-9-2-15 2-18 12z" fill="#6f9a63"/>'
    },
    {
      wafu: '卯月', season: '春', color: '#f6b8ce',
      note: '桜が満開になり、新しい年度がはじまる',
      art: petals(5, 60, 52, 17, 15, '#f6b8ce', 'sakura') +
        '<circle cx="60" cy="52" r="5.5" fill="#fff2dc"/>' +
        '<g stroke="#fff2dc" stroke-width="1.8" stroke-linecap="round">' +
        '<path d="M60 52l-7-8M60 52l7-8M60 52l-9 5M60 52l9 5M60 52v10"/></g>' +
        '<circle cx="24" cy="94" r="6" fill="#f6b8ce" opacity=".75"/>' +
        '<circle cx="98" cy="86" r="4.5" fill="#f6b8ce" opacity=".6"/>'
    },
    {
      wafu: '皐月', season: '春', color: '#4fa3d8',
      note: '鯉のぼりが泳ぎ、風がさわやかになる',
      art:
        '<path d="M96 42v72" stroke="#8a97ad" stroke-width="3.5" stroke-linecap="round"/>' +
        '<circle cx="96" cy="38" r="5" fill="#e9a83c"/>' +
        '<path d="M88 58C70 40 34 42 20 58c14 16 50 18 68 0z" fill="#4fa3d8"/>' +
        '<path d="M20 58L6 46v24z" fill="#4fa3d8"/>' +
        '<circle cx="78" cy="53" r="4.2" fill="#0e1426"/>' +
        '<g stroke="#dcecf7" stroke-width="2.2" fill="none" stroke-linecap="round">' +
        '<path d="M62 46c-4 8-4 16 0 24M50 45c-4 9-4 17 0 26M38 47c-4 8-4 15 0 22"/></g>' +
        '<path d="M86 88C72 76 46 78 36 88c10 12 36 14 50 0z" fill="#e07a7a" opacity=".9"/>' +
        '<path d="M36 88L24 79v18z" fill="#e07a7a" opacity=".9"/>'
    },
    {
      wafu: '水無月', season: '夏', color: '#8f9fe0',
      note: '梅雨のあじさいが、雨に色を深める',
      art:
        floret(44, 44, 9, '#8f9fe0') + floret(70, 38, 9, '#a9b7ea') +
        floret(58, 58, 9.5, '#7f90d8') + floret(32, 62, 8.5, '#a9b7ea') +
        floret(80, 60, 8.5, '#8f9fe0') + floret(56, 30, 8, '#b9c4ef') +
        '<path d="M60 74v16" stroke="#5f9a68" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M60 92c-14 0-22-7-25-17 13-3 21 3 25 17z" fill="#5f9a68"/>' +
        '<path d="M60 104c14 0 22-7 25-17-13-3-21 3-25 17z" fill="#4f8a58"/>'
    },
    {
      wafu: '文月', season: '夏', color: '#7fd0d8',
      note: '風鈴の音がすずしい、七夕の月',
      art:
        '<path d="M60 22v10" stroke="#8a97ad" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M36 62c0-24 48-24 48 0z" fill="#7fd0d8"/>' +
        '<ellipse cx="60" cy="62" rx="24" ry="6" fill="#a5e2e8"/>' +
        '<path d="M60 62v14" stroke="#8a97ad" stroke-width="2.4" stroke-linecap="round"/>' +
        '<circle cx="60" cy="79" r="5" fill="#e9e4d2"/>' +
        '<path d="M60 84v6" stroke="#8a97ad" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M53 90h14v22l-7-5-7 5z" fill="#f2ede0"/>'
    },
    {
      wafu: '葉月', season: '夏', color: '#f2c14e',
      note: '夜空に花火があがる、夏のさかり',
      art: firework(60, 56, 40, '#f2c14e') +
        firework(26, 88, 18, '#e98aa8') +
        firework(96, 84, 15, '#7fd0d8')
    },
    {
      wafu: '長月', season: '秋', color: '#f0e2b0',
      note: '十五夜の月と、すすきの穂がゆれる',
      art:
        '<circle cx="82" cy="38" r="25" fill="#f0e2b0"/>' +
        '<circle cx="74" cy="31" r="4" fill="#dfcf98" opacity=".7"/>' +
        '<circle cx="90" cy="47" r="5.5" fill="#dfcf98" opacity=".6"/>' +
        '<circle cx="86" cy="27" r="3" fill="#dfcf98" opacity=".5"/>' +
        susuki(18, 114, -12) + susuki(33, 116, -3) + susuki(48, 114, 6)
    },
    {
      wafu: '神無月', season: '秋', color: '#e0703f',
      note: '紅葉が山を染め、秋が深まる',
      art: maple(60, 92, '#e0703f', 1.35) +
        '<path d="M60 92v20" stroke="#a8552f" stroke-width="3.4" stroke-linecap="round"/>'
    },
    {
      wafu: '霜月', season: '秋', color: '#e8c451',
      note: '銀杏が黄金色になり、落ち葉が舞う',
      art:
        '<path d="M60 80C40 78 22 66 18 50 26 34 44 26 58 34L60 46 62 34C76 26 94 34 102 50 98 66 80 78 60 80Z" fill="#e8c451"/>' +
        '<g stroke="#c9a53f" stroke-width="1.4" stroke-linecap="round" opacity=".65">' +
        '<path d="M60 78L34 44M60 78L46 36M60 78L86 44M60 78L74 36"/></g>' +
        '<path d="M60 80v30" stroke="#c3a13c" stroke-width="3.2" stroke-linecap="round"/>' +
        '<circle cx="24" cy="100" r="3.6" fill="#e8c451" opacity=".55"/>' +
        '<circle cx="100" cy="96" r="2.8" fill="#e8c451" opacity=".45"/>'
    },
    {
      wafu: '師走', season: '冬', color: '#a8d8ee',
      note: '雪の結晶が舞い、一年が暮れてゆく',
      art: snowflake(60, 58, 40, '#a8d8ee') +
        '<circle cx="24" cy="98" r="3.4" fill="#a8d8ee" opacity=".7"/>' +
        '<circle cx="96" cy="94" r="2.6" fill="#a8d8ee" opacity=".55"/>' +
        '<circle cx="86" cy="22" r="2.4" fill="#a8d8ee" opacity=".5"/>'
    }
  ];

  /* ---------- 意匠を組み立てる小さな部品 ---------- */

  /** 花びらを放射状に並べる */
  function petals(count, cx, cy, dist, size, color, shape) {
    var out = '';
    for (var i = 0; i < count; i++) {
      var deg = i * (360 / count);
      if (shape === 'round') {
        out += '<circle cx="' + cx + '" cy="' + (cy - dist) + '" r="' + size + '" fill="' + color +
          '" transform="rotate(' + deg + ' ' + cx + ' ' + cy + ')"/>';
      } else if (shape === 'sakura') {
        // 先が割れた桜の花びら
        var d = 'M0 -' + (dist + size) + ' l3 5 c6 5 8 12 4 17 c-3 4-11 4-14 0 c-4-5-2-12 4-17 z';
        out += '<path d="' + d + '" fill="' + color +
          '" transform="translate(' + cx + ' ' + cy + ') rotate(' + deg + ')"/>';
      } else {
        // 先がとがった花びら
        var p = 'M0 -' + (dist + size) + ' c7 6 10 14 5 19 c-3 3-7 3-10 0 c-5-5-2-13 5-19 z';
        out += '<path d="' + p + '" fill="' + color +
          '" transform="translate(' + cx + ' ' + cy + ') rotate(' + deg + ')"/>';
      }
    }
    return out;
  }

  /** 松葉の束（1点から扇状に広がる細い線） */
  function pineTuft(x, y, deg, r) {
    var out = '<g stroke="#5fa075" stroke-width="2.2" stroke-linecap="round" fill="none">';
    for (var i = -3; i <= 3; i++) {
      var a = (deg + i * 13) * Math.PI / 180;
      out += '<path d="M' + x + ' ' + y + 'L' + (x + Math.cos(a) * r).toFixed(1) +
        ' ' + (y + Math.sin(a) * r).toFixed(1) + '"/>';
    }
    return out + '</g>';
  }

  /** もみじ（とがった小葉を5枚、扇状に並べる） */
  function maple(cx, cy, color, scale) {
    var out = '<g fill="' + color + '" transform="translate(' + cx + ' ' + cy +
      ') scale(' + (scale || 1) + ')">';
    var angles = [-72, -36, 0, 36, 72];
    var scales = [0.72, 0.92, 1, 0.92, 0.72];
    for (var i = 0; i < angles.length; i++) {
      out += '<path d="M0 0C-5-10-11-18-9-29L-4-26-3-40 0-52 3-40 4-26 9-29C11-18 5-10 0 0Z" ' +
        'transform="rotate(' + angles[i] + ') scale(' + scales[i] + ')"/>';
    }
    return out + '</g>';
  }

  /** あじさいの小花（4枚花びら） */
  function floret(cx, cy, r, color) {
    var out = '';
    for (var i = 0; i < 4; i++) {
      out += '<ellipse cx="' + cx + '" cy="' + (cy - r * 0.62) + '" rx="' + (r * 0.55) +
        '" ry="' + (r * 0.72) + '" fill="' + color +
        '" transform="rotate(' + (i * 90) + ' ' + cx + ' ' + cy + ')"/>';
    }
    return out + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.24) + '" fill="#f7f2d8"/>';
  }

  /** 花火 */
  function firework(cx, cy, r, color) {
    var out = '<g stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" opacity=".9">';
    var dots = '';
    for (var i = 0; i < 12; i++) {
      var a = i * 30 * Math.PI / 180;
      var x1 = cx + Math.cos(a) * r * 0.28, y1 = cy + Math.sin(a) * r * 0.28;
      var x2 = cx + Math.cos(a) * r, y2 = cy + Math.sin(a) * r;
      out += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '"/>';
      dots += '<circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="2.6" fill="' + color + '"/>';
    }
    return out + '</g>' + dots;
  }

  /** すすきの穂（羽毛のような穂を付ける） */
  function susuki(x, baseY, tilt) {
    var topY = baseY - 66;
    var topX = x + tilt;
    return '<path d="M' + x + ' ' + baseY + ' Q' + (x + tilt * 0.35) + ' ' + (baseY - 34) +
      ' ' + topX + ' ' + topY + '" stroke="#b9a877" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
      '<g transform="translate(' + topX + ' ' + topY + ') rotate(' + (tilt * 0.7) + ')">' +
      '<path d="M0 17C-6 6-5-7 0-17C5-7 6 6 0 17Z" fill="#e2d5ab"/>' +
      '<g stroke="#e2d5ab" stroke-width="1.3" stroke-linecap="round" opacity=".8">' +
      '<path d="M0 9l-9 5M0 2l-10 3M0-5l-9-1M0 9l9 5M0 2l10 3M0-5l9-1M0-12l-7-5M0-12l7-5"/>' +
      '</g></g>';
  }

  /** 雪の結晶 */
  function snowflake(cx, cy, r, color) {
    var out = '<g stroke="' + color + '" stroke-width="3" stroke-linecap="round" fill="none">';
    for (var i = 0; i < 6; i++) {
      var deg = i * 60;
      out += '<g transform="translate(' + cx + ' ' + cy + ') rotate(' + deg + ')">' +
        '<path d="M0 0V-' + r + '"/>' +
        '<path d="M0 -' + (r * 0.5) + 'l-8-8M0 -' + (r * 0.5) + 'l8-8"/>' +
        '<path d="M0 -' + (r * 0.8) + 'l-6-6M0 -' + (r * 0.8) + 'l6-6"/>' +
        '</g>';
    }
    return out + '</g><circle cx="' + cx + '" cy="' + cy + '" r="4" fill="' + color + '"/>';
  }

  /* ============================================================
     日本の祝日
     ※ 1980年〜2099年に対応。2020・2021年の五輪特例は含みません
     ============================================================ */

  /** その月の第n月曜日の日付 */
  function nthMonday(y, m, n) {
    var day = new Date(y, m - 1, 1).getDay();     // 0=日
    var first = 1 + ((8 - day) % 7);              // 最初の月曜
    return first + (n - 1) * 7;
  }

  /** 春分の日・秋分の日（近似式） */
  function equinox(y, spring) {
    var base = spring ? 20.8431 : 23.2488;
    return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }

  var holidayCache = {};

  /** その年の祝日を { 'M-D': 名前 } の形で返す */
  function holidaysOf(y) {
    if (holidayCache[y]) return holidayCache[y];

    var h = {};
    function put(m, d, name) { h[m + '-' + d] = name; }

    put(1, 1, '元日');
    put(1, nthMonday(y, 1, 2), '成人の日');
    put(2, 11, '建国記念の日');
    put(2, 23, '天皇誕生日');
    put(3, equinox(y, true), '春分の日');
    put(4, 29, '昭和の日');
    put(5, 3, '憲法記念日');
    put(5, 4, 'みどりの日');
    put(5, 5, 'こどもの日');
    put(7, nthMonday(y, 7, 3), '海の日');
    put(8, 11, '山の日');
    put(9, nthMonday(y, 9, 3), '敬老の日');
    put(9, equinox(y, false), '秋分の日');
    put(10, nthMonday(y, 10, 2), 'スポーツの日');
    put(11, 3, '文化の日');
    put(11, 23, '勤労感謝の日');

    // 振替休日：日曜と重なったら、次の平日を休みにする
    Object.keys(h).slice().forEach(function (key) {
      var parts = key.split('-');
      var d = new Date(y, +parts[0] - 1, +parts[1]);
      if (d.getDay() !== 0) return;
      var next = new Date(d.getTime());
      do {
        next.setDate(next.getDate() + 1);
      } while (h[(next.getMonth() + 1) + '-' + next.getDate()]);
      h[(next.getMonth() + 1) + '-' + next.getDate()] = '振替休日';
    });

    // 国民の休日：祝日にはさまれた平日
    var cur = new Date(y, 0, 1);
    var end = new Date(y, 11, 31);
    while (cur <= end) {
      var k = (cur.getMonth() + 1) + '-' + cur.getDate();
      if (!h[k] && cur.getDay() !== 0) {
        var before = new Date(cur.getTime()); before.setDate(before.getDate() - 1);
        var after = new Date(cur.getTime()); after.setDate(after.getDate() + 1);
        var kb = (before.getMonth() + 1) + '-' + before.getDate();
        var ka = (after.getMonth() + 1) + '-' + after.getDate();
        if (h[kb] && h[ka]) h[k] = '国民の休日';
      }
      cur.setDate(cur.getDate() + 1);
    }

    holidayCache[y] = h;
    return h;
  }

  /* ============================================================
     表示
     ============================================================ */
  var el = {
    motif: $('calMotif'), wafu: $('calWafu'), season: $('calSeason'),
    note: $('calNote'), ym: $('calYm'), grid: $('calGrid'),
    prev: $('calPrev'), next: $('calNext'), today: $('calToday'),
    holidays: $('calHolidays')
  };

  var view = new Date();           // 表示中の月（1日に固定して使う）
  view.setDate(1);

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function render() {
    var y = view.getFullYear();
    var m = view.getMonth();         // 0-11
    var info = MONTHS[m];
    var today = new Date();
    var hol = holidaysOf(y);

    // 左側：季節の意匠
    el.motif.innerHTML = info.art;
    el.wafu.textContent = info.wafu;
    el.season.textContent = info.season;
    el.note.textContent = info.note;
    el.ym.textContent = y + '年 ' + (m + 1) + '月';
    document.documentElement.style.setProperty('--cal-accent', info.color);

    // 日付のマス
    var firstDay = new Date(y, m, 1).getDay();
    var start = new Date(y, m, 1 - firstDay);
    var frag = document.createDocumentFragment();

    WEEK.forEach(function (w, i) {
      var head = document.createElement('div');
      head.className = 'cal-wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
      head.textContent = w;
      frag.appendChild(head);
    });

    for (var i = 0; i < CELLS; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var cell = document.createElement('div');
      var cls = 'cal-day';
      var inMonth = d.getMonth() === m;
      if (!inMonth) cls += ' out';

      var name = inMonth ? hol[(d.getMonth() + 1) + '-' + d.getDate()] : null;
      if (name) cls += ' holiday';
      else if (d.getDay() === 0) cls += ' sun';
      else if (d.getDay() === 6) cls += ' sat';
      if (sameDay(d, today)) cls += ' today';

      cell.className = cls;
      var num = document.createElement('span');
      num.className = 'n';
      num.textContent = d.getDate();
      cell.appendChild(num);
      if (name) {
        var dot = document.createElement('span');
        dot.className = 'hdot';
        cell.appendChild(dot);
      }
      frag.appendChild(cell);
    }
    el.grid.replaceChildren(frag);

    // 今月の祝日を並べる
    var list = [];
    Object.keys(hol).forEach(function (k) {
      var parts = k.split('-');
      if (+parts[0] === m + 1) list.push({ d: +parts[1], name: hol[k] });
    });
    list.sort(function (a, b) { return a.d - b.d; });

    var hf = document.createDocumentFragment();
    list.forEach(function (item) {
      var li = document.createElement('li');
      var dd = document.createElement('span');
      dd.className = 'hd';
      dd.textContent = item.d + '日';
      var nn = document.createElement('span');
      nn.textContent = item.name;
      li.appendChild(dd);
      li.appendChild(nn);
      hf.appendChild(li);
    });
    if (!list.length) {
      var none = document.createElement('li');
      none.className = 'none';
      none.textContent = '今月の祝日はありません';
      hf.appendChild(none);
    }
    el.holidays.replaceChildren(hf);

    // 今月以外を見ているときだけ「今日」ボタンを出す
    var isThisMonth = y === today.getFullYear() && m === today.getMonth();
    el.today.hidden = isThisMonth;
  }

  function shift(n) {
    view = new Date(view.getFullYear(), view.getMonth() + n, 1);
    render();
  }

  el.prev.addEventListener('click', function () { shift(-1); });
  el.next.addEventListener('click', function () { shift(1); });
  el.today.addEventListener('click', function () {
    view = new Date();
    view.setDate(1);
    render();
  });

  // カレンダーの画面から離れたら今月に戻しておく
  document.addEventListener('slidechange', function (e) {
    if (e.detail && e.detail.index === 3) return;
    var now = new Date();
    if (view.getFullYear() !== now.getFullYear() || view.getMonth() !== now.getMonth()) {
      view = new Date();
      view.setDate(1);
      render();
    }
  });

  // 日付が変わったら描き直す
  var lastDay = new Date().getDate();
  if (EC.onSecond) {
    EC.onSecond(function (now) {
      if (now.getDate() !== lastDay) {
        lastDay = now.getDate();
        render();
      }
    });
  }

  render();
})();
