const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'sessions.json')

const load = () => {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

function save(d) {
  const tmp = FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
  try { fs.chmodSync(FILE, 0o600) } catch {}
}

const get = email => load()[email]

function put(email, rec) {
  const d = load()
  d[email] = rec
  save(d)
}

function del(email) {
  const d = load()
  if (!(email in d)) return false
  delete d[email]
  save(d)
  return true
}

const mask = t => {
  const s = String(t || '')
  return s.length > 12 ? s.slice(0, 6) + '…' + s.slice(-4) : '…'
}

// sensor email: agung@gmail.com -> agu**@gmail.com
const maskEmail = e => {
  const s = String(e || '')
  const at = s.indexOf('@')
  if (at < 1) return '**'
  return s.slice(0, Math.min(3, at)) + '**' + s.slice(at)
}

const list = () => Object.entries(load()).map(([email, s]) => ({
  email: maskEmail(email),
  uid: s.uid,
  pro: !!s.pro,
  order: s.order || null,
  refresh: mask(s.refreshToken),
  at: s.at
}))

module.exports = { load, save, get, put, del, list, mask, maskEmail }
