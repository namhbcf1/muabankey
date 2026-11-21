/** Verify the package quality gate includes the shipped Python coordinator suite. */
import { Suite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const S = new Suite('Python quality gate');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const verify = pkg.scripts.verify || '';
S.ok(/python\s+test\/app-coordinator\.test\.py/.test(verify), 'npm run verify chạy Python coordinator test');
S.ok(/node test\/run\.mjs/.test(verify), 'npm run verify vẫn chạy JavaScript suites');
S.ok(/scripts\/check-syntax\.mjs/.test(verify), 'npm run verify vẫn kiểm syntax/import');
process.exit(S.summary() ? 0 : 1);
