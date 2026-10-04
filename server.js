#!/usr/bin/env node
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const BRANDING = 'kyyoaAM gateway'
const VERSION = '1.1.3'

// ---------- .env loader (stdlib, tanpa dotenv) ----------
const ENVF = path.join(__dirname, '.env')
if (fs.existsSync(ENVF)) {
  for (const line of fs.readFileSync(ENVF, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1')
  }
}

// ---------- GATEWAY_KEY: generate sekali kalau belum ada ----------
let GATEWAY_KEY = process.env.GATEWAY_KEY
if (!GATEWAY_KEY) {
  GATEWAY_KEY = crypto.randomBytes(24).toString('hex')
  const prev = fs.existsSync(ENVF) ? fs.readFileSync(ENVF, 'utf8') : ''
  fs.appendFileSync(ENVF, (prev && !prev.endsWith('\n') ? '\n' : '') + `GATEWAY_KEY=${GATEWAY_KEY}\n`)
  console.log(`[${BRANDING}] GATEWAY_KEY baru dibuat & disimpan di .env (tampil sekali ini):`)
  console.log(`[${BRANDING}] ` + GATEWAY_KEY)
}
const KEY_HASH = crypto.createHash('sha256').update(GATEWAY_KEY).digest()

const LOGIN_SHA = (process.env.LOGIN_SHA256 || '').toLowerCase()

// ---------- anti-abuse ----------
const MAX_POOL = parseInt(process.env.MAX_POOL || '10', 10)          // kapasitas total pool
const CREATE_PER_DAY = parseInt(process.env.CREATE_PER_DAY || '10', 10) // tambah sesi/hari/IP
const PREM_COOLDOWN = parseInt(process.env.PREM_COOLDOWN || '60', 10)   // detik antar premium per sesi
const lastPrem = new Map() // email -> ts percobaan premium/refresh terakhir
setInterval(() => {
  const now = Date.now()
  for (const [k, ts] of lastPrem) if (now - ts > 3600e3) lastPrem.delete(k)
}, 600000).unref()

const auth = require('./lib/auth')
const store = require('./lib/store')
const ratelimit = require('./lib/ratelimit')
const { emailOk, isDisposable } = require('./lib/validate')

const HOST = process.env.HOST || '127.0.0.1'
const PORT = parseInt(process.env.PORT || '20140', 10)

const json = (res, code, obj, headers = {}) => {
  const b = JSON.stringify(obj)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(b),
    ...headers
  })
  res.end(b)
}

// ---------- auth: API key (curl) ATAU cookie sesi (web UI) ----------
const keyOk = req => {
  const h = crypto.createHash('sha256').update(String(req.headers['x-gateway-key'] || '')).digest()
  return crypto.timingSafeEqual(h, KEY_HASH)
}

const COOKIE = 'kg_sid'
const COOKIE_TTL = 12 * 3600 * 1000 // 12 jam

const hmac = val => crypto.createHmac('sha256', GATEWAY_KEY).update(val).digest('base64url')
const signCookie = exp => `${exp}.${hmac(String(exp))}`

function cookieOk(header) {
  const m = String(header || '').match(new RegExp(COOKIE + '=([^;]+)'))
  if (!m) return false
  const raw = decodeURIComponent(m[1])
  const i = raw.lastIndexOf('.')
  if (i < 1) return false
  const val = raw.slice(0, i)
  const mac = raw.slice(i + 1)
  const expMac = hmac(val)
  const a = Buffer.from(mac)
  const b = Buffer.from(expMac)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
  return parseInt(val, 10) > Date.now()
}

const authOk = req => keyOk(req) || cookieOk(req.headers.cookie)

// ---------- body reader ----------
const readBody = (req, limit = 65536) => new Promise((resolve, reject) => {
  let buf = ''
  req.on('data', c => {
    buf += c
    if (buf.length > limit) {
      req.destroy()
      reject(new Error('body terlalu besar (max 64KB)'))
    }
  })
  req.on('end', () => {
    if (!buf) return resolve({})
    try { resolve(JSON.parse(buf)) } catch { reject(new Error('JSON tidak valid')) }
  })
  req.on('error', reject)
})

const ipOf = req => {
  // Cf-Connecting-Ip = IP asli dari edge CF (client gak bisa spoof — di-set CF).
  // XFF fallback utk lokal/direct (client bisa gandeng XFF palsu, makanya cip duluan)
  const cip = req.headers['cf-connecting-ip']
  if (cip) return String(cip).split(',')[0].trim()
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.socket.remoteAddress || '?'
}

// ---------- static ----------
const INDEX = path.join(__dirname, 'public', 'index.html')

// ---------- handler ----------
async function handle(req, res) {
  const t0 = Date.now()
  const u = new URL(req.url, 'http://x')
  let code = 200
  const finish = (c, obj, headers) => { code = c; json(res, c, obj, headers) }

  try {
    // health: terbuka
    if (req.method === 'GET' && u.pathname === '/health') {
      return finish(200, { ok: true, v: VERSION, premiumReady: true })
    }

    // halaman UI + aset statis (whitelist path — anti traversal)
    if (req.method === 'GET' && ['/', '/ui', '/app.css', '/app.js'].includes(u.pathname)) {
      const file = (u.pathname === '/' || u.pathname === '/ui')
        ? INDEX
        : path.join(__dirname, 'public', u.pathname.slice(1))
      const type = file.endsWith('.css') ? 'text/css; charset=utf-8'
        : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : 'text/html; charset=utf-8'
      const body = fs.readFileSync(file)
      res.writeHead(200, { 'content-type': type, 'content-length': body.length })
      res.end(body)
      code = 200
      return
    }

    // login
    if (req.method === 'POST' && u.pathname === '/api/login') {
      if (!ratelimit.allow('login:' + ipOf(req), 5, 5 / 60)) {
        return finish(429, { ok: false, why: 'terlalu banyak percobaan — tunggu sebentar' })
      }
      const b = await readBody(req)
      const hash = crypto.createHash('sha256').update(String(b.pass || '')).digest()
      const want = Buffer.from(LOGIN_SHA, 'hex')
      const ok = LOGIN_SHA.length === 64 && hash.length === want.length && crypto.timingSafeEqual(hash, want)
      if (!ok) return finish(401, { ok: false, why: 'sandi salah' })
      const exp = Date.now() + COOKIE_TTL
      const cookie = `${COOKIE}=${signCookie(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_TTL / 1000}`
      return finish(200, { ok: true }, { 'set-cookie': cookie })
    }

    // logout
    if (req.method === 'POST' && u.pathname === '/api/logout') {
      const cookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
      return finish(200, { ok: true }, { 'set-cookie': cookie })
    }

    // status sesi web
    if (req.method === 'GET' && u.pathname === '/api/me') {
      return finish(200, { ok: true, auth: authOk(req) || cookieOk(req.headers.cookie) })
    }

    // semua route API inti: cookie ATAU X-Gateway-Key
    if (!authOk(req)) return finish(401, { ok: false, why: 'belum masuk — login dulu / X-Gateway-Key salah' })

    const ip = ipOf(req)
    // limit global: 10 req/menit per IP
    if (!ratelimit.allow('g:' + ip, 10, 10 / 60)) {
      return finish(429, { ok: false, why: 'rate limit global — pelan-pelan' })
    }

    const route = `${req.method} ${u.pathname}`

    if (route === 'POST /link') {
      // limit khusus: 1 link / 30 detik per IP (hindari TOO_MANY_ATTEMPTS Firebase)
      if (!ratelimit.allow('l:' + ip, 1, 1 / 30)) {
        return finish(429, { ok: false, why: 'link max 1x / 30 detik per IP' })
      }
      const b = await readBody(req)
      if (!emailOk(b.email)) return finish(400, { ok: false, why: 'email tidak valid' })
      // temp-mail dilarang: loopback/e2e exempt, publik ditolak
      if (!/^(127\.|::1$|::ffff:127)/.test(ipOf(req)) && isDisposable(b.email, process.env.BLOCKED_DOMAINS)) {
        return finish(400, { ok: false, why: 'email sekali pakai tidak diterima — pakai email asli (gmail/yahoo/dll)' })
      }
      const r = await auth.link(b.email)
      return finish(r.ok ? 200 : 502, r)
    }

    if (route === 'POST /verify') {
      const b = await readBody(req)
      if (!emailOk(b.email)) return finish(400, { ok: false, why: 'email tidak valid' })
      // lapis 2: temp-mail dilarang juga di verify (jaga jalur langsung tanpa /link)
      if (!/^(127\.|::1$|::ffff:127)/.test(ipOf(req)) && isDisposable(b.email, process.env.BLOCKED_DOMAINS)) {
        return finish(400, { ok: false, why: 'email sekali pakai tidak diterima — pakai email asli (gmail/yahoo/dll)' })
      }
      if (!b.link || String(b.link).length > 2048) {
        return finish(400, { ok: false, why: 'link kosong / kepanjangan' })
      }
      // anti-abuse 1: kuota bikin akun per IP per hari.
      // cek dulu (peek — link gak kebuang kalau kuota habis), konsumsi HANYA kalau sukses.
      // loopback (e2e/dev lokal) di-ekssep: beda key IP publik via XFF
      const isLocal = /^(127\.|::1$|::ffff:127)/.test(ip)
      if (!isLocal && !ratelimit.peek('v:' + ip, CREATE_PER_DAY, 1 / 86400)) {
        return finish(429, { ok: false, why: `batas ${CREATE_PER_DAY} akun/hari per IP sudah terpakai — coba lagi besok` })
      }
      // anti-abuse 2: kapasitas pool
      const nPool = Object.keys(store.load()).length
      if (nPool >= MAX_POOL) {
        return finish(429, { ok: false, why: `pool penuh (${nPool}/${MAX_POOL}) — minta admin hapus sesi lama` })
      }
      const v = await auth.verify(b.email, b.link)
      if (!v.ok) return finish(502, v)
      if (!isLocal) ratelimit.consume('v:' + ip, CREATE_PER_DAY, 1 / 86400) // buang jatah cuma kalau sukses
      let pro = false
      let order = null
      let premWhy = null
      // versi publik: auth.premium() = stub (belum dikonfigurasi).
      // versi private: coba aktifkan premium di sini, simpan hasilnya.
      const p = await auth.premium(v.idToken)
      pro = !!p.ok
      order = p.order || null
      premWhy = p.ok ? null : p.why
      store.put(v.email, {
        uid: v.uid,
        refreshToken: v.refreshToken,
        pro,
        order,
        at: new Date().toISOString()
      })
      return finish(200, { ok: true, email: v.email, uid: v.uid, isNewUser: v.isNewUser, pro, order, premWhy })
    }

    if (route === 'POST /premium' || route === 'POST /refresh') {
      const b = await readBody(req)
      let email = String(b.email || '')
      // terima uid (tombol baris tabel) atau email masked (list disensor) -> email utuh
      if (!email && b.uid) {
        const hit = Object.entries(store.load()).find(([, s]) => s.uid === b.uid)
        if (hit) email = hit[0]
      } else if (email.includes('**')) {
        const hit = Object.entries(store.load()).find(([e]) => store.maskEmail(e) === email)
        if (hit) email = hit[0]
      }
      const s = store.get(email)
      if (!s) return finish(404, { ok: false, why: 'sesi tidak ditemukan di pool' })
      // anti-abuse 3: cooldown per sesi (spam AKTIFKAN = rotasi token & order boros)
      const nowP = Date.now()
      const lastP = lastPrem.get(email)
      if (lastP && nowP - lastP < PREM_COOLDOWN * 1000) {
        return finish(429, { ok: false, why: `tunggu ${Math.ceil((PREM_COOLDOWN * 1000 - (nowP - lastP)) / 1000)} detik — cooldown sesi ${PREM_COOLDOWN}s` })
      }
      lastPrem.set(email, nowP)
      const r = await auth.refresh(s.refreshToken)
      if (!r.ok) return finish(502, r)
      s.refreshToken = r.refreshToken
      s.at = new Date().toISOString()
      store.put(email, s)
      if (route === 'POST /refresh') return finish(200, { ok: true })
      const p = await auth.premium(r.idToken)
      if (p.ok) {
        s.pro = true
        s.order = p.order
        store.put(email, s)
        return finish(200, { ok: true, order: p.order, pro: true })
      }
      return finish(502, p)
    }

    if (route === 'GET /sessions') {
      return finish(200, { ok: true, sessions: store.list(), limit: MAX_POOL })
    }

    if (route === 'DELETE /sessions') {
      const b = await readBody(req)
      // gate admin: kalau ADMIN_PASS di-set, hapus wajib sandi (lindungi pool dari user lain)
      if (process.env.ADMIN_PASS && String(b.admin || '') !== process.env.ADMIN_PASS) {
        return finish(403, { ok: false, why: 'hapus sesi butuh sandi admin' })
      }
      let email = String(b.email || '')
      // list sudah masked -> delete bisa pakai uid (UI) atau email utuh (curl)
      if (!email && b.uid) {
        const d = store.load()
        const hit = Object.entries(d).find(([, v]) => v.uid === b.uid)
        if (hit) email = hit[0]
      }
      const gone = email && store.del(email)
      return finish(gone ? 200 : 404, gone ? { ok: true } : { ok: false, why: 'sesi tidak ditemukan' })
    }

    return finish(404, { ok: false, why: 'route tidak ditemukan' })
  } catch (e) {
    try { finish(400, { ok: false, why: e.message }) } catch {}
    return
  } finally {
    console.log(`${req.method} ${u.pathname} ${code} ${Date.now() - t0}ms`)
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    try { json(res, 500, { ok: false, why: e.message }) } catch {}
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[${BRANDING}] v${VERSION} aktif -> http://${HOST}:${PORT}`)
  console.log(`[${BRANDING}] web UI: http://${HOST}:${PORT}/ | API: cookie atau header X-Gateway-Key`)
  console.log(`[${BRANDING}] premiumReady: true`)
})

process.on('SIGINT', () => { server.close(); process.exit(0) })
process.on('SIGTERM', () => { server.close(); process.exit(0) })
