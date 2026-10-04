const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const emailOk = e => EMAIL_RE.test(String(e || ''))

// domain email sekali pakai (temp-mail) — ditolak di /link & /verify.
// mail.tm dipakai e2e — lolos via loopback-exempt di server.js.
// Tambahan tanpa ubah kode via env BLOCKED_DOMAINS="a.com,b.com".
const DISPOSABLE = new Set([
  // --- contoh terdeteksi ---
  'caps7.com',
  // --- test/dev temp (versi private punya tambahan sendiri via BLOCKED_DOMAINS) ---
  'mail.tm',
  // --- populer umum ---
  'tempmail.com', 'tempmailo.com', 'temp-mail.com', 'temp-mail.org',
  '10minutemail.com', '10minutemail.net', '10minute-mail.com',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com',
  'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'mailinator.com', 'mailinator.net', 'mailinator.org',
  'trashmail.com', 'trashmail.net', 'trashmail.org',
  'dispostable.com', 'disposablemail.com',
  'throwawaymail.com', 'fakemail.net', 'fakeinbox.com',
  'getairmail.com', 'getnada.com', 'inboxkitten.com',
  'mohmal.com', 'moakt.com', 'moakt.cc',
  'grr.la', 'guerrillamailblock.com',
  'mintemail.com', 'mytemp.email', 'tempail.com', 'tempmail.net',
  'maildrop.cc', 'harakirimail.com', 'dodgit.com', 'mintemail.com',
  'spamgourmet.com', 'spambox.me', 'spam4.me',
  'jetable.fr.nf', 'courriel.fr.nf', 'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf',
  'nomail.xl.cx', 'nospam.ze.tc', 'cool.fr.nf', 'mega.zik.dj', 'speed.1s.fr',
  'mvrht.com'
])

const domainOf = e => {
  const s = String(e || '').trim().toLowerCase()
  const at = s.lastIndexOf('@')
  if (at < 1) return ''
  return s.slice(at + 1)
}

// true kalau domain (atau parent-nya, cth sub.mail.tm) ada di blocklist + extra env
function isDisposable(email, extra = '') {
  const d = domainOf(email)
  if (!d) return false
  const hit = b => d === b || d.endsWith('.' + b)
  for (const b of DISPOSABLE) if (hit(b)) return true
  for (const x of String(extra || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) {
    if (hit(x)) return true
  }
  return false
}

module.exports = { EMAIL_RE, emailOk, DISPOSABLE, domainOf, isDisposable }
