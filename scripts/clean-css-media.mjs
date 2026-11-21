/**
 * clean-css-media.mjs — Xoá các RULE đơn lẻ còn sót trong @media.
 *
 * Vì sao phải làm riêng: `clean-css.mjs` cố tình BỎ QUA toàn bộ @media (sửa
 * cấu trúc bên trong bằng cách bóc selector là quá rủi ro). Nhưng vài class
 * chết vẫn nằm trong đó, nên xử lý riêng — chỉ xoá RULE có selector HOÀN
 * TOÀN chết, và chỉ khi rule đó nằm trên MỘT dòng (không đụng khối nhiều dòng).
 *
 * Dùng: node scripts/clean-css-media.mjs [--write]
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const CSS = 'public/assets/style.css';

/** Class chết đã kiểm: 0 lần xuất hiện trong public/assets/**\/*.js + index.html. */
const DEAD = new Set([
  'cart-item', 'cart-thumb', 'cart-info', 'cart-name', 'cart-price',
  'cart-remove', 'cart-badge', 'cart-drawer',
  'drawer-overlay', 'drawer-head', 'drawer-title', 'drawer-body', 'drawer-foot',
  'qty-row', 'qty-ctrl', 'qty-badge',
  'key-box', 'key-value', 'key-copy',
  'ck-item', 'ck-item-total', 'ck-pay', 'ck-wallet', 'ck-summary', 'ck-receipt',
  'ck-license', 'ck-delivered', 'ck-done-receipt', 'ck-pay-note',
  'tx-amt', 'tx-row', 'tx-list', 'tx-type', 'tx-time', 'tx-amount', 'tx-note',
  'pd-review', 'pd-review-list', 'pd-review-item',
  'summary-row', 'chip-row', 'balance-chip', 'badge-dot',
  'cred-row', 'cred-label', 'cred-value', 'cmd-block',
]);

/** Selector có phải HOÀN TOÀN chết? */
function deadSelector(sel) {
  const classes = [...sel.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  if (!classes.length) return false;
  return classes.every((c) => DEAD.has(c) || [...DEAD].some((d) => c.startsWith(d + '-')));
}

const lines = readFileSync(CSS, 'utf8').split('\n');
const removed = [];
const out = [];

for (const line of lines) {
  const t = line.trim();
  // Chỉ xét dòng là MỘT rule trọn vẹn: "sel{...}" và không phải at-rule
  const m = t.match(/^([^{}@]+)\{([^{}]*)\}$/);
  if (m) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (selectors.length && selectors.every(deadSelector)) {
      removed.push(t.slice(0, 70));
      continue; // bỏ dòng này
    }
  }
  out.push(line);
}

console.log(`Rule xoá: ${removed.length}`);
for (const r of removed) console.log(`  ${r}`);
console.log(`Dòng: ${lines.length} -> ${out.length}`);

if (process.argv.includes('--write')) {
  copyFileSync(CSS, `${CSS}.bak-media`);
  writeFileSync(CSS, out.join('\n'), 'utf8');
  console.log(`\n✓ Đã ghi (sao lưu: ${CSS}.bak-media)`);
} else {
  console.log('\n(chỉ đo — thêm --write để ghi)');
}
