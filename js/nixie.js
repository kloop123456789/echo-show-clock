/* ニキシー管時計。数字を5回タップ、またはキーボードで nixie と入力。 */
'use strict';

(function () {
  var EC = window.EC;
  var $ = function (id) { return document.getElementById(id); };
  var screen = $('nixieScreen');
  var clock = $('nixieClock');
  var KEY = 'echo-clock-nixie';
  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  var built = false, previousSlide = 0, previousFocus = null;
  var digitNodes = [], lastTime = '', lastDate = '', lastWeather = '', lastAlarm = '';

  // フォントに依存せず、曲がった一本の電極として数字を描く。
  var digits = [
    'M100 179C61 179 49 215 49 284S61 390 100 390S151 353 151 284S139 179 100 179Z',
    'M69 216L108 181V389M74 389H141',
    'M50 222C54 167 141 163 149 220C158 279 50 300 49 387H152',
    'M51 184H149L92 269C172 257 170 387 99 390C71 391 52 376 46 354',
    'M137 390V181L43 332H162',
    'M148 184H57L51 275C64 256 146 251 151 314C158 393 66 412 46 356',
    'M140 184C82 171 48 240 48 322C48 414 152 411 152 331C152 255 56 257 49 319',
    'M47 184H154L74 390',
    'M100 275C32 252 41 179 100 179C161 179 166 248 100 275C22 303 37 390 100 390C165 390 178 303 100 275Z',
    'M151 252C143 309 48 310 48 236C48 159 152 161 152 247C152 330 119 394 61 387'
  ];

  function buildClock() {
    if (built) return;
    built = true;
    var svg = [
      '<svg viewBox="0 0 1385 510" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">',
      '<defs>',
      '<linearGradient id="nx-glass" x1="0" x2="1"><stop stop-color="#b8c8cb" stop-opacity=".24"/><stop offset=".08" stop-color="#536268" stop-opacity=".17"/><stop offset=".25" stop-color="#24272a" stop-opacity=".05"/><stop offset=".72" stop-color="#27201a" stop-opacity=".08"/><stop offset=".93" stop-color="#9b9f93" stop-opacity=".2"/><stop offset="1" stop-color="#273338" stop-opacity=".5"/></linearGradient>',
      '<linearGradient id="nx-edge" x1="0" y1="0" x2="1" y2=".6"><stop stop-color="#c4d4da" stop-opacity=".6"/><stop offset=".23" stop-color="#6d6957" stop-opacity=".3"/><stop offset=".48" stop-color="#151616"/><stop offset=".79" stop-color="#b9b09a" stop-opacity=".3"/><stop offset="1" stop-color="#363f3d"/></linearGradient>',
      '<linearGradient id="nx-metal"><stop stop-color="#111312"/><stop offset=".12" stop-color="#797566"/><stop offset=".17" stop-color="#30332e"/><stop offset=".49" stop-color="#151817"/><stop offset=".78" stop-color="#524638"/><stop offset=".84" stop-color="#80735b"/><stop offset="1" stop-color="#101313"/></linearGradient>',
      '<linearGradient id="nx-base"><stop stop-color="#060809"/><stop offset=".15" stop-color="#1b2020"/><stop offset=".28" stop-color="#111414"/><stop offset=".8" stop-color="#080a09"/><stop offset="1" stop-color="#191b18"/></linearGradient>',
      '<linearGradient id="nx-shine" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#dcebf0" stop-opacity=".55"/><stop offset=".25" stop-color="#bcd2d5" stop-opacity=".13"/><stop offset=".8" stop-color="#bad3d2" stop-opacity=".015"/><stop offset="1" stop-color="#d5e0d4" stop-opacity=".14"/></linearGradient>',
      '<radialGradient id="nx-warm"><stop stop-color="#e85b14" stop-opacity=".14"/><stop offset="1" stop-color="#c4460a" stop-opacity="0"/></radialGradient>',
      '<radialGradient id="nx-lamp"><stop stop-color="#fff1c4"/><stop offset=".4" stop-color="#ffc177"/><stop offset=".68" stop-color="#ff601f"/><stop offset="1" stop-color="#602613"/></radialGradient>',
      '<pattern id="nx-mesh" width="14" height="24" patternUnits="userSpaceOnUse"><path d="m7 0 6 4v8l-6 4-6-4V4ZM7 16v8M1 12l-1 1M13 12l1 1" fill="none" stroke="#9c8c70" stroke-width=".7" opacity=".42"/></pattern>',
      '<pattern id="nx-grain" width="29" height="37" patternUnits="userSpaceOnUse"><path d="m4 5 1 1m8 19 2-1m9-16v2m-3 22 1-1M2 29h1" stroke="#aeb4a5" stroke-opacity=".13" stroke-width="1"/></pattern>',
      '<filter id="nx-glow" x="-50%" y="-40%" width="200%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>',
      '<filter id="nx-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1"/></filter>',
      '<g id="nx-housing">',
      '<ellipse cx="100" cy="492" rx="105" ry="12" fill="#000" opacity=".65"/>',
      '<path d="M12 445Q100 430 188 445V484Q100 505 12 484Z" fill="url(#nx-base)" stroke="#252825" stroke-width="1.2"/>',
      '<path d="M14 451Q100 466 187 451M14 478Q100 494 187 478" fill="none" stroke="#393b32" stroke-opacity=".4"/>',
      '<path d="M12 445Q100 430 188 445V484Q100 505 12 484Z" fill="url(#nx-grain)"/>',
      '<path d="M17 439V117C17 76 44 62 73 52Q91 47 91 28V21C91 8 109 8 109 21V28Q109 47 127 52C157 62 183 76 183 117V439Q183 457 100 459Q17 457 17 439Z" fill="#111411" stroke="url(#nx-edge)" stroke-width="3"/>',
      '<path d="M41 121Q100 109 159 121V424H41Z" fill="#161711"/>',
      '<path d="M39 127V432M162 127V432M57 132V420M146 132V420" stroke="url(#nx-metal)" stroke-width="4"/>',
      '<path d="M52 415v23m17-23v28m21-28v28m21-28v28m21-28v28m18-28v23" stroke="#574b38" stroke-width="2"/>',
      '<rect x="34" y="118" width="132" height="6" rx="2" fill="url(#nx-metal)"/>',
      '<rect x="34" y="418" width="132" height="6" rx="2" fill="url(#nx-metal)"/>',
      '<ellipse cx="100" cy="442" rx="82" ry="10" fill="url(#nx-metal)"/>',
      '<ellipse cx="100" cy="439" rx="76" ry="7" fill="#141711"/>',
      '<path d="M25 445Q100 461 176 445" fill="none" stroke="#a48e6c" stroke-opacity=".46" stroke-width="2"/>',
      '<ellipse cx="100" cy="290" rx="79" ry="156" fill="url(#nx-warm)"/>',
      '</g>',
      '<g id="nx-front">',
      '<rect x="39" y="138" width="122" height="276" rx="11" fill="url(#nx-mesh)"/>',
      '<path d="M36 131V418M165 131V418" stroke="#7d725b" stroke-opacity=".6" stroke-width="2"/>',
      '<g fill="url(#nx-metal)" stroke="#6c6756" stroke-width=".8"><ellipse cx="36" cy="137" rx="4" ry="7"/><ellipse cx="165" cy="137" rx="4" ry="7"/><ellipse cx="36" cy="407" rx="4" ry="7"/><ellipse cx="165" cy="407" rx="4" ry="7"/><rect x="94" y="111" width="12" height="28" rx="5"/></g>',
      '<path d="M17 439V117C17 76 44 62 73 52Q91 47 91 28V21C91 8 109 8 109 21V28Q109 47 127 52C157 62 183 76 183 117V439Q183 457 100 459Q17 457 17 439Z" fill="url(#nx-glass)"/>',
      '<path d="M26 408V116Q26 91 45 80L40 119V414Z" fill="url(#nx-shine)"/>',
      '<path d="M48 75Q88 53 130 70L144 83Q95 68 48 90Z" fill="#b3c4c8" opacity=".11"/>',
      '<path d="M172 132V420" stroke="url(#nx-shine)" stroke-width="3"/>',
      '<path d="M23 416V123Q22 81 68 63M177 122Q180 88 145 69" fill="none" stroke="#d4ded6" stroke-opacity=".17" stroke-width="1.5"/>',
      '<path d="M93 21Q95 12 103 16M93 33Q100 36 107 32M86 49Q100 54 114 49" fill="none" stroke="#e4dac0" stroke-opacity=".5" stroke-width="2"/>',
      '<path d="M57 63Q102 74 148 62M33 101Q96 91 166 103" fill="none" stroke="#a29171" stroke-opacity=".3" stroke-width="1.2"/>',
      '<path d="M19 114V437Q20 452 100 454Q180 452 181 436V114" fill="url(#nx-grain)" opacity=".4"/>',
      '</g>',
      '<g id="nx-colon"><path d="M0 217v132" stroke="url(#nx-metal)" stroke-width="3"/>',
      '<g fill="#ff571b" filter="url(#nx-glow)"><circle cy="249" r="10"/><circle cy="315" r="10"/></g>',
      '<g fill="url(#nx-metal)" stroke="#60452b"><circle cy="249" r="12"/><circle cy="315" r="12"/></g>',
      '<g fill="url(#nx-lamp)"><circle cy="249" r="8"/><circle cy="315" r="8"/></g></g>'
    ];
    digits.forEach(function (d, i) { svg.push('<path id="nx-num-' + i + '" d="' + d + '"/>'); });
    svg.push('</defs>');
    [0, 215, 485, 700, 970, 1185].forEach(function (x, i) {
      svg.push('<g transform="translate(' + x + ' 0)"><use href="#nx-housing"/>');
      svg.push('<g fill="none" stroke="#8c6a45" stroke-width=".8" opacity=".14">');
      digits.forEach(function (_, n) {
        svg.push('<use href="#nx-num-' + n + '" transform="translate(' + ((n % 3) - 1) * 2 + ' ' + (n % 4) + ')"/>');
      });
      svg.push('</g><g class="nixie-digit" data-digit="' + i + '">');
      ['halo', 'hot', 'core'].forEach(function (layer) {
        svg.push('<use class="nixie-' + layer + '" href="#nx-num-0"/>');
      });
      svg.push('</g><use href="#nx-front"/></g>');
    });
    svg.push('<use href="#nx-colon" x="450"/><use href="#nx-colon" x="935"/></svg>');
    clock.innerHTML = svg.join('');
    digitNodes = clock.querySelectorAll('[data-digit]');
  }

  function setText(id, value) {
    if ($(id).textContent !== value) $(id).textContent = value;
  }

  function update(now) {
    if (screen.hidden || document.hidden) return;
    var time = EC.pad2(now.getHours()) + EC.pad2(now.getMinutes()) + EC.pad2(now.getSeconds());
    if (time !== lastTime) {
      for (var i = 0; i < 6; i++) {
        if (time[i] === lastTime[i]) continue;
        var layers = digitNodes[i].children;
        for (var j = 0; j < layers.length; j++) layers[j].setAttribute('href', '#nx-num-' + time[i]);
      }
      clock.setAttribute('aria-label', now.getHours() + '時' + now.getMinutes() + '分' + now.getSeconds() + '秒');
      lastTime = time;
    }
    var date = now.getFullYear() + '年 ' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + WEEK[now.getDay()] + '曜日';
    if (date !== lastDate) { setText('nixieDate', date); lastDate = date; }
    var weather = EC.getWeather();
    var weatherKey = JSON.stringify(weather);
    if (weatherKey !== lastWeather) {
      setText('nixiePlace', weather.name);
      setText('nixieTemp', (weather.temperature == null ? '--' : weather.temperature) + '°C');
      $('nixieWeatherIcon').querySelector('use').setAttribute('href', '#' + weather.icon);
      $('nixieWeather').setAttribute('aria-label', weather.name + '、' + weather.description + '、場所の設定を開く');
      $('nixieWeather').title = weather.description + ' · 場所を変更';
      lastWeather = weatherKey;
    }
    var next = EC.getNextAlarm ? EC.getNextAlarm(now) : null;
    var alarmText = next ? EC.pad2(next.time.getHours()) + ':' + EC.pad2(next.time.getMinutes()) : '未設定';
    var alarmLabel = next ? (next.snoozed ? 'スヌーズ ' : '次のアラーム ') + alarmText : 'アラーム未設定';
    if (lastAlarm !== alarmLabel) {
      setText('nixieAlarmTime', alarmText);
      $('nixieAlarm').title = alarmLabel;
      $('nixieAlarm').setAttribute('aria-label', alarmLabel + '、アラームを設定');
      lastAlarm = alarmLabel;
    }
  }

  function saveMode(on) {
    try {
      if (on) localStorage.setItem(KEY, 'on');
      else localStorage.removeItem(KEY);
    } catch (e) { /* 保存できないブラウザでも切り替え可能 */ }
  }

  function setMode(on) {
    if (on === !screen.hidden) return;
    resetCommand();
    if (on) {
      buildClock();
      previousSlide = EC.getSlide();
      previousFocus = document.activeElement;
      EC.goTo(0, false); // アナログ時計の連続描画を止める。
      $('track').hidden = true;
      $('dots').hidden = true;
      screen.hidden = false;
      document.body.classList.add('nixie-mode');
      update(new Date());
      screen.focus();
    } else {
      screen.hidden = true;
      document.body.classList.remove('nixie-mode');
      $('track').hidden = false;
      $('dots').hidden = false;
      EC.goTo(previousSlide, false);
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }
    saveMode(on);
  }

  function overlayOpen() { return !!document.querySelector('.overlay:not([hidden])'); }
  function editable(node) {
    return node && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName));
  }

  var command = '', keyAt = 0, taps = 0, tapAt = 0, gesture = null;
  function resetCommand() { command = ''; taps = 0; keyAt = 0; tapAt = 0; gesture = null; }

  document.addEventListener('keydown', function (e) {
    // 設定ダイアログの Escape と隠し画面の Escape を同時に処理しない。
    if (overlayOpen() || editable(e.target) || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) {
      resetCommand();
      return;
    }
    if (e.repeat) return;
    if (e.key === 'Escape' && !screen.hidden) {
      e.preventDefault();
      setMode(false);
      return;
    }
    var now = Date.now();
    if (now - keyAt > 1500) command = '';
    keyAt = now;
    var key = (e.key || '').toLowerCase();
    command = (command + (key.length === 1 ? key : ' ')).slice(-5);
    if (command === 'nixie') { e.preventDefault(); setMode(screen.hidden); }
  }, true);

  // pointer capture を使う既存スワイプと両立させ、移動・長押しはタップに数えない。
  function begin(target, x, y, id) {
    if (overlayOpen() || !target.closest) { resetCommand(); return; }
    var hit = target.closest('.clock, .a-time, #nixieClock');
    if (!hit) { resetCommand(); return; }
    gesture = { x: x, y: y, id: id, at: Date.now() };
  }
  function move(x, y) {
    if (gesture && (Math.abs(x - gesture.x) > 12 || Math.abs(y - gesture.y) > 12)) resetCommand();
  }
  function end(x, y, id) {
    if (!gesture || gesture.id !== id) return;
    move(x, y);
    if (!gesture) return;
    var now = Date.now(), duration = now - gesture.at;
    gesture = null;
    if (duration > 450 || overlayOpen()) { resetCommand(); return; }
    taps = now - tapAt < 650 ? taps + 1 : 1;
    tapAt = now;
    if (taps >= 5) setMode(screen.hidden);
  }
  if (window.PointerEvent) {
    document.addEventListener('pointerdown', function (e) {
      if (e.isPrimary === false || e.button !== 0) { resetCommand(); return; }
      begin(e.target, e.clientX, e.clientY, e.pointerId);
    }, true);
    document.addEventListener('pointermove', function (e) { move(e.clientX, e.clientY); }, true);
    document.addEventListener('pointerup', function (e) { end(e.clientX, e.clientY, e.pointerId); });
    document.addEventListener('pointercancel', resetCommand, true);
  } else {
    var lastTouchAt = -Infinity;
    document.addEventListener('touchstart', function (e) {
      lastTouchAt = Date.now();
      if (e.touches.length !== 1) { resetCommand(); return; }
      var t = e.touches[0];
      begin(e.target, t.clientX, t.clientY, t.identifier);
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true, capture: true });
    document.addEventListener('touchend', function (e) {
      lastTouchAt = Date.now();
      var t = e.changedTouches[0];
      if (t) end(t.clientX, t.clientY, t.identifier);
    });
    document.addEventListener('touchcancel', resetCommand, true);
    document.addEventListener('mousedown', function (e) {
      // touchend の後に合成されるマウスイベントを二重に数えない。
      if (e.button === 0 && Date.now() - lastTouchAt > 800) begin(e.target, e.clientX, e.clientY, 'mouse');
    }, true);
    document.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); }, true);
    document.addEventListener('mouseup', function (e) { end(e.clientX, e.clientY, 'mouse'); });
  }
  window.addEventListener('blur', resetCommand);
  document.addEventListener('visibilitychange', resetCommand);
  $('nixieClose').addEventListener('click', function () { setMode(false); });
  $('nixieWeather').addEventListener('click', EC.openSettings);
  $('nixieAlarm').addEventListener('click', function () {
    setMode(false);
    EC.goTo(2, false);
    var alarmTab = document.querySelector('[data-tool="alarm"]');
    alarmTab.click();
    alarmTab.focus();
  });
  EC.onSecond(update);
  try { if (localStorage.getItem(KEY) === 'on') setMode(true); } catch (e) { /* 初期状態は通常時計 */ }
})();
