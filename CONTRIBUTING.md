# Contributing

開発参加歓迎。非公式プロジェクトなので、サイゼリヤ公式への問い合わせはしないこと。

## セットアップ

```bash
bun install
bun run test   # モックサーバ相手のテスト（実店舗のQRは不要）
bun run dev    # wrangler dev でローカル起動
```

## 方針

- クライアント本体は `src/lib/client/`、静的メニューは `src/data/menu.json`。
  元は [pnsk-lab/saizeriya](https://github.com/pnsk-lab/saizeriya)（MIT）から同梱したもの。
  上流の修正を取り込む場合は出所が分かるようにコミットメッセージに書くこと。
- Worker 本体は `src/index.ts`、Web UI は `src/ui.ts`（ビルド不要の単一HTML）。
- 実店舗のセッション情報・QR URL・トークン類をコードやテストに含めないこと。
- PR では `bun run test` が通ることを確認してから出すこと。
