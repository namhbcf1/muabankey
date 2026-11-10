import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const url = 'https://xienhl.com/assets/pages/licenses.js';
const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
const c = await r.text();

console.log('  Length:', c.length);
const p = join(tmpdir(), 'lic-check.js');
writeFileSync(p, c, 'utf8');

try {
  execSync(`node --check "${p}"`, { stdio: 'pipe' });
  console.log('  ✅ Ban server: syntax OK');
} catch (e) {
  console.log('  ❌ Ban server: LOI syntax');
  console.log('  ', String(e.stderr || e.message).split('\n').slice(0, 6).join('\n   '));
}

// In vung sau copyone
const i = c.indexOf('data-copyone');
console.log('\n  --- Vung sau data-copyone ---');
console.log(c.slice(i, i + 500).split('\n').slice(0, 16).map((l) => '    ' + l).join('\n'));

// Dem
const tryN = (c.match(/try\s*\{/g) || []).length;
const catchN = (c.match(/catch\s*[\({]/g) || []).length;
console.log(`\n  try: ${tryN} | catch: ${catchN}`);
