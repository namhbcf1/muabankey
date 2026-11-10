/** Dọn key test đã tạo trong quá trình chẩn đoán. */
import { readFileSync } from 'node:fs';
const B = 'https://xienhl.com';
const pw = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];
const r = await fetch(B + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'namhbcf', password: pw }),
});
const ck = r.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];
const keys = ['AOE1-GFFZ-HZZN-TJTD', 'RACE-ZDEM-4CGE-5GQ9', 'GIFT-2XFJ-JNSK-493A'];
for (const k of keys) {
  const res = await fetch(B + `/api/admin/licenses/${encodeURIComponent(k)}/revoke`, {
    method: 'POST', headers: { Cookie: ck },
  });
  const d = await res.json();
  console.log(`  ${k}: HTTP ${res.status} status=${d.license?.status} note=${(d.license?.note || '').slice(0, 30)}`);
}
