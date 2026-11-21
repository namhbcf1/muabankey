/** Global abuse limiter must fail closed on D1/KV outage. */
import { Suite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const S = new Suite('Global rate limit');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src/index.js'), 'utf8');
S.ok(/rateLimit\(env, `g:\$\{clientIp\(request\)\}`, 3000, 60, \{ failClosed: true \}\)/.test(src), 'global limiter fail-closed khi hạ tầng đếm lỗi');
S.ok(!/rateLimit\(env, `g:\$\{clientIp\(request\)\}`, 3000, 60\);/.test(src), 'không còn global limiter fail-open');
process.exit(S.summary() ? 0 : 1);
