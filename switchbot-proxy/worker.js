/* ============================================================
   SwitchBot の温湿度を、ブラウザから読める形にして返す「中継役」
   Cloudflare Workers 用（無料枠で足ります）

   なぜ必要か
     SwitchBot の API は、よそのサイトからブラウザで直接読むことを許していない。
     （CORS＝読み取り許可のヘッダを返さないため、Chrome が止めてしまう）
     またトークンをブラウザに置くと、公開ページでは他人に見られる恐れがある。
     この中継役を挟むと、トークンは Cloudflare 側に置いたまま、
     ブラウザには温度と湿度の数字だけが渡る。

   設定する環境変数（Cloudflare の画面で入れる。作り方は README.md）
     SWITCHBOT_TOKEN      必須  SwitchBot アプリで取得したトークン
     SWITCHBOT_SECRET     必須  同じくクライアントシークレット
     SWITCHBOT_DEVICE_ID  任意  温湿度計のデバイスID。省略すると自動で探す
     ALLOW_ORIGIN         任意  読み取りを許すページ。既定は * （どこからでも可）
     ACCESS_KEY           任意  設定すると ?key=... が一致しないと答えない

   使い方
     GET /            → { "name": "リビング", "temperature": 24.3, "humidity": 52, ... }
     GET /?list=1     → 手持ちのデバイス一覧（デバイスIDを調べるとき用）
   ============================================================ */

// 温度・湿度を持っている機種（deviceType がこれに当てはまるものを自動で選ぶ）
var THERMO = /Meter|WoIOSensor|Hub\s?[23]/i;

// 自動で見つけたデバイスIDの覚え書き（同じ Worker が使い回される間だけ有効）
var cachedDeviceId = null;

/** SwitchBot API v1.1 の認証ヘッダを組み立てる */
async function authHeaders(token, secret) {
  var t = Date.now().toString();
  var nonce = crypto.randomUUID();
  var enc = new TextEncoder();

  var key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  var mac = await crypto.subtle.sign('HMAC', key, enc.encode(token + t + nonce));

  // 署名は Base64。ここは大文字小文字を変えてはいけない
  var bytes = new Uint8Array(mac);
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);

  return {
    'Authorization': token,
    'sign': btoa(bin),
    't': t,
    'nonce': nonce,
    'Content-Type': 'application/json; charset=utf8'
  };
}

/** SwitchBot API を叩いて body を返す */
async function api(path, token, secret) {
  var headers = await authHeaders(token, secret);
  var res = await fetch('https://api.switch-bot.com/v1.1' + path, { headers: headers });

  var data;
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

  var body = await api('/devices', token, secret);
  var list = (body && body.deviceList) || [];
  var hit = list.filter(function (d) { return THERMO.test(d.deviceType || ''); })[0];

  if (!hit) {
    throw new Error(
      '温湿度計が見つかりませんでした。?list=1 で一覧を見て、' +
      'SWITCHBOT_DEVICE_ID に温湿度計のIDを設定してください'
    );
  }
  cachedDeviceId = hit.deviceId;
  return cachedDeviceId;
}

export default {
  async fetch(request, env, ctx) {
    var cors = {
      'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    };

    function json(obj, status, cacheSeconds) {
      var headers = Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': cacheSeconds
          ? 'public, max-age=' + cacheSeconds
          : 'no-store'
      }, cors);
      return new Response(JSON.stringify(obj, null, 2), { status: status || 200, headers: headers });
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'GET だけ受け付けます' }, 405);

    var url = new URL(request.url);

    // 合言葉を設定している場合の確認
    if (env.ACCESS_KEY && url.searchParams.get('key') !== env.ACCESS_KEY) {
      return json({ error: 'key が違います' }, 403);
    }

    var token = env.SWITCHBOT_TOKEN;
    var secret = env.SWITCHBOT_SECRET;
    if (!token || !secret) {
      return json({ error: 'SWITCHBOT_TOKEN と SWITCHBOT_SECRET を設定してください' }, 500);
    }

    try {
      // デバイスID調べ用の一覧
      if (url.searchParams.get('list')) {
        var body = await api('/devices', token, secret);
        var devices = ((body && body.deviceList) || []).map(function (d) {
          return {
            deviceId: d.deviceId,
            deviceName: d.deviceName,
            deviceType: d.deviceType,
            温湿度計: THERMO.test(d.deviceType || '')
          };
        });
        return json({ devices: devices }, 200);
      }

      // 同じ答えを何度も取りに行かないよう、60秒だけ手前に貯めておく
      // （Cloudflare 以外で動かしたときは caches が無いので、その場合は貯めない）
      var cache = null;
      var cacheKey = new Request(url.origin + url.pathname + '?cached=1', { method: 'GET' });
      try {
        cache = caches.default;
        var hit = await cache.match(cacheKey);
        if (hit) return hit;
      } catch (e) { cache = null; }

      var deviceId = env.SWITCHBOT_DEVICE_ID || await findThermo(token, secret);
      var st = await api('/devices/' + encodeURIComponent(deviceId) + '/status', token, secret);

      var out = {
        name: env.SWITCHBOT_DEVICE_NAME || '室内',
        temperature: typeof st.temperature === 'number' ? st.temperature : null,
        humidity: typeof st.humidity === 'number' ? st.humidity : null,
        battery: typeof st.battery === 'number' ? st.battery : null,
        deviceId: st.deviceId || deviceId,
        deviceType: st.deviceType || null,
        time: new Date().toISOString()
      };

      if (out.temperature === null && out.humidity === null) {
        return json({
          error: 'この機器は温度・湿度を返しません。?list=1 で温湿度計のIDを確認してください',
          deviceId: deviceId,
          deviceType: st.deviceType || null
        }, 502);
      }

      var res = json(out, 200, 60);
      if (cache) {
        try { ctx.waitUntil(cache.put(cacheKey, res.clone())); } catch (e) { /* 貯められなくても動く */ }
      }
      return res;

    } catch (err) {
      cachedDeviceId = null;   // 探し直せるように忘れる
      return json({ error: String(err && err.message || err) }, 502);
    }
  }
};
