/**
 * Verify every route handler referenced in src/index.js actually exists
 * as an export in its module, and detect duplicate registrations.
 */
import fs from 'node:fs';

const idx = fs.readFileSync('src/index.js', 'utf8');

// collect imports: import * as alias from './path';
const imports = {};
for (const m of idx.matchAll(/import \* as (\w+) from '([^']+)'/g)) {
  imports[m[1]] = m[2];
}

// load module exports keys via dynamic import
const exportMap = {};
for (const [alias, spec] of Object.entries(imports)) {
  const url = 'file://' + process.cwd().replace(/\\/g, '/') + '/' + spec.replace(/^\.\//, 'src/');
  const mod = await import(url);
  exportMap[alias] = new Set(Object.keys(mod));
}

// collect route registrations
const routes = [];
for (const m of idx.matchAll(/r\.(get|post|patch|put|delete)\('([^']+)',\s*([\s\S]{0,200}?)\);/g)) {
  routes.push({ method: m[1].toUpperCase(), path: m[2], handler: m[3].replace(/\s+/g, ' ') });
}

const missing = [];
for (const r of routes) {
  // direct: alias.fn   or arrow using alias.fn
  const refs = [...r.handler.matchAll(/(\w+)\.(\w+)/g)]
    .filter((x) => imports[x[1]]);
  if (!refs.length) {
    missing.push({ ...r, issue: 'no module reference found (inline handler?)' });
    continue;
  }
  for (const [, alias, fn] of refs) {
    if (!exportMap[alias].has(fn)) {
      missing.push({ ...r, issue: `missing export ${alias}.${fn}` });
    }
  }
}

console.log('=== ROUTES MISSING EXPORT ===');
if (!missing.length) console.log('(none)');
for (const m of missing) console.log(`${m.method} ${m.path}  ->  ${m.issue}`);

// duplicates
const seen = new Map();
const dups = [];
for (const r of routes) {
  const k = r.method + ' ' + r.path;
  if (seen.has(k)) dups.push(k + '  (registered ' + r.handler.slice(0, 70) + ')');
  seen.set(k, true);
}
console.log('\n=== DUPLICATE ROUTE REGISTRATIONS ===');
if (!dups.length) console.log('(none)');
for (const d of dups) console.log(d);

console.log(`\ntotal routes registered: ${routes.length}`);
