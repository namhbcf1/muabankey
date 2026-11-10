import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'public/assets';
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push(p);
  }
})(dir);

// Consider an interpolation "safe" if it's wrapped in esc(...) or a numeric/format helper
const SAFE = /^(esc\(|fmtVnd\(|fmtNum\(|fmtDate\(|timeAgo\(|Number\(|Math\.|JSON\.|encodeURIComponent\(|new Intl|String\(|label\b|cls\b|ico\b|n\b|i\b|p\b|'\s*$)/;
const ALLOW = new Set(['label', 'cls', 'ico', 'n', 'qty', 'n2', 'idx', 'total', 'cur', 'p', 'i', 'maxQty', 'stockClass', 'stockText', 'daysLeft', 'discount', 'subtotal', 'total', 'left', 'polls', 'diff', 'm', 'h', 'd']);

let hits = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((ln, i) => {
    const m = ln.match(/\$\{([^}]*)\}/g);
    if (!m) return;
    for (const raw of m) {
      const expr = raw.slice(2, -1).trim();
      if (SAFE.test(expr)) continue;
      if (ALLOW.has(expr)) continue;
      hits.push({ file: f, line: i + 1, expr, code: ln.trim().slice(0, 130) });
    }
  });
}

console.log('TOTAL', hits.length);
const byFile = {};
for (const h of hits) (byFile[h.file] ||= []).push(h);
for (const [f, arr] of Object.entries(byFile)) {
  console.log('\n### ' + f + ' (' + arr.length + ')');
  for (const h of arr) console.log(`  ${h.line}: ${h.expr}   << ${h.code}`);
}
