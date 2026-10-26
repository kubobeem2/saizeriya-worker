# saizeriya-worker

サイゼリヤのモバイルオーダー用 CLI（[pnsk-lab/saizeriya](https://github.com/pnsk-lab/saizeriya) の
`saizeriya.js` CLI）を **Cloudflare Workers** に移植したもの。
Web UI は上流に同梱の **Betterzeriya** そのもので、API も2系統ある。

> 非公式の個人プロジェクトです。サイゼリヤ公式とは関係ありません。

> English: An unofficial port of the Saizeriya mobile-order CLI to Cloudflare
> Workers, with the upstream Betterzeriya web UI (served as a SPA) and its
> `/api/*` contract implemented on the Worker, plus a CLI-style REST API.
> MIT licensed; the client core and the UI are vendored from
> [pnsk-lab/saizeriya](https://github.com/pnsk-lab/saizeriya).

ターミナル CLI はセッションをローカルファイルに保存し対話 REPL で動くため
Workers では動かない。そこでクライアント本体（fetch + `node-html-parser`
のみ）を同梱し、Worker 上で API 化した。

> 使い方まとめページ: デプロイ先の **`/docs`** に Web UI / MCP / API の説明とリンクがあります（この README が原典）。

## 免責・利用上の注意

- **非公式プロジェクトです。** 株式会社サイゼリヤおよびその関係会社とは一切関係がなく、公式の承認・推奨を受けたものではありません。「サイゼリヤ」等の商標は各権利者に帰属します。
- **利用は自己責任です。** 本ソフトウェアの利用により生じた損害・トラブルについて、作者は一切の責任を負いません（`LICENSE` の無保証条項も参照）。
- **公式サービスの利用規約に従ってください。** 本ソフトウェアは公式モバイルオーダーの非公式クライアントであり、その利用が公式の利用規約に抵触する可能性があります。提供元から停止・削除等の要請があった場合は速やかに従います。規約の確認は利用者自身で行ってください。
- **自分のテーブルの QR のみ使ってください。** 他人のテーブルへの注文、いたずら注文、店舗の業務を妨げる行為は絶対にしないでください。
- **本番モードの注文は本物です。** 本番モードで送信した注文は実際に調理され、会計の対象になります。送信前に注文内容・テーブル・金額を必ず確認してください。ドライランでは注文は送信されません。
- **表示情報の正確性は保証しません。** メニュー・価格・在庫等の情報は公式システムに依存しており、内容の正確性・最新性は保証しません。商品画像等の著作権は各権利者に帰属します。
- **MCP / API の悪用禁止。** 公開する MCP サーバ・HTTP API を、他者への迷惑行為や店舗への不正な注文に使わないでください。

English summary: Unofficial project, not affiliated with Saizeriya. Use at
your own risk; no warranty. Follow the official service's terms — this is an
unofficial client and its use may conflict with them. Only use the QR code
for your own table; never place prank or fraudulent orders. In real mode
orders are actually sent and billed — double-check before submitting.

## Web UI（Betterzeriya）

- `web/` が Betterzeriya 本体。SPA としてビルドし（adapter-static、
  `ssr = false` に変更）、Worker の静的アセットとして `/` から配信する
- 画面: QR スキャン/画像から読み取り/URL 入力 → 人数 → メニュー（画像・
  検索・ガチャ等）→ 注文 → 会計・レシート、端末名つきの「誰が何を
  注文したか」表示、AI ページ（WebLLM、ブラウザ内動作）
- `/ui` は `/` へのリダイレクト

### MCP サーバ（`/mcp`）

AI クライアントから注文フローを操作できる MCP（Model Context Protocol、
streamable HTTP）サーバも同梱している。接続先は
`https://<your-domain>/mcp`。

ツール: `menu_search` / `menu_item` / `create_session` /
`get_session_state` / `set_people_count` / `set_device_name` /
`lookup_item` / `submit_order` / `get_account` / `get_receipt` /
`call_staff`

- `create_session` は `mode`（`real` / `dry`）が必須。本番モードは
  実際に注文が飛ぶので注意。モードはセッション ID の接頭辞
  （`dry-…` / `real-…`）に埋め込まれ、途中で切り替わらない
- セッション系ツールは Web UI と同じく `official_session`
  スナップショットを持ち回る方式
- `API_KEY` シークレットを設定した場合は `/mcp` にも同じキーを要求する

### モード選択（本番 / ドライラン）

- 初回アクセス時は `/mode` の選択画面に誘導される。**本番**は公式に
  接続して実際に注文する。**ドライラン**は同梱のモックサーバ相手に
  全フロー（注文・会計まで）を試す練習モードで、実際の注文は送信
  されない
- 選択は `sz_mode` クッキーに保存され、画面上部に常時バナーが出る。
  `/mode` からいつでも切り替え可能。CLI 互換 API も同じクッキーで
  切り替わる

Betterzeriya が叩く API は上流 `betterzeriya-server` の契約を移植:

- `POST /api/sessions` `{qrURLSource}` → `{id, state, officialSession}`
- `POST /api/sessions/:id` 状態リフレッシュ
- `POST /api/sessions/:id/people` / `name` / `lookup` / `submit` / `account` / `receipt` / `call`
- セッションはフロントが localStorage に持つ `officialSession`
  （state + 公式クッキー + roomHash）を毎回 POST する方式。上流と同じく
  スナップショットの所持が権限になる
- 部屋モデル（端末名・注文者表示）は roomHash（QR URL の SHA-256）単位で
  KV `SESSIONS`（なければメモリ）に 24 時間保持

## CLI 互換 API

- `POST /sessions` `{name?, qrURL, people?}` セッション開始
- `GET /sessions` / `GET /sessions/:name` / `DELETE /sessions/:name`
- `POST /sessions/:name/cmd` `{command, ...}`、または `/sessions/:name/<command>`
  - コマンド: `state` `people` `lookup` `add` `remove` `cart` `cart-page`
    `submit` `account` `receipt` `call` `history` `menu-page` `reorder`
    `alcohol` `check`
- `GET /menu?q=<query>` 静的メニュー検索、`GET /menu/:code?shop=<id>&table=<id>` 公式 lookup
- `GET /` 使い方（JSON、ブラウザでは UI）

使用例:

```bash
curl -X POST "$BASE/sessions" -H 'content-type: application/json' \
  -d '{"name":"table1","qrURL":"<テーブルのQR URL>","people":2}'
curl -X POST "$BASE/sessions/table1/add" -d '{"code":"1202","count":2}'
curl -X POST "$BASE/sessions/table1/submit" -d '{}'
curl -X POST "$BASE/sessions/table1/account" -d '{}'
```

## セッション保存（CLI 互換 API 側）

- `SESSIONS` KV を bind すると KV に保存（`wrangler.jsonc` 参照）
- KV なしの場合は isolate 内メモリ＋各レスポンスの `snapshot` を次回 body に
  渡す方式

## 認証

`API_KEY` secret を設定すると CLI 互換 API（`/sessions`、`/menu`）で
`x-api-key` ヘッダーが必須になる。Betterzeriya の `/api/*` は対象外。

```bash
bunx wrangler secret put API_KEY
```

## Deploy

```bash
bun install
bun run build:web           # Betterzeriya を web/build/ にビルド
bunx wrangler login
bunx wrangler kv namespace create SESSIONS   # KV を使う場合。id を wrangler.jsonc へ
bun run deploy
```

## 開発

```bash
bun run build:web
bun run dev    # wrangler dev（UI + API 一体）
bun run test   # モックサーバ相手に CLI API と /api/* の注文フロー + SPA 配信をテスト
```

## CLI との差分

- `--browser` モード（Playwright）は未移植。fetch モードのみ
- `order-time` はライブラリが実行環境のローカル時刻で生成するため、Workers では UTC 表記になる

## クレジット / ライセンス

クライアント本体・メニューデータ・モックサーバ・Betterzeriya は
[pnsk-lab/saizeriya](https://github.com/pnsk-lab/saizeriya)（MIT License, Copyright (c) 2026 Shotaro Nakamura）
から同梱したもの。ライセンス全文は `LICENSE` を参照。
