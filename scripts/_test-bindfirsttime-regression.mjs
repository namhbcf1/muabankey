/**
 * CHỨNG MINH lỗi hồi quy trong bindFirstTime() bản mới (chưa deploy):
 *
 * bindFirstTime(env, lic, key, hwid, ip, now, token)  <- có tham số token
 * nhưng apiActivate:242 và apiCheck:291 gọi KHÔNG truyền token
 *   => token = undefined
 *   => wasBound = true (activated_at có giá trị)
 *   => return { ok:false, code:'rebind_token_required' }  và KHÔNG update DB
 * NHƯNG handler BỎ QUA giá trị trả về:
 *   await bindFirstTime(...); return json(publicLic(lic, { first_bind: true }))
 *   => vẫn trả ok:true!
 *
 * HỆ QUẢ: hwid không bao giờ được ghi -> key dùng được trên MỌI máy,
 *         và mọi máy đều nhận ok:true. Nghiêm trọng hơn lỗi cũ.
 */
import { apiActivate, apiCheck } from '../src/routes/license-server.js';

/* ---------- Fake D1 tối giản ---------- */
function makeDB(licenses, tokens = []) {
  const db = { licenses, tokens, log: [] };
  db.prepare = (sql) => {
    const st = { sql, args: [] };
    st.bind = (...a) => { st.args = a; return st; };
    st.first = async () => {
      if (/FROM licenses WHERE key = \?/.test(sql)) {
        return licenses.find((l) => l.key === st.args[0]) || null;
      }
      if (/FROM rebind_tokens WHERE token_hash = \?/.test(sql)) {
        return tokens.find((t) => t.token_hash === st.args[0]) || null;
      }
      if (/COUNT\(\*\) AS n FROM lic_attempts/.test(sql)) return { n: 0 };
      return null;
    };
    st.run = async () => {
      db.log.push({ sql: sql.replace(/\s+/g, ' ').trim(), args: st.args });
      if (/^UPDATE licenses SET hwid = \?/.test(sql.trim())) {
        const l = licenses.find((x) => x.key === st.args[st.args.length - 1]);
        if (l) l.hwid = st.args[0];
      }
      if (/UPDATE rebind_tokens SET used = 1/.test(sql)) {
        const t = tokens.find((x) => x.token_hash === st.args[0]);
        if (t) t.used = 1;
      }
      if (/INSERT INTO lic_events/.test(sql)) { /* noop */ }
      if (/INSERT INTO lic_attempts/.test(sql)) { /* noop */ }
      if (/DELETE FROM lic_attempts/.test(sql)) { /* noop */ }
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
    url: 'https://x.test/api/activate',
  };
}

const now = Math.floor(Date.now() / 1000);
const KEY = 'TEST-KEY-0001';

async function scenario(label, lic, body) {
  const db = makeDB([lic]);
  const env = { DB: db, CACHE: { get: async () => null, put: async () => {} } };
  const fn = body.__check ? apiCheck : apiActivate;
  const res = await fn(env, mkReq(body));
  const data = await res.json();
  const writes = db.log.filter((w) => /UPDATE licenses/.test(w.sql));
  console.log(`\n── ${label}`);
  console.log(`   HTTP ${res.status}  ok=${data.ok}  code=${data.code || '-'}  first_bind=${data.first_bind}`);
  console.log(`   DB lic.hwid sau gọi : ${lic.hwid === null ? 'NULL' : lic.hwid}`);
  console.log(`   Số câu UPDATE licenses: ${writes.length}${writes.length ? '' : '  <-- KHÔNG GHI DB!'}`);
  return { status: res.status, data, writes, hwid: lic.hwid };
}

console.log('════════ KIỂM CHỨNG LỖI HỒI QUY bindFirstTime ════════');

/* 1. License đã từng bind (activated_at != null) + hwid=NULL (vừa admin reset) */
const r1 = await scenario(
  'A. /api/check  máy CŨ  (hwid=NULL sau reset, activated_at có) — KHÔNG token',
  { key: KEY, hwid: null, plan: 'aoe1', created_at: now - 10 * 86400,
    activated_at: now - 10 * 86400, expires_at: now + 20 * 86400,
    revoked: 0, max_rebind: 1, rebinds: 0, last_seen: null, last_ip: null },
  { key: KEY, hwid: 'old'.padEnd(32, 'o'), __check: true },
);

const r2 = await scenario(
  'B. /api/activate máy MỚI (hwid=NULL sau reset) — KHÔNG token',
  { key: KEY, hwid: null, plan: 'aoe1', created_at: now - 10 * 86400,
    activated_at: now - 10 * 86400, expires_at: now + 20 * 86400,
    revoked: 0, max_rebind: 1, rebinds: 0, last_seen: null, last_ip: null },
  { key: KEY, hwid: 'new'.padEnd(32, 'n') },
);

const r3 = await scenario(
  'C. /api/activate máy THỨ BA bất kỳ — KHÔNG token',
  { key: KEY, hwid: null, plan: 'aoe1', created_at: now - 10 * 86400,
    activated_at: now - 10 * 86400, expires_at: now + 20 * 86400,
    revoked: 0, max_rebind: 1, rebinds: 0, last_seen: null, last_ip: null },
  { key: KEY, hwid: 'xyz'.padEnd(32, 'z') },
);

console.log('\n════════ KẾT LUẬN ════════');
const allOkNoWrite = [r1, r2, r3].every((r) => r.data.ok === true && r.writes.length === 0);
if (allOkNoWrite) {
  console.log('  🚨 XÁC NHẬN LỖI HỒI QUY NGHIÊM TRỌNG:');
  console.log('     - CẢ 3 máy khác nhau đều nhận ok=true');
  console.log('     - KHÔNG máy nào ghi được hwid vào DB (hwid vẫn NULL)');
  console.log('     - first_bind=true trả về sai (bindFirstTime thất bại nhưng bị bỏ qua)');
  console.log('');
  console.log('     Hệ quả: sau khi admin "Reset máy", license thành VÔ CHỦ —');
  console.log('     key chạy được trên MỌI máy, không máy nào bị chặn.');
  console.log('     Đây là hở bảo mật nặng hơn cả lỗi ban đầu (share key vô hạn).');
  console.log('');
  console.log('     Nguyên nhân: bindFirstTime(env, lic, key, hwid, ip, now, token)');
  console.log('       - apiActivate:242  thiếu tham số token');
  console.log('       - apiCheck:291     thiếu tham số token');
  console.log('       - cả 2 nơi đều bỏ qua { ok:false, code:"rebind_token_required" }');
} else {
  console.log('  Không tái hiện được — kiểm tra lại giả định.');
  console.log(JSON.stringify({ r1: r1.data, r2: r2.data, r3: r3.data }, null, 2));
}
