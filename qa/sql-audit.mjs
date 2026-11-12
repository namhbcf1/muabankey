/**
 * Static audit: find D1 prepare() calls where the number of bind() args
 * does not match the number of bound placeholders in the SQL.
 *
 * Handles: single-line and multi-line template literals, VALUES(...) with
 * literal tokens, string-concatenated SQL, and `.bind(...args)` spreads
 * (reported separately for manual review).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || 'src';
const files = [];
(function walk(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.js')) files.push(f);
  }
})(root);

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

/** Count placeholders in a SQL fragment, ignoring quoted string literals. */
function countPlaceholders(sql) {
  // strip single-quoted literals
  const cleaned = sql.replace(/'(?:[^']|'')*'/g, "''");
  const q = (cleaned.match(/\?/g) || []).length;
  return q;
}

/** Count top-level literal values inside a VALUES (...) tuple list. */
function countValueTokens(sql) {
  const m = sql.match(/\bVALUES\b([\s\S]*)$/i);
  if (!m) return null;
  let s = m[1];
  // cut trailing content after the final closing paren of the tuple list
  // count top-level comma-separated tokens across all tuples
  let depth = 0;
  let inStr = false;
  const tokens = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { inStr = !inStr; cur += c; continue; }
    if (!inStr) {
      if (c === '(') { depth++; if (depth === 1) { cur = ''; continue; } }
      if (c === ')') {
        depth--;
        if (depth === 0) { if (cur.trim()) tokens.push(cur.trim()); cur = ''; continue; }
      }
      if (c === ',' && depth === 1) { tokens.push(cur.trim()); cur = ''; continue; }
      // stop when tuple list ends and a new statement-ish token appears
      if (depth === 0 && /[A-Za-z`;]/.test(c) && tokens.length) break;
    }
    if (depth >= 1) cur += c;
  }
  return tokens;
}

const findings = [];
const reviews = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /\.prepare\(\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*')\s*\)\s*\.bind\(([\s\S]{0,900}?)\)\s*\.(run|all|first|raw)\(/g;
  let m;
  while ((m = re.exec(src))) {
    const rawSql = m[1];
    const sql = rawSql.slice(1, -1).replace(/\\`/g, '`').replace(/\\'/g, "'");
    const bindArgs = m[2];
    if (bindArgs.includes('...')) {
      reviews.push({ file, line: lineOf(src, m.index), kind: 'spread', sql: sql.replace(/\s+/g, ' ').slice(0, 90) });
      continue;
    }
    // count top-level commas in bind args
    let depth = 0; let inStr = false; let n = bindArgs.trim() ? 1 : 0;
    for (const c of bindArgs) {
      if (c === "'" || c === '"' || c === '`') inStr = !inStr;
      if (inStr) continue;
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ',' && depth === 0) n++;
    }
    const ph = countPlaceholders(sql);
    const toks = countValueTokens(sql);
    let literalNonQ = 0;
    let tupleLen = null;
    if (toks && toks.length) {
      tupleLen = toks.length;
      literalNonQ = toks.filter((t) => t !== '?').length;
      // only meaningful for INSERT ... VALUES
    }
    const isInsert = /^\s*INSERT\s+INTO/i.test(sql);
    if (isInsert && tupleLen !== null) {
      const cols = sql.match(/\(([^)]*)\)\s*VALUES/i);
      const nCols = cols ? cols[1].split(',').filter((x) => x.trim()).length : null;
      if (nCols !== null && tupleLen !== nCols) {
        findings.push({
          file, line: lineOf(src, m.index), severity: 'HIGH',
          issue: `INSERT column/value arity mismatch: ${nCols} columns vs ${tupleLen} values`,
          cols: nCols, values: tupleLen,
          bindArgs: n, placeholders: ph,
          sql: sql.replace(/\s+/g, ' ').slice(0, 150),
        });
        continue;
      }
      if (n !== ph) {
        findings.push({
          file, line: lineOf(src, m.index), severity: 'HIGH',
          issue: `bind count ${n} != placeholder count ${ph}`,
          cols: nCols, values: tupleLen, bindArgs: n, placeholders: ph,
          sql: sql.replace(/\s+/g, ' ').slice(0, 150),
        });
      }
      continue;
    }
    if (n !== ph) {
      findings.push({
        file, line: lineOf(src, m.index), severity: 'HIGH',
        issue: `bind count ${n} != placeholder count ${ph}`,
        bindArgs: n, placeholders: ph,
        sql: sql.replace(/\s+/g, ' ').slice(0, 150),
      });
    }
  }
}

console.log('=== ARITY FINDINGS ===');
if (!findings.length) console.log('(none)');
for (const f of findings) console.log(`${f.severity}  ${f.file}:${f.line}  ${f.issue}\n     ${f.sql}`);
console.log('\n=== MANUAL REVIEW (spread binds) ===');
for (const r of reviews) console.log(`${r.file}:${r.line}  ${r.sql}`);
