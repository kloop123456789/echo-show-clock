/* ============================================================
   あと何日（アラームの画面の4つ目の道具）

   「基本情報技術者試験まで あと115日」のように、決めた日までの日数を数える。
   いくつか登録でき、選んだものを大きく、残りを右に並べる。

   数えるのは「日付の差」。時刻は見ない（当日の朝でも夜でも「今日です」）。
   登録した日から当日までのうち、どれだけ過ぎたかを帯で見せる（準備の進み具合の目安）。

   保存先はブラウザ（localStorage）。
   ============================================================ */
(function () {
  'use strict';

  var EC = window.EC || {};
  var $ = function (id) { return document.getElementById(id); };

  var ui = {
    panel: $('panel-days'), main: $('daysMain'), list: $('daysList'),
    editor: $('daysEditor'), title: $('daysTitle'), name: $('ddName'), date: $('ddDate'),
    chips: $('ddChips'), preview: $('ddPreview'),
    ok: $('ddOk'), cancel: $('ddCancel'), del: $('ddDelete'),
    clockHm: $('dcHm'), clockS: $('dcS'), clockDate: $('dcDate')
  };
  if (!ui.panel || !ui.editor) return;

  var KEY = 'echo-clock-days';
  var MAX = 5;
  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  // 名前の入力を楽にする候補
  var SUGGEST = ['試験', '資格試験', '入試', '発表会', '締め切り', '旅行', '誕生日', '記念日'];

  var data = load();
  var editing = null;       // 編集中の id（新しく作るときは null）
  var lastDay = '';         // 日付が変わったら描き直すため

  // ---------- 日付の計算 ----------
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function toUtc(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }

  /** a から b まで何日か（日付の差） */
  function daysBetween(a, b) { return Math.round((toUtc(b) - toUtc(a)) / 864e5); }

  function dateLabel(s) {
    var t = toUtc(s);
    if (isNaN(t)) return '';
    var d = new Date(t);
    return d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日（' + WEEK[d.getUTCDay()] + '）';
  }

  function weeksText(n) {
    if (n < 14) return '';
    var w = Math.floor(n / 7), r = n % 7;
    return w + '週' + (r ? 'と' + r + '日' : 'ちょうど');
  }

  // ---------- 保存 ----------
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.items)) {
        d.items = d.items.filter(function (it) { return it && it.id && !isNaN(toUtc(it.date)); });
        return d;
      }
    } catch (e) { /* 壊れていたら初めから */ }
    return { items: [], selected: null };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 保存できなくても動く */ }
  }

  /** 近い順（過ぎたものは後ろ） */
  function sorted() {
    var today = todayStr();
    return data.items.slice().sort(function (a, b) {
      var da = daysBetween(today, a.date), db = daysBetween(today, b.date);
      if ((da < 0) !== (db < 0)) return da < 0 ? 1 : -1;
      return da < 0 ? db - da : da - db;
    });
  }

  function selectedItem() {
    var list = sorted();
    for (var i = 0; i < list.length; i++) if (list[i].id === data.selected) return list[i];
    return list[0] || null;
  }

  // ---------- 描画 ----------
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderMain(it) {
    var frag = document.createDocumentFragment();

    if (!it) {
      var empty = h('div', 'dm-empty');
      empty.appendChild(h('div', 'dm-empty-t', '試験や記念日までの日数を数えます'));
      empty.appendChild(h('div', 'dm-empty-s', '例：基本情報技術者試験まで あと115日'));
      var add = h('button', 'btn primary dm-add', '＋ 追加する');
      add.type = 'button';
      add.setAttribute('data-act', 'add');
      empty.appendChild(add);
      frag.appendChild(empty);
      ui.main.replaceChildren(frag);
      ui.main.classList.add('is-empty');
      return;
    }
    ui.main.classList.remove('is-empty');

    var today = todayStr();
    var n = daysBetween(today, it.date);

    var head = h('div', 'dm-head');
    head.appendChild(h('div', 'dm-name', it.name));
    var edit = h('button', 'dm-edit', '編集');
    edit.type = 'button';
    edit.setAttribute('data-act', 'edit');
    edit.setAttribute('data-id', it.id);
    head.appendChild(edit);
    frag.appendChild(head);

    var big = h('div', 'dm-big' + (n === 0 ? ' is-today' : n < 0 ? ' is-past' : ''));
    if (n > 0) {
      big.appendChild(h('span', 'dm-pre', 'あと'));
      big.appendChild(h('span', 'dm-num', String(n)));
      big.appendChild(h('span', 'dm-unit', '日'));
    } else if (n === 0) {
      big.appendChild(h('span', 'dm-num dm-word', '今日です'));
    } else {
      big.appendChild(h('span', 'dm-num dm-word', '終わりました'));
      big.appendChild(h('span', 'dm-unit', (-n) + '日前'));
    }
    frag.appendChild(big);

    var sub = h('div', 'dm-sub');
    sub.appendChild(h('span', '', dateLabel(it.date) + (n > 0 ? ' まで' : '')));
    var w = n > 0 ? weeksText(n) : '';
    if (w) sub.appendChild(h('span', 'dm-weeks', w));
    frag.appendChild(sub);

    // 登録した日から当日までの、過ぎた割合
    var total = daysBetween(it.created || today, it.date);
    var done = daysBetween(it.created || today, today);
    var pct = total > 0 ? Math.max(0, Math.min(100, Math.round(done / total * 100))) : 100;
    var bar = h('div', 'dm-bar');
    var fill = h('i');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    frag.appendChild(bar);
    frag.appendChild(h('div', 'dm-bar-t',
      n < 0 ? '' : '登録した日（' + dateLabel(it.created || today).replace(/^\d+年/, '') + '）から ' + pct + '% 経過'));

    ui.main.replaceChildren(frag);
  }

  function renderList(sel) {
    var frag = document.createDocumentFragment();
    var today = todayStr();

    sorted().forEach(function (it) {
      var n = daysBetween(today, it.date);
      var b = h('button', 'dl-item' + (sel && it.id === sel.id ? ' is-on' : '') + (n < 0 ? ' is-past' : ''));
      b.type = 'button';
      b.setAttribute('data-act', 'select');
      b.setAttribute('data-id', it.id);
      var left = h('span', 'dl-left');
      left.appendChild(h('span', 'dl-name', it.name));
      left.appendChild(h('span', 'dl-date', dateLabel(it.date).replace(/^\d+年/, '')));
      b.appendChild(left);
      b.appendChild(h('span', 'dl-days', n > 0 ? 'あと' + n + '日' : n === 0 ? '今日' : (-n) + '日前'));
      var li = h('li');
      li.appendChild(b);
      frag.appendChild(li);
    });

    if (data.items.length < MAX) {
      var add = h('button', 'dl-add', '＋ 追加');
      add.type = 'button';
      add.setAttribute('data-act', 'add');
      var li2 = h('li');
      li2.appendChild(add);
      frag.appendChild(li2);
    }
    ui.list.replaceChildren(frag);
    ui.list.hidden = !data.items.length;
    ui.panel.classList.toggle('has-list', !!data.items.length);
  }

  function render() {
    lastDay = todayStr();
    var sel = selectedItem();
    renderMain(sel);
    renderList(sel);
  }

  // ---------- 追加・編集 ----------
  function newId() { return 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

  function updatePreview() {
    var v = ui.date.value;
    if (!v) { ui.preview.textContent = '日付を選んでください'; return; }
    var n = daysBetween(todayStr(), v);
    ui.preview.textContent = dateLabel(v) + '　' +
      (n > 0 ? 'あと ' + n + ' 日' : n === 0 ? '今日です' : (-n) + ' 日前（過ぎた日です）');
  }

  function openEditor(id) {
    editing = id || null;
    var it = null;
    data.items.forEach(function (x) { if (x.id === id) it = x; });

    ui.title.textContent = it ? 'カウントダウンの編集' : 'カウントダウンの追加';
    ui.name.value = it ? it.name : '';
    if (it) {
      ui.date.value = it.date;
    } else {
      // 新しく作るときは、ひと月先を仮に入れておく
      var d = new Date();
      d.setMonth(d.getMonth() + 1);
      ui.date.value = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    ui.del.hidden = !it;
    updatePreview();
    ui.editor.hidden = false;
    // 新しく作るときだけ名前の欄に入る（編集のたびに画面の鍵盤が出ると邪魔なため）
    if (!it) setTimeout(function () { try { ui.name.focus(); } catch (e) { /* 無視 */ } }, 60);
  }

  function closeEditor() {
    ui.editor.hidden = true;
    editing = null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function commit() {
    var date = ui.date.value;
    if (isNaN(toUtc(date))) {
      ui.preview.textContent = '日付を選んでください';
      ui.preview.classList.add('is-err');
      return;
    }
    ui.preview.classList.remove('is-err');
    var name = (ui.name.value || '').trim() || 'その日';

    if (editing) {
      data.items.forEach(function (x) {
        if (x.id === editing) { x.name = name; x.date = date; }
      });
      data.selected = editing;
    } else {
      if (data.items.length >= MAX) { closeEditor(); return; }
      var it = { id: newId(), name: name, date: date, created: todayStr() };
      data.items.push(it);
      data.selected = it.id;
    }
    save();
    closeEditor();
    render();
  }

  function removeEditing() {
    if (!editing) return;
    data.items = data.items.filter(function (x) { return x.id !== editing; });
    if (data.selected === editing) data.selected = null;
    save();
    closeEditor();
    render();
  }

  // ---------- 操作 ----------
  ui.panel.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'add') openEditor(null);
    else if (act === 'edit') openEditor(b.getAttribute('data-id'));
    else if (act === 'select') {
      data.selected = b.getAttribute('data-id');
      save();
      render();
    }
  });

  ui.ok.addEventListener('click', commit);
  ui.cancel.addEventListener('click', closeEditor);
  ui.del.addEventListener('click', removeEditing);
  ui.date.addEventListener('input', updatePreview);
  ui.date.addEventListener('change', updatePreview);
  ui.name.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commit(); }
  });
  ui.editor.addEventListener('click', function (e) { if (e.target === ui.editor) closeEditor(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !ui.editor.hidden) closeEditor();
  });

  // 名前の候補
  (function () {
    var frag = document.createDocumentFragment();
    SUGGEST.forEach(function (w) {
      var c = h('button', 'chip', w);
      c.type = 'button';
      c.addEventListener('click', function () {
        ui.name.value = w;
        ui.name.focus();
      });
      frag.appendChild(c);
    });
    ui.chips.replaceChildren(frag);
  })();

  // ---------- 時計 ----------
  function renderClock(now) {
    if (!ui.clockHm) return;
    ui.clockHm.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    ui.clockS.textContent = pad2(now.getSeconds());
    ui.clockDate.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日（' + WEEK[now.getDay()] + '）';
  }

  // 毎秒：時計を進め、日付が変わったら描き直す（つけっぱなしの画面で、夜中の0時に1日減るように）
  if (EC.onSecond) {
    EC.onSecond(function (now) {
      renderClock(now || new Date());
      if (todayStr() !== lastDay) render();
    });
  }
  renderClock(new Date());
  document.addEventListener('toolchange', function (e) {
    if (e.detail && e.detail.tool === 'days') render();
  });

  render();
})();
