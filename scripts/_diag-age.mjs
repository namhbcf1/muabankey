/** Phân tích dữ liệu thật: tuổi key vs hạn còn lại (đọc). */
import { readFileSync } from 'node:fs';
const B = 'https://xienhl.com';
const pw = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];
const now = Math.floor(Date.now() / 1000);
const ts = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—');
const dd = (s) => (s / 86400).toFixed(1) + 'd';

const r = await fetch(B + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'namhbcf', password: pw }),
});
const ck = r.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];
const d = await fetch(B + '/api/admin/licenses', { headers: { Cookie: ck } }).then((x) => x.json());
const L = d.licenses || [];
console.log(`Tổng mẫu: ${L.length}, tổng DB: ${d.stats.total}\n`);

const age = L.map((l) => ({ ...l, tuoi: now - (l.createdAt || now), conlai: (l.expiresAt || 0) - now }));
const old = age.filter((x) => x.tuoi > 2 * 86400);
console.log(`Key tạo > 2 ngày trước: ${old.length}`);
console.log(`  trong đó còn hạn: ${old.filter((x) => x.conlai > 0).length}`);
console.log(`  trong đó CHƯA gán: ${old.filter((x) => !x.bound).length}`);

const usable = old.filter((x) => !x.bound && x.conlai > 0).slice(0, 10);
if (usable.length) {
  console.log('\nKey CHƯA GÁN + còn hạn + tạo > 2 ngày (ứng viên test):');
  for (const x of usable) {
    console.log(`  ${x.key}  tạo=${ts(x.createdAt)} (${dd(x.tuoi)})  hạn=${ts(x.expiresAt)} (còn ${dd(x.conlai)}) max=${x.maxRebind}`);
  }
} else {
  console.log('\nKhông có key chưa gán nào tạo > 2 ngày mà còn hạn.');
  console.log('Top 5 key tạo > 2 ngày (bất kỳ trạng thái):');
  for (const x of old.slice(0, 5)) {
    console.log(`  ${x.key}  ${x.status.padEnd(9)} tạo=${ts(x.createdAt)} (${dd(x.tuoi)})  hạn=${ts(x.expiresAt)}  bound=${x.bound}`);
  }
}

/* Công thức bindFirstTime: days = round((expires_at - created_at)/86400); exp = now + days*86400 */
console.log('\n=== MÔ PHỎNG công thức bindFirstTime trên dữ liệu thật ===');
console.log('(dùng cho mỗi key: nếu reset + activate LẠI bây giờ, hạn mới = now + days*86400)\n');
let shown = 0;
for (const x of age) {
  if (x.bound || !x.expiresAt || x.conlai <= 0) continue;
  const days = Math.max(1, Math.round((x.expiresAt - x.createdAt) / 86400));
  const expMoi = now + days * 86400;
  const them = expMoi - x.expiresAt;
  if (them < 3600) continue;
  console.log(`  ${x.key}  tuổi=${dd(x.tuoi)}  hạn hiện tại=${ts(x.expiresAt)}  hạn SAU reset+activate=${ts(expMoi)}  TẶNG THÊM ${dd(them)}`);
  if (++shown >= 6) break;
}
if (!shown) console.log('  (không có mẫu phù hợp trong 300 bản ghi này)');
