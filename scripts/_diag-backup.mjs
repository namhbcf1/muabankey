/** Phân tích backup SQL: mô phỏng tác động của bindFirstTime khi reset. */
import { readFileSync } from 'node:fs';

const sql = readFileSync('backup-before-cleanup-20261110-205447.sql', 'utf8');
const re = /INSERT INTO "licenses" \([^)]*\) VALUES\((.*?)\);/g;
const rows = [];
let m;
while ((m = re.exec(sql))) {
  const parts = m[1].match(/'(?:[^']|'')*'|[^,]+/g) || [];
  const v = parts.map((p) => {
    const t = p.trim();
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === 'NULL') return null;
    return Number(t);
  });
  const o = {};
  ['key', 'hwid', 'plan', 'note', 'created_at', 'activated_at', 'expires_at',
   'last_seen', 'last_ip', 'revoked', 'max_rebind', 'rebinds'].forEach((k, i) => { o[k] = v[i]; });
  rows.push(o);
}
console.log(`Đọc được ${rows.length} license từ backup\n`);

const now = Math.floor(Date.now() / 1000);
const ts = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—');
const dd = (s, sign = false) => (sign && s > 0 ? '+' : '') + (s / 86400).toFixed(1) + 'd';

// Key còn hạn, đã từng kích hoạt (activated_at khác created_at)
const live = rows.filter((r) => r.expires_at > 0 && r.expires_at > now && r.activated_at);
console.log(`Key còn hạn + đã kích hoạt: ${live.length}/${rows.length}`);

const impacts = live.map((r) => {
  const age = now - r.created_at;
  const days = Math.max(1, Math.round((r.expires_at - r.created_at) / 86400));
  const expAfterReset = now + days * 86400;
  return { ...r, age, days, expAfterReset, gain: expAfterReset - r.expires_at };
}).sort((a, b) => b.gain - a.gain);

console.log('\n=== 10 KEY BỊ TẶNG NHIỀU NHẤT NẾU ADMIN BẤM "Reset máy" + KHÁCH KÍCH HOẠT LẠI ===');
console.log('key                     | tuổi key | hạn hiện tại     | hạn sau reset    | TẶNG THÊM');
console.log('-'.repeat(100));
for (const r of impacts.slice(0, 10)) {
  console.log(
    `${String(r.key).padEnd(23)} | ${dd(r.age).padStart(8)} | ${ts(r.expires_at).padEnd(16)} | ${ts(r.expAfterReset).padEnd(16)} | ${dd(r.gain, true)}`
  );
}

const gains = impacts.map((r) => r.gain).filter((g) => g > 0);
if (gains.length) {
  const avg = gains.reduce((a, b) => a + b, 0) / gains.length;
  console.log(`\nSố key bị tặng thêm: ${gains.length}/${impacts.length}`);
  console.log(`Mức tặng trung bình : ${dd(avg, true)}`);
  console.log(`Mức tặng lớn nhất   : ${dd(Math.max(...gains), true)}`);
  console.log(`Tổng thời gian tặng : ${dd(gains.reduce((a, b) => a + b, 0))} (nếu reset hết)`);
}

// Trial: max_rebind = 0
const trials = rows.filter((r) => r.plan === 'trial');
console.log(`\n=== TRIAL (plan='trial') ===`);
console.log(`Số trial: ${trials.length}`);
const t0 = trials.filter((r) => (r.max_rebind || 0) === 0);
console.log(`  max_rebind = 0 : ${t0.length}  → KHÔNG BAO GIỜ đổi máy được (đúng thiết kế)`);

// Phân bố max_rebind
const mix = {};
for (const r of rows) {
  const k = `max_rebind=${r.max_rebind ?? 'NULL'}`;
  mix[k] = (mix[k] || 0) + 1;
}
console.log('\n=== Phân bố max_rebind toàn bộ (backup) ===');
for (const [k, v] of Object.entries(mix).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);

// Đã hết lượt
const exhausted = rows.filter((r) => r.hwid && (r.rebinds || 0) >= (r.max_rebind || 0));
console.log(`\nKey ĐÃ hết lượt đổi máy (rebinds >= max_rebind): ${exhausted.length}/${rows.filter((r) => r.hwid).length} key đã gán`);
