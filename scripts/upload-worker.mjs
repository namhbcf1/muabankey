/**
 * Upload Worker trực tiếp qua Cloudflare API, bỏ qua Workers Versions API
 * (đang lỗi 10021 "binding DB of type d1 failed to generate").
 *
 * Dùng PUT /accounts/:id/workers/scripts/:name với multipart/form-data.
 */
import { readFileSync } from 'node:fs';

const TOKEN = process.env.CF_TOKEN;
const ACCT = process.env.CF_ACCT;
const NAME = 'muabankey';

const script = readFileSync('.dry2/index.js', 'utf8');

const metadata = {
  main_module: 'worker.js',
  compatibility_date: '2025-11-10',
  bindings: [
    { type: 'd1', name: 'DB', id: '81f478c9-5627-458a-a35f-d483e69d400b' },
    { type: 'kv_namespace', name: 'CACHE', namespace_id: 'c8dd77b0855b4012b0c68bcb62027f7a' },
    { type: 'r2_bucket', name: 'MEDIA', bucket_name: 'muabankey-assets' },
    { type: 'ai', name: 'AI' },
  ],
  observability: { enabled: true },
};

async function main() {
  console.log('\n📤 Upload Worker qua API trực tiếp\n');
  console.log(`Script: ${script.length} bytes`);

  const fd = new FormData();
  fd.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  fd.append('worker.js', new Blob([script], { type: 'application/javascript+module' }), 'worker.js');

  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/workers/scripts/${NAME}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });

  const text = await r.text();
  console.log(`HTTP ${r.status}`);

  let j = null;
  try { j = JSON.parse(text); } catch { /* not json */ }

  if (j && j.success) {
    console.log('✅ Upload thành công');
    console.log('   Script:', j.result?.id || NAME);
    console.log('   Modified:', j.result?.modified_on);
  } else {
    console.log('❌ Thất bại');
    if (j && j.errors) {
      for (const e of j.errors) console.log(`   [${e.code}] ${e.message}`);
    } else {
      console.log('   ' + text.slice(0, 500));
    }
    process.exit(1);
  }
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
