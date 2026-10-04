const assert = require('assert')
const auth = require('./lib/auth')
const store = require('./lib/store')
const rl = require('./lib/ratelimit')
const v = require('./lib/validate')

let pass = 0
let fail = 0
const t = (name, fn) => {
  try {
    fn()
    pass++
    console.log('PASS ' + name)
  } catch (e) {
    fail++
    console.log('FAIL ' + name + ' -> ' + e.message)
  }
}

// ---- extractCode (mock, tanpa request keluar) ----
t('extractCode: link utuh', () =>
  assert.strictEqual(
    auth.extractCode('https://auth.example.com/check?action=confirm&oobCode=ABC123def456_-&mode=signIn'),
    'ABC123def456_-'))

t('extractCode: link ter-encode', () =>
  assert.strictEqual(auth.extractCode('https%3A%2F%2Fx.y%2FoobCode%3Dzzz111222333'), 'zzz111222333'))

t('extractCode: entity &amp;', () =>
  assert.strictEqual(auth.extractCode('https://a.b/?x=1&amp;oobCode=QQQ111222333'), 'QQQ111222333'))

t('extractCode: nested param link', () =>
  assert.strictEqual(
    auth.extractCode('https://rdr.to/?link=https%3A%2F%2Fx%2Fy%3FoobCode%3DNESTED12345'),
    'NESTED12345'))

t('extractCode: kode polos', () =>
  assert.strictEqual(auth.extractCode('Aa1_-Bb2_-Cc3'), 'Aa1_-Bb2_-Cc3'))

t('extractCode: URL tanpa kode -> null', () =>
  assert.strictEqual(auth.extractCode('https://contoh.com/tanpa-kode'), null))

t('extractCode: kosong -> null', () =>
  assert.strictEqual(auth.extractCode(''), null))

t('extractCode: pendek -> null', () =>
  assert.strictEqual(auth.extractCode('abc123'), null))

// ---- ekspor lengkap (termasuk premium) ----
t('5 ekspor auth: link, verify, refresh, premium, extractCode', () => {
  for (const k of ['link', 'verify', 'refresh', 'premium', 'extractCode']) {
    assert.strictEqual(typeof auth[k], 'function', k + ' bukan function')
  }
})

// ---- masking token ----
t('mask: token dipotong', () =>
  assert.strictEqual(store.mask('abcdefghijklmnop'), 'abcdef…mnop'))

t('mask: token pendek jadi …', () =>
  assert.strictEqual(store.mask('short'), '…'))

t('maskEmail: agung@gmail.com -> agu**@gmail.com', () =>
  assert.strictEqual(store.maskEmail('agung@gmail.com'), 'agu**@gmail.com'))

t('maskEmail: tanpa @ -> **', () => {
  assert.strictEqual(store.maskEmail('bukan-email'), '**')
  assert.strictEqual(store.maskEmail('ab@x.co'), 'ab**@x.co')
})

// ---- rate limit ----
t('ratelimit: burst 2 lalu tolak', () => {
  const k = 'test-' + Date.now() + '-' + Math.random()
  assert.strictEqual(rl.allow(k, 2, 0.0001), true)
  assert.strictEqual(rl.allow(k, 2, 0.0001), true)
  assert.strictEqual(rl.allow(k, 2, 0.0001), false)
})

t('ratelimit: kuota harian (refill 1/86400 per detik) habis', () => {
  const k = 'day-' + Date.now() + '-' + Math.random()
  assert.strictEqual(rl.allow(k, 3, 1 / 86400), true)
  assert.strictEqual(rl.allow(k, 3, 1 / 86400), true)
  assert.strictEqual(rl.allow(k, 3, 1 / 86400), true)
  assert.strictEqual(rl.allow(k, 3, 1 / 86400), false)
})

t('ratelimit: peek gak buang token, consume buang (sukses saja)', () => {
  const k = 'pc-' + Date.now() + '-' + Math.random()
  assert.strictEqual(rl.peek(k, 1, 1 / 86400), true)
  assert.strictEqual(rl.peek(k, 1, 1 / 86400), true) // 2x peek tetap true
  rl.consume(k, 1, 1 / 86400)
  assert.strictEqual(rl.peek(k, 1, 1 / 86400), false) // habis setelah consume
})

// ---- validasi email ----
t('emailOk: valid / invalid', () => {
  assert.ok(v.emailOk('a@b.co'))
  assert.ok(v.emailOk('user.name+tag@mail.example.com'))
  assert.ok(!v.emailOk('a@b'))
  assert.ok(!v.emailOk(''))
  assert.ok(!v.emailOk(null))
})

// ---- temp-mail blocklist ----
t('isDisposable: temp-mail ditolak, email asli lolos', () => {
  for (const d of ['caps7.com', 'tempmail.com', 'yopmail.com', 'mailinator.com', '10minutemail.com', 'guerrillamail.com']) {
    assert.ok(v.isDisposable('x@' + d), d + ' harus ditolak')
  }
  assert.ok(v.isDisposable('x@sub.mail.tm'), 'subdomain disposable harus ditolak')
  assert.ok(v.isDisposable('x@CAPS7.COM'), 'case-insensitive')
  assert.ok(!v.isDisposable('user@gmail.com'), 'gmail harus lolos')
  assert.ok(!v.isDisposable('user@yahoo.co.id'), 'yahoo harus lolos')
  assert.ok(!v.isDisposable('a@b.co'), 'domain biasa harus lolos')
  assert.ok(v.isDisposable('x@evil.com', 'evil.com'), 'BLOCKED_DOMAINS env harus kepakai')
})

// ---- store roundtrip (write -> list masked -> delete) ----
t('store: put/get/list/del + email & token masked di list', () => {
  const e = 'selftest@localhost'
  store.put(e, { uid: 'uid-x', refreshToken: 'R'.repeat(40), pro: false, at: new Date().toISOString() })
  assert.ok(store.get(e), 'get gagal')
  const row = store.list().find(s => s.email === 'sel**@localhost')
  assert.ok(row, 'list gagal (email harus masked sel**@localhost)')
  assert.ok(!row.refresh.includes('R'.repeat(40)), 'refresh token bocor utuh di list')
  assert.strictEqual(store.del(e), true)
  assert.strictEqual(store.del(e), false)
})

console.log(`\n${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
