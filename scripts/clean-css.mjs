/**
 * clean-css.mjs — Xoá các nhóm CSS KHÔNG CÒN được tham chiếu.
 *
 * AN TOÀN:
 *   - Block mà MỌI selector đều chết -> bỏ cả block.
 *   - Block TRỘN -> chỉ bỏ selector chết khỏi danh sách; trong CSS mỗi
 *     selector phân tách bằng dấu phẩy là độc lập, nên bỏ một cái không làm
 *     đổi hành vi của những cái còn lại.
 *   - Không đụng @media / @keyframes / @font-face (giữ nguyên toàn bộ).
 *   - Chạy không có --write để chỉ ĐO.
 *   - Có --write thì ghi bản sao lưu trước.
 *
 * Dùng: node scripts/clean-css.mjs [--write]
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const CSS = 'public/assets/style.css';
const src = readFileSync(CSS, 'utf8');

/**
 * Tiền tố coi là chết — đã grep toàn bộ public/assets/*.js, public/index.html
 * và public/_headers: 0 lần xuất hiện.
 *
 * KHÔNG có 'qr-': vẫn còn dùng 6 lần.
 */
const DEAD_PREFIXES = [
  'cart-', 'drawer-', 'qty-', 'key-box', 'key-copy', 'key-value',
  'ck-item', 'ck-pay', 'ck-wallet', 'ck-summary', 'ck-receipt',
  'ck-license', 'ck-delivered', 'ck-done-receipt',
  'tx-', 'pd-review', 'summary-row', 'chip-row', 'balance-chip',
  'badge-dot', 'cred-', 'cmd-block',
];

/** Selector chết khi MỌI class trong nó đều thuộc nhóm chết. */
function selectorIsDead(sel) {
  const s = sel.trim();
  if (!s) return false;
  const classes = [...s.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  if (!classes.length) return false;
  return classes.every((c) => DEAD_PREFIXES.some((p) => c === p || c.startsWith(p)));
}

/** Tách thành các block cấp 1 (đủ dùng cho file này). */
function splitBlocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    let start = open - 1;
    while (start >= 0 && !'};'.includes(css[start])) start--;
    const prelude = css.slice(start + 1, open);
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    out.push({ prelude: prelude.trim(), body: css.slice(open, j), raw: css.slice(start + 1, j) });
    i = j;
  }
  return out;
}

const blocks = splitBlocks(src);

let removedBlocks = 0;
let removedBytes = 0;
const removedList = [];
const trimmedSelectors = [];

let out = '';
let last = 0;

for (const b of blocks) {
  const idx = src.indexOf(b.raw, last);
  if (idx === -1) { out += b.raw; continue; }
  out += src.slice(last, idx);

  /*
   * Bóc comment khỏi prelude TRƯỚC khi xét: khối @media thường bị một comment
   * đứng ngay trước, nên `prelude.startsWith('@')` không đủ để nhận ra.
   * Sửa bên trong @media bằng cách bóc selector là quá rủi ro (dễ làm hỏng
   * cú pháp), nên chỉ cần thấy '@' là bỏ qua toàn bộ block.
   */
  const preludeClean = b.prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const isAtRule = b.prelude.includes('@');
  const selectors = preludeClean.split(',').map((s) => s.trim()).filter(Boolean);
  const deadSelectors = selectors.filter(selectorIsDead);

  if (isAtRule || deadSelectors.length === 0) {
    out += b.raw;
  } else if (deadSelectors.length === selectors.length && selectors.length > 0) {
    removedBlocks++;
    removedBytes += b.raw.length;
    removedList.push(preludeClean.slice(0, 70));
    out += '\n';
  } else {
    const liveSelectors = selectors.filter((s) => !selectorIsDead(s));
    const indentMatch = src.slice(idx, idx + 60).match(/\n(\s+)/);
    const sep = indentMatch ? `,\n${indentMatch[1]}` : ',';
    out += `${liveSelectors.join(sep)}${b.body.slice(b.body.indexOf('{'))}`;
    trimmedSelectors.push({
      prelude: preludeClean.slice(0, 55),
      removed: selectors.length - liveSelectors.length,
      kept: liveSelectors.length,
    });
  }
  last = idx + b.raw.length;
}
out += src.slice(last);

// Dọn dòng trắng thừa sinh ra do xoá
out = out.replace(/\n{3,}/g, '\n\n');

const before = src.split('\n').length;
const after = out.split('\n').length;

console.log(`Block xoá cả      : ${removedBlocks}`);
console.log(`Selector bỏ lẻ    : ${trimmedSelectors.reduce((s, m) => s + m.removed, 0)}`);
console.log(`Dung lượng giảm   : ${removedBytes} B`);
console.log(`Dòng              : ${before} -> ${after} (giảm ${before - after})`);

if (trimmedSelectors.length) {
  console.log(`\nBlock TRỘN — bỏ selector chết, GIỮ selector sống (${trimmedSelectors.length}):`);
  for (const m of trimmedSelectors) console.log(`  ${m.prelude}  (bỏ ${m.removed}, giữ ${m.kept})`);
}
if (removedList.length) {
  console.log(`\nĐã xoá (${removedList.length}):`);
  for (const r of removedList) console.log(`  ${r}`);
}

if (process.argv.includes('--write')) {
  copyFileSync(CSS, `${CSS}.bak-clean`);
  writeFileSync(CSS, out, 'utf8');
  console.log(`\n✓ Đã ghi ${CSS}  (sao lưu: ${CSS}.bak-clean)`);
} else {
  console.log('\n(chỉ đo — thêm --write để ghi)');
}
