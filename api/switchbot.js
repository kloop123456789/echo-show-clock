/* ============================================================
   SwitchBot の温湿度を、ブラウザから読める形にして返す「中継役」
   Vercel 用（このリポジトリを Vercel に置くと、そのまま動きます）

   なぜ必要か
     SwitchBot の API は、よそのサイトからブラウザで直接読むことを許していない。
     （CORS＝読み取り許可のヘッダを返さないため、Chrome が止めてしまう）
     またトークンをブラウザに置くと、公開ページでは他人に見られる恐れがある。
     この中継役を挟むと、トークンは Vercel 側に置いたまま、
     ブラウザには温度と湿度の数字だけが渡る。

   置き場所
     このファイルを api/switchbot.js に置くと、
     https://〇〇〇.vercel.app/api/switchbot で読めるようになる。

   環境変数（Vercel の Settings → Environment Variables で入れる）
     SWITCHBOT_TOKEN        必須  SwitchBot アプリで取得したトークン
     SWITCHBOT_SECRET       必須  同じくクライアントシークレット
     SWITCHBOT_DEVICE_ID    任意  温湿度計のデバイスID。省略すると自動で探す
     SWITCHBOT_DEVICE_NAME  任意  画面に出す名前（既定は「室内」）
     ALLOW_ORIGIN           任意  読み取りを許すページ。既定は * （どこからでも可）
     ACCESS_KEY             任意  設定すると ?key=... が一致しないと答えない

   使い方
     GET /api/switchbot         → { "name": "室内", "temperature": 24.3, ... }
     GET /api/switchbot?list=1  → 手持ちのデバイス一覧（デバイスIDを調べるとき用）

   ※ Cloudflare Workers 用の switchbot-proxy/worker.js と中身は同じです。
      どちらか片方だけ使えば足ります。
      それぞれ単体で貼り付けて使えるよう、あえて別々に書いてあります。
   ============================================================ */

const crypto = require('node:crypto');

// 温度・湿度を持っている機種（deviceType がこれに当てはまるものを自動で選ぶ）
const THERMO = /Meter|WoIOSensor|Hub\s?[23]/i;

// 自動で見つけたデバイスIDの覚え書き（同じ実行環境が使い回される間だけ有効）
let cachedDeviceId = null;

/** SwitchBot API v1.1 の認証ヘッダを組み立てる */
function authHeaders(token, secret) {
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  // 署名は Base64。ここは大文字小文字を変えてはいけない
  const sign = crypto.createHmac('sha256', secret).update(token + t + nonce).digest('base64');

  return {
    'Authorization': token,
    'sign': sign,
    't': t,
    'nonce': nonce,
    'Content-Type': 'application/json; charset=utf8'
  };
}

/** SwitchBot API を叩いて body を返す */
async function api(path, token, secret) {
  const res = await fetch('https://api.switch-bot.com/v1.1' + path, {
    headers: authHeaders(token, secret)
  });

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('SwitchBot の返事が読めませんでした（HTTP ' + res.status + '）');
  }

  if (data.statusCode !== 100) {
    // 161:機器がオフライン / 171:ハブがオフライン / 190:内部エラー
    throw new Error(
      'SwitchBot がエラーを返しました（statusCode ' + data.statusCode +
      (data.message ? ' / ' + data.message : '') + '）'
    );
  }
  return data.body;
}

/** 温湿度計を自動で探す */
async function findThermo(token, secret) {
  if (cachedDeviceId) return cachedDeviceId;

  const body = await api('/devices', token, secret);
  const list = (body && body.deviceList) || [];
  const hit = list.find((d) => THERMO.test(d.deviceType || ''));

  if (!hit) {
    throw new Error(
      '温湿度計が見つかりませんでした。?list=1 で一覧を見て、' +
      'SWITCHBOT_DEVICE_ID に温湿度計のIDを設定してください'
    );
  }
  cachedDeviceId = hit.deviceId;
  return cachedDeviceId;
}

module.exports = async function handler(req, res) {
  const env = process.env;

  res.setHeader('Access-Control-Allow-Origin', env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET だけ受け付けます' }); return; }

  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  // 合言葉を設定している場合の確認
  if (env.ACCESS_KEY && q.key !== env.ACCESS_KEY) {
    res.status(403).json({ error: 'key が違います' });
    return;
  }

  const token = env.SWITCHBOT_TOKEN;
  const secret = env.SWITCHBOT_SECRET;
  if (!token || !secret) {
    res.status(500).json({ error: 'SWITCHBOT_TOKEN と SWITCHBOT_SECRET を設定してください' });
    return;
  }

  try {
    // デバイスID調べ用の一覧
    if (q.list) {
      const body = await api('/devices', token, secret);
      const devices = ((body && body.deviceList) || []).map((d) => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        deviceType: d.deviceType,
        温湿度計: THERMO.test(d.deviceType || '')
      }));
      res.status(200).json({ devices });
      return;
    }

    const deviceId = env.SWITCHBOT_DEVICE_ID || await findThermo(token, secret);
    const st = await api('/devices/' + encodeURIComponent(deviceId) + '/status', token, secret);

    const out = {
      name: env.SWITCHBOT_DEVICE_NAME || '室内',
      temperature: typeof st.temperature === 'number' ? st.temperature : null,
      humidity: typeof st.humidity === 'number' ? st.humidity : null,
      battery: typeof st.battery === 'number' ? st.battery : null,
      deviceId: st.deviceId || deviceId,
      deviceType: st.deviceType || null,
      time: new Date().toISOString()
    };

    if (out.temperature === null && out.humidity === null) {
      res.status(502).json({
        error: 'この機器は温度・湿度を返しません。?list=1 で温湿度計のIDを確認してください',
        deviceId,
        deviceType: st.deviceType || null
      });
      return;
    }

    res.status(200).json(out);

  } catch (err) {
    cachedDeviceId = null;   // 探し直せるように忘れる
    res.status(502).json({ error: String((err && err.message) || err) });
  }
};
