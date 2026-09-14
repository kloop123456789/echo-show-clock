// 気象庁の実データを使って js/jma.js を検証する（ネットにつながっている必要がある）。
// 実行: node tests/jma-live.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JMA = require('../js/jma.js');

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('  OK  ' + name);
  } catch (err) {
    failures++;
    console.log('  NG  ' + name + '\n      ' + (err && err.message));
  }
}
const hm = (d) => d ? d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '--';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('天気コードと計算');

await test('118種類すべての天気コードに、アイコンと読みやすい名前が付く', () => {
  const icons = new Set(['i-sun', 'i-moon', 'i-cloud-sun', 'i-cloud-moon', 'i-cloud', 'i-fog', 'i-drizzle',
    'i-rain', 'i-heavy-rain', 'i-snow', 'i-sleet', 'i-thunder', 'i-sun-rain', 'i-sun-snow']);
  const codes = [100, 101, 102, 104, 110, 111, 130, 131, 200, 201, 202, 204, 206, 209, 231, 240, 300, 304, 306, 308, 311, 340, 350, 400, 403, 405, 407, 450];
  for (const c of codes) {
    const t = JMA.telop(c);
    assert.ok(t.label && t.label !== '---', 'コード ' + c + ' の名前がない');
    assert.ok(icons.has(t.look[0]) && icons.has(t.look[1]), 'コード ' + c + ' のアイコンが不明: ' + t.look);
  }
  assert.equal(JMA.telop(101).label, '晴れ時々くもり');
  assert.equal(JMA.telop(214).label, 'くもりのち雨');
  assert.equal(JMA.telop(100).look[0], 'i-sun');
  assert.equal(JMA.telop(102).look[0], 'i-sun-rain');
  assert.equal(JMA.telop(203).look[0], 'i-drizzle');
  assert.equal(JMA.telop(231).look[0], 'i-fog', '霧雨は霧として扱う');
  assert.equal(JMA.telop(306).look[0], 'i-heavy-rain');
  assert.equal(JMA.telop(340).look[0], 'i-sleet');
  assert.equal(JMA.telop(450).look[0], 'i-thunder');
});

await test('日の出・日の入りの計算が、Open-Meteo の値と2分以内で合う（東京 2026-09-14）', () => {
  const rise = JMA.sunEvent('2026-09-14', 35.6895, 139.6917, true);
  const set = JMA.sunEvent('2026-09-14', 35.6895, 139.6917, false);
  // Open-Meteo: 05:22 / 17:50（日本時間）
  const ref = (h, m) => Date.UTC(2026, 8, 14, h - 9, m);
  assert.ok(Math.abs(rise - ref(5, 22)) <= 2 * 60e3, '日の出 ' + hm(rise));
  assert.ok(Math.abs(set - ref(17, 50)) <= 2 * 60e3, '日の入 ' + hm(set));
});

await test('体感温度の計算（気温26.6℃・湿度76%・風4.4m/s）', () => {
  const v = JMA.feelsLike(26.6, 76, 4.4);
  assert.ok(v > 26 && v < 30, '体感 ' + v);
});

console.log('\n地点 → 予報区（気象庁・国土地理院の実データ）');

const places = [
  ['東京駅', 35.6812, 139.7671, '東京地方'],
  ['横浜市中区', 35.4437, 139.6380, '東部'],
  ['大阪市北区', 34.7055, 135.4983, '大阪府'],
  ['名古屋市中区', 35.1815, 136.9066, '西部'],
  ['札幌市中央区', 43.0621, 141.3544, '石狩地方'],
  ['仙台市青葉区', 38.2682, 140.8694, '東部'],
  ['福岡市博多区', 33.5902, 130.4207, '福岡地方'],
  ['那覇市', 26.2124, 127.6809, '本島中南部'],
  ['八丈島', 33.1100, 139.7890, '伊豆諸島南部']
];

const results = {};
for (const [name, lat, lon, expectArea] of places) {
  await test(name + ' → ' + expectArea, async () => {
    const ctx = await JMA.resolve(lat, lon);
    assert.ok(ctx, '日本なのに null');
    assert.equal(ctx.class10Name, expectArea);
    assert.ok(ctx.point, '気温の観測点がない');
    assert.ok(ctx.week, '週間予報の区域がない');
    assert.ok(ctx.station && ctx.station.km < 25, 'いまの観測所が遠すぎる ' + JSON.stringify(ctx.station));
    results[name] = ctx;
    console.log('      ' + ctx.officeName + ' / ' + ctx.class10Name + ' / 気温:' + ctx.pointName +
      ' / 実測:' + ctx.station.name + '(' + ctx.station.km + 'km)' + (ctx.humStation ? ' 湿度:' + ctx.humStation.name : ''));
  });
  await sleep(150);
}

await test('海外（ニューヨーク・ソウル）は気象庁の対象外として null', async () => {
  assert.equal(await JMA.resolve(40.7128, -74.0060), null);
  assert.equal(await JMA.resolve(37.5665, 126.9780), null);
});

console.log('\n予報をまとめて取得');

for (const [name, lat, lon] of [places[0], places[4], places[7]]) {
  await test(name + ' の予報が画面に必要な形でそろう', async () => {
    const now = new Date();
    const wx = await JMA.load({ lat, lon, name }, now);
    assert.ok(wx, 'null');
    assert.equal(wx.source, 'jma');
    // いま
    assert.ok(typeof wx.now.temp === 'number', 'いまの気温がない');
    assert.ok(wx.now.icon && wx.now.label, 'いまの天気がない');
    assert.ok(wx.now.observed, 'アメダスの実測が取れていない');
    // 3時間ごと
    assert.ok(wx.slots.length >= 8, '3時間ごとが ' + wx.slots.length + ' 件');
    assert.ok(wx.slots.every((s) => s.icon && typeof s.temp === 'number'), '3時間ごとに欠け');
    assert.ok(wx.slots.filter((s) => s.pop !== null).length >= 4, '降水確率が付いていない');
    // 日ごと
    assert.ok(wx.days.length >= 7, '日ごとが ' + wx.days.length + ' 件');
    assert.equal(wx.days[0].date, new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10), '先頭が今日でない');
    wx.days.slice(0, 3).forEach((d, i) => {
      assert.ok(d.code && d.label, i + '日目の天気がない');
      assert.ok(d.pop !== null, i + '日目の降水確率がない');
      assert.ok(d.sunrise && d.sunset, i + '日目の日の出入りがない');
    });
    wx.days.slice(1, 7).forEach((d, i) => {
      assert.ok(d.hi !== null && d.lo !== null, (i + 1) + '日目の気温がない');
    });
    assert.ok(wx.days.slice(2).some((d) => d.reliability), '週間予報の信頼度がない');
    assert.ok(wx.credit.short === '出典：気象庁' && wx.credit.lines[0].text.includes('加工して作成'));

    const d0 = wx.days[0];
    console.log('      いま ' + wx.now.temp + '° ' + wx.now.label + ' 湿度' + wx.now.humidity + '% 風' + wx.now.wind + 'm/s ' +
      wx.now.windDir + ' 降水確率' + wx.now.pop + '%');
    console.log('      今日 ' + d0.label + ' ' + d0.hi + (d0.hiObserved ? '(実測)' : '') + '/' + d0.lo +
      (d0.loObserved ? '(実測)' : '') + ' 日の出' + hm(d0.sunrise) + ' 日の入' + hm(d0.sunset));
    console.log('      3時間: ' + wx.slots.slice(0, 8).map((s) => s.key.slice(11, 13) + '時' + s.label + s.temp + '°' + (s.pop ?? '-') + '%').join(' '));
    console.log('      週間: ' + wx.days.map((d) => d.date.slice(8) + '日' + d.label + ' ' + d.hi + '/' + d.lo + ' ' + d.pop + '%' + (d.reliability ? d.reliability : '')).join(' | '));
    console.log('      ' + wx.credit.note);
  });
  await sleep(200);
}

console.log(failures ? '\n' + failures + ' 件失敗' : '\nすべて成功');
if (failures) process.exitCode = 1;
