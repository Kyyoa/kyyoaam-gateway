/* KYYOA AM Gateway — dashboard */
const $ = id => document.getElementById(id)
const api = async (path, opts = {}) => {
  const r = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts
  })
  let d = {}
  try { d = await r.json() } catch {}
  if (r.status === 401 && path !== '/api/login') { showLogin(); throw { why: 'sesi habis — masuk lagi' } }
  return { st: r.status, d }
}

let toastT
function toast(msg, ok = true) {
  const t = $('toast')
  t.textContent = msg
  t.className = 'frame toast mono ' + (ok ? 'ok' : 'bad')
  t.hidden = false
  clearTimeout(toastT)
  toastT = setTimeout(() => { t.hidden = true }, 5200)
}

const showLogin = () => { $('login').hidden = false; $('app').hidden = true }
const showApp = () => {
  $('login').hidden = true; $('app').hidden = false
  const em = localStorage.getItem('kg_email')
  if (em) { $('e1').value = em; $('e2').value = em; $('e3').value = em }
  loadSessions()
}

/* ---------- boot: cek sesi + status premium ---------- */
async function boot() {
  const { d } = await api('/api/me')
  if (d.auth) showApp(); else showLogin()
  const h = await fetch('/health').then(r => r.json()).catch(() => null)
  if (h && h.premiumReady) $('prem-note').hidden = false
}
$('login-form').addEventListener('submit', async ev => {
  ev.preventDefault()
  $('login-msg').textContent = ''
  const { st, d } = await api('/api/login', { method: 'POST', body: JSON.stringify({ pass: $('pass').value }) })
  if (st === 200) { $('pass').value = ''; showApp() }
  else $('login-msg').textContent = d.why || 'gagal'
})
$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' })
  showLogin()
})

/* ---------- langkah 1: kirim link ---------- */
let cdT
$('b1').addEventListener('click', async () => {
  const email = $('e1').value.trim()
  const b = $('b1'); b.disabled = true
  const { st, d } = await api('/link', { method: 'POST', body: JSON.stringify({ email }) })
  if (st === 200) {
    localStorage.setItem('kg_email', email)
    $('s1').textContent = 'LINK TERKIRIM — CEK INBOX / SPAM'
    $('e2').value = email; $('e3').value = email
    toast('magic link terkirim ke ' + email)
    let s = 30
    $('b1').textContent = `TUNGGU ${s}D`
    cdT = setInterval(() => {
      s--
      if (s <= 0) { clearInterval(cdT); b.disabled = false; $('b1').textContent = 'KIRIM LINK' }
      else $('b1').textContent = `TUNGGU ${s}D`
    }, 1000)
  } else {
    $('s1').textContent = d.why || 'gagal'
    toast(d.why || 'gagal kirim link', false)
    b.disabled = false
  }
})

/* ---------- langkah 2: verifikasi + premium ---------- */
$('b2').addEventListener('click', async () => {
  const email = $('e2').value.trim()
  const link = $('l2').value.trim()
  const b = $('b2'); b.disabled = true; b.textContent = 'MEMPROSES…'
  const { st, d } = await api('/verify', { method: 'POST', body: JSON.stringify({ email, link }) })
  b.disabled = false; b.textContent = 'VERIFIKASI'
  const r = $('r2'); r.hidden = false
  if (st === 200 && d.ok) {
    localStorage.setItem('kg_email', email)
    r.className = 'result'
    r.innerHTML = d.pro
      ? `<span class="badge">PREMIUM AKTIF</span><br>ORDER: ${esc(d.order)}<button class="copy" data-c="${esc(d.order)}">SALIN</button><br>UID: ${esc(d.uid)}`
      : `LOGIN OK &middot; UID ${esc(d.uid)}<br>PREMIUM: ${esc(d.premWhy || 'gagal')}`
    toast(d.pro ? 'premium aktif untuk ' + email : 'login ok, premium belum aktif', !!d.pro)
    $('e3').value = email
    loadSessions()
  } else {
    r.className = 'result err'
    r.textContent = d.why || 'gagal'
    toast(d.why || 'verifikasi gagal', false)
  }
})

/* ---------- langkah 3: premium ulang ---------- */
$('b3').addEventListener('click', async () => {
  const email = $('e3').value.trim()
  const b = $('b3'); b.disabled = true; b.textContent = 'MEMPROSES…'
  const { st, d } = await api('/premium', { method: 'POST', body: JSON.stringify({ email }) })
  b.disabled = false; b.textContent = 'AKTIFKAN'
  const r = $('r3'); r.hidden = false
  if (st === 200 && d.ok) {
    r.className = 'result'
    r.innerHTML = `<span class="badge">PREMIUM AKTIF</span><br>ORDER: ${esc(d.order)}<button class="copy" data-c="${esc(d.order)}">SALIN</button>`
    toast('premium diaktifkan lagi — ' + email)
    loadSessions()
  } else {
    r.className = 'result err'
    r.textContent = d.why || 'gagal'
    toast(d.why || 'premium gagal', false)
  }
})

/* ---------- sesi pool ---------- */
async function loadSessions() {
  const { st, d } = await api('/sessions')
  if (st !== 200) return
  const rows = d.sessions || []
  $('pool-count').textContent = `POOL · ${rows.length}${d.limit ? '/' + d.limit : ''} SESI`
  $('empty').hidden = rows.length > 0
  const tb = document.querySelector('#tbl tbody')
  tb.innerHTML = rows.map(s => `
    <tr>
      <td>${esc(s.email)}</td>
      <td class="muted">${esc(String(s.uid).slice(0, 10))}…</td>
      <td>${s.pro ? '<span class="badge">PRO</span>' : '<span class="muted">—</span>'}</td>
      <td>${s.order ? esc(s.order) + '<button class="copy" data-c="' + esc(s.order) + '">SALIN</button>' : '<span class="muted">—</span>'}</td>
      <td class="muted">${esc(String(s.at).replace('T', ' ').slice(0, 16))}</td>
      <td>
        <button class="btn tiny" data-act="prem" data-u="${esc(s.uid)}">AKTIFKAN</button>
        <button class="del" data-u="${esc(s.uid)}">HAPUS</button>
      </td>
    </tr>`).join('')
}

document.addEventListener('click', async ev => {
  // re-aktifkan premium langsung dari baris tabel (tanpa tahu email utuh)
  const p = ev.target.closest('[data-act=prem]')
  if (p) {
    p.disabled = true
    const { st, d } = await api('/premium', { method: 'POST', body: JSON.stringify({ uid: p.dataset.u }) })
    p.disabled = false
    if (st === 200 && d.ok) toast('premium diaktifkan — order ' + d.order)
    else toast(d.why || 'premium gagal', false)
    loadSessions()
    return
  }
  const c = ev.target.closest('.copy')
  if (c) {
    await navigator.clipboard.writeText(c.dataset.c).catch(() => {})
    toast('disalin: ' + c.dataset.c)
    return
  }
  const del = ev.target.closest('.del')
  if (del) {
    const admin = prompt('HAPUS SESI DARI POOL (permanen, semua orang kehilangan akses).\n\nMasukkan sandi admin:')
    if (admin === null) return // batal
    const { st, d } = await api('/sessions', { method: 'DELETE', body: JSON.stringify({ uid: del.dataset.u, admin }) })
    toast(st === 200 ? 'sesi dihapus' : (d.why || 'gagal'), st === 200)
    if (st === 200) loadSessions()
  }
})

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

boot()
