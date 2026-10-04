const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const emailOk = e => EMAIL_RE.test(String(e || ''))

module.exports = { EMAIL_RE, emailOk }
