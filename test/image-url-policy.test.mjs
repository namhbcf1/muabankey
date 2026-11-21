/** Product image URL policy must match HTTPS-only CSP-safe contract. */
import { Suite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const S = new Suite('Product image policy');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src/routes/products.js'), 'utf8');
S.ok(/normalizeProductImageUrl/.test(src), 'admin product save normalizes image URL');
S.ok(/u\.protocol !== 'https:'/.test(src), 'image URL rejects non-HTTPS schemes');
S.ok(/IMAGE_URL_INVALID/.test(src), 'invalid URL has typed error');
S.ok(/IMAGE_URL_INSECURE/.test(src), 'insecure URL has typed error');
process.exit(S.summary() ? 0 : 1);
