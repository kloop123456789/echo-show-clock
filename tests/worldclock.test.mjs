// 世界時計の時刻の換算（js/worldclock.js の「時刻の計算」の部分）を検証する。
// 夏時間の切り替えの前後で、日本時間への換算が正しいかを確かめる。
// 実行: node tests/worldclock.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'js/worldclock.js'), 'utf8');

// 本物のコードから、計算の部分だけを取り出して使う
const start = src.indexOf('// ---------- 時刻の計算 ----------');
const end = src.indexOf('// ---------- 左：世界時計 ----------');
assert.ok(start > 0 && end > start, '計算の部分が見つからない');
const calc = new Function(
  "var WEEK = ['日','月','火','水','木','金','土'];" +
  'var WD_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };' +
  src.slice(start, end) +
  'return { partsOf: partsOf, offsetMin: offsetMin, zonedToUtc: zonedToUtc, isSummer: isSummer, dayDiff: dayDiff, diffText: diffText, jpClock: jpClock };'
)();

const TZ = {
  PT: 'America/Los_Angeles', ET: 'America/New_York', UTC: 'UTC',
  UK: 'Europe/London', CET: 'Europe/Paris', CN: 'Asia/Shanghai', JP: 'Asia/Tokyo'
};

/** 現地の壁の時計 → 日本時間の「YYYY-MM-DD HH:MM」 */
function toJst(tz, y, mo, d, h, mi) {
  const t = calc.zonedToUtc(y, mo, d, h, mi, tz);
  const p = calc.partsOf(t, TZ.JP);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  OK  ' + name); }
  catch (e) { failures++; console.log('  NG  ' + name + '\n      ' + e.message); }
}

console.log('現地の時刻 → 日本時間');

test('PT 10:00（夏時間・9月）→ 日本の翌日 2:00', () => {
  assert.equal(toJst(TZ.PT, 2026, 9, 22, 10, 0), '2026-09-23 02:00');
});
test('PT 10:00（標準時・11月、夏時間が終わった後）→ 日本の翌日 3:00', () => {
  assert.equal(toJst(TZ.PT, 2026, 11, 2, 10, 0), '2026-11-03 03:00');
});
test('PT 夏時間の終わり（2026-11-01）をまたいでも1時間ずれる', () => {
  assert.equal(toJst(TZ.PT, 2026, 10, 31, 10, 0), '2026-11-01 02:00');
  assert.equal(toJst(TZ.PT, 2026, 11, 1, 10, 0), '2026-11-02 03:00');
});
test('ET 13:00（夏時間）→ 日本の翌日 2:00', () => {
  assert.equal(toJst(TZ.ET, 2026, 9, 22, 13, 0), '2026-09-23 02:00');
});
test('UTC 17:00 → 日本の翌日 2:00', () => {
  assert.equal(toJst(TZ.UTC, 2026, 9, 22, 17, 0), '2026-09-23 02:00');
});
test('ロンドン 12:00（夏時間 BST）→ 日本 20:00', () => {
  assert.equal(toJst(TZ.UK, 2026, 9, 22, 12, 0), '2026-09-22 20:00');
});
test('ロンドン 12:00（冬時間 GMT）→ 日本 21:00', () => {
  assert.equal(toJst(TZ.UK, 2026, 12, 1, 12, 0), '2026-12-01 21:00');
});
test('パリ 9:00（夏時間）→ 日本 16:00', () => {
  assert.equal(toJst(TZ.CET, 2026, 9, 22, 9, 0), '2026-09-22 16:00');
});
test('北京 10:00 → 日本 11:00（夏時間なし）', () => {
  assert.equal(toJst(TZ.CN, 2026, 9, 22, 10, 0), '2026-09-22 11:00');
  assert.equal(toJst(TZ.CN, 2026, 1, 22, 10, 0), '2026-01-22 11:00');
});
test('夏時間が始まる瞬間（存在しない PT 2:30）でも止まらずに近い時刻を返す', () => {
  const r = toJst(TZ.PT, 2027, 3, 14, 2, 30);
  assert.match(r, /^2027-03-14 1[89]:30$/);
});

console.log('\n表示のための計算');

test('夏時間かどうか（PT：9月は夏、12月は冬／北京・日本は常に標準）', () => {
  assert.equal(calc.isSummer(Date.UTC(2026, 8, 22), TZ.PT), true);
  assert.equal(calc.isSummer(Date.UTC(2026, 11, 22), TZ.PT), false);
  assert.equal(calc.isSummer(Date.UTC(2026, 8, 22), TZ.CN), false);
  assert.equal(calc.isSummer(Date.UTC(2026, 8, 22), TZ.JP), false);
});
test('日本との時差（PT 夏時間は −16時間、ロンドン冬は −9時間）', () => {
  const t1 = Date.UTC(2026, 8, 22, 3);
  assert.equal(calc.diffText(calc.offsetMin(t1, TZ.PT) - calc.offsetMin(t1, TZ.JP)), '−16時間');
  const t2 = Date.UTC(2026, 11, 22, 3);
  assert.equal(calc.diffText(calc.offsetMin(t2, TZ.UK) - calc.offsetMin(t2, TZ.JP)), '−9時間');
  assert.equal(calc.diffText(0), '時差なし');
});
test('日本時間の朝10時は、PT ではまだ前日', () => {
  const t = Date.UTC(2026, 8, 22, 1);   // 日本 9/22 10:00
  const d = calc.dayDiff(calc.partsOf(t, TZ.PT), calc.partsOf(t, TZ.JP));
  assert.equal(d, -1);
});
test('午前・午後の書き方', () => {
  assert.equal(calc.jpClock(3, 0), '午前3時');
  assert.equal(calc.jpClock(15, 0), '午後3時');
  assert.equal(calc.jpClock(0, 0), '午前0時');
  assert.equal(calc.jpClock(12, 30), '午後0時30分');
});

console.log(failures ? '\n' + failures + ' 件失敗' : '\nすべて成功');
if (failures) process.exitCode = 1;
