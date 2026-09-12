// 中継役（switchbot-proxy/worker.js）を、SwitchBot API を偽物に差し替えて検証する。
// 本物のトークンは要らない。実行: node tests/switchbot-worker.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../switchbot-proxy/worker.js';

const TOKEN = 'TEST_TOKEN_1234567890';
const SECRET = 'TEST_SECRET_abcdefghij';

const DEVICES = [
  { deviceId: 'AAA', deviceName: 'カーテン', deviceType: 'Curtain' },
  { deviceId: 'BBB', deviceName: 'リビング', deviceType: 'Meter' },
  { deviceId: 'CCC', deviceName: '寝室', deviceType: 'WoIOSensor' }
];
const STATUS = {
  AAA: { deviceId: 'AAA', deviceType: 'Curtain', slidePosition: 0 },
  BBB: { deviceId: 'BBB', deviceType: 'Meter', temperature: 24.3, humidity: 52, battery: 96 },
  CCC: { deviceId: 'CCC', deviceType: 'WoIOSensor', temperature: 19.8, humidity: 61, battery: 80 }
};

let calls = [];
let failWith = null;

// SwitchBot API のふり
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  const h = init.headers;
  calls.push(u.pathname);

  // 署名が仕様どおりか、受け取る側でも確かめる
  const expect = crypto.createHmac('sha256', SECRET).update(h.Authorization + h.t + h.nonce).digest('base64');
  assert.equal(h.sign, expect, '署名が SwitchBot の仕様と合っていない');
  assert.ok(Number(h.t) > 0 && h.nonce, 't と nonce が入っていない');

  const body = (obj) => new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } });
  if (failWith) return body({ statusCode: failWith, message: 'ng' });
  if (h.Authorization !== TOKEN) return body({ statusCode: 401, message: 'Unauthorized' });

  if (u.pathname === '/v1.1/devices') return body({ statusCode: 100, body: { deviceList: DEVICES, infraredRemoteList: [] } });
  const m = u.pathname.match(/^\/v1\.1\/devices\/([^/]+)\/status$/);
  if (m && STATUS[m[1]]) return body({ statusCode: 100, body: STATUS[m[1]] });
  return body({ statusCode: 190, message: 'not found' });
};

const ctx = { waitUntil() {} };
const call = (path, env) => worker.fetch(new Request('https://proxy.example.dev' + path), env, ctx);
const base = { SWITCHBOT_TOKEN: TOKEN, SWITCHBOT_SECRET: SECRET };

let done = 0;
async function test(name, fn) {
  calls = [];
  failWith = null;
  await fn();
  done++;
  console.log('  OK  ' + name);
}

console.log('中継役（switchbot-proxy/worker.js）の検証');

await test('温湿度計を自動で選び、温度と湿度を返す', async () => {
  const res = await call('/', base);
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.equal(j.temperature, 24.3);
  assert.equal(j.humidity, 52);
  assert.equal(j.battery, 96);
  assert.equal(j.deviceId, 'BBB', 'カーテンではなく温湿度計を選ぶこと');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

await test('デバイスIDを指定すると、そちらを読む', async () => {
  const j = await (await call('/', { ...base, SWITCHBOT_DEVICE_ID: 'CCC', SWITCHBOT_DEVICE_NAME: '寝室' })).json();
  assert.equal(j.temperature, 19.8);
  assert.equal(j.name, '寝室');
  assert.ok(!calls.includes('/v1.1/devices'), 'IDがあるなら一覧は取りに行かない');
});

await test('?list=1 で一覧を返し、温湿度計に印が付く', async () => {
  const j = await (await call('/?list=1', base)).json();
  assert.equal(j.devices.length, 3);
  assert.deepEqual(j.devices.map((d) => d['温湿度計']), [false, true, true]);
});

await test('温度を持たない機器を指定したら、その旨を返す', async () => {
  const res = await call('/', { ...base, SWITCHBOT_DEVICE_ID: 'AAA' });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /温度・湿度を返しません/);
});

await test('トークン未設定はエラーにする', async () => {
  const res = await call('/', {});
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /SWITCHBOT_TOKEN/);
});

await test('SwitchBot 側のエラーをそのまま伝える', async () => {
  failWith = 161;
  const res = await call('/', base);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /statusCode 161/);
});

await test('ACCESS_KEY を設定すると、合言葉なしでは答えない', async () => {
  const env = { ...base, ACCESS_KEY: 'himitsu' };
  assert.equal((await call('/', env)).status, 403);
  assert.equal((await call('/?key=chigau', env)).status, 403);
  assert.equal((await call('/?key=himitsu', env)).status, 200);
});

await test('ALLOW_ORIGIN で読み取れるページを絞れる', async () => {
  const res = await call('/', { ...base, ALLOW_ORIGIN: 'https://example.github.io' });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://example.github.io');
});

await test('OPTIONS（事前確認）に 204 で答える', async () => {
  const res = await worker.fetch(new Request('https://proxy.example.dev/', { method: 'OPTIONS' }), base, ctx);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
});

await test('GET 以外は受け付けない', async () => {
  const res = await worker.fetch(new Request('https://proxy.example.dev/', { method: 'POST' }), base, ctx);
  assert.equal(res.status, 405);
});

console.log('\n' + done + ' 件すべて成功');
