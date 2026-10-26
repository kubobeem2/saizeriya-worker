/**
 * Human-readable docs page at /docs: what this site is, plus how to use
 * the MCP server (/mcp) and the HTTP APIs (/api/* and the CLI-style API).
 * Linked from the mode chooser footer and the SPA's About dialog.
 */

const DOCS_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>使い方・MCP / API | saizeriya-worker</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 720px; padding: 24px 16px 48px; line-height: 1.7; font-size: 14px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 32px 0 8px; padding-top: 16px; border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
  h3 { font-size: 15px; margin: 18px 0 6px; }
  p { margin: 0 0 10px; }
  .lead { opacity: .8; }
  a { color: inherit; font-weight: 700; }
  code { font-family: ui-monospace, monospace; font-size: 12.5px; background: color-mix(in srgb, currentColor 10%, transparent); padding: 1px 5px; border-radius: 4px; word-break: break-all; }
  pre { background: color-mix(in srgb, currentColor 8%, transparent); border-radius: 10px; padding: 12px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 13px; }
  th, td { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: color-mix(in srgb, currentColor 8%, transparent); }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: #0a7d3b; color: #fff; vertical-align: 2px; }
  .badge.warn { background: #b45309; }
  nav.toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; }
  nav.toc a { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 999px; padding: 4px 12px; text-decoration: none; font-size: 13px; }
  footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent); font-size: 13px; opacity: .9; }
</style>
</head>
<body>
<h1>saizeriya-worker の使い方</h1>
<p class="lead">サイゼリヤのモバイルオーダーをブラウザから使うための<strong>非公式の個人プロジェクト</strong>です（サイゼリヤ公式とは関係ありません）。モバイルオーダー用 CLI を Cloudflare Workers に移植したもので、Web UI のほかに <strong>MCP サーバ</strong>と <strong>HTTP API</strong>も公開しています。</p>

<nav class="toc">
  <a href="#web">Web UI</a>
  <a href="#mcp">MCP サーバ</a>
  <a href="#api">HTTP API</a>
  <a href="#github">GitHub / ソース</a>
</nav>

<h2 id="web">Web UI（通常の使い方）</h2>
<p>トップページでモード（本番 / ドライラン）を選び、店内テーブルの QR を読み取るだけです。メニューの閲覧・注文・会計・レシート表示までブラウザで完結します。<span class="badge">本番</span> は注文が実際にキッチンへ届き、<span class="badge warn">ドライラン</span> はモック相手の練習モードで注文は送信されません。</p>
<p><a href="/mode">モード選択へ</a> ／ <a href="/">トップページへ</a></p>

<h2 id="mcp">MCP サーバ（AI クライアント向け）</h2>
<p>AI クライアント（Claude 等）から注文フローを操作できる MCP（Model Context Protocol、streamable HTTP）サーバを同梱しています。</p>
<table>
  <tr><th>接続先</th><td><code>https://saizeria.kubobeem.tech/mcp</code></td></tr>
  <tr><th>transport</th><td>streamable HTTP（<code>POST /mcp</code> に JSON-RPC）</td></tr>
  <tr><th>認証</th><td>現在は鍵なしで公開しています</td></tr>
</table>
<h3>接続設定の例</h3>
<pre><code>{
  "mcpServers": {
    "saizeriya": {
      "url": "https://saizeria.kubobeem.tech/mcp"
    }
  }
}</code></pre>
<h3>ツール一覧（11個）</h3>
<table>
  <tr><th>ツール</th><th>説明</th></tr>
  <tr><td><code>menu_search</code></td><td>メニューをキーワード検索</td></tr>
  <tr><td><code>menu_item</code></td><td>4桁コードでメニュー詳細を引く</td></tr>
  <tr><td><code>create_session</code></td><td>セッション開始。<code>mode</code>（<code>real</code> / <code>dry</code>）必須。まず <code>dry</code> で試すのがおすすめ</td></tr>
  <tr><td><code>get_session_state</code></td><td>現在の状態（カート・人数など）を取得</td></tr>
  <tr><td><code>set_people_count</code></td><td>人数を設定</td></tr>
  <tr><td><code>set_device_name</code></td><td>端末名を設定（誰が注文したか表示される）</td></tr>
  <tr><td><code>lookup_item</code></td><td>公式側で商品を照会</td></tr>
  <tr><td><code>submit_order</code></td><td>注文を送信。<span class="badge">本番</span> モードでは実際に届くので注意</td></tr>
  <tr><td><code>get_account</code></td><td>会計情報を取得</td></tr>
  <tr><td><code>get_receipt</code></td><td>レシートを取得</td></tr>
  <tr><td><code>call_staff</code></td><td>店員を呼ぶ</td></tr>
</table>
<p>セッション ID にはモードが埋め込まれ（<code>dry-…</code> / <code>real-…</code>）、途中で切り替わりません。セッション系ツールは Web UI と同じくスナップショットを持ち回る方式です。</p>

<h2 id="api">HTTP API</h2>
<h3>Betterzeriya API（Web UI が使う <code>/api/*</code>）</h3>
<table>
  <tr><th>エンドポイント</th><th>説明</th></tr>
  <tr><td><code>POST /api/sessions</code></td><td><code>{qrURLSource}</code> → セッション作成 <code>{id, state, officialSession}</code></td></tr>
  <tr><td><code>POST /api/sessions/:id</code></td><td>状態リフレッシュ</td></tr>
  <tr><td><code>POST /api/sessions/:id/people</code> / <code>name</code> / <code>lookup</code> / <code>submit</code> / <code>account</code> / <code>receipt</code> / <code>call</code></td><td>人数・端末名・照会・注文送信・会計・レシート・店員呼び出し</td></tr>
  <tr><td><code>GET /api/config</code></td><td>現在のモード（<code>real</code> / <code>dry</code>）を返す</td></tr>
</table>
<p>セッションはフロントが localStorage に持つ <code>officialSession</code> を毎回 POST する方式で、スナップショットの所持が権限になります。</p>
<h3>CLI 互換 API</h3>
<table>
  <tr><th>エンドポイント</th><th>説明</th></tr>
  <tr><td><code>POST /sessions</code></td><td><code>{name?, qrURL, people?}</code> セッション開始</td></tr>
  <tr><td><code>GET /sessions</code> / <code>GET /sessions/:name</code> / <code>DELETE /sessions/:name</code></td><td>一覧・状態・削除</td></tr>
  <tr><td><code>POST /sessions/:name/cmd</code> または <code>/sessions/:name/&lt;command&gt;</code></td><td>コマンド実行: <code>people</code> <code>lookup</code> <code>add</code> <code>remove</code> <code>cart</code> <code>submit</code> <code>account</code> <code>receipt</code> <code>call</code> <code>history</code> <code>reorder</code> など</td></tr>
  <tr><td><code>GET /menu?q=&lt;query&gt;</code></td><td>静的メニュー検索</td></tr>
  <tr><td><code>GET /menu/:code?shop=&lt;id&gt;&amp;table=&lt;id&gt;</code></td><td>公式 lookup</td></tr>
  <tr><td><code>GET /</code>（JSON でアクセス時）</td><td>使い方サマリ（HELP）を JSON で返す</td></tr>
</table>
<pre><code>curl -X POST "https://saizeria.kubobeem.tech/sessions" \\
  -H 'content-type: application/json' \\
  -d '{"name":"table1","qrURL":"&lt;テーブルのQR URL&gt;","people":2}'
curl -X POST "https://saizeria.kubobeem.tech/sessions/table1/add" -d '{"code":"1202","count":2}'
curl -X POST "https://saizeria.kubobeem.tech/sessions/table1/submit" -d '{}'</code></pre>
<p>モード（本番 / ドライラン）は Web UI と同じ <code>sz_mode</code> クッキーで切り替わります。<code>API_KEY</code> を設定したデプロイでは CLI 互換 API に <code>x-api-key</code> ヘッダーが必要です（この本番は未設定）。</p>

<h2 id="github">GitHub / ソースコード</h2>
<p>詳細な仕様・デプロイ方法・テストは README にあります。不具合報告や改善提案も GitHub へ。</p>
<ul>
  <li><a href="https://github.com/kubobeem2/saizeriya-worker" target="_blank" rel="noopener noreferrer">kubobeem2/saizeriya-worker（このサイトのソース）</a></li>
  <li><a href="https://github.com/pnsk-lab/saizeriya" target="_blank" rel="noopener noreferrer">pnsk-lab/saizeriya（原作 CLI / Betterzeriya）</a></li>
</ul>

<footer>
  <p>非公式の個人プロジェクトです。サイゼリヤ公式とは関係ありません。ライセンスは MIT（原作分を含む、詳細は GitHub の LICENSE を参照）。</p>
  <p><a href="/">トップページへ戻る</a></p>
</footer>
</body>
</html>
`

export const handleDocsRequest = (path: string): Response | undefined => {
  if (path === '/docs') {
    return new Response(DOCS_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  return undefined
}
