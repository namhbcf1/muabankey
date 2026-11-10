import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const B = 'https://xienhl.com';

const pw = 'Demo@123456';
const r = await fetch(B + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo', password: pw }),
});
const ck = r.headers.get('set-cookie').match(/mbk_session=[^;]+/)[0];
const mine = await fetch(B + '/api/licenses/mine', { headers: { Cookie: ck } }).then((x) => x.json());
const key = mine.licenses[0].key;

const tok = await fetch(B + '/api/licenses/' + encodeURIComponent(key) + '/install-token', {
  method: 'POST', headers: { Cookie: ck },
}).then((x) => x.json());

console.log('\n=== KIEM TRA PS1 ===\n');
console.log('  oneLiner   :', tok.oneLiner);

const res = await fetch(tok.downloadPs1);
const ct = res.headers.get('content-type');
const ps = await res.text();

console.log('  Content-Type:', ct);
console.log('  Co BOM      :', ps.charCodeAt(0) === 0xFEFF ? 'CO (LOI)' : 'KHONG (OK)');
console.log('  Co selfUrl  :', ps.includes('/i/' + key + '.ps1') ? 'CO (OK)' : 'KHONG (LOI)');
console.log('  PSCommandPath trong Start-Process:',
  /-File', \$PSCommandPath/.test(ps) ? 'CON (LOI)' : 'KHONG (OK)');
console.log('  Chieu dai   :', ps.length, 'bytes');

// Luu ra file de test that
const out = join(tmpdir(), 'xa-selftest.ps1');
writeFileSync(out, ps, 'utf8');
console.log('  Da luu      :', out);

// In khoi admin de xem bang mat
const idx = ps.indexOf('$isAdmin');
console.log('\n--- Khoi admin ---');
console.log(ps.slice(idx, idx + 700));
