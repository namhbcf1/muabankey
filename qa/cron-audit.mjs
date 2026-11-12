/**
 * Cron cleanup audit:
 *  - For every table the cron DELETEs from, check the column it filters on
 *    actually exists AND holds the right unit (ms vs sec).
 *  - Flag any DELETE that targets a column the table does not have
 *    (silently no-ops forever -> table grows unbounded).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const idx = fs.readFileSync('src/index.js', 'utf8');

// extract DELETE FROM <table> WHERE <col> <op> ?
const dels = [];
const re = /DELETE\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*([<>=]+)\s*\?/gi;
let m;
while ((m = re.exec(idx))) {
  dels.push({ table: m[1], col: m[2], op: m[3], line: idx.slice(0, m.index).split('\n').length });
}

// also UPDATE ... SET status='expired' WHERE status='pending' AND <col> < ?
const upds = [];
const ure = /UPDATE\s+(\w+)\s+SET[\s\S]{0,200}?WHERE[\s\S]{0,200}?(\w+)\s*<\s*\?/gi;
while ((m = ure.exec(idx))) {
  upds.push({ table: m[1], col: m[2], line: idx.slice(0, m.index).split('\n').length });
}

const d1 = (sql) => JSON.parse(execSync(
  `node qa/d1q.mjs ${JSON.stringify(sql)}`, { encoding: 'utf8' }));

const tables = [...new Set([...dels.map((d) => d.table), ...upds.map((u) => u.table)])];
const schema = {};
for (const t of tables) {
  schema[t] = d1(`PRAGMA table_info(${t})`).map((c) => c.name);
}

console.log('=== CRON DELETE targets ===');
for (const d of dels) {
  const cols = schema[d.table] || [];
  const has = cols.includes(d.col);
  console.log(`${has ? 'OK  ' : 'BUG '} index.js:${d.line}  DELETE FROM ${d.table} WHERE ${d.col} (${cols.length} cols)`);
  if (!has) {
    console.log(`       !! column "${d.col}" does not exist in ${d.table}`);
    console.log(`       columns: ${cols.join(', ')}`);
  }
}

console.log('\n=== CRON UPDATE ... expires targets ===');
for (const u of upds) {
  const cols = schema[u.table] || [];
  const has = cols.includes(u.col);
  console.log(`${has ? 'OK  ' : 'BUG '} index.js:${u.line}  UPDATE ${u.table} ... WHERE ${u.col} < ?`);
  if (!has) console.log(`       !! column "${u.col}" missing; columns: ${cols.join(', ')}`);
}

// unit sanity: compare column magnitude against now
console.log('\n=== UNIT SANITY (ms vs sec) ===');
const nowMs = Date.now();
const nowSec = Math.floor(nowMs / 1000);
for (const t of tables) {
  const cols = schema[t] || [];
  for (const c of cols) {
    if (!/(_at|at|expires|created)$/.test(c)) continue;
    const r = d1(`SELECT MIN(${c}) mn, MAX(${c}) mx FROM ${t} WHERE ${c} IS NOT NULL AND ${c} > 0`);
    const { mn, mx } = r[0] || {};
    if (mn == null) continue;
    // sec values ~1.7e9 ; ms values ~1.7e12
    const unit = mx > 1e11 ? 'MS' : 'SEC';
    const expected = /(expires_at)$/.test(c) ? '' : '';
    console.log(`${t}.${c}: min=${mn} max=${mx} -> ${unit}`);
  }
}
void nowMs; void nowSec; void expected;
