/* ============================================================
   Echo Clock & Weather - アラーム / ストップウォッチ / タイマー

   - アラーム：最大4件。時刻を指定して、毎日または1回だけ鳴らす
   - ストップウォッチ：スタート／ラップ／リセット
   - タイマー：残り時間をリング表示。0になったら鳴る

   状態は localStorage に保存するので、再読み込みしても続きます。
   音は Web Audio API でその場で作るため、音声ファイルは不要です。
   ============================================================ */
'use strict';

(function () {
  var EC = window.EC || {};
  var pad2 = EC.pad2 || function (n) { return n < 10 ? '0' + n : String(n); };

  var $ = function (id) { return document.getElementById(id); };

  var KEY_ALARMS = 'echo-clock-alarms';
  var KEY_LABELS = 'echo-clock-labels';   // 前に使った「やること」の履歴
  var KEY_SW = 'echo-clock-stopwatch';
  var KEY_TM = 'echo-clock-timer';
  var MAX_ALARMS = 4;
  var MAX_MEMO_LINES = 4;          // 鳴動画面に出す行数の上限
  var DEFAULT_LABELS = ['起きる', '薬を飲む', 'ストレッチ', '水を飲む', '出発の準備'];
  var RING_LIMIT = 15 * 1000;      // 15秒鳴らして自動で止める
  var SNOOZE_MS = 5 * 60 * 1000;   // スヌーズは5分後

  // ---------- 保存・読み込み ----------
  function load(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || 'null');
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できなくても動く */ }
  }

  // ---------- 音（Web Audio でその場で作る） ----------
  var audioCtx = null;
  var beepTimer = null;

  function ensureAudio() {
    try {
      if (!audioCtx) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }

  /** 短いビープを1回鳴らす */
  function beep(freq, duration, gainPeak) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.015);
    gain.gain.setValueAtTime(gainPeak, t0 + duration - 0.04);
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** ピピッ、ピピッ を繰り返す */
  function startBeeping() {
    stopBeeping();
    function pattern() {
      beep(880, 0.16, 0.28);
      setTimeout(function () { beep(1170, 0.16, 0.28); }, 200);
    }
    pattern();
    beepTimer = setInterval(pattern, 1200);
  }
  function stopBeeping() {
    if (beepTimer) { clearInterval(beepTimer); beepTimer = null; }
  }

  /** ボタンを押したときの小さな確認音 */
  function tickSound() { beep(660, 0.05, 0.08); }

  // 最初のタップで音の準備をする（自動再生の制限を回避するため）
  document.addEventListener('pointerdown', function once() {
    ensureAudio();
    document.removeEventListener('pointerdown', once);
  }, { once: true });

  // ---------- 画面を消させない ----------
  // 実際の処理は app.js にまとめてある（表示中はいつでも点灯を保つ）。
  var requestWakeLock = EC.keepScreenOn || function () {};

  /* ============================================================
     鳴動中の画面
     ============================================================ */
  var ringing = {
    el: $('ringing'),
    box: document.querySelector('.ring-box'),
    title: $('ringTitle'),
    time: $('ringTime'),
    memo: $('ringMemo'),
    snoozeBtn: $('ringSnooze'),
    stopBtn: $('ringStop'),
    kind: null,          // 'alarm' か 'timer'
    autoStop: 0
  };

  /** 改行区切りの文章を、行の配列にする（空行は捨てる） */
  function memoLines(text) {
    if (!text) return [];
    return String(text).split(/\r?\n/)
      .map(function (v) { return v.trim(); })
      .filter(function (v) { return v.length > 0; })
      .slice(0, MAX_MEMO_LINES);
  }

  function renderRingMemo(text) {
    var lines = memoLines(text);
    if (!lines.length) {
      ringing.memo.hidden = true;
      ringing.memo.replaceChildren();
      ringing.box.classList.remove('has-memo');
      return;
    }
    var frag = document.createDocumentFragment();
    lines.forEach(function (line) {
      var li = document.createElement('li');
      li.textContent = line;
      frag.appendChild(li);
    });
    ringing.memo.replaceChildren(frag);
    // 1行だけのときは中央寄せの大きな文字にする
    if (lines.length === 1) ringing.memo.classList.add('single');
    else ringing.memo.classList.remove('single');
    ringing.memo.hidden = false;
    ringing.box.classList.add('has-memo');
  }

  function startRinging(kind, titleText, timeText, allowSnooze, memoText) {
    ringing.kind = kind;
    ringing.title.textContent = titleText;
    ringing.time.textContent = timeText;
    ringing.snoozeBtn.hidden = !allowSnooze;
    renderRingMemo(memoText);
    ringing.el.hidden = false;
    startBeeping();
    requestWakeLock();
    clearTimeout(ringing.autoStop);
    ringing.autoStop = setTimeout(stopRinging, RING_LIMIT);
  }

  function stopRinging() {
    clearTimeout(ringing.autoStop);
    stopBeeping();
    ringing.el.hidden = true;
    ringing.kind = null;
  }

  ringing.stopBtn.addEventListener('click', stopRinging);
  ringing.snoozeBtn.addEventListener('click', function () {
    // snoozeMemo は鳴らしたときに入れてあるので、そのまま持ち越す
    snoozeAt = Date.now() + SNOOZE_MS;
    stopRinging();
    EC.toast && EC.toast('5分後にもう一度鳴らします');
  });

  var snoozeAt = 0;
  var snoozeMemo = '';

  /* ============================================================
     時刻ピッカー（アラームとタイマーで共用）
     ============================================================ */
  var picker = {
    el: $('picker'),
    dialog: document.querySelector('.picker-dialog'),
    title: $('pickerTitle'),
    a: $('pkA'), b: $('pkB'),
    aCap: $('pkACap'), bCap: $('pkBCap'),
    dailyRow: $('pkDailyRow'), daily: $('pkDaily'),
    memoRow: $('pkMemoRow'), memo: $('pkMemo'), chips: $('pkChips'),
    del: $('pkDelete'), cancel: $('pkCancel'), ok: $('pkOk'),
    valA: 0, valB: 0, maxA: 23, maxB: 59,
    onOk: null, onDelete: null
  };

  function openPicker(opts) {
    picker.title.textContent = opts.title;
    picker.aCap.textContent = opts.capA;
    picker.bCap.textContent = opts.capB;
    picker.maxA = opts.maxA;
    picker.maxB = opts.maxB;
    picker.valA = opts.a;
    picker.valB = opts.b;
    picker.onOk = opts.onOk;
    picker.onDelete = opts.onDelete || null;
    picker.del.hidden = !opts.onDelete;
    picker.dailyRow.hidden = !opts.showDaily;
    picker.daily.checked = opts.daily !== false;
    picker.memoRow.hidden = !opts.showMemo;
    picker.memo.value = opts.memo || '';
    // 「やること」欄があるときだけ、ダイアログを横長の2列にする
    if (opts.showMemo) {
      picker.dialog.classList.add('with-memo');
      renderChips();
    } else {
      picker.dialog.classList.remove('with-memo');
    }
    drawPicker();
    picker.el.hidden = false;
  }

  /** 過去に使った「やること」をタップで入れられるようにする */
  function recentLabels() {
    var saved = load(KEY_LABELS, []);
    var list = [];
    saved.concat(DEFAULT_LABELS).forEach(function (v) {
      if (v && list.indexOf(v) === -1) list.push(v);
    });
    return list.slice(0, 6);
  }

  function rememberLabel(text) {
    memoLines(text).forEach(function (line) {
      var saved = load(KEY_LABELS, []).filter(function (v) { return v !== line; });
      saved.unshift(line);
      save(KEY_LABELS, saved.slice(0, 10));
    });
  }

  function renderChips() {
    var frag = document.createDocumentFragment();
    recentLabels().forEach(function (text) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = text;
      b.addEventListener('click', function () {
        var cur = picker.memo.value.replace(/\s+$/, '');
        picker.memo.value = cur ? (cur + '\n' + text) : text;
        tickSound();
      });
      frag.appendChild(b);
    });
    picker.chips.replaceChildren(frag);
  }

  function closePicker() { picker.el.hidden = true; }

  function drawPicker() {
    picker.a.textContent = pad2(picker.valA);
    picker.b.textContent = pad2(picker.valB);
  }

  picker.el.addEventListener('click', function (e) {
    if (e.target === picker.el) closePicker();
    var btn = e.target.closest ? e.target.closest('.spin-btn') : null;
    if (!btn) return;
    var unit = btn.getAttribute('data-unit');
    var dir = btn.getAttribute('data-act') === 'up' ? 1 : -1;
    if (unit === 'a') {
      picker.valA = (picker.valA + dir + picker.maxA + 1) % (picker.maxA + 1);
    } else {
      picker.valB = (picker.valB + dir + picker.maxB + 1) % (picker.maxB + 1);
    }
    tickSound();
    drawPicker();
  });

  picker.cancel.addEventListener('click', closePicker);
  picker.ok.addEventListener('click', function () {
    var fn = picker.onOk;
    var memo = picker.memo.value.trim();
    closePicker();
    if (fn) fn(picker.valA, picker.valB, picker.daily.checked, memo);
  });
  picker.del.addEventListener('click', function () {
    var fn = picker.onDelete;
    closePicker();
    if (fn) fn();
  });

  /* ============================================================
     アラーム
     ============================================================ */
  var alarms = load(KEY_ALARMS, []);
  // 前のバージョンで作ったアラームには label がないので補う
  alarms.forEach(function (al) { if (typeof al.label !== 'string') al.label = ''; });
  var alarmCards = $('alarmCards');
  var firedKey = '';   // 同じ分に二重で鳴らさないための目印

  function anyAlarmOn() {
    for (var i = 0; i < alarms.length; i++) if (alarms[i].on) return true;
    return false;
  }

  function saveAlarms() { save(KEY_ALARMS, alarms); }

  // 隠し時計にも、保存済みアラームとスヌーズのうち最も近い時刻を渡す。
  EC.getNextAlarm = function (now) {
    now = now || new Date();
    var next = snoozeAt > now.getTime() ? { time: new Date(snoozeAt), snoozed: true } : null;
    alarms.forEach(function (al) {
      if (!al.on) return;
      var time = new Date(now.getFullYear(), now.getMonth(), now.getDate(), al.h, al.m, 0, 0);
      if (time.getTime() <= now.getTime()) time.setDate(time.getDate() + 1);
      if (!next || time.getTime() < next.time.getTime()) next = { time: time, snoozed: false };
    });
    return next;
  };

  /** 次に鳴る日時までの説明文 */
  function nextText(al) {
    if (!al.on) return 'オフ';
    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), al.h, al.m, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    var diffMin = Math.round((next.getTime() - now.getTime()) / 60000);
    var hh = Math.floor(diffMin / 60), mm = diffMin % 60;
    var when = hh > 0 ? (hh + '時間' + (mm > 0 ? mm + '分' : '')) : (mm + '分');
    return 'あと' + when + (al.daily ? '' : '・1回');
  }

  function renderAlarms() {
    var frag = document.createDocumentFragment();

    alarms.forEach(function (al, idx) {
      var li = document.createElement('li');
      li.className = 'acard' + (al.on ? ' on' : '');

      var time = document.createElement('button');
      time.type = 'button';
      time.className = 'acard-time';
      time.textContent = pad2(al.h) + ':' + pad2(al.m);
      time.addEventListener('click', function () { editAlarm(idx); });
      li.appendChild(time);

      if (al.label) {
        var memo = document.createElement('div');
        memo.className = 'acard-memo';
        memo.textContent = memoLines(al.label).join('・');
        li.appendChild(memo);
      }

      var sub = document.createElement('div');
      sub.className = 'acard-sub';
      sub.textContent = nextText(al);
      li.appendChild(sub);

      var sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'sw' + (al.on ? ' on' : '');
      sw.setAttribute('aria-label', al.on ? 'アラームをオフにする' : 'アラームをオンにする');
      sw.addEventListener('click', function () {
        al.on = !al.on;
        if (al.on) { tickSound(); requestWakeLock(); }
        saveAlarms();
        renderAlarms();
      });
      li.appendChild(sw);

      frag.appendChild(li);
    });

    if (alarms.length < MAX_ALARMS) {
      var add = document.createElement('li');
      add.className = 'acard add';
      add.setAttribute('role', 'button');
      add.setAttribute('tabindex', '0');
      add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-plus"/></svg>';
      var label = document.createElement('div');
      label.textContent = 'アラームを追加';
      add.appendChild(label);
      add.addEventListener('click', addAlarm);
      frag.appendChild(add);
    }

    alarmCards.replaceChildren(frag);
  }

  function addAlarm() {
    var now = new Date();
    openPicker({
      title: 'アラームを追加',
      capA: '時', capB: '分',
      maxA: 23, maxB: 59,
      a: (now.getHours() + 1) % 24, b: 0,
      showDaily: true, daily: true,
      showMemo: true, memo: '',
      onOk: function (h, m, daily, memo) {
        alarms.push({ h: h, m: m, on: true, daily: daily, label: memo });
        rememberLabel(memo);
        saveAlarms();
        renderAlarms();
        requestWakeLock();
        EC.toast && EC.toast(pad2(h) + ':' + pad2(m) + ' にアラームを設定しました');
      }
    });
  }

  function editAlarm(idx) {
    var al = alarms[idx];
    if (!al) return;
    openPicker({
      title: 'アラームの変更',
      capA: '時', capB: '分',
      maxA: 23, maxB: 59,
      a: al.h, b: al.m,
      showDaily: true, daily: al.daily,
      showMemo: true, memo: al.label || '',
      onOk: function (h, m, daily, memo) {
        al.h = h; al.m = m; al.daily = daily; al.on = true; al.label = memo;
        rememberLabel(memo);
        saveAlarms();
        renderAlarms();
      },
      onDelete: function () {
        alarms.splice(idx, 1);
        saveAlarms();
        renderAlarms();
      }
    });
  }

  /** 1秒ごとに、鳴らす時刻になっていないか調べる */
  function checkAlarms(now) {
    // スヌーズ
    if (snoozeAt && Date.now() >= snoozeAt) {
      snoozeAt = 0;
      startRinging('alarm', 'アラーム',
        pad2(now.getHours()) + ':' + pad2(now.getMinutes()), true, snoozeMemo);
      return;
    }

    var key = now.getHours() + ':' + now.getMinutes();
    if (key === firedKey) return;

    for (var i = 0; i < alarms.length; i++) {
      var al = alarms[i];
      if (!al.on) continue;
      if (al.h === now.getHours() && al.m === now.getMinutes() && now.getSeconds() === 0) {
        firedKey = key;
        if (!al.daily) { al.on = false; saveAlarms(); }
        renderAlarms();
        snoozeMemo = al.label || '';
        startRinging('alarm', 'アラーム', pad2(al.h) + ':' + pad2(al.m), true, al.label);
        return;
      }
    }
  }

  /* ============================================================
     ストップウォッチ
     ============================================================ */
  var sw = load(KEY_SW, { running: false, startedAt: 0, base: 0, laps: [] });
  var swTime = $('swTime'), swLaps = $('swLaps');
  var swStart = $('swStart'), swLap = $('swLap'), swReset = $('swReset');
  var swRaf = 0;

  function swElapsed() {
    return sw.base + (sw.running ? Date.now() - sw.startedAt : 0);
  }

  /** 経過時間を 0:00.00 の形にする */
  function fmtSw(ms) {
    var cs = Math.floor(ms / 10) % 100;
    var total = Math.floor(ms / 1000);
    var s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
    var head = h > 0 ? (h + ':' + pad2(m) + ':' + pad2(s)) : (m + ':' + pad2(s));
    return { head: head, cs: pad2(cs) };
  }

  function drawSw() {
    var f = fmtSw(swElapsed());
    swTime.textContent = f.head;
    var span = document.createElement('span');
    span.className = 'cs';
    span.textContent = '.' + f.cs;
    swTime.appendChild(span);
  }

  function swLoop() {
    drawSw();
    swRaf = requestAnimationFrame(swLoop);
  }
  function swStartLoop() { if (!swRaf) swLoop(); }
  function swStopLoop() { if (swRaf) { cancelAnimationFrame(swRaf); swRaf = 0; } }

  function saveSw() { save(KEY_SW, sw); }

  function drawSwButtons() {
    swStart.textContent = sw.running ? 'ストップ' : (sw.base > 0 ? '再開' : 'スタート');
    swStart.className = 'rbtn ' + (sw.running ? 'stop' : 'go');
    swLap.disabled = !sw.running;
    swReset.disabled = sw.running || (sw.base === 0 && sw.laps.length === 0);
  }

  function drawLaps() {
    if (!sw.laps.length) {
      var empty = document.createElement('li');
      empty.className = 'laps-empty';
      empty.textContent = 'ラップはまだありません';
      swLaps.replaceChildren(empty);
      return;
    }
    var best = Math.min.apply(null, sw.laps.map(function (l) { return l.lap; }));
    var worst = Math.max.apply(null, sw.laps.map(function (l) { return l.lap; }));

    var frag = document.createDocumentFragment();
    for (var i = sw.laps.length - 1; i >= 0; i--) {
      var l = sw.laps[i];
      var li = document.createElement('li');
      if (sw.laps.length > 1 && l.lap === best) li.className = 'best';
      else if (sw.laps.length > 1 && l.lap === worst) li.className = 'worst';

      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = 'L' + (i + 1);
      li.appendChild(n);

      var lapF = fmtSw(l.lap);
      var lap = document.createElement('span');
      lap.className = 'lap';
      lap.textContent = lapF.head + '.' + lapF.cs;
      li.appendChild(lap);

      var totF = fmtSw(l.total);
      var tot = document.createElement('span');
      tot.className = 'tot';
      tot.textContent = totF.head + '.' + totF.cs;
      li.appendChild(tot);

      frag.appendChild(li);
    }
    swLaps.replaceChildren(frag);
  }

  swStart.addEventListener('click', function () {
    if (sw.running) {
      sw.base = swElapsed();
      sw.running = false;
      swStopLoop();
      drawSw();
    } else {
      sw.startedAt = Date.now();
      sw.running = true;
      swStartLoop();
    }
    tickSound();
    saveSw();
    drawSwButtons();
  });

  swLap.addEventListener('click', function () {
    if (!sw.running) return;
    var total = swElapsed();
    var prev = sw.laps.length ? sw.laps[sw.laps.length - 1].total : 0;
    sw.laps.push({ total: total, lap: total - prev });
    tickSound();
    saveSw();
    drawLaps();
  });

  swReset.addEventListener('click', function () {
    sw = { running: false, startedAt: 0, base: 0, laps: [] };
    swStopLoop();
    saveSw();
    drawSw();
    drawSwButtons();
    drawLaps();
  });

  /* ============================================================
     カウントダウンタイマー
     ============================================================ */
  var timer = load(KEY_TM, { running: false, endAt: 0, remain: 300000, duration: 300000 });
  var tmTime = $('tmTime'), tmSub = $('tmSub'), tmRing = $('tmRing');
  var tmStart = $('tmStart'), tmReset = $('tmReset'), tmEdit = $('tmEdit');
  var RING_LEN = 2 * Math.PI * 53;   // リングの円周

  function tmRemain() {
    return timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remain;
  }

  function fmtTm(ms) {
    var total = Math.ceil(ms / 1000);
    var s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
    return h > 0 ? (h + ':' + pad2(m) + ':' + pad2(s)) : (pad2(m) + ':' + pad2(s));
  }

  function drawTm() {
    var remain = tmRemain();
    tmTime.textContent = fmtTm(remain);
    var ratio = timer.duration > 0 ? remain / timer.duration : 0;
    tmRing.style.strokeDasharray = RING_LEN.toFixed(1);
    tmRing.style.strokeDashoffset = (RING_LEN * (1 - ratio)).toFixed(1);
    if (remain <= 10000 && timer.running) tmRing.classList.add('warn');
    else tmRing.classList.remove('warn');

    if (timer.running) tmSub.textContent = '残り時間';
    else if (remain !== timer.duration) tmSub.textContent = '一時停止中';
    else tmSub.textContent = 'タップして時間を変更';

    tmStart.textContent = timer.running ? '一時停止' : (remain === timer.duration ? '開始' : '再開');
    tmStart.className = 'rbtn ' + (timer.running ? 'stop' : 'go');
    tmStart.disabled = remain <= 0;
    tmReset.disabled = timer.running === false && remain === timer.duration;

    // 押されている長さのボタンを目立たせる
    var btns = $('tmPresets').children;
    for (var i = 0; i < btns.length; i++) {
      var sec = parseInt(btns[i].getAttribute('data-sec'), 10) * 1000;
      if (sec === timer.duration) btns[i].classList.add('is-on');
      else btns[i].classList.remove('is-on');
    }
  }

  function saveTm() { save(KEY_TM, timer); }

  function setDuration(ms) {
    timer.running = false;
    timer.duration = ms;
    timer.remain = ms;
    timer.endAt = 0;
    saveTm();
    drawTm();
  }

  $('tmPresets').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.pbtn') : null;
    if (!b) return;
    setDuration(parseInt(b.getAttribute('data-sec'), 10) * 1000);
    tickSound();
  });

  tmEdit.addEventListener('click', function () {
    if (timer.running) return;
    var total = Math.round(timer.duration / 1000);
    openPicker({
      title: 'タイマーの長さ',
      capA: '分', capB: '秒',
      maxA: 99, maxB: 59,
      a: Math.floor(total / 60), b: total % 60,
      showDaily: false, showMemo: false,
      onOk: function (m, s) {
        var ms = (m * 60 + s) * 1000;
        if (ms <= 0) return;
        setDuration(ms);
      }
    });
  });

  tmStart.addEventListener('click', function () {
    if (timer.running) {
      timer.remain = tmRemain();
      timer.running = false;
    } else {
      var remain = tmRemain();
      if (remain <= 0) return;
      timer.endAt = Date.now() + remain;
      timer.running = true;
      requestWakeLock();
    }
    tickSound();
    saveTm();
    drawTm();
  });

  tmReset.addEventListener('click', function () {
    timer.running = false;
    timer.remain = timer.duration;
    timer.endAt = 0;
    saveTm();
    drawTm();
  });

  function checkTimer() {
    if (!timer.running) return;
    if (Date.now() >= timer.endAt) {
      timer.running = false;
      timer.remain = timer.duration;
      timer.endAt = 0;
      saveTm();
      drawTm();
      startRinging('timer', 'タイマー', fmtTm(timer.duration), false, '');
    } else {
      drawTm();
    }
  }

  /* ============================================================
     タブの切り替え
     ============================================================ */
  var tabs = $('tabs');
  tabs.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.tab') : null;
    if (!b) return;
    var name = b.getAttribute('data-tool');
    var all = tabs.querySelectorAll('.tab');
    for (var i = 0; i < all.length; i++) {
      if (all[i] === b) all[i].classList.add('is-on');
      else all[i].classList.remove('is-on');
    }
    ['alarm', 'stopwatch', 'timer'].forEach(function (n) {
      var panel = $('panel-' + n);
      if (n === name) panel.classList.add('is-on');
      else panel.classList.remove('is-on');
    });
    if (name === 'stopwatch' && sw.running) swStartLoop();
    else if (name !== 'stopwatch') swStopLoop();
  });

  /* ============================================================
     起動
     ============================================================ */
  renderAlarms();
  drawSw();
  drawSwButtons();
  drawLaps();

  // 再読み込み前に動いていたタイマーの残り時間を計算し直す
  if (timer.running && timer.endAt <= Date.now()) {
    timer.running = false;
    timer.remain = timer.duration;
    timer.endAt = 0;
    saveTm();
  }
  drawTm();
  if (sw.running) swStartLoop();
  if (timer.running || anyAlarmOn()) requestWakeLock();

  // 1秒ごとの見直し（app.js の時計に相乗り）
  if (EC.onSecond) {
    EC.onSecond(function (now) {
      checkAlarms(now);
      checkTimer();
      // 「あと○分」の表示は1分ごとに更新すれば十分
      if (now.getSeconds() === 0) renderAlarms();
    });
  }
})();
