# SwitchBot の中継役をつくる（Cloudflare Workers 版）

時計アプリに室温・湿度を出すための、小さな中継プログラムです。
**15分ほど**で終わります。費用はかかりません（無料枠の範囲です）。

> **Vercel を使っている場合は、こちらではなく
> [メインの README](../README.md#室温湿度を出すswitchbot) の手順が簡単です。**
> このリポジトリをそのまま Vercel に置くだけで、時計と中継役が同時に動きます
> （中継役は [`api/switchbot.js`](../api/switchbot.js) に入っています）。

## なぜ必要なの？

SwitchBot の API は、**ブラウザから直接読むことができません**。
よそのサイトからの読み取りを許可する印（CORS ヘッダ）を返してくれないので、
Chrome が安全のために通信を止めてしまいます。

もうひとつ、SwitchBot のトークン（合鍵のようなもの）を
ブラウザ側に置くと、GitHub Pages のような公開ページでは
他人に見られてしまう恐れがあります。

そこで **間に中継役を1つ置きます**。

```
Echo Show の Chrome  →  中継役（Cloudflare）  →  SwitchBot
                        ここにトークンを置く
     温度と湿度だけ受け取る
```

トークンは Cloudflare 側に置いたままになり、ブラウザには数字だけが渡ります。

---

## 手順1：SwitchBot のトークンを取る

1. スマホの **SwitchBot アプリ** を開く
2. 右下の **プロフィール** → **設定**
3. **アプリバージョン** を **10回** 続けてタップする
   （開発者向けオプションが出てきます）
4. **開発者向けオプション** を開く
5. **トークン** と **クライアントシークレット** の2つをコピーしておく

> この2つは合鍵です。人に見せたり、チャットに貼ったりしないでください。

あわせて、**温湿度計が SwitchBot アプリに追加済みで、
ハブ（Hub Mini / Hub 2 など）とつながっている**ことを確認してください。
ハブ経由でないと、外部から値を読むことができません。

---

## 手順2：Cloudflare で Worker をつくる

1. <https://dash.cloudflare.com/> にアクセスし、アカウントを作る（無料）
2. 左メニューの **Compute (Workers)** → **Create** → **Start with Hello World!**
3. 名前を `switchbot` などにして **Deploy**
4. できたら **Edit code**（コードを編集）を開く
5. 出てきたコードを**全部消して**、このフォルダの
   [`worker.js`](worker.js) の中身を**そのまま貼り付ける**
6. 右上の **Deploy** を押す

---

## 手順3：トークンを Worker に登録する

コードに直接書かず、Cloudflare の金庫に入れます。

1. Worker の画面で **Settings**（設定）→ **Variables and Secrets**
2. **Add** を押して、次の2つを **Secret**（種類は Secret）として登録する

   | 名前 | 中身 |
   |------|------|
   | `SWITCHBOT_TOKEN` | 手順1のトークン |
   | `SWITCHBOT_SECRET` | 手順1のクライアントシークレット |

3. **Deploy**（保存）を押す

---

## 手順4：動くか確かめる

Worker の URL（`https://switchbot.〇〇〇.workers.dev/` のような形）を
ブラウザで開きます。こう出れば成功です。

```json
{
  "name": "室内",
  "temperature": 24.3,
  "humidity": 52,
  "battery": 96,
  "deviceId": "XXXXXXXXXXXX",
  "deviceType": "Meter",
  "time": "2026-09-12T09:00:00.000Z"
}
```

### 温湿度計が複数ある / うまく選ばれないとき

URL のうしろに `?list=1` を付けると、手持ちの機器の一覧が出ます。

```
https://switchbot.〇〇〇.workers.dev/?list=1
```

`"温湿度計": true` になっているものの `deviceId` をコピーして、
手順3と同じ場所に **`SWITCHBOT_DEVICE_ID`** という名前で登録してください
（これは Secret でなく Text でも構いません）。

表示名を変えたいときは **`SWITCHBOT_DEVICE_NAME`** に `リビング` などを入れます。

---

## 手順5：時計アプリに登録する

1. 時計アプリを開く
2. 1枚目の画面で、地名（東京など）のボタンを押して設定を開く
3. **室温・湿度（SwitchBot）** の欄に、Worker の URL を貼り付ける
4. **保存** を押す

「取得できました：室内 24.3° 52%」と出れば完了です。
時計の下と、アナログ時計の右下に室温が出ます。

---

## 任意：URL を知られても読まれないようにする

Worker の URL を知っている人なら誰でも、あなたの部屋の温度を見られます。
気になる場合は、合言葉をかけられます。

1. 手順3と同じ場所に **`ACCESS_KEY`** という名前で、好きな文字列を登録する
2. 時計アプリに入れる URL を `https://switchbot.〇〇〇.workers.dev/?key=好きな文字列` にする

読み取れるページを限定したい場合は、**`ALLOW_ORIGIN`** に
`https://kloop123456789.github.io` を登録してください。

---

## うまくいかないとき

| 出てくるもの | 原因と対処 |
|---|---|
| `statusCode 401` | トークンかシークレットが違う。手順3をやり直す |
| `statusCode 161` | 機器がオフライン。電池とハブとの距離を確認する |
| `statusCode 171` | ハブがオフライン。ハブの電源と Wi-Fi を確認する |
| `温湿度計が見つかりませんでした` | `?list=1` で ID を調べ、`SWITCHBOT_DEVICE_ID` を登録する |
| 時計アプリ側で「取得できません」 | URL の打ち間違い。末尾のスラッシュ有無も確認する |
| 時計アプリ側で何も出ない | 中継URLが未設定。手順5を確認する |

SwitchBot API は **1日1万回** まで呼べます。
このアプリは5分おき（1日約288回）なので、余裕があります。

---

## コマンドで入れたい人向け

`wrangler`（Cloudflare のコマンドツール）を使う場合は、このフォルダで:

```bash
npx wrangler secret put SWITCHBOT_TOKEN
```

```bash
npx wrangler secret put SWITCHBOT_SECRET
```

```bash
npx wrangler deploy
```
