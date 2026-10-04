// kyyoaAM gateway — PUBLIC auth stub.
// Versi publik: TANPA endpoint internal, TANPA api key, TANPA verifyPurchase.
// Interface sama persis dgn versi private (link/verify/refresh/premium/extractCode)
// supaya server.js & test.js jalan tanpa ubah. Logic asli = private, tidak dipublish.
//
// Mau jalanin beneran? Isi PROVIDER_* di .env dan implementasikan 4 fungsi di bawah
// sesuai penyedia auth masing-masing.

function extractCode(raw) {
  // Ambil kode sekali-pakai dari link login (param query `oobCode` generik).
  // Tidak ada URL/endpoint internal di sini — murni parsing string.
  if (!raw) return null
  let s = String(raw).replace(/&amp;/g, '&')
  try { s = decodeURIComponent(s) } catch {}
  try {
    const u = new URL(s)
    const direct = u.searchParams.get('oobCode')
    if (direct) return direct.replace(/[^a-zA-Z0-9_-]/g, '')
    const nested = u.searchParams.get('link') || u.searchParams.get('q') || u.searchParams.get('url')
    if (nested) {
      try { return new URL(nested).searchParams.get('oobCode') } catch {}
    }
  } catch {}
  const m = s.match(/oobCode=([a-zA-Z0-9_-]+)/i)
  if (m) return m[1]
  const t = String(raw).trim()
  return /^[a-zA-Z0-9_-]{10,}$/.test(t) && !t.includes('://') ? t : null
}

async function link(_email) {
  return { ok: false, why: 'auth provider belum dikonfigurasi (versi publik — stub)' }
}

async function verify(_email, _raw) {
  return { ok: false, why: 'auth provider belum dikonfigurasi (versi publik — stub)' }
}

async function refresh(_refreshToken) {
  return { ok: false, why: 'auth provider belum dikonfigurasi (versi publik — stub)' }
}

async function premium(_idToken) {
  return { ok: false, why: 'premium provider belum dikonfigurasi (versi publik — stub)' }
}

module.exports = { link, verify, refresh, premium, extractCode }
