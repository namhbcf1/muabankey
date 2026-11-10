import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const B = 'https://xienhl.com';

const r = await fetch(B + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo', password: 'Demo@123456' }),
});
const ck = r.headers.get('set-cookie').match(/mbk_session=[^;]+/)[0];

const mine = await fetch(B + '/api/licenses/mine', { headers: { Cookie: ck } }).then((x) => x.json());
const key = mine.licenses[0].key;

const tok = await fetch(B + '/api/licenses/' + encodeURIComponent(key) + '/install-token', {
  method: 'POST', headers: { Cookie: ck },
}).then((x) => x.json());

const out = join(tmpdir(), 'cmdurl.txt');
writeFileSync(out, tok.downloadCmd, 'utf8');
console.log('key     :', key);
console.log('url     :', tok.downloadCmd);
console.log('đã ghi  :', out);
