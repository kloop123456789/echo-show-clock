/* ============================================================
   防災ライブ（7枚目）

   映像は YouTube 本体で開く（配信者が埋め込みを許可していないため）。
   リンクは HTML に書いてあるので、ここで受け持つのは「戻ってきたとき」だけ。

   時計と同じタブで開くので、「戻る」で帰ると時計は読み込み直しになり、1枚目から始まる。
   配信が止まったときにすぐ開き直せるよう、開いたことを覚えておいて7枚目を出す。
   ============================================================ */
(function () {
  'use strict';

  var EC = window.EC || {};
  var KEY = 'echo-clock-live-return';

  var slide = document.querySelector('.slide-live');
  var link = document.querySelector('.lv-open');
  if (!slide || !link || !EC.goTo) return;

  /** 開いた印を読み、同時に消す（次に読み込み直したときまで残らないように） */
  function takeMark() {
    try {
      var on = sessionStorage.getItem(KEY);
      sessionStorage.removeItem(KEY);
      return !!on;
    } catch (e) { return false; }
  }

  function showIfReturned() {
    if (!takeMark()) return;
    EC.goTo(Array.prototype.indexOf.call(document.querySelectorAll('.slide'), slide), false);
  }

  link.addEventListener('click', function () {
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* 覚えられなければ1枚目に戻るだけ */ }
  });

  showIfReturned();
  // 読み込み直さず、前の状態のまま戻ったとき（印が残らないよう消すだけになる）
  window.addEventListener('pageshow', showIfReturned);
})();
