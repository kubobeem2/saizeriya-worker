# saizeriya-worker

サイゼリヤのモバイルオーダー用 CLI（[pnsk-lab/saizeriya](https://github.com/pnsk-lab/saizeriya) の
`saizeriya.js` CLI）を **Cloudflare Workers** に移植したもの。API と Web UI を同梱している。

> 非公式の個人プロジェクトです。サイゼリヤ公式とは関係ありません。

> English: An unofficial port of the Saizeriya mobile-order CLI to Cloudflare
> Workers. It exposes the CLI commands as a REST API and ships a small Web UI
> (`/ui`) to start a session from a table QR code, search the menu, order, and
> check the bill. MIT licensed; the client core is vendored from
> [pnsk-lab/saizeriya](https://github.com/pnsk-lab/saizeriya).

ターミナル CLI はセッションをローカルファイル（`~/.saizeriya-cli/sessions.json`）に保存し、
対話 REPL で動くため Workers では動かない。そこでクライアント本体
（fetch + `node-html-parser` のみで動く部分）を同梱し、CLI コマンドを HTTP API にした。

## できること

- **Web UI**（`/ui`）: QR からセッション開始、メニュー検索、カート追加、注文送信、会計・レシート確認、店員呼び出し
- **API**: CLI コマンド一式を REST で
  - `POST /sessions` セッション開始（`{name?, qrURL, people?}`）
  - `GET /sessions` / `GET /sessions/:name` / `DELETE /sessions/:name`
  - `POST /sessions/:name/cmd` `{command, ...}`、または `/sessions/:name/<command>` 専用サブルート
  - コマンド: `state` `people` `lookup` `add` `remove` `cart` `cart-page` `submit` `account` `receipt` `call` `history` `menu-page` `reorder` `alcohol` `check`
  - `GET /menu?q=<query>` 静的メニュー検索、`GET /menu/:code?shop=<id>&table=<id>` 公式 lookup
  - `GET /` 使い方（JSON）。ブラウザで開くと `/ui` へ

使用例:

```bash
curl -X POST "$BASE/sessions" -H 'content-type: application/json' \
  -d '{"name":"table1","qrURL":"<テーブルのQR URL>","people":2}'
curl -X POST "$BASE/sessions/table1/add" -d '{"code":"1202","count":2}'
curl -X POST "$BASE/sessions/table1/submit" -d '{}'
curl -X POST "$BASE/sessions/table1/account" -d '{}'
```

## セッション保存

- `SESSIONS` KV を bind すると KV に保存（`wrangler.jsonc` 参照）
- KV なしの場合は isolate 内メモリ＋各レスポンスの `snapshot` を次回 body に渡す方式

## 認証

`API_KEY` secret を設定すると `GET /` と `/ui` 以外は `x-api-key` ヘッダー必須になる。
注文できる API を無防備に公開しないこと。Web UI からもキーを入力できる。

```bash
bunx wrangler secret put API_KEY
```

## Deploy

```bash
bun install
bunx wrangler login
bunx wrangler kv namespace create SESSIONS   # KV を使う場合。id を wrangler.jsonc へ
bun run deploy
```

## 開発

```bash
bun run dev    # wrangler dev
bun run test   # モックサーバ相手のフル注文フロー + Web UI のテスト
```

## CLI との差分

- `--browser` モード（Playwright）は未移植。fetch モードのみ
- `order-time` はライブラリが実行環境のローカル時刻で生成するため、Workers では UTC 表記になる

## クレジット / ライセンス

クライアント本体・メニューデータ・モックサーバは
[pnsk-lab/saizeriya](https://github.com/pnsk-lab/saizeriya)（MIT License, Copyright (c) 2026 Shotaro Nakamura）
から同梱したもの。ライセンス全文は `LICENSE` を参照。
