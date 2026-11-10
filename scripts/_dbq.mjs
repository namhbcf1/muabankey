/**
 * _dbq.mjs — chạy nhiều câu SQL trên D1 remote qua REST API.
 * Dùng: node scripts/_dbq.mjs queries.sql [out.json]
 * Mỗi câu được tách bằng marker:  -- @q: <nhãn>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN = 'cfut_36vwtVnGqd2KYb59ZWgI9faJGhStWQdeNIdEVWHba90694c6';
const ACCOUNT = '5b62d10947844251d23e0eac532531dd';
const DBID = '81f478c9-5627-458a-a35f-d483e69d400b';
const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DBID}/query`;

const file = process.argv[2];
const sql = readFileSync(file, 'utf8');

const chunks = [];
let cur = null;
for (const line of sql.split(/\r?\n/)) {
  const m = line.match(/^--\s*@q:\s*(.+)$/);
  if (m) { if (cur) chunks.push(cur); cur = { label: m[1].trim(), body: [] }; }
  else if (cur) cur.body.push(line);
}
if (cur) chunks.push(cur);

const out = [];
for (const c of chunks) {
  const statement = c.body.join('\n').trim().replace(/;\s*$/, '');
  if (!statement) continue;
  let rows = null, err = null;
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: statement }),
    });
    const j = await r.json();
    if (!j.success) {
      err = JSON.stringify(j.errors || j).slice(0, 600);
    } else {
      const res = j.result?.[0];
      if (res?.success === false) err = JSON.stringify(res.error || res).slice(0, 600);
      else rows = res?.results ?? [];
    }
  } catch (e) { err = 'FETCH: ' + e.message; }

  out.push({ label: c.label, sql: statement, rows, error: err });
  const n = rows ? rows.length : 0;
  console.log(`\n===== ${c.label}  [${err ? 'ERR' : n + ' rows'}]`);
  if (err) { console.log('  !! ' + err); continue; }
  if (!n) { console.log('  (0 dòng)'); continue; }
  // In gọn: nếu 1 dòng thì in object, nhiều dòng thì JSON lines
  if (n <= 60) for (const r of rows) console.log('  ' + JSON.stringify(r));
  else { for (const r of rows.slice(0, 60)) console.log('  ' + JSON.stringify(r)); console.log(`  … +${n - 60} dòng nữa`); }
}

if (process.argv[3]) {
  writeFileSync(process.argv[3], JSON.stringify(out, null, 1), 'utf8');
  console.log('\n[đã ghi] ' + process.argv[3]);
}
