// token bucket per key, in-memory, stdlib only
const buckets = new Map()

function allow(key, capacity, refillPerSec) {
  const now = Date.now() / 1000
  let b = buckets.get(key)
  if (!b) {
    b = { tokens: capacity, ts: now }
    buckets.set(key, b)
  }
  b.tokens = Math.min(capacity, b.tokens + (now - b.ts) * refillPerSec)
  b.ts = now
  if (b.tokens < 1) return false
  b.tokens -= 1
  return true
}

function fill(key, capacity, refillPerSec) {
  const now = Date.now() / 1000
  let b = buckets.get(key)
  if (!b) {
    b = { tokens: capacity, ts: now }
    buckets.set(key, b)
  }
  b.tokens = Math.min(capacity, b.tokens + (now - b.ts) * refillPerSec)
  b.ts = now
  return b
}

// cek kuota TANPA buang token (buat gate sebelum kerja eksternal)
function peek(key, capacity, refillPerSec) {
  return fill(key, capacity, refillPerSec).tokens >= 1
}

// buang token terpisah dari cek (dipanggil cuma kalau sukses)
function consume(key, capacity, refillPerSec) {
  const b = fill(key, capacity, refillPerSec)
  b.tokens -= 1
  return b.tokens
}

// bersihkan bucket idle > 10 menit
setInterval(() => {
  const now = Date.now() / 1000
  for (const [k, b] of buckets) if (now - b.ts > 600) buckets.delete(k)
}, 600000).unref()

module.exports = { allow, peek, consume }
