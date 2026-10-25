/**
 * Minimal Web UI for the saizeriya Worker API, served at GET /ui.
 * Plain HTML + vanilla JS, no build step. Talks to the same-origin API.
 * The optional API key is kept in localStorage and sent as `x-api-key`.
 */
export const UI_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>saizeriya-cli Web UI</title>
<style>
  :root { color-scheme: light dark; --accent:#0a7d3b; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 880px; padding: 16px; }
  h1 { font-size: 20px; margin: 4px 0 12px; }
  h2 { font-size: 15px; margin: 0 0 8px; }
  section { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
  label { display: block; font-size: 12px; opacity: .75; margin: 8px 0 2px; }
  input, select { width: 100%; padding: 8px; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; color: inherit; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .row > * { flex: 1; min-width: 120px; }
  button { padding: 8px 12px; border-radius: 6px; border: 0; background: var(--accent); color: #fff; cursor: pointer; }
  button.sub { background: color-mix(in srgb, currentColor 15%, transparent); color: inherit; }
  button.danger { background: #b3261e; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td, th { padding: 4px 6px; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); text-align: left; }
  td.num, th.num { text-align: right; }
  pre { white-space: pre-wrap; word-break: break-all; font-size: 12px; max-height: 260px; overflow: auto; }
  .muted { opacity: .7; font-size: 13px; }
  .item-add { padding: 2px 8px; font-size: 12px; }
</style>
</head>
<body>
<h1>saizeriya-cli Web UI</h1>

<section>
  <h2>接続</h2>
  <label>APIキー（設定している場合のみ）</label>
  <input id="apiKey" type="password" placeholder="x-api-key" autocomplete="off">
</section>

<section>
  <h2>セッション開始（テーブルのQR）</h2>
  <label>QR URL</label>
  <input id="qrURL" type="url" placeholder="https://ioes.saizeriya.co.jp/...">
  <div class="row">
    <div><label>セッション名（任意）</label><input id="sessionName" type="text" placeholder="table1"></div>
    <div><label>人数</label><input id="people" type="number" min="1" max="99" value="2"></div>
  </div>
  <p><button id="startBtn">セッション開始</button></p>
  <div class="row">
    <div>
      <label>セッション一覧</label>
      <select id="sessionList"></select>
    </div>
    <div><label>&nbsp;</label><button class="sub" id="refreshSessionsBtn">一覧を更新</button></div>
    <div><label>&nbsp;</label><button class="sub" id="refreshStateBtn">状態を更新</button></div>
    <div><label>&nbsp;</label><button class="danger" id="deleteSessionBtn">セッション削除</button></div>
  </div>
  <p class="muted" id="stateSummary">セッション未選択</p>
</section>

<section>
  <h2>メニュー検索</h2>
  <div class="row">
    <div><input id="menuQuery" type="text" placeholder="名前 or 4桁コード（例: ティラミス / 3201）"></div>
    <div><button id="menuSearchBtn">検索</button></div>
  </div>
  <table id="menuTable"><thead><tr><th>コード</th><th>名前</th><th class="num">価格</th><th>状態</th><th></th></tr></thead><tbody></tbody></table>
</section>

<section>
  <h2>カート</h2>
  <div class="row">
    <div><label>コードで追加</label><input id="addCode" type="text" inputmode="numeric" placeholder="1202"></div>
    <div><label>個数</label><input id="addCount" type="number" min="1" max="99" value="1"></div>
    <div><label>&nbsp;</label><button id="addBtn">追加</button></div>
  </div>
  <table id="cartTable"><thead><tr><th>#</th><th>コード</th><th>名前</th><th class="num">個数</th><th class="num">価格</th><th></th></tr></thead><tbody></tbody></table>
  <p class="muted" id="cartTotal"></p>
  <div class="row">
    <button id="submitBtn">注文を送信</button>
    <button class="sub" id="accountBtn">会計を確認</button>
    <button class="sub" id="receiptBtn">レシート</button>
    <button class="sub" id="callBtn">店員を呼ぶ</button>
    <button class="sub" id="callDessertBtn">食後に呼ぶ</button>
  </div>
</section>

<section>
  <h2>結果</h2>
  <pre id="log"></pre>
</section>

<script>
var $ = function (id) { return document.getElementById(id) }
var currentState = null

function log(value) {
  $('log').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}
function apiKey() { return $('apiKey').value.trim() }
function headers() {
  var h = { 'content-type': 'application/json' }
  if (apiKey()) h['x-api-key'] = apiKey()
  return h
}
async function api(path, init) {
  var res = await fetch(path, Object.assign({ headers: headers() }, init || {}))
  var body = await res.json().catch(function () { return {} })
  if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status))
  return body
}
function sessionName() { return $('sessionList').value || $('sessionName').value.trim() }
function requireSession() {
  var name = sessionName()
  if (!name) throw new Error('セッションを選んでください')
  return name
}
async function post(path, data) {
  return api(path, { method: 'POST', body: JSON.stringify(data || {}) })
}
function renderState(state) {
  currentState = state
  if (!state) { $('stateSummary').textContent = 'セッション未選択'; renderCart([]); return }
  $('stateSummary').textContent =
    '店 ' + state.shopId + ' / テーブル ' + state.tableNo + ' / ' + state.peopleCount +
    '名 / 画面 ' + state.pageKind + ' / カート ' + state.cart.length + '件'
  renderCart(state.cart)
}
function renderCart(cart) {
  var tbody = $('cartTable').querySelector('tbody')
  tbody.innerHTML = ''
  var total = 0
  cart.forEach(function (item, index) {
    if (item.price) total += item.price * item.count
    var tr = document.createElement('tr')
    tr.innerHTML =
      '<td>' + (index + 1) + '</td><td>' + item.id + '</td><td>' + (item.name || '') +
      '</td><td class="num">' + item.count + '</td><td class="num">' +
      (item.price === undefined ? '' : item.price + '円') + '</td>'
    var td = document.createElement('td')
    var btn = document.createElement('button')
    btn.className = 'sub item-add'
    btn.textContent = '削除'
    btn.onclick = function () { run(function () { return removeItem(index) }) }
    td.appendChild(btn)
    tr.appendChild(td)
    tbody.appendChild(tr)
  })
  $('cartTotal').textContent = cart.length ? 'カート合計（目安）: ' + total + '円' : 'カートは空です'
}
async function refreshSessions() {
  var data = await api('/sessions')
  var select = $('sessionList')
  var current = select.value
  select.innerHTML = ''
  data.sessions.forEach(function (name) {
    var opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    select.appendChild(opt)
  })
  if (data.sessions.indexOf(current) >= 0) select.value = current
  return data.sessions
}
async function refreshState() {
  var name = requireSession()
  var data = await api('/sessions/' + encodeURIComponent(name))
  renderState(data.state)
  return data
}
async function removeItem(index) {
  var name = requireSession()
  var data = await post('/sessions/' + encodeURIComponent(name) + '/remove', { index: index })
  renderState(data.state)
  log(data)
}
function run(fn) {
  fn().catch(function (error) { log('エラー: ' + error.message) })
}

$('apiKey').value = localStorage.getItem('saizeriya-api-key') || ''
$('apiKey').addEventListener('change', function () {
  localStorage.setItem('saizeriya-api-key', apiKey())
})

$('startBtn').onclick = function () {
  run(async function () {
    var data = await post('/sessions', {
      name: $('sessionName').value.trim() || undefined,
      qrURL: $('qrURL').value.trim(),
      people: Number($('people').value) || undefined,
    })
    log(data)
    await refreshSessions()
    $('sessionList').value = data.name
    renderState(data.state)
  })
}
$('refreshSessionsBtn').onclick = function () {
  run(async function () { log(await refreshSessions()) })
}
$('refreshStateBtn').onclick = function () {
  run(async function () { log(await refreshState()) })
}
$('deleteSessionBtn').onclick = function () {
  run(async function () {
    var name = requireSession()
    log(await api('/sessions/' + encodeURIComponent(name), { method: 'DELETE' }))
    renderState(null)
    await refreshSessions()
  })
}
$('sessionList').addEventListener('change', function () {
  run(async function () { await refreshState() })
})
$('menuSearchBtn').onclick = function () {
  run(async function () {
    var q = $('menuQuery').value.trim()
    var data = await api('/menu?q=' + encodeURIComponent(q))
    var tbody = $('menuTable').querySelector('tbody')
    tbody.innerHTML = ''
    data.items.forEach(function (item) {
      var tr = document.createElement('tr')
      tr.innerHTML =
        '<td>' + item.id + '</td><td>' + item.name + '</td><td class="num">' + item.price +
        '円</td><td>' + (item.state === 0 ? '売り切れ' : '注文可') + '</td>'
      var td = document.createElement('td')
      var btn = document.createElement('button')
      btn.className = 'item-add'
      btn.textContent = '追加'
      btn.onclick = function () {
        run(async function () {
          var name = requireSession()
          var added = await post('/sessions/' + encodeURIComponent(name) + '/add', { code: item.id, count: 1 })
          renderState(added.state)
          log(added)
        })
      }
      td.appendChild(btn)
      tr.appendChild(td)
      tbody.appendChild(tr)
    })
    log(data.items.length + '件ヒット')
  })
}
$('addBtn').onclick = function () {
  run(async function () {
    var name = requireSession()
    var data = await post('/sessions/' + encodeURIComponent(name) + '/add', {
      code: $('addCode').value.trim(),
      count: Number($('addCount').value) || 1,
    })
    renderState(data.state)
    log(data)
  })
}
$('submitBtn').onclick = function () {
  if (!confirm('注文を送信します。よろしいですか？')) return
  run(async function () {
    var name = requireSession()
    var data = await post('/sessions/' + encodeURIComponent(name) + '/submit', {})
    renderState(data.state)
    log(data)
  })
}
$('accountBtn').onclick = function () {
  run(async function () {
    var name = requireSession()
    var data = await post('/sessions/' + encodeURIComponent(name) + '/account', {})
    renderState(data.state)
    log(data.account || data)
  })
}
$('receiptBtn').onclick = function () {
  run(async function () {
    var name = requireSession()
    var data = await post('/sessions/' + encodeURIComponent(name) + '/receipt', {})
    renderState(data.state)
    log(data)
  })
}
$('callBtn').onclick = function () {
  run(async function () {
    var name = requireSession()
    log(await post('/sessions/' + encodeURIComponent(name) + '/call', { after: false }))
  })
}
$('callDessertBtn').onclick = function () {
  run(async function () {
    var name = requireSession()
    log(await post('/sessions/' + encodeURIComponent(name) + '/call', { after: true }))
  })
}

run(async function () { await refreshSessions() })
</script>
</body>
</html>
`
