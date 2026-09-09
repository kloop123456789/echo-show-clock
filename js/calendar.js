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

     絵は img/month-01.png 〜 month-12.png を使います。
     差し替えたときは IMG_VER の数字を増やしてください。
     ブラウザが古い画像を覚えているのを防げます。
     ============================================================ */
  var IMG_VER = 2;

  var MONTHS = [
    { wafu: '睦月', season: '冬', color: '#f0a92e', note: '初日の出と松に、新しい年を迎える' },
    { wafu: '如月', season: '冬', color: '#ee85ab', note: '梅がほころび、春の気配がただよう' },
    { wafu: '弥生', season: '春', color: '#f08fb0', note: 'ひな人形をかざり、桃の節句を祝う' },
    { wafu: '卯月', season: '春', color: '#f4a9c6', note: '桜が満開になり、新しい年度がはじまる' },
    { wafu: '皐月', season: '春', color: '#3f8fd8', note: '鯉のぼりが泳ぎ、風がさわやかになる' },
    { wafu: '水無月', season: '夏', color: '#7f8fdc', note: '梅雨のあじさいが、雨に色を深める' },
    { wafu: '文月', season: '夏', color: '#6fc9d6', note: '風鈴の音がすずしい、七夕の月' },
    { wafu: '葉月', season: '夏', color: '#f2c14e', note: '夜空に花火があがる、夏のさかり' },
    { wafu: '長月', season: '秋', color: '#ecdfa8', note: '十五夜の月と、すすきの穂がゆれる' },
    { wafu: '神無月', season: '秋', color: '#e0602f', note: '紅葉が山を染め、秋が深まる' },
    { wafu: '霜月', season: '秋', color: '#eec44a', note: '銀杏が黄金色になり、落ち葉が舞う' },
    { wafu: '師走', season: '冬', color: '#9fd4ee', note: '雪の結晶が舞い、一年が暮れてゆく' }
  ];

  /** その月の絵の場所 */
  function motifSrc(month0) {
    var n = month0 + 1;
    return 'img/month-' + (n < 10 ? '0' + n : n) + '.png?v=' + IMG_VER;
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
    var src = motifSrc(m);
    if (el.motif.getAttribute('src') !== src) el.motif.setAttribute('src', src);
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
