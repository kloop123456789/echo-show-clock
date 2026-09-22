/* ============================================================
   世界時計（5枚目）

   左：主要な都市のいまの時刻。日本から見て「前日／同じ日／翌日」かと、時差を出す。
   右：時差の計算。「PT の 10:00」のように現地の時刻を入れると、
       日本時間では何日の何時か、いまからあと何時間かを出す。

   AI の新しいモデルなどは「10am PT」のように米国西海岸の時刻で告知されることが多いので、
   PT（米西海岸）を最初に置いている。

   夏時間の切り替えは、ブラウザが持っている世界の時刻データ（Intl）に任せる。
   自分で「何時間ずれ」と覚えておかないので、切り替えの日をまたいでも正しい。
   ============================================================ */
(function () {
  'use strict';

  var EC = window.EC || {};
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    slide: document.querySelector('.slide-world'),
    jst: $('wcJst'), cards: $('wcCards'), chips: $('wcChips'),
    date: $('wcDate'), prev: $('wcPrev'), next: $('wcNext'),
    hour: $('wcHour'), minute: $('wcMin'), ampm: $('wcAmpm'), spins: $('wcSpins'),
    result: $('wcResult'), left: $('wcLeft'), zone: $('wcZone')
  };
  if (!ui.slide || !window.Intl || !Intl.DateTimeFormat) return;

  var HOME = 'Asia/Tokyo';
  var SAVE_KEY = 'echo-clock-world';
  var MIN_STEP = 5;               // 分を何分ずつ動かすか
  var HOLD_DELAY = 420;           // 長押しで連続して動き出すまで
  var HOLD_EVERY = 110;           // 長押し中の間隔

  // 並び順は、AI の発表でよく使われる順
  var CITIES = [
    { id: 'pt', name: 'サンフランシスコ', abbr: 'PT', area: '米西海岸', tz: 'America/Los_Angeles' },
    { id: 'et', name: 'ニューヨーク', abbr: 'ET', area: '米東海岸', tz: 'America/New_York' },
    { id: 'utc', name: '協定世界時', abbr: 'UTC', area: '世界時', tz: 'UTC' },
    { id: 'uk', name: 'ロンドン', abbr: 'UK', area: 'ロンドン', tz: 'Europe/London' },
    { id: 'cet', name: 'パリ・ベルリン', abbr: 'CET', area: '中欧', tz: 'Europe/Paris' },
    { id: 'cn', name: '北京・上海', abbr: 'CN', area: '中国', tz: 'Asia/Shanghai' }
  ];

  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  var WD_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  var visible = false;

  // ---------- 時刻の計算 ----------
  var fmt = {};

  /** ある瞬間の、その地域での年月日・時分・曜日 */
  function partsOf(t, tz) {
    var f = fmt[tz] || (fmt[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short'
    }));
    var o = {};
    f.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
    return {
      y: +o.year, mo: +o.month, d: +o.day,
      h: (+o.hour) % 24, mi: +o.minute, s: +o.second,
      wd: WD_EN[o.weekday] !== undefined ? WD_EN[o.weekday] : 0
    };
  }

  /** その地域の、世界時からのずれ（分） */
  function offsetMin(t, tz) {
    var p = partsOf(t, tz);
    var asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60000);
  }

  /** その地域の壁の時計で「y年mo月d日 h時mi分」になる瞬間 */
  function zonedToUtc(y, mo, d, h, mi, tz) {
    var guess = Date.UTC(y, mo - 1, d, h, mi);
    var off1 = offsetMin(guess, tz);
    var t = guess - off1 * 60000;
    var off2 = offsetMin(t, tz);
    // 夏時間の切り替えをまたぐときは、もう一度合わせ直す
    if (off2 !== off1) t = guess - off2 * 60000;
    return t;
  }

  /** いまが夏時間か（1月と7月のずれの小さいほうを標準時とみなす） */
  function isSummer(t, tz) {
    var y = partsOf(t, tz).y;
    var std = Math.min(offsetMin(Date.UTC(y, 0, 1), tz), offsetMin(Date.UTC(y, 6, 1), tz));
    return offsetMin(t, tz) > std;
  }

  /** 2つの年月日の差（日） */
  function dayDiff(a, b) {
    return Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d)) / 864e5);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function md(p) { return p.mo + '月' + p.d + '日（' + WEEK[p.wd] + '）'; }
  function hm(p) { return pad2(p.h) + ':' + pad2(p.mi); }

  /** 時差を「−16時間」「+5時間30分」のように */
  function diffText(min) {
    if (min === 0) return '時差なし';
    var sign = min > 0 ? '+' : '−';
    var a = Math.abs(min);
    return sign + Math.floor(a / 60) + '時間' + (a % 60 ? (a % 60) + '分' : '');
  }

  /** 「午前3時」「午後3時30分」 */
  function jpClock(h, mi) {
    var am = h < 12;
    var hh = h % 12;
    return (am ? '午前' : '午後') + hh + '時' + (mi ? mi + '分' : '');
  }

  function relDay(n, base) {
    if (n === 0) return base === 'home' ? '今日' : '日本と同じ日';
    if (n === -1) return base === 'home' ? '昨日' : '日本の前日';
    if (n === 1) return base === 'home' ? '明日' : '日本の翌日';
    if (n === 2 && base === 'home') return '明後日';
    if (n === -2 && base === 'home') return '一昨日';
    return (n > 0 ? n + '日後' : (-n) + '日前');
  }

  function cityById(id) {
    for (var i = 0; i < CITIES.length; i++) if (CITIES[i].id === id) return CITIES[i];
    return CITIES[0];
  }

  // ---------- 左：世界時計 ----------
  var cardEls = {};

  function buildCards() {
    var frag = document.createDocumentFragment();
    CITIES.forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'wc-card';
      li.innerHTML =
        '<div class="wc-card-head"><span class="wc-name"></span><span class="wc-abbr"></span>' +
        '<svg class="wc-sky" aria-hidden="true"><use href="#i-sun"/></svg></div>' +
        '<div class="wc-clock"></div>' +
        '<div class="wc-meta"><span class="wc-day"></span><span class="wc-rel"></span></div>';
      li.querySelector('.wc-name').textContent = c.name;
      li.querySelector('.wc-abbr').textContent = c.abbr;
      cardEls[c.id] = {
        li: li,
        sky: li.querySelector('.wc-sky use'),
        clock: li.querySelector('.wc-clock'),
        day: li.querySelector('.wc-day'),
        rel: li.querySelector('.wc-rel')
      };
      frag.appendChild(li);
    });
    ui.cards.replaceChildren(frag);
  }

  function renderCards(t) {
    var home = partsOf(t, HOME);
    var homeOff = offsetMin(t, HOME);
    ui.jst.textContent = '日本 ' + md(home) + ' ' + hm(home);

    CITIES.forEach(function (c) {
      var e = cardEls[c.id];
      var p = partsOf(t, c.tz);
      var off = offsetMin(t, c.tz);
      var night = p.h < 6 || p.h >= 18;
      e.sky.setAttribute('href', night ? '#i-moon' : '#i-sun');
      e.li.classList.toggle('is-night', night);
      e.clock.textContent = hm(p);
      e.day.textContent = md(p);
      var summer = c.tz !== 'UTC' && isSummer(t, c.tz);
      e.rel.textContent = relDay(dayDiff(p, home), 'city') + '・' + diffText(off - homeOff) +
        (summer ? '・夏時間' : '');
      e.li.classList.toggle('is-picked', c.id === state.city);
    });
  }

  // ---------- 右：時差の計算 ----------
  // 選んだ地域の「壁の時計」で持つ（地域を変えても、同じ時刻の入力のまま比べられるように）
  var state = load() || defaults();

  function defaults() {
    // 最初は「次に来る PT の 10:00」（米国の発表でよくある時刻）
    var c = CITIES[0];
    var now = Date.now();
    var p = partsOf(now, c.tz);
    var t = zonedToUtc(p.y, p.mo, p.d, 10, 0, c.tz);
    if (t <= now) {
      var q = partsOf(now + 864e5, c.tz);
      return { city: c.id, y: q.y, mo: q.mo, d: q.d, h: 10, mi: 0 };
    }
    return { city: c.id, y: p.y, mo: p.mo, d: p.d, h: 10, mi: 0 };
  }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s || !s.city || !isFinite(s.y) || !isFinite(s.h)) return null;
      // 1日以上前に過ぎた入力は、次に開いたときには初めからにする
      var t = zonedToUtc(s.y, s.mo, s.d, s.h, s.mi, cityById(s.city).tz);
      if (Date.now() - t > 864e5) return null;
      return s;
    } catch (e) { return null; }
  }

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* 保存できなくても動く */ }
  }

  function targetTime() {
    return zonedToUtc(state.y, state.mo, state.d, state.h, state.mi, cityById(state.city).tz);
  }

  function buildChips() {
    var frag = document.createDocumentFragment();
    CITIES.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wc-chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('data-id', c.id);
      b.innerHTML = '<b></b><span></span>';
      b.querySelector('b').textContent = c.abbr;
      b.querySelector('span').textContent = c.area;
      frag.appendChild(b);
    });
    ui.chips.replaceChildren(frag);
  }

  /** 残り時間を「あと8時間25分」のように */
  function leftText(ms) {
    var past = ms < 0;
    var a = Math.abs(ms);
    if (a < 60 * 1000) return past ? 'ちょうど今' : 'まもなく';
    var totalMin = Math.floor(a / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    var s;
    // 「あと何時間か」が知りたいので、2日（48時間）までは時間で数える
    if (h >= 48) s = Math.floor(h / 24) + '日' + (h % 24) + '時間';
    else if (h > 0) s = h + '時間' + m + '分';
    else s = m + '分' + pad2(Math.floor((a % 60000) / 1000)) + '秒';
    return past ? s + '前に過ぎました' : 'あと ' + s;
  }

  function renderConv(now) {
    var c = cityById(state.city);
    var t = targetTime();
    var local = partsOf(t, c.tz);
    var localNow = partsOf(now, c.tz);
    var home = partsOf(t, HOME);
    var homeNow = partsOf(now, HOME);

    // 入力（現地）
    var ld = dayDiff(local, localNow);
    ui.date.textContent = md(local) + (Math.abs(ld) <= 2 ? '　現地の' + relDay(ld, 'home') : '');
    ui.hour.textContent = pad2(local.h);
    ui.minute.textContent = pad2(local.mi);
    ui.ampm.textContent = jpClock(local.h, local.mi);

    // 結果（日本時間）
    var hd = dayDiff(home, homeNow);
    ui.result.innerHTML = '';
    var dd = document.createElement('span');
    dd.className = 'wc-rdate';
    dd.textContent = md(home) + (Math.abs(hd) <= 2 ? '　' + relDay(hd, 'home') : '');
    var tt = document.createElement('span');
    tt.className = 'wc-rtime';
    tt.textContent = hm(home);
    ui.result.appendChild(dd);
    ui.result.appendChild(tt);

    ui.left.textContent = leftText(t - now);
    ui.left.classList.toggle('is-past', t < now);
    ui.left.classList.toggle('is-soon', t >= now && t - now < 3600 * 1000);

    // 選んだ地域の説明
    var diff = offsetMin(t, c.tz) - offsetMin(t, HOME);
    var summer = c.tz !== 'UTC' && isSummer(t, c.tz);
    ui.zone.textContent = c.abbr + '（' + c.name + '）は日本より' +
      (diff === 0 ? '時差なし' : (diff < 0 ? diffText(-diff).slice(1) + '遅い' : diffText(diff).slice(1) + '進んでいる')) +
      (summer ? '（いまは夏時間）' : '');

    var chips = ui.chips.querySelectorAll('.wc-chip');
    for (var i = 0; i < chips.length; i++) {
      var on = chips[i].getAttribute('data-id') === state.city;
      chips[i].classList.toggle('is-on', on);
      chips[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  function render() {
    var now = Date.now();
    renderCards(now);
    renderConv(now);
  }

  // ---------- 操作 ----------
  /** 現地の年月日を n 日ずらす */
  function shiftDay(n) {
    var d = new Date(Date.UTC(state.y, state.mo - 1, state.d + n));
    state.y = d.getUTCFullYear();
    state.mo = d.getUTCMonth() + 1;
    state.d = d.getUTCDate();
  }

  function act(kind) {
    if (kind === 'h+') state.h = (state.h + 1) % 24;
    else if (kind === 'h-') state.h = (state.h + 23) % 24;
    else if (kind === 'm+') state.mi = (Math.floor(state.mi / MIN_STEP) * MIN_STEP + MIN_STEP) % 60;
    else if (kind === 'm-') state.mi = (Math.ceil(state.mi / MIN_STEP) * MIN_STEP - MIN_STEP + 60) % 60;
    save();
    render();
  }

  // 押し続けると連続で動く（時刻を大きく変えるとき、何度も押さなくて済むように）
  var holdTimer = null, holdKind = null;
  function stopHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
    holdKind = null;
  }
  ui.spins.addEventListener('pointerdown', function (e) {
    var b = e.target.closest ? e.target.closest('[data-a]') : null;
    if (!b) return;
    e.preventDefault();
    holdKind = b.getAttribute('data-a');
    act(holdKind);
    holdTimer = setTimeout(function repeat() {
      if (!holdKind) return;
      act(holdKind);
      holdTimer = setTimeout(repeat, HOLD_EVERY);
    }, HOLD_DELAY);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    ui.spins.addEventListener(t, stopHold);
  });
  // キーボード（Enter・スペース）で押されたとき
  ui.spins.addEventListener('click', function (e) {
    if (e.detail !== 0) return;   // 指やマウスは pointerdown で済んでいる
    var b = e.target.closest ? e.target.closest('[data-a]') : null;
    if (b) act(b.getAttribute('data-a'));
  });

  ui.prev.addEventListener('click', function () { shiftDay(-1); save(); render(); });
  ui.next.addEventListener('click', function () { shiftDay(1); save(); render(); });

  /** その地域で、いまから次に来る h時mi分 の日付に合わせる */
  function toNextOccurrence() {
    var tz = cityById(state.city).tz;
    var now = Date.now();
    var p = partsOf(now, tz);
    state.y = p.y; state.mo = p.mo; state.d = p.d;
    if (targetTime() <= now) shiftDay(1);
  }

  ui.chips.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.wc-chip') : null;
    if (!b) return;
    // 入力した時刻（壁の時計）はそのままで、どこの「10:00」かだけを変える。
    // 日付は、その地域で次に来るその時刻に合わせる（発表の時刻を調べる使い方が多いため）
    state.city = b.getAttribute('data-id');
    toNextOccurrence();
    save();
    render();
  });

  // ---------- 表示中だけ毎秒更新 ----------
  document.addEventListener('slidechange', function (e) {
    var mine = Array.prototype.indexOf.call(document.querySelectorAll('.slide'), ui.slide);
    visible = !!(e.detail && e.detail.index === mine);
    if (visible) render();
    else stopHold();
  });
  if (EC.onSecond) EC.onSecond(function () { if (visible && !document.hidden) render(); });

  buildCards();
  buildChips();
  render();
})();
