/**
 * Rigorous static audit of D1 prepare(...).bind(...) arity.
 * Uses paren balancing so nested calls / batch arrays do not overrun.
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

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/** Read a balanced (...) group starting at src[i] === '('. Returns {body, end}. */
function readGroup(src, i) {
  let depth = 0, inStr = null, out = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += src[++i]; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; out += c; continue; }
    if (c === '(') { depth++; if (depth === 1) continue; }
    if (c === ')') { depth--; if (depth === 0) return { body: out, end: i }; }
    out += c;
  }
  return { body: out, end: i };
}

function splitTopLevel(s, sep = ',') {
  const parts = [];
  let depth = 0, inStr = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === '\\') { cur += s[++i]; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const problems = [];
const notes = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let idx = 0;
  while (true) {
    const p = src.indexOf('.prepare(', idx);
    if (p < 0) break;
    idx = p + 1;
    const g = readGroup(src, p + '.prepare'.length);
    const argText = g.body.trim();
    // SQL must be a template/string literal
    if (!/^[`'"]/.test(argText)) continue;
    let sql = argText.slice(1, -1);
    let after = g.end + 1;
    // optionally skip whitespace
    let k = after;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (!src.startsWith('.bind(', k)) {
      // no bind -> nothing to check unless SQL has placeholders
      const ph = (sql.replace(/'(?:[^']|'')*'/g, "''").match(/\?/g) || []).length;
      if (ph > 0) notes.push({ file, line: lineOf(src, p), sql, ph });
      continue;
    }
    const b = readGroup(src, k + '.bind'.length);
    const bindStr = b.body;
    // terminal method after bind
    let t = b.end + 1;
    while (t < src.length && /\s/.test(src[t])) t++;
    const term = /^\.(run|all|first|raw|batch)\(/.exec(src.slice(t));
    if (!term && !src.startsWith(')', t)) {
      // part of a batch array element; still check arity
    }
    const hasSpread = bindStr.includes('...');
    const ph = (sql.replace(/'(?:[^']|'')*'/g, "''").match(/\?/g) || []).length;

    if (hasSpread) {
      notes.push({ file, line: lineOf(src, p), sql, ph, spread: true, bind: bindStr.replace(/\s+/g, ' ').slice(0, 80) });
      continue;
    }
    const args = bindStr.trim() ? splitTopLevel(bindStr) : [];
    const nArgs = args.length;

    // INSERT column/value arity
    const ins = /^\s*INSERT\s+INTO\s+([\w`"]+)\s*\(([\s\S]*?)\)\s*VALUES([\s\S]*)$/i.exec(sql);
    if (ins) {
      const cols = splitTopLevel(ins[2]).filter((x) => x.trim());
      const valuesPart = ins[3];
      // first balanced tuple
      const open = valuesPart.indexOf('(');
      if (open >= 0) {
        const tg = readGroup(valuesPart, open);
        const vals = splitTopLevel(tg.body).filter((x) => x.trim());
        if (vals.length !== cols.length) {
          problems.push({
            file, line: lineOf(src, p), severity: 'P0',
            issue: `INSERT arity: ${cols.length} columns vs ${vals.length} values`,
            detail: `cols=[${cols.map((c) => c.trim()).join(',')}]`,
          });
        }
        // Authoritative check: bind() arg count must equal total placeholders.
        // (Comparing against VALUES slots only is unreliable for ON CONFLICT /
        // subquery / multi-statement SQL, so it is intentionally not used.)
        if (nArgs !== ph) {
          problems.push({
            file, line: lineOf(src, p), severity: 'P0',
            issue: `INSERT bind args(${nArgs}) != total placeholders(${ph})`,
            bind: args.map((a) => a.trim().slice(0, 28)),
          });
        }
      }
      continue;
    }

    if (nArgs !== ph) {
      problems.push({
        file, line: lineOf(src, p), severity: 'P0',
        issue: `bind args(${nArgs}) != placeholders(${ph})`,
        bind: args.map((a) => a.trim().slice(0, 28)),
        sql: sql.replace(/\s+/g, ' ').slice(0, 120),
      });
    }
  }
}

console.log('=== PROBLEMS ===');
if (!problems.length) console.log('(none)');
for (const x of problems) {
  console.log(`${x.severity} ${x.file}:${x.line}  ${x.issue}`);
  if (x.bind) console.log('      bind: ' + JSON.stringify(x.bind));
  if (x.detail) console.log('      ' + x.detail);
  if (x.sql) console.log('      sql : ' + x.sql);
}
console.log('\n=== SPREAD / DYNAMIC (manual review) ===');
for (const x of notes) console.log(`${x.file}:${x.line} ph=${x.ph}${x.spread ? ' SPREAD ' + x.bind : '  ' + x.sql.replace(/\s+/g, ' ').slice(0, 100)}`);
