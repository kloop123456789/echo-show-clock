// 実ブラウザで隠しコマンド・時刻・既存機能との連携を検証する。
// 実行: node tests/nixie.test.cjs（playwright が必要）
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '_archive', 'nixie-check');
const fixture = {
  current: { temperature_2m: 26, weather_code: 2, is_day: 1, relative_humidity_2m: 65, apparent_temperature: 27, wind_speed_10m: 2 },
  hourly: { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], is_day: [] },
  daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [] }
};
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const options = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch(options);
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 480 }, timezoneId: 'Asia/Tokyo', hasTouch: true, reducedMotion: 'reduce' });
    context.setDefaultTimeout(8000);
    await context.route('https://**/*', route => {
      const url = route.request().url();
      if (url.includes('api.open-meteo.com/v1/forecast')) return route.fulfill({ json: fixture });
      if (url.includes('geocoding-api.open-meteo.com')) return route.fulfill({ json: { results: [{ name: '大阪', latitude: 34.69, longitude: 135.50, country: '日本' }] } });
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-09T20:48:36+09:00'));
    await page.goto(url);
    const visible = () => page.locator('#nixieScreen').isVisible();
    const type = text => page.keyboard.type(text);
    const tick = () => page.waitForTimeout(1100);
    assert.equal(await visible(), false);
    assert.equal(await page.locator('.slide').count(), 4);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => EC.getSlide()), 1);
    await type('nixie');
    assert.equal(await visible(), true);
    assert.equal(await page.locator('#track').isVisible(), false);
    assert.equal(await page.locator('#nixieClock').getAttribute('aria-label'), '20時48分36秒');
    assert.deepEqual(await page.locator('.nixie-core').evaluateAll(nodes => nodes.map(n => n.getAttribute('href'))), ['2', '0', '4', '8', '3', '6'].map(n => '#nx-num-' + n));
    assert.equal(await page.locator('#nixieTemp').textContent(), '26°C');
    assert.equal(await page.locator('#nixieAlarmTime').textContent(), '未設定');
    assert.equal(await page.evaluate(() => localStorage.getItem('echo-clock-nixie')), 'on');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => EC.getSlide()), 0);
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'echo-960x480.png') });
    await page.keyboard.press('Escape');
    assert.equal(await visible(), false);
    assert.equal(await page.evaluate(() => EC.getSlide()), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('echo-clock-nixie')), null);
    await page.evaluate(() => EC.goTo(0, false));
    const tapClock = () => page.locator('.clock').tap();
    for (let i = 0; i < 4; i++) await tapClock();
    assert.equal(await visible(), false);
    await tapClock();
    assert.equal(await visible(), true);
    for (let i = 0; i < 5; i++) await page.locator('#nixieClock').tap();
    assert.equal(await visible(), false);
    // 間が空いたタップやドラッグは隠しコマンドに含めない。
    for (let i = 0; i < 4; i++) await tapClock();
    await page.clock.setFixedTime(new Date('2026-09-09T20:48:38+09:00'));
    await tapClock();
    assert.equal(await visible(), false);
    const box = await page.locator('.clock').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => EC.getSlide()), 1);
    assert.equal(await visible(), false);
    await page.evaluate(() => EC.goTo(0, false));
    await page.locator('#placeBtn').click();
    await page.locator('#searchInput').pressSequentially('nixie');
    assert.equal(await visible(), false);
    await page.keyboard.press('Escape');
    await type('nixxe');
    assert.equal(await visible(), false);
    await type('nixie');
    assert.equal(await visible(), true);
    await page.reload();
    assert.equal(await visible(), true);
    console.log('PASS: hidden commands, swipe and persistence');
    await page.locator('#nixieWeather').click();
    assert.equal(await page.locator('#settings').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settings').isVisible(), false);
    assert.equal(await visible(), true);
    await page.locator('#nixieWeather').click();
    await page.locator('#searchInput').fill('大阪');
    await page.locator('#searchForm button').click();
    await page.locator('#results button').click();
    await tick();
    assert.equal(await page.locator('#nixiePlace').textContent(), '大阪');
    console.log('PASS: settings and weather');
    await page.locator('#nixieAlarm').click();
    assert.equal(await visible(), false);
    assert.equal(await page.evaluate(() => EC.getSlide()), 2);
    assert.equal(await page.locator('#panel-alarm').isVisible(), true);
    await page.evaluate(() => {
      localStorage.setItem('echo-clock-alarms', JSON.stringify([
        { h: 7, m: 0, on: true, daily: true, label: '' },
        { h: 21, m: 30, on: true, daily: false, label: 'テスト' },
        { h: 20, m: 50, on: false, daily: true, label: '' }
      ]));
      localStorage.setItem('echo-clock-nixie', 'on');
    });
    await page.reload();
    assert.equal(await page.locator('#nixieAlarmTime').textContent(), '21:30');
    await page.clock.setFixedTime(new Date('2026-09-09T21:30:00+09:00'));
    await tick();
    assert.equal(await page.locator('#ringing').isVisible(), true);
    assert.equal(await visible(), true);
    await page.locator('#ringSnooze').click();
    await tick();
    assert.equal(await page.locator('#nixieAlarmTime').textContent(), '21:35');
    console.log('PASS: alarm and snooze');
    await page.clock.setFixedTime(new Date('2026-09-10T00:00:00+09:00'));
    await tick();
    assert.equal(await page.locator('#nixieDate').textContent(), '2026年 9月10日 木曜日');
    assert.equal(await page.locator('#nixieClock').getAttribute('aria-label'), '0時0分0秒');
    if (await page.locator('#ringing').isVisible()) await page.locator('#ringStop').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'phone-390x844.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    for (const id of ['nixieDate', 'nixieClock', 'nixieWeather', 'nixieAlarm', 'nixieClose']) {
      const bounds = await page.locator('#' + id).boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844, id + ' is within viewport');
    }
    await page.locator('#nixieClose').click();
    assert.equal(await visible(), false);
    await page.reload();
    assert.equal(await visible(), false);
    // タイマーは隠し画面に切り替えても鳴動する。
    await page.evaluate(() => {
      localStorage.setItem('echo-clock-timer', JSON.stringify({ running: true, endAt: Date.now() + 60000, remain: 60000, duration: 60000 }));
      localStorage.setItem('echo-clock-nixie', 'on');
    });
    await page.reload();
    await page.clock.setFixedTime(new Date('2026-09-10T00:01:00+09:00'));
    await tick();
    assert.equal(await page.locator('#ringTitle').textContent(), 'タイマー');
    assert.equal(await page.locator('#ringing').isVisible(), true);
    await page.locator('#ringStop').click();
    await page.locator('#nixieClose').click();
    // PointerEvent 非対応端末の touch と合成 mouse を二重カウントしない。
    const legacy = await context.newPage();
    legacy.on('pageerror', error => errors.push(error.message));
    await legacy.addInitScript(() => { window.PointerEvent = undefined; });
    await legacy.goto(url);
    for (let i = 0; i < 4; i++) await legacy.locator('.clock').tap();
    assert.equal(await legacy.locator('#nixieScreen').isVisible(), false);
    await legacy.locator('.clock').tap();
    assert.equal(await legacy.locator('#nixieScreen').isVisible(), true);
    await legacy.keyboard.press('Escape');
    // 保存が禁止された環境でも、切り替えと閉じる操作ができる。
    const privatePage = await context.newPage();
    privatePage.on('pageerror', error => errors.push(error.message));
    await privatePage.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage disabled'); } });
    });
    await privatePage.goto(url);
    await privatePage.keyboard.type('nixie');
    assert.equal(await privatePage.locator('#nixieScreen').isVisible(), true);
    await privatePage.keyboard.press('Escape');
    assert.equal(await privatePage.locator('#nixieScreen').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS: keyboard / touch / swipe / persistence / settings / weather / alarm / snooze / timer / midnight / portrait / legacy touch / unavailable storage');
    console.log('Screenshots: ' + output);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
