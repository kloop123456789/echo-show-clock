// 中継役を、SwitchBot API を偽物に差し替えて検証する。
// Cloudflare 版（switchbot-proxy/worker.js）と Vercel 版（api/switchbot.js）の
// 両方に同じ検証をかけ、ふるまいがそろっていることを確かめる。
// 本物のトークンは要らない。実行: node tests/switchbot-worker.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../switchbot-proxy/worker.js';
import vercel from '../api/switchbot.js';

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

// ---- 2つの実装を、同じ形（status / headers / body）で呼べるようにする ----
const ctx = { waitUntil() {} };
const ORIGIN = 'https://proxy.example.dev';
const ENV_KEYS = ['SWITCHBOT_TOKEN', 'SWITCHBOT_SECRET', 'SWITCHBOT_DEVICE_ID',
  'SWITCHBOT_DEVICE_NAME', 'ALLOW_ORIGIN', 'ACCESS_KEY'];

async function callWorker(path, env, method = 'GET') {
  const res = await worker.fetch(new Request(ORIGIN + path, { method }), env, ctx);
  const text = await res.text();
  return { status: res.status, headers: Object.fromEntries(res.headers), body: text ? JSON.parse(text) : null };
}

async function callVercel(path, env, method = 'GET') {
  // Vercel の関数は process.env を直接読むので、その間だけ差し替える
  const saved = {};
  ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.assign(process.env, env);
  try {
    const url = new URL(ORIGIN + path);
    const req = { method, url: path, query: Object.fromEntries(url.searchParams) };
    return await new Promise((resolve, reject) => {
      const headers = {};
      let status = 200;
      const res = {
        setHeader(k, v) { headers[k.toLowerCase()] = String(v); return res; },
        status(c) { status = c; return res; },
        json(obj) { resolve({ status, headers, body: obj }); return res; },
        end() { resolve({ status, headers, body: null }); return res; }
      };
      Promise.resolve(vercel(req, res)).catch(reject);
    });
  } finally {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    });
  }
}

const IMPLS = [
  { label: 'Cloudflare（switchbot-proxy/worker.js）', call: callWorker },
  { label: 'Vercel（api/switchbot.js）', call: callVercel }
];

const base = { SWITCHBOT_TOKEN: TOKEN, SWITCHBOT_SECRET: SECRET };

// ---- 検証の中身。どちらの実装でも同じことを確かめる ----
const CASES = [
  ['温湿度計を自動で選び、温度と湿度を返す', async (call) => {
    const { status, body, headers } = await call('/', base);
    assert.equal(status, 200);
    assert.equal(body.temperature, 24.3);
    assert.equal(body.humidity, 52);
    assert.equal(body.battery, 96);
    assert.equal(body.deviceId, 'BBB', 'カーテンではなく温湿度計を選ぶこと');
    assert.equal(headers['access-control-allow-origin'], '*');
  }],

  ['デバイスIDを指定すると、そちらを読む', async (call) => {
    const { body } = await call('/', { ...base, SWITCHBOT_DEVICE_ID: 'CCC', SWITCHBOT_DEVICE_NAME: '寝室' });
    assert.equal(body.temperature, 19.8);
    assert.equal(body.name, '寝室');
    assert.ok(!calls.includes('/v1.1/devices'), 'IDがあるなら一覧は取りに行かない');
  }],

  ['名前を指定しなければ「室内」になる', async (call) => {
    const { body } = await call('/', { ...base, SWITCHBOT_DEVICE_ID: 'BBB' });
    assert.equal(body.name, '室内');
  }],

  ['?list=1 で一覧を返し、温湿度計に印が付く', async (call) => {
    const { body } = await call('/?list=1', base);
    assert.equal(body.devices.length, 3);
    assert.deepEqual(body.devices.map((d) => d['温湿度計']), [false, true, true]);
  }],

  ['温度を持たない機器を指定したら、その旨を返す', async (call) => {
    const { status, body } = await call('/', { ...base, SWITCHBOT_DEVICE_ID: 'AAA' });
    assert.equal(status, 502);
    assert.match(body.error, /温度・湿度を返しません/);
  }],

  ['トークン未設定はエラーにする', async (call) => {
    const { status, body } = await call('/', {});
    assert.equal(status, 500);
    assert.match(body.error, /SWITCHBOT_TOKEN/);
  }],

  ['SwitchBot 側のエラーをそのまま伝える', async (call) => {
    failWith = 161;
    const { status, body } = await call('/', { ...base, SWITCHBOT_DEVICE_ID: 'BBB' });
    assert.equal(status, 502);
    assert.match(body.error, /statusCode 161/);
  }],

  ['ACCESS_KEY を設定すると、合言葉なしでは答えない', async (call) => {
    const env = { ...base, SWITCHBOT_DEVICE_ID: 'BBB', ACCESS_KEY: 'himitsu' };
    assert.equal((await call('/', env)).status, 403);
    assert.equal((await call('/?key=chigau', env)).status, 403);
    assert.equal((await call('/?key=himitsu', env)).status, 200);
  }],

  ['ALLOW_ORIGIN で読み取れるページを絞れる', async (call) => {
    const { headers } = await call('/', { ...base, SWITCHBOT_DEVICE_ID: 'BBB', ALLOW_ORIGIN: 'https://example.github.io' });
    assert.equal(headers['access-control-allow-origin'], 'https://example.github.io');
  }],

  ['OPTIONS（事前確認）に 204 で答える', async (call) => {
    const { status, headers } = await call('/', base, 'OPTIONS');
    assert.equal(status, 204);
    assert.equal(headers['access-control-allow-methods'], 'GET, OPTIONS');
  }],

  ['GET 以外は受け付けない', async (call) => {
    const { status } = await call('/', base, 'POST');
    assert.equal(status, 405);
  }]
];

let failures = 0;
for (const impl of IMPLS) {
  console.log('\n' + impl.label);
  for (const [name, fn] of CASES) {
    calls = [];
    failWith = null;
    try {
      await fn(impl.call);
      console.log('  OK  ' + name);
    } catch (err) {
      failures++;
      console.log('  NG  ' + name + '\n      ' + (err && err.message));
    }
  }
}

const total = IMPLS.length * CASES.length;
console.log('\n' + (total - failures) + ' / ' + total + ' 成功');
if (failures) process.exitCode = 1;
