/**
 * Mode selection: real (本番) vs dry-run (ドライラン).
 *
 * The chosen mode is kept in a `sz_mode` cookie. In dry mode every call to
 * the official ordering system is replaced with the bundled mock server,
 * so the whole flow (including checkout) can be tried without placing a
 * real order. The mode also drives a fixed banner injected into the SPA
 * HTML so the current mode is always visible.
 */
export type Mode = 'real' | 'dry'

export const MODE_COOKIE = 'sz_mode'

export const getMode = (request: Request): Mode | undefined => {
  const cookie = request.headers.get('cookie') ?? ''
  for (const part of cookie.split(';')) {
    const [name, value] = part.trim().split('=')
    if (name === MODE_COOKIE) {
      return value === 'dry' ? 'dry' : value === 'real' ? 'real' : undefined
    }
  }
  return undefined
}

const CHOOSER_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>モード選択 | saizeriya-worker</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 640px; padding: 24px 16px; }
  h1 { font-size: 20px; }
  p.lead { opacity: .8; font-size: 14px; line-height: 1.7; }
  a.card { display: block; text-decoration: none; color: inherit; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 12px; padding: 18px; margin: 14px 0; }
  a.card:active { transform: scale(.99); }
  .badge { display: inline-block; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; margin-bottom: 8px; }
  .real .badge { background: #0a7d3b; color: #fff; }
  .dry .badge { background: #b45309; color: #fff; }
  .card h2 { margin: 0 0 6px; font-size: 18px; }
  .card p { margin: 0; font-size: 13px; opacity: .8; line-height: 1.6; }
  .current { font-size: 13px; opacity: .75; }
</style>
</head>
<body>
<h1>どちらのモードで開きますか？</h1>
<p class="lead">このサイトには2つのモードがあります。選択はこのブラウザに保存され、画面上部のバーからいつでも切り替えられます。</p>

<a class="card real" href="/mode/set?m=real">
  <span class="badge">本番</span>
  <h2>実際に注文する</h2>
  <p>公式のモバイルオーダーに接続します。送信した注文は本当にキッチンへ届きます。店内のテーブルの QR を読み取って使ってください。</p>
</a>

<a class="card dry" href="/mode/set?m=dry">
  <span class="badge">ドライラン</span>
  <h2>試すだけ（注文は届きません）</h2>
  <p>モックサーバ相手の練習モードです。QR は店内のものでもダミーでも構いません。注文・会計まで全部試せますが、実際の注文は送信されません。</p>
</a>

<p class="current" id="current"></p>
<script>
  var match = document.cookie.match(/(?:^|; )sz_mode=(real|dry)/)
  if (match) {
    document.getElementById('current').textContent =
      '現在の設定: ' + (match[1] === 'dry' ? 'ドライラン' : '本番') + 'モード'
  }
</script>
</body>
</html>
`

export const handleModeRequest = (request: Request, path: string): Response | undefined => {
  if (path === '/mode') {
    return new Response(CHOOSER_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  if (path === '/mode/set') {
    const mode = new URL(request.url).searchParams.get('m')
    if (mode !== 'real' && mode !== 'dry') {
      return new Response('Invalid mode', { status: 400 })
    }
    return new Response(null, {
      status: 302,
      headers: {
        location: '/',
        'set-cookie': `${MODE_COOKIE}=${mode}; Path=/; Max-Age=2592000; SameSite=Lax`,
      },
    })
  }
  return undefined
}

const bannerHTML = (mode: Mode) =>
  mode === 'dry'
    ? `<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#b45309;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:6px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px"><span>ドライラン実行中 — 実際の注文は送信されません</span><a href="/mode" style="color:#fff;text-decoration:underline;white-space:nowrap">モード切替</a></div><div style="height:31px"></div>`
    : `<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#0a7d3b;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:6px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px"><span>本番モード — 注文は実際に送信されます</span><a href="/mode" style="color:#fff;text-decoration:underline;white-space:nowrap">モード切替</a></div><div style="height:31px"></div>`

/** Insert the fixed mode banner right after <body> (or at the top). */
export const injectModeBanner = (html: string, mode: Mode): string => {
  const banner = bannerHTML(mode)
  if (html.includes('</body>')) {
    return html.replace(/(<body[^>]*>)/i, `$1${banner}`)
  }
  return banner + html
}
