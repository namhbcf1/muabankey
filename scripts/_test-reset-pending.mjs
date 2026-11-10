/**
 * KIỂM CHỨNG thiết kế MỚI: reset_pending (thay cho activated_at = NULL).
 *
 * Kỳ vọng:
 *  - Admin reset -> hwid=NULL, reset_pending=1, activated_at GIỮ NGUYÊN, rebinds=0
 *  - Máy CŨ /api/check KHÔNG token -> 403 rebind_token_required, KHÔNG bind được
 *  - Máy MỚI /api/check CÓ token -> bind OK, reset_pending về 0, hạn KHÔNG đổi
 *  - Sau đó máy cũ /api/check -> 403 hwid_mismatch
 */
import { apiActivate, apiCheck } from '../src/routes/license-server.js';

function makeDB(licenses, tokens = []) {
  const db = { licenses, tokens, log: [] };
  db.prepare = (sql) => {
    const st = { sql, args: [] };
    st.bind = (...a) => { st.args = a; return st; };
    st.first = async () => {
      if (/FROM licenses WHERE key = \?/.test(sql)) return licenses.find((l) => l.key === st.args[0]) || null;
      if (/FROM rebind_tokens WHERE token_hash = \?/.test(sql)) return tokens.find((t) => t.token_hash === st.args[0]) || null;
      if (/COUNT\(\*\) AS n FROM lic_attempts/.test(sql)) return { n: 0 };
      return null;
    };
    st.run = async () => {
      db.log.push(sql.replace(/\s+/g, ' ').trim());
      const m = /^UPDATE licenses SET hwid = \?, reset_pending = 0/.test(sql.trim());
      if (m) {
        const l = licenses.find((x) => x.key === st.args[st.args.length - 1]);
        if (l) { l.hwid = st.args[0]; l.reset_pending = 0; l.reset_at = null; l.rebinds = (l.rebinds || 0) + (st.args[3] || 0); }
      } else if (/^UPDATE licenses SET hwid = \?, activated_at/.test(sql.trim())) {
        const l = licenses.find((x) => x.key === st.args[5]);
        if (l) { l.hwid = st.args[0]; l.activated_at = st.args[1]; l.expires_at = st.args[2]; }
      } else if (/^UPDATE licenses SET hwid = NULL, reset_pending = 1/.test(sql.trim())) {
        const l = licenses.find((x) => x.key === st.args[1]);
        if (l) { l.hwid = null; l.reset_pending = 1; l.reset_at = st.args[0]; l.rebinds = 0; }
      }
      if (/UPDATE rebind_tokens SET used = 1/.test(sql)) {
        const t = tokens.find((x) => x.token_hash === st.args[0]);
        if (t) t.used = 1;
      }
      return { meta: { changes: 1 } };
    };
    st.all = async () => ({ results: [] });
    return st;
  };
  db.batch = async () => [];
  return db;
}

function mkReq(body) {
  return {
    headers: { get: (k) => (k.toLowerCase() === 'cf-connecting-ip' ? '1.2.3.4' : null) },
    text: async () => JSON.stringify(body),
    url: 'https://x.test/api/check',
  };
}

const sha = async (t) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))),
  (b) => b.toString(16).padStart(2, '0')).join('');

const now = Math.floor(Date.now() / 1000);
const KEY = 'RESET-KEY-01';
const TOKEN = 'tok-rebind-xyz';
const TH = await sha(TOKEN);

function mkLic() {
  return {
    key: KEY, hwid: 'o'.repeat(32), plan: 'aoe1',
    created_at: now - 60 * 86400,
    activated_at: now - 20 * 86400,   // kích hoạt 20 ngày trước
    expires_at: now + 10 * 86400,     // còn 10 ngày
    revoked: 0, max_rebind: 1, rebinds: 0,
    last_seen: now - 3600, last_ip: '1.1.1.1',
    reset_pending: 0, reset_at: null,
  };
}

async function call(fn, env, body) {
  const res = await fn(env, mkReq(body));
  return { status: res.status, d: await res.json() };
}

console.log('════ KIỂM CHỨNG reset_pending ════');

/* --- Admin reset --- */
const lic = mkLic();
const tokens = [{ token_hash: TH, key: KEY, user_id: 'u', created_at: now, expires_at: now + 1800, used: 0 }];
const E0 = lic.expires_at;
const db = makeDB([lic], tokens);
const env = { DB: db, CACHE: { get: async () => null, put: async () => {} } };

// mô phỏng resetHwid()
await env.DB.prepare(
  'UPDATE licenses SET hwid = NULL, reset_pending = 1, reset_at = ?, rebinds = 0 WHERE key = ?'
).bind(now, KEY).run();
console.log(`\n1) Sau admin reset:`);
console.log(`   hwid=${lic.hwid}  reset_pending=${lic.reset_pending}  activated_at=${lic.activated_at} (GIỮ)  rebinds=${lic.rebinds}`);
console.log(`   expires_at=${lic.expires_at} (KHÔNG đổi: ${lic.expires_at === E0})`);

/* --- Máy cũ check, không token --- */
const r1 = await call(apiCheck, env, { key: KEY, hwid: 'o'.repeat(32) });
console.log(`\n2) Máy CŨ /api/check (không token): HTTP ${r1.status} code=${r1.d.code} ok=${r1.d.ok}`);
console.log(`   DB: hwid=${lic.hwid}  reset_pending=${lic.reset_pending}`);
const oldBlocked = r1.status === 403 && lic.hwid === null;

/* --- Máy mới check, có token --- */
const r2 = await call(apiCheck, env, { key: KEY, hwid: 'n'.repeat(32), token: TOKEN });
console.log(`\n3) Máy MỚI /api/check (có token): HTTP ${r2.status} ok=${r2.d.ok} rebound=${r2.d.rebound}`);
console.log(`   DB: hwid=${lic.hwid}  reset_pending=${lic.reset_pending}  rebinds=${lic.rebinds}`);
console.log(`   expires_at=${lic.expires_at} (không đổi: ${lic.expires_at === E0})`);
const newBound = r2.d.ok === true && lic.hwid === 'n'.repeat(32) && lic.reset_pending === 0;

/* --- Máy cũ check lại --- */
const r3 = await call(apiCheck, env, { key: KEY, hwid: 'o'.repeat(32) });
console.log(`\n4) Máy CŨ /api/check lại: HTTP ${r3.status} code=${r3.d.code}`);
const oldStillBlocked = r3.status === 403 && r3.d.code === 'hwid_mismatch';

console.log('\n════ KẾT QUẢ ════');
const checks = [
  ['Admin reset giữ activated_at', lic.activated_at === now - 20 * 86400],
  ['Admin reset giữ hạn dùng', lic.expires_at === E0],
  ['Máy cũ KHÔNG bind được (thiếu token)', oldBlocked],
  ['Máy mới bind được với token', newBound],
  ['Token bị tiêu', tokens[0].used === 1],
  ['Máy cũ bị chặn sau khi máy mới bind', oldStillBlocked],
  ['Hạn không bị cộng thêm', lic.expires_at === E0],
];
for (const [n, v] of checks) console.log(`  ${v ? '✅' : '❌'} ${n}`);
const bad = checks.filter(([, v]) => !v);
console.log(`\n  ${checks.length - bad.length}/${checks.length} đạt`);
if (bad.length) {
  console.log('  Debug r1:', JSON.stringify(r1.d));
  console.log('  Debug r2:', JSON.stringify(r2.d));
  console.log('  Debug r3:', JSON.stringify(r3.d));
}
