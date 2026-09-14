/* ============================================================
   気象庁の天気予報とアメダスを読み、画面で使う形にそろえる

   使うもの（どれも気象庁ホームページが公開している JSON。登録不要・無料）
     府県天気予報      bosai/forecast/data/forecast/{府県}.json
                        今日〜明後日の天気・風・波、6時間ごとの降水確率、最高/最低気温
                        週間予報（天気・降水確率・信頼度・気温の予想範囲・平年値）
     地域時系列予報    bosai/jmatile/data/wdist/VPFD/{地域}.json
                        3時間ごとの天気・風・気温（明日いっぱいまで）
     アメダス          bosai/amedas/data/point/{観測所}/{日付}_{時}.json
                        いまの気温・湿度・風・降水量（10分ごとの実測）
     区域表など        bosai/common/const/area.json ほか

   地点（緯度経度）から予報区を決めるのに、国土地理院の逆ジオコーダ
   （緯度経度 → 市区町村コード）を使う。日本の外では結果が空になるので、
   そのときは「気象庁の対象外」として app.js が Open-Meteo に切り替える。

   利用条件：気象庁ホームページのコンテンツは公共データ利用規約に準拠し、
   「出典：気象庁ホームページ」の記載と、加工した旨の明記が必要。
   形式やURLは予告なく変わることがあるため、失敗したら app.js が別の元に切り替える。

   ブラウザでは window.JMA、node では module.exports として使える（テスト用）。
   ============================================================ */
(function (root) {
  'use strict';

  var BASE = 'https://www.jma.go.jp/bosai/';
  var GSI = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
  var CACHE_KEY = 'echo-clock-jma-area';
  var CACHE_VER = 2;
  var TZ = 9;                     // 日本時間（UTC+9）
  var HOUR = 3600 * 1000;
  var TIMEOUT = 12 * 1000;

  // ---------- 天気コード（気象庁の予報ページの表から取り出したもの） ----------
  var TELOPS = {
    100: '晴', 101: '晴時々曇', 102: '晴一時雨', 103: '晴時々雨', 104: '晴一時雪', 105: '晴時々雪',
    106: '晴一時雨か雪', 107: '晴時々雨か雪', 108: '晴一時雨か雷雨', 110: '晴後時々曇', 111: '晴後曇',
    112: '晴後一時雨', 113: '晴後時々雨', 114: '晴後雨', 115: '晴後一時雪', 116: '晴後時々雪', 117: '晴後雪',
    118: '晴後雨か雪', 119: '晴後雨か雷雨', 120: '晴朝夕一時雨', 121: '晴朝の内一時雨', 122: '晴夕方一時雨',
    123: '晴山沿い雷雨', 124: '晴山沿い雪', 125: '晴午後は雷雨', 126: '晴昼頃から雨', 127: '晴夕方から雨',
    128: '晴夜は雨', 130: '朝の内霧後晴', 131: '晴明け方霧', 132: '晴朝夕曇', 140: '晴時々雨で雷を伴う',
    160: '晴一時雪か雨', 170: '晴時々雪か雨', 181: '晴後雪か雨',
    200: '曇', 201: '曇時々晴', 202: '曇一時雨', 203: '曇時々雨', 204: '曇一時雪', 205: '曇時々雪',
    206: '曇一時雨か雪', 207: '曇時々雨か雪', 208: '曇一時雨か雷雨', 209: '霧', 210: '曇後時々晴', 211: '曇後晴',
    212: '曇後一時雨', 213: '曇後時々雨', 214: '曇後雨', 215: '曇後一時雪', 216: '曇後時々雪', 217: '曇後雪',
    218: '曇後雨か雪', 219: '曇後雨か雷雨', 220: '曇朝夕一時雨', 221: '曇朝の内一時雨', 222: '曇夕方一時雨',
    223: '曇日中時々晴', 224: '曇昼頃から雨', 225: '曇夕方から雨', 226: '曇夜は雨', 228: '曇昼頃から雪',
    229: '曇夕方から雪', 230: '曇夜は雪', 231: '曇海上海岸は霧か霧雨', 240: '曇時々雨で雷を伴う',
    250: '曇時々雪で雷を伴う', 260: '曇一時雪か雨', 270: '曇時々雪か雨', 281: '曇後雪か雨',
    300: '雨', 301: '雨時々晴', 302: '雨時々止む', 303: '雨時々雪', 304: '雨か雪', 306: '大雨',
    308: '雨で暴風を伴う', 309: '雨一時雪', 311: '雨後晴', 313: '雨後曇', 314: '雨後時々雪', 315: '雨後雪',
    316: '雨か雪後晴', 317: '雨か雪後曇', 320: '朝の内雨後晴', 321: '朝の内雨後曇', 322: '雨朝晩一時雪',
    323: '雨昼頃から晴', 324: '雨夕方から晴', 325: '雨夜は晴', 326: '雨夕方から雪', 327: '雨夜は雪',
    328: '雨一時強く降る', 329: '雨一時みぞれ', 340: '雪か雨', 350: '雨で雷を伴う', 361: '雪か雨後晴',
    371: '雪か雨後曇', 400: '雪', 401: '雪時々晴', 402: '雪時々止む', 403: '雪時々雨', 405: '大雪',
    406: '風雪強い', 407: '暴風雪', 409: '雪一時雨', 411: '雪後晴', 413: '雪後曇', 414: '雪後雨',
    420: '朝の内雪後晴', 421: '朝の内雪後曇', 422: '雪昼頃から雨', 423: '雪夕方から雨', 425: '雪一時強く降る',
    426: '雪後みぞれ', 427: '雪一時みぞれ', 450: '雪で雷を伴う'
  };

  /** 「晴時々曇」→「晴れ時々くもり」のように、読みやすい書き方へ */
  function readable(label) {
    return String(label).replace(/晴/g, '晴れ').replace(/曇/g, 'くもり').replace(/後/g, 'のち');
  }

  /**
   * 天気の文言から、アイコン・背景の種類を決める。
   * 返り値 [昼のアイコン, 夜のアイコン, 背景の種類]
   */
  function looks(label) {
    var s = String(label || '');
    var has = function (x) { return s.indexOf(x) >= 0; };
    var m = s.match(/[晴曇雨雪霧]|くもり/);
    var first = m ? (m[0] === 'くもり' ? '曇' : m[0]) : '';
    var rain = s.replace(/霧雨/g, '').indexOf('雨') >= 0;   // 「霧雨」は霧として扱う
    var snow = has('雪') || has('みぞれ');

    if (has('雷')) return ['i-thunder', 'i-thunder', 'storm'];
    if (first === '晴') {
      if (rain) return ['i-sun-rain', 'i-rain', 'partly'];
      if (snow) return ['i-sun-snow', 'i-snow', 'partly'];
      if (has('曇') || has('くもり') || has('霧')) return ['i-cloud-sun', 'i-cloud-moon', 'partly'];
      return ['i-sun', 'i-moon', 'clear'];
    }
    if (first === '曇') {
      if (rain && snow) return ['i-sleet', 'i-sleet', 'rain'];
      if (rain) return ['i-drizzle', 'i-drizzle', 'rain'];
      if (snow) return ['i-snow', 'i-snow', 'snow'];
      if (has('霧')) return ['i-fog', 'i-fog', 'cloudy'];
      if (has('晴')) return ['i-cloud-sun', 'i-cloud-moon', 'partly'];
      return ['i-cloud', 'i-cloud', 'cloudy'];
    }
    if (first === '雨') {
      if (has('大雨') || has('暴風') || has('強く')) return ['i-heavy-rain', 'i-heavy-rain', 'rain'];
      if (snow) return ['i-sleet', 'i-sleet', 'rain'];
      return ['i-rain', 'i-rain', 'rain'];
    }
    if (first === '雪') {
      if (rain) return ['i-sleet', 'i-sleet', 'snow'];
      return ['i-snow', 'i-snow', 'snow'];
    }
    if (first === '霧') return ['i-fog', 'i-fog', 'cloudy'];
    return ['i-cloud', 'i-cloud', 'cloudy'];
  }

  function telop(code) {
    var raw = TELOPS[Number(code)];
    return raw ? { label: readable(raw), look: looks(raw) } : { label: '---', look: ['i-cloud', 'i-cloud', 'cloudy'] };
  }

  // ---------- 小さな道具 ----------
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /** 気象庁の予報文を読みやすく：全角の数字を半角に、全角スペースを半角に */
  function tidy(s) {
    return String(s)
      .replace(/[０-９．－]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, ' ');
  }

  /** 日本時間での「YYYY-MM-DD」 */
  function ymdJst(date) {
    var d = new Date(date.getTime() + TZ * HOUR);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function hourJst(date) { return new Date(date.getTime() + TZ * HOUR).getUTCHours(); }

  /** 「2026-09-14T18:00:00+09:00」→ Date */
  function parseTime(s) {
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /** 2点間のおおよその距離（km） */
  function distKm(lat1, lon1, lat2, lon2) {
    var r = Math.PI / 180;
    var x = (lon2 - lon1) * r * Math.cos((lat1 + lat2) / 2 * r);
    var y = (lat2 - lat1) * r;
    return Math.sqrt(x * x + y * y) * 6371;
  }

  function getJSON(url) {
    var ctrl = null, timer = null;
    try { ctrl = new AbortController(); } catch (e) { /* 非対応なら時間切れなし */ }
    var opts = { cache: 'no-store' };
    if (ctrl) { opts.signal = ctrl.signal; timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT); }
    return fetch(url, opts).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  function getText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.text();
    });
  }

  // ---------- 日の出・日の入り（計算値） ----------
  // 気象庁の予報データには含まれないため、天文計算で出す（誤差はおおむね1分以内）
  function sunEvent(ymd, lat, lon, rising) {
    var p = ymd.split('-');
    var y = +p[0], mo = +p[1], d = +p[2];
    var rad = Math.PI / 180;
    var n = (Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 864e5;
    var lngHour = lon / 15;
    var t = n + ((rising ? 6 : 18) - lngHour) / 24;
    var M = 0.9856 * t - 3.289;
    var L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634;
    L = ((L % 360) + 360) % 360;
    var RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = ((RA % 360) + 360) % 360;
    RA = (RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90)) / 15;
    var sinDec = 0.39782 * Math.sin(L * rad);
    var cosDec = Math.cos(Math.asin(sinDec));
    var cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null;
    var H = (rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
    var T = H + RA - 0.06571 * t - 6.622;
    var ut = ((T - lngHour) % 24 + 24) % 24;
    var local = ((ut + TZ) % 24 + 24) % 24;
    // その日の日本時間 0時を起点に、日本時間の時刻を足す
    return new Date(Date.UTC(y, mo - 1, d) - TZ * HOUR + local * HOUR);
  }

  // ---------- 体感温度（計算値） ----------
  // 気温・湿度・風速から求める（Steadman の式。Open-Meteo の体感温度と同じ系統）
  function feelsLike(t, rh, ws) {
    if (t === null || rh === null) return null;
    var e = rh / 100 * 6.105 * Math.exp(17.27 * t / (237.7 + t));
    return t + 0.33 * e - 0.70 * (ws || 0) - 4.00;
  }

  // ---------- 地点 → 予報区 ----------
  var AMEDAS_DIRS = ['静穏', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
    '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西', '北'];

  function inJapanBox(lat, lon) {
    return lat >= 20 && lat <= 46.5 && lon >= 122 && lon <= 154.5;
  }

  function loadCache(lat, lon) {
    try {
      var c = JSON.parse(root.localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.v === CACHE_VER && Math.abs(c.lat - lat) < 1e-4 && Math.abs(c.lon - lon) < 1e-4) return c;
    } catch (e) { /* なければ調べ直す */ }
    return null;
  }
  function saveCache(c) {
    try { root.localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) { /* 保存できなくても動く */ }
  }

  function stationLatLon(s) {
    return [s.lat[0] + s.lat[1] / 60, s.lon[0] + s.lon[1] / 60];
  }

  /**
   * 緯度経度から、使う予報区と観測所を決める。
   * 日本の外なら null を返す（呼び出し側で別の元に切り替える）。
   */
  function resolve(lat, lon) {
    if (!inJapanBox(lat, lon)) return Promise.resolve(null);
    var cached = loadCache(lat, lon);
    if (cached) return Promise.resolve(cached);

    return getJSON(GSI + '?lat=' + lat + '&lon=' + lon).then(function (geo) {
      var muni = geo && geo.results && geo.results.muniCd;
      if (!muni) return null;   // 海外・海上など

      return Promise.all([
        getJSON(BASE + 'common/const/area.json'),
        getJSON(BASE + 'forecast/const/forecast_area.json'),
        getJSON(BASE + 'forecast/const/week_area.json'),
        getJSON(BASE + 'amedas/const/amedastable.json')
      ]).then(function (res) {
        var area = res[0], fa = res[1], wa = res[2], table = res[3];

        // その地域10（一次細分区域）に属する予報の気温観測点と、府県予報区
        function officeOf(c10) {
          for (var o in fa) {
            for (var i = 0; i < fa[o].length; i++) {
              if (fa[o][i].class10 === c10) return { office: o, entry: fa[o][i] };
            }
          }
          return null;
        }
        function class10Of(c20) {
          var a = area.class20s[c20];
          var b = a && area.class15s[a.parent];
          return b ? b.parent : null;
        }
        function nearestPointKm(codes) {
          var best = null;
          codes.forEach(function (code) {
            var s = table[code];
            if (!s) return;
            var ll = stationLatLon(s);
            var km = distKm(lat, lon, ll[0], ll[1]);
            if (!best || km < best.km) best = { code: code, km: km };
          });
          return best;
        }

        // 1) 市区町村コード＋"00" がそのまま区域にあればそれ
        var c10 = class10Of(muni + '00');

        // 2) 政令指定都市の区などは、市の単位（や「横浜市北部」など）で登録されている。
        //    同じ県の中で、この番号以下の一番近い番号の区域群を候補にする。
        if (!c10) {
          var target = muni + '00';
          var pref = muni.slice(0, 2);
          var keys = Object.keys(area.class20s).filter(function (k) {
            return k.slice(0, 2) === pref && k <= target;
          }).sort();
          var last = keys[keys.length - 1];
          if (last) {
            // 「仙台市東部・西部」のように、同じ市の区域が並んでいることがある
            var cityHead = last.slice(0, 5);
            var group = keys.filter(function (k) { return k.slice(0, 5) === cityHead; });
            var c10s = [];
            group.forEach(function (k) {
              var c = class10Of(k);
              if (c && c10s.indexOf(c) < 0) c10s.push(c);
            });
            if (c10s.length === 1) {
              c10 = c10s[0];
            } else if (c10s.length > 1) {
              // 区域が分かれるときは、各区域の気温観測点が一番近いものを選ぶ
              var best = null;
              c10s.forEach(function (c) {
                var of = officeOf(c);
                var p = of && nearestPointKm(of.entry.amedas || []);
                if (p && (!best || p.km < best.km)) best = { c10: c, km: p.km };
              });
              c10 = best ? best.c10 : c10s[0];
            }
          }
        }
        if (!c10) throw new Error('予報区が見つかりませんでした（市区町村コード ' + muni + '）');

        var of = officeOf(c10);
        if (!of) throw new Error('府県予報区が見つかりませんでした（' + c10 + '）');

        var point = nearestPointKm(of.entry.amedas || []) || { code: (of.entry.amedas || [])[0] };
        var week = null;
        (wa[of.office] || []).some(function (w) {
          if (w.srf === c10) { week = { code: w.week, point: w.amedas }; return true; }
          return false;
        });

        // いまの実測に使う観測所：気温を測っている一番近い所。湿度がなければ、湿度の一番近い所も
        var tempSt = null, humSt = null;
        Object.keys(table).forEach(function (code) {
          var s = table[code];
          var ll = stationLatLon(s);
          var km = distKm(lat, lon, ll[0], ll[1]);
          if (s.elems.charAt(0) === '1' && (!tempSt || km < tempSt.km)) tempSt = { code: code, name: s.kjName, km: km, hum: s.elems.charAt(6) === '1' };
          if (s.elems.charAt(6) === '1' && (!humSt || km < humSt.km)) humSt = { code: code, name: s.kjName, km: km };
        });

        var c10info = area.class10s[c10] || {};
        var result = {
          v: CACHE_VER, lat: lat, lon: lon, muni: muni,
          office: of.office,
          officeName: (area.offices[of.office] || {}).name || '',
          class10: c10,
          class10Name: c10info.name || '',
          point: point ? point.code : null,
          pointName: point && table[point.code] ? table[point.code].kjName : '',
          week: week,
          station: tempSt ? { code: tempSt.code, name: tempSt.name, km: Math.round(tempSt.km * 10) / 10 } : null,
          humStation: (tempSt && !tempSt.hum && humSt && humSt.km < 40)
            ? { code: humSt.code, name: humSt.name, km: Math.round(humSt.km * 10) / 10 } : null
        };
        saveCache(result);
        return result;
      });
    });
  }

  // ---------- アメダスの最新値 ----------
  function latestValue(obj, key) {
    var v = obj && obj[key];
    // [値, 品質フラグ]。0 が正常
    return v && v[1] === 0 ? num(v[0]) : null;
  }

  function fetchObs(code, latestText) {
    var latest = parseTime(String(latestText).trim());
    if (!latest || !code) return Promise.resolve(null);
    var j = new Date(latest.getTime() + TZ * HOUR);
    var day = j.getUTCFullYear() + pad2(j.getUTCMonth() + 1) + pad2(j.getUTCDate());
    var block = pad2(Math.floor(j.getUTCHours() / 3) * 3);
    return getJSON(BASE + 'amedas/data/point/' + code + '/' + day + '_' + block + '.json').then(function (data) {
      var keys = Object.keys(data).sort();
      // 新しい順に、気温が正常に取れている時刻を探す
      for (var i = keys.length - 1; i >= 0; i--) {
        var o = data[keys[i]];
        if (latestValue(o, 'temp') !== null || latestValue(o, 'humidity') !== null) {
          var k = keys[i];
          var at = new Date(Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8),
            +k.slice(8, 10), +k.slice(10, 12)) - TZ * HOUR);
          return {
            at: at,
            temp: latestValue(o, 'temp'),
            humidity: latestValue(o, 'humidity'),
            wind: latestValue(o, 'wind'),
            windDir: (function () {
              var d = latestValue(o, 'windDirection');
              return d === null ? '' : (AMEDAS_DIRS[d] || '');
            })(),
            precip10m: latestValue(o, 'precipitation10m'),
            precip1h: latestValue(o, 'precipitation1h'),
            maxTemp: latestValue(o, 'maxTemp'),
            minTemp: latestValue(o, 'minTemp')
          };
        }
      }
      return null;
    });
  }

  // ---------- 予報の読み取り ----------
  function findArea(ts, code) {
    if (!ts || !ts.areas) return null;
    for (var i = 0; i < ts.areas.length; i++) {
      if (ts.areas[i].area && ts.areas[i].area.code === code) return ts.areas[i];
    }
    return null;
  }

  /** 読み込んだ JSON 群を、画面用の形（app.js の説明を参照）にまとめる */
  function build(ctx, fc, vpfd, obs, humObs, now) {
    var today = ymdJst(now);
    var b0 = fc[0] || {};
    var b1 = fc[1] || null;
    var ts0 = (b0.timeSeries || [])[0];
    var ts1 = (b0.timeSeries || [])[1];
    var ts2 = (b0.timeSeries || [])[2];

    var a0 = findArea(ts0, ctx.class10);
    var a1 = findArea(ts1, ctx.class10);
    var a2 = findArea(ts2, ctx.point);
    if (!a0) throw new Error('予報区 ' + ctx.class10 + ' が府県天気予報に見つかりません');

    var days = {};
    function day(date) {
      if (!days[date]) {
        days[date] = {
          date: date, code: null, label: '', icon: 'i-cloud', text: null,
          hi: null, lo: null, hiRange: null, loRange: null, hiObserved: false, loObserved: false,
          pop: null, popBlocks: null, windText: null, wave: null, reliability: null,
          rain: null, uv: null, windMax: null, windMaxDir: '',
          normalHi: null, normalLo: null,
          sunrise: sunEvent(date, ctx.lat, ctx.lon, true),
          sunset: sunEvent(date, ctx.lat, ctx.lon, false)
        };
      }
      return days[date];
    }

    // 今日〜明後日：天気・風・波
    (ts0.timeDefines || []).forEach(function (t, i) {
      var d = day(t.slice(0, 10));
      var code = a0.weatherCodes && a0.weatherCodes[i];
      if (code) {
        var tp = telop(code);
        d.code = code; d.label = tp.label; d.icon = tp.look[0];
      }
      if (a0.weathers && a0.weathers[i]) d.text = tidy(a0.weathers[i]);
      if (a0.winds && a0.winds[i]) d.windText = tidy(a0.winds[i]);
      if (a0.waves && a0.waves[i]) d.wave = tidy(a0.waves[i]);
    });

    // 6時間ごとの降水確率
    var popByBlock = {};
    if (a1) {
      (ts1.timeDefines || []).forEach(function (t, i) {
        var p = num(a1.pops && a1.pops[i]);
        if (p === null) return;
        var date = t.slice(0, 10), h = +t.slice(11, 13);
        popByBlock[date + 'T' + pad2(h)] = p;
        var d = day(date);
        d.popBlocks = d.popBlocks || [];
        d.popBlocks.push({ h: h, pop: p });
        d.pop = d.pop === null ? p : Math.max(d.pop, p);
      });
    }

    // 最高・最低気温（0時 → 朝の最低、9時 → 日中の最高）
    if (a2) {
      (ts2.timeDefines || []).forEach(function (t, i) {
        var v = num(a2.temps && a2.temps[i]);
        if (v === null) return;
        var d = day(t.slice(0, 10));
        if (t.slice(11, 13) === '00') d.lo = v; else d.hi = v;
      });
    }

    // 週間予報
    if (b1 && ctx.week) {
      var w0 = findArea((b1.timeSeries || [])[0], ctx.week.code);
      var w1 = findArea((b1.timeSeries || [])[1], ctx.week.point);
      if (w0) {
        (b1.timeSeries[0].timeDefines || []).forEach(function (t, i) {
          var d = day(t.slice(0, 10));
          var code = w0.weatherCodes && w0.weatherCodes[i];
          if (!d.code && code) {
            var tp = telop(code);
            d.code = code; d.label = tp.label; d.icon = tp.look[0];
          }
          var p = num(w0.pops && w0.pops[i]);
          if (d.pop === null && p !== null) d.pop = p;
          if (w0.reliabilities && w0.reliabilities[i]) d.reliability = w0.reliabilities[i];
        });
      }
      if (w1) {
        (b1.timeSeries[1].timeDefines || []).forEach(function (t, i) {
          var d = day(t.slice(0, 10));
          var hi = num(w1.tempsMax && w1.tempsMax[i]);
          var lo = num(w1.tempsMin && w1.tempsMin[i]);
          if (d.hi === null && hi !== null) d.hi = hi;
          if (d.lo === null && lo !== null) d.lo = lo;
          var hu = num(w1.tempsMaxUpper && w1.tempsMaxUpper[i]), hl = num(w1.tempsMaxLower && w1.tempsMaxLower[i]);
          var lu = num(w1.tempsMinUpper && w1.tempsMinUpper[i]), ll = num(w1.tempsMinLower && w1.tempsMinLower[i]);
          if (hu !== null && hl !== null) d.hiRange = [hl, hu];
          if (lu !== null && ll !== null) d.loRange = [ll, lu];
        });
      }
      var avg = b1.tempAverage && findArea(b1.tempAverage, ctx.week.point);
      if (avg) {
        Object.keys(days).forEach(function (k) {
          days[k].normalHi = num(avg.max);
          days[k].normalLo = num(avg.min);
        });
      }
    }

    // 3時間ごと（地域時系列予報）
    var slots = [];
    if (vpfd && vpfd.areaTimeSeries) {
      var at = vpfd.areaTimeSeries, pt = vpfd.pointTimeSeries || {};
      var tempAt = {};
      (pt.timeDefines || []).forEach(function (t, i) {
        tempAt[t.dateTime] = num(pt.temperature && pt.temperature[i]);
        // 最高・最低の欄が埋まっていれば、日ごとの気温の足りない所を補う
        var d = day(t.dateTime.slice(0, 10));
        var mx = num(pt.maxTemperature && pt.maxTemperature[i]);
        var mn = num(pt.minTemperature && pt.minTemperature[i]);
        if (d.hi === null && mx !== null) d.hi = mx;
        if (d.lo === null && mn !== null) d.lo = mn;
      });
      (at.timeDefines || []).forEach(function (t, i) {
        var time = parseTime(t.dateTime);
        if (!time) return;
        var date = t.dateTime.slice(0, 10), h = +t.dateTime.slice(11, 13);
        var dd = day(date);
        var isDay = dd.sunrise && dd.sunset ? (time >= dd.sunrise && time < dd.sunset) : (h >= 6 && h < 18);
        var label = (at.weather && at.weather[i]) || '';
        var lk = looks(label);
        var w = (at.wind && at.wind[i]) || {};
        var range = w.range ? String(w.range).split(/\s+/) : null;
        var blockKey = date + 'T' + pad2(Math.floor(h / 6) * 6);
        slots.push({
          time: time,
          key: date + 'T' + pad2(h) + ':00',
          label: label,
          icon: lk[isDay ? 0 : 1],
          bg: lk[2],
          temp: tempAt[t.dateTime] !== undefined ? tempAt[t.dateTime] : null,
          pop: popByBlock[blockKey] !== undefined ? popByBlock[blockKey] : null,
          popBlock: blockKey,
          rain: null,
          wind: null,
          windRange: range && range.length === 2 ? range[0] + '〜' + range[1] : null,
          windDir: w.direction || ''
        });
      });
    }

    // いま
    var cur = null;
    for (var s = 0; s < slots.length; s++) {
      if (slots[s].time <= now && now < new Date(slots[s].time.getTime() + 3 * HOUR)) { cur = slots[s]; break; }
    }
    if (!cur && slots.length) cur = slots[0];

    var d0 = day(today);
    var nowLabel = cur ? cur.label : d0.label;
    var nowLook = looks(nowLabel);
    var isDayNow = d0.sunrise && d0.sunset ? (now >= d0.sunrise && now < d0.sunset) : (hourJst(now) >= 6 && hourJst(now) < 18);
    // 実際に降っていれば、予報より観測を優先して「雨」にする
    var raining = obs && ((obs.precip10m !== null && obs.precip10m > 0) || (obs.precip1h !== null && obs.precip1h >= 0.5));
    if (raining && nowLook[2] !== 'rain' && nowLook[2] !== 'snow' && nowLook[2] !== 'storm') {
      nowLabel = '雨';
      nowLook = looks('雨');
    }

    var humidity = obs ? obs.humidity : null;
    if (humidity === null && humObs) humidity = humObs.humidity;
    var temp = obs ? obs.temp : (cur ? cur.temp : null);

    // 今日の最高・最低が発表済みの時間を過ぎていたら、観測値で補う
    if (obs) {
      if (d0.hi === null && obs.maxTemp !== null) { d0.hi = obs.maxTemp; d0.hiObserved = true; }
      if (d0.lo === null && obs.minTemp !== null) { d0.lo = obs.minTemp; d0.loObserved = true; }
    }

    var nowBlock = today + 'T' + pad2(Math.floor(hourJst(now) / 6) * 6);
    var list = Object.keys(days).sort().filter(function (k) { return k >= today && days[k].code; })
      .slice(0, 8).map(function (k) { return days[k]; });

    var report = parseTime(b0.reportDatetime || '');
    var reportText = report
      ? (new Date(report.getTime() + TZ * HOUR).getUTCDate()) + '日' + hourJst(report) + '時発表'
      : '';
    var obsText = obs && ctx.station
      ? ctx.station.name + '観測所 ' + pad2(hourJst(obs.at)) + ':' + pad2(new Date(obs.at.getTime() + TZ * HOUR).getUTCMinutes())
      : '';

    return {
      source: 'jma',
      sourceName: '気象庁',
      reportAt: report,
      areaName: ctx.class10Name,
      step: 3,
      now: {
        temp: temp,
        feels: obs ? feelsLike(obs.temp, humidity, obs.wind) : null,
        humidity: humidity,
        wind: obs ? obs.wind : null,
        windDir: obs ? obs.windDir : '',
        pop: popByBlock[nowBlock] !== undefined ? popByBlock[nowBlock] : (cur ? cur.pop : null),
        label: nowLabel,
        icon: nowLook[isDayNow ? 0 : 1],
        bg: nowLook[2],
        observedAt: obs ? obs.at : null,
        observed: !!obs
      },
      slots: slots,
      days: list,
      credit: {
        short: '出典：気象庁',
        lines: [
          { k: '出典', text: '気象庁ホームページ（天気予報・地域時系列予報・週間天気予報・アメダス）を加工して作成', href: 'https://www.jma.go.jp/bosai/forecast/' }
        ],
        note: [
          ctx.class10Name ? ctx.class10Name + 'の予報（' + reportText + '）' : '',
          obsText ? 'いまの気温・湿度・風は' + obsText + ' の実測' : '',
          '体感温度と日の出入りは計算値'
        ].filter(Boolean).join('　・　')
      }
    };
  }

  /** 地点の天気をまとめて取ってくる。日本の外なら null */
  function load(place, now) {
    now = now || new Date();
    return resolve(place.lat, place.lon).then(function (ctx) {
      if (!ctx) return null;
      return Promise.all([
        getJSON(BASE + 'forecast/data/forecast/' + ctx.office + '.json'),
        getJSON(BASE + 'jmatile/data/wdist/VPFD/' + ctx.class10 + '.json').catch(function () { return null; }),
        getText(BASE + 'amedas/data/latest_time.txt').catch(function () { return ''; })
      ]).then(function (res) {
        var latest = res[2];
        return Promise.all([
          ctx.station ? fetchObs(ctx.station.code, latest).catch(function () { return null; }) : null,
          ctx.humStation ? fetchObs(ctx.humStation.code, latest).catch(function () { return null; }) : null
        ]).then(function (o) {
          var wx = build(ctx, res[0], res[1], o[0], o[1], now);
          wx.area = ctx;
          return wx;
        });
      });
    });
  }

  var api = {
    load: load,
    resolve: resolve,
    build: build,
    telop: telop,
    looks: looks,
    sunEvent: sunEvent,
    feelsLike: feelsLike,
    inJapanBox: inJapanBox
  };

  root.JMA = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
