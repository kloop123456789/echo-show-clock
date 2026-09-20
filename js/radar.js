/* ============================================================
   雨雲レーダー（5枚目）

   気象庁の「高解像度降水ナウキャスト」の地図タイルを、
   国土地理院の白地図の上に重ねて、1時間前から1時間先までを動かして見せる。

     雨雲  https://www.jma.go.jp/bosai/jmatile/data/nowc/
             targetTimes_N1.json … 実況の時刻一覧（5分ごと）
             targetTimes_N2.json … 予測の時刻一覧（5分ごと・1時間先まで）
             {基準時刻}/none/{対象時刻}/surf/hrpns/{z}/{x}/{y}.png
     地図  https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png
             白地図。暗い画面に合わせて色を反転して使う

   時刻の文字列（20260920170000）は世界時なので、表示のときに直す。

   地図は自前で組み立てる（外部の地図ライブラリは使わない）。
   決まった大きさの画面に、必要な枚数のタイルを並べるだけで足りるため。

   雨雲のタイルは偶数の拡大率（4・6・8・10）にしか中身がない。
   奇数のときは、ひとつ下の偶数のタイルを2倍に引き伸ばして重ねる。

   地図をタップすると、その場所が中心になる（指定した中心は覚えておく）。
   指で動かして地図をずらす方式にすると、画面を切り替えるスワイプができなくなるため。

   通信をむだにしないよう、この画面を表示している間だけ読み込む。
   ============================================================ */
(function () {
  'use strict';

  var EC = window.EC || {};
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    slide: document.querySelector('.slide-radar'),
    map: $('radarMap'), place: $('radarPlace'), kind: $('radarKind'), time: $('radarTime'),
    steps: $('radarSteps'), play: $('radarPlay'), msg: $('radarMsg'),
    zoomIn: $('radarIn'), zoomOut: $('radarOut'), legend: $('radarLegend'),
    reset: $('radarReset'), home: $('radarHome'), homeName: $('radarHomeName'), hint: $('radarHint')
  };
  if (!ui.slide || !ui.map) return;

  var TILE = 256;
  var BASE_TILE = 'https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png';
  var NOWC = 'https://www.jma.go.jp/bosai/jmatile/data/nowc/';

  var STEP_MIN = 10;            // 何分おきのコマにするか
  var PAST_MIN = 60;            // 何分前から
  var AHEAD_MIN = 60;           // 何分先まで
  var FRAME_MS = 480;           // 1コマの表示時間
  var HOLD_MS = 1600;           // 最後のコマで止まる時間
  var REFRESH = 5 * 60 * 1000;  // 取り直す間隔（表示中のみ）

  var ZOOM_KEY = 'echo-clock-radar-zoom';
  var CENTER_KEY = 'echo-clock-radar-center';
  var TAP_MOVE = 10;            // これより動いたらスワイプ（app.js の判定とそろえる）
  var TAP_TIME = 500;           // これより長く押したらタップではない
  var HINT_MS = 6000;
  var MIN_Z = 6, MAX_Z = 11, DEF_Z = 9;

  // 1時間に降る雨の量（mm）と色。気象庁の降水量の配色に合わせる
  var LEGEND = [
    ['1', '#a0d2ff'], ['5', '#218cff'], ['10', '#0041ff'], ['20', '#faf500'],
    ['30', '#ff9900'], ['50', '#ff2800'], ['80', '#b40068']
  ];

  var zoom = (function () {
    try {
      var v = parseInt(localStorage.getItem(ZOOM_KEY), 10);
      return (v >= MIN_Z && v <= MAX_Z) ? v : DEF_Z;
    } catch (e) { return DEF_Z; }
  })();

  var frames = [];        // [{ time: Date, future: bool, layer: element }]
  var index = 0;
  var playing = true;
  var timer = null;
  var loadedAt = 0;
  var building = false;
  var visible = false;
  var center = null;          // いま地図の中心にしている場所 { lat, lon }
  var customCenter = (function () {
    try {
      var c = JSON.parse(localStorage.getItem(CENTER_KEY) || 'null');
      return (c && isFinite(c.lat) && isFinite(c.lon)) ? c : null;
    } catch (e) { return null; }
  })();
  var hintShown = false;

  // ---------- 座標の計算（ウェブメルカトル） ----------
  function lonToX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  function latToY(lat, z) {
    var r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
  }

  function xToLon(X, z) { return X / (TILE * Math.pow(2, z)) * 360 - 180; }
  function yToLat(Y, z) {
    var n = Math.PI - 2 * Math.PI * Y / (TILE * Math.pow(2, z));
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /** 「20260920170000」（世界時）→ Date */
  function parseStamp(s) {
    s = String(s);
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
      +s.slice(8, 10), +s.slice(10, 12), 0));
  }

  function hm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  function setMsg(text) {
    ui.msg.textContent = text || '';
    ui.msg.hidden = !text;
    ui.map.classList.toggle('is-blank', !!text && !frames.length);
  }

  // ---------- タイルを並べる ----------
  /** 雨雲のタイルがある拡大率（偶数だけ）。奇数のときはひとつ下を使う */
  function radarZoom() {
    var z = zoom % 2 === 0 ? zoom : zoom - 1;
    return Math.max(4, Math.min(10, z));
  }

  /**
   * その拡大率のタイルを、いまの表示範囲に並べるための一覧を作る。
   * 表示の拡大率より小さいタイルを使うときは、そのぶん引き伸ばす。
   */
  function tileGrid(tileZoom) {
    var w = ui.map.clientWidth, h = ui.map.clientHeight;
    if (!w || !h) return null;

    var size = TILE * Math.pow(2, zoom - tileZoom);   // 画面上での1枚の大きさ
    var cx = lonToX(center.lon, tileZoom) * size;
    var cy = latToY(center.lat, tileZoom) * size;
    var left = cx - w / 2, top = cy - h / 2;
    var max = Math.pow(2, tileZoom);

    var list = [];
    for (var ty = Math.floor(top / size); ty <= Math.floor((top + h - 1) / size); ty++) {
      for (var tx = Math.floor(left / size); tx <= Math.floor((left + w - 1) / size); tx++) {
        if (ty < 0 || ty >= max) continue;
        list.push({
          x: ((tx % max) + max) % max, y: ty,
          left: Math.round(tx * size - left), top: Math.round(ty * size - top)
        });
      }
    }
    return { list: list, size: size };
  }

  function tileImg(url, t, size) {
    var img = document.createElement('img');
    img.className = 'rt';
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;   // 画像をつかんで動かす既定の動作は、スワイプの邪魔になる
    img.style.left = t.left + 'px';
    img.style.top = t.top + 'px';
    img.style.width = size + 'px';
    img.style.height = size + 'px';
    img.src = url;
    return img;
  }

  function buildBase(grid, cls) {
    var layer = document.createElement('div');
    layer.className = cls;
    grid.list.forEach(function (t) {
      layer.appendChild(tileImg(
        BASE_TILE.replace('{z}', zoom).replace('{x}', t.x).replace('{y}', t.y), t, grid.size));
    });
    return layer;
  }

  function buildFrame(grid, basetime, validtime, rz) {
    var layer = document.createElement('div');
    layer.className = 'radar-frame';
    grid.list.forEach(function (t) {
      layer.appendChild(tileImg(
        NOWC + basetime + '/none/' + validtime + '/surf/hrpns/' + rz + '/' + t.x + '/' + t.y + '.png',
        t, grid.size));
    });
    return layer;
  }

  // ---------- コマの時刻を決める ----------
  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function pickTimes(now) {
    return Promise.all([
      getJSON(NOWC + 'targetTimes_N1.json'),
      getJSON(NOWC + 'targetTimes_N2.json').catch(function () { return []; })
    ]).then(function (res) {
      var out = [];
      var seen = {};

      function add(entry, future) {
        var t = parseStamp(entry.validtime);
        var diff = (t - now) / 60000;
        if (diff < -PAST_MIN - 1 || diff > AHEAD_MIN + 1) return;
        if (t.getMinutes() % STEP_MIN !== 0) return;      // 10分ごとに間引く
        if (seen[entry.validtime]) return;
        seen[entry.validtime] = true;
        out.push({ time: t, future: future, basetime: entry.basetime, validtime: entry.validtime });
      }

      (res[0] || []).forEach(function (e) { add(e, false); });
      (res[1] || []).forEach(function (e) { add(e, true); });

      out.sort(function (a, b) { return a.time - b.time; });
      return out;
    });
  }

  // ---------- 組み立て ----------
  function build() {
    if (building) return;
    var place = EC.getPlace && EC.getPlace();
    if (!place) return;
    center = customCenter || place;

    // 中心をずらしているときは、題名の地名を出さずに「戻す」ボタンを出す
    ui.place.textContent = customCenter ? '' : (place.name || '');
    ui.reset.textContent = '◎ ' + (place.name || '地点') + 'に戻す';
    ui.reset.hidden = !customCenter;

    if (!window.JMA || !JMA.inJapanBox(center.lat, center.lon)) {
      frames = [];
      ui.map.replaceChildren();
      ui.steps.replaceChildren();
      stop();
      setMsg('雨雲レーダーは日本の地点のみです（気象庁のナウキャスト）');
      return;
    }

    var baseGrid = tileGrid(zoom);
    var rz = radarZoom();
    var radarGrid = tileGrid(rz);
    if (!baseGrid || !radarGrid) return;

    building = true;
    setMsg(frames.length ? '' : '雨雲を読み込んでいます…');

    pickTimes(new Date()).then(function (times) {
      if (!times.length) throw new Error('時刻の一覧が空です');

      var layers = document.createDocumentFragment();
      layers.appendChild(buildBase(baseGrid, 'radar-base'));

      frames = times.map(function (t) {
        var layer = buildFrame(radarGrid, t.basetime, t.validtime, rz);
        layers.appendChild(layer);
        return { time: t.time, future: t.future, layer: layer };
      });

      // 海岸線や県境は、雨雲の上にも薄く重ねる（弱い雨の色で地図が埋もれないように）
      layers.appendChild(buildBase(baseGrid, 'radar-lines'));

      ui.map.replaceChildren(layers);
      buildSteps();
      updateHome(place);

      // 「いま」（未来でない最後のコマ）から始める
      index = 0;
      frames.forEach(function (f, i) { if (!f.future) index = i; });
      show(index);

      loadedAt = Date.now();
      building = false;
      setMsg('');
      if (visible && playing) start();
      if (visible) showHint();
    }).catch(function (err) {
      building = false;
      console.warn('[radar]', err);
      setMsg('雨雲を取得できませんでした（表示し直すと再試行します）');
    });
  }

  /** 中心をずらしているとき、設定している地点の位置に印を出す */
  function updateHome(place) {
    if (!customCenter || !place) { ui.home.hidden = true; return; }
    var w = ui.map.clientWidth, h = ui.map.clientHeight;
    var dx = (lonToX(place.lon, zoom) - lonToX(center.lon, zoom)) * TILE + w / 2;
    var dy = (latToY(place.lat, zoom) - latToY(center.lat, zoom)) * TILE + h / 2;
    if (dx < 0 || dy < 0 || dx > w || dy > h) { ui.home.hidden = true; return; }
    ui.home.style.left = Math.round(dx) + 'px';
    ui.home.style.top = Math.round(dy) + 'px';
    ui.homeName.textContent = place.name || '';
    ui.home.hidden = false;
  }

  function buildSteps() {
    var frag = document.createDocumentFragment();
    frames.forEach(function (f, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rstep' + (f.future ? ' future' : '');
      b.setAttribute('data-i', String(i));
      b.setAttribute('aria-label', hm(f.time) + ' の雨雲');
      var label = document.createElement('span');
      label.className = 'rl';
      // 目盛りは30分ごとに時刻を出す（全部出すと読みにくいため）
      label.textContent = (f.time.getMinutes() % 30 === 0) ? hm(f.time) : '';
      b.appendChild(label);
      li.appendChild(b);
      frag.appendChild(li);
    });
    ui.steps.replaceChildren(frag);
  }

  function show(i) {
    if (!frames.length) return;
    index = (i + frames.length) % frames.length;
    frames.forEach(function (f, n) { f.layer.classList.toggle('is-on', n === index); });

    var f = frames[index];
    ui.time.textContent = hm(f.time);
    ui.kind.textContent = f.future ? '予測' : '実況';
    ui.kind.classList.toggle('is-future', f.future);

    var btns = ui.steps.querySelectorAll('.rstep');
    for (var n = 0; n < btns.length; n++) {
      btns[n].classList.toggle('is-on', n === index);
      btns[n].classList.toggle('is-past', n < index);
    }
  }

  // ---------- 再生 ----------
  function tick() {
    show(index + 1);
    // 最後のコマ（1時間先）では少し長く止めて、見やすくする
    var last = index === frames.length - 1;
    timer = setTimeout(tick, last ? HOLD_MS : FRAME_MS);
  }

  function start() {
    stop();
    if (!frames.length) return;
    timer = setTimeout(tick, FRAME_MS);
    ui.play.classList.add('is-playing');
    ui.play.setAttribute('aria-label', '停止');
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
    ui.play.classList.remove('is-playing');
    ui.play.setAttribute('aria-label', '再生');
  }

  function setPlaying(on) {
    playing = on;
    if (on && visible) start(); else stop();
  }

  // ---------- 中心の指定 ----------
  function saveCenter() {
    try {
      if (customCenter) localStorage.setItem(CENTER_KEY, JSON.stringify(customCenter));
      else localStorage.removeItem(CENTER_KEY);
    } catch (e) { /* 保存できなくても、そのときは動く */ }
  }

  function rebuild() {
    frames = [];
    loadedAt = 0;
    stop();
    build();
  }

  /** 押された画面の点を中心にする */
  function centerAt(clientX, clientY) {
    if (!center || !frames.length) return;
    var r = ui.map.getBoundingClientRect();
    var X = lonToX(center.lon, zoom) * TILE - r.width / 2 + (clientX - r.left);
    var Y = latToY(center.lat, zoom) * TILE - r.height / 2 + (clientY - r.top);
    customCenter = { lat: yToLat(Y, zoom), lon: xToLon(X, zoom) };
    saveCenter();
    rebuild();
  }

  function resetCenter() {
    customCenter = null;
    saveCenter();
    rebuild();
  }

  // タップ（ほとんど動かさずに離す）だけを拾う。
  // 動かしたときは app.js のスワイプに任せる
  var tap = null;
  function inMap(node) { return !!(node && node.closest && node.closest('#radarMap')); }

  if (window.PointerEvent) {
    document.addEventListener('pointerdown', function (e) {
      if (!visible || e.isPrimary === false || (e.button != null && e.button !== 0) || !inMap(e.target)) {
        tap = null;
        return;
      }
      tap = { x: e.clientX, y: e.clientY, id: e.pointerId, at: Date.now() };
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (tap && (Math.abs(e.clientX - tap.x) > TAP_MOVE || Math.abs(e.clientY - tap.y) > TAP_MOVE)) tap = null;
    }, true);
    document.addEventListener('pointerup', function (e) {
      if (!tap || tap.id !== e.pointerId) return;
      var t = tap;
      tap = null;
      if (Date.now() - t.at > TAP_TIME) return;
      if (Math.abs(e.clientX - t.x) > TAP_MOVE || Math.abs(e.clientY - t.y) > TAP_MOVE) return;
      centerAt(e.clientX, e.clientY);
    }, true);
    document.addEventListener('pointercancel', function () { tap = null; }, true);
  } else {
    ui.map.addEventListener('click', function (e) { if (visible) centerAt(e.clientX, e.clientY); });
  }

  ui.reset.addEventListener('click', resetCenter);

  function showHint() {
    if (hintShown || !frames.length) return;
    hintShown = true;
    ui.hint.hidden = false;
    setTimeout(function () { ui.hint.hidden = true; }, HINT_MS);
  }

  // ---------- 画面が表示されたとき ----------
  function onVisible() {
    visible = true;
    if (!frames.length || Date.now() - loadedAt > REFRESH) build();
    else if (playing) start();
    showHint();
  }

  function onHidden() {
    visible = false;
    stop();
  }

  // 開いたままでも新しい雨雲に入れ替わるよう、時々見に行く（表示中だけ）
  setInterval(function () {
    if (visible && !building && !document.hidden && Date.now() - loadedAt > REFRESH) build();
  }, 60 * 1000);

  document.addEventListener('slidechange', function (e) {
    var i = e.detail && e.detail.index;
    var slides = document.querySelectorAll('.slide');
    var mine = Array.prototype.indexOf.call(slides, ui.slide);
    if (i === mine) onVisible(); else onHidden();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (visible) onVisible();
  });

  document.addEventListener('placechange', function () {
    // 地点を変えたら、ずらしていた中心は元に戻す
    customCenter = null;
    saveCenter();
    frames = [];
    loadedAt = 0;
    if (visible) build();
  });

  // ---------- 操作 ----------
  ui.play.addEventListener('click', function () { setPlaying(!timer); });

  ui.steps.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.rstep') : null;
    if (!b) return;
    setPlaying(false);
    show(parseInt(b.getAttribute('data-i'), 10));
  });

  function setZoom(z) {
    z = Math.max(MIN_Z, Math.min(MAX_Z, z));
    if (z === zoom) return;
    zoom = z;
    try { localStorage.setItem(ZOOM_KEY, String(z)); } catch (e) { /* 保存できなくても動く */ }
    ui.zoomIn.disabled = zoom >= MAX_Z;
    ui.zoomOut.disabled = zoom <= MIN_Z;
    rebuild();
  }
  ui.zoomIn.addEventListener('click', function () { setZoom(zoom + 1); });
  ui.zoomOut.addEventListener('click', function () { setZoom(zoom - 1); });
  ui.zoomIn.disabled = zoom >= MAX_Z;
  ui.zoomOut.disabled = zoom <= MIN_Z;

  // ---------- 凡例 ----------
  (function () {
    var frag = document.createDocumentFragment();
    LEGEND.forEach(function (c) {
      var li = document.createElement('li');
      var sw = document.createElement('i');
      sw.style.background = c[1];
      li.appendChild(sw);
      li.appendChild(document.createTextNode(c[0]));
      frag.appendChild(li);
    });
    var unit = document.createElement('li');
    unit.className = 'unit';
    unit.textContent = 'mm/h';
    frag.appendChild(unit);
    ui.legend.replaceChildren(frag);
  })();

  // 起動時にこの画面が出ている場合に備えて
  if (EC.getSlide && EC.getSlide() === Array.prototype.indexOf.call(document.querySelectorAll('.slide'), ui.slide)) {
    onVisible();
  }
})();
