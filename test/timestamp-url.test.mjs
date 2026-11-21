/** Release signing must use TLS for timestamp transport. */
import { Suite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const S = new Suite('Signing timestamp');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['tool/build-arena.ps1','tool/sign/sign-exe.ps1']) {
  const s = readFileSync(join(ROOT, f), 'utf8');
  S.ok(!/http:\/\/timestamp\.digicert\.com/.test(s), `${f}: không dùng timestamp HTTP`);
  S.ok(/https:\/\/timestamp\.digicert\.com/.test(s), `${f}: dùng timestamp HTTPS`);
}
process.exit(S.summary() ? 0 : 1);
