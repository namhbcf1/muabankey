/**
 * Kiểm tra installer sinh đúng domain mới.
 */
const B = process.argv[2] || 'https://xienhl.com';

async function main() {
  console.log('\n🔧 Kiểm tra installer trên', B, '\n');

  const r = await fetch(B + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo', password: 'Demo@123456' }),
  });
  if (r.status !== 200) { console.log('  ❌ không đăng nhập được'); return; }
  const ck = r.headers.get('set-cookie').match(/mbk_session=[^;]+/)[0];

  const mine = await fetch(B + '/api/licenses/mine', { headers: { Cookie: ck } }).then((x) => x.json());
  if (!mine.licenses || !mine.licenses.length) {
    console.log('  ⚠️  demo chưa có license — tạo license test');

    // Đăng nhập admin để tạo
    const ar = await fetch(B + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'namhbcf', password: 'namhbcf123' }),
    });
    const ack = ar.headers.get('set-cookie').match(/mbk_session=[^;]+/)[0];
    const made = await fetch(B + '/api/admin/licenses', {
      method: 'POST',
      headers: { Cookie: ack, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1, days: 7, prefix: 'DOM', note: 'Domain test' }),
    }).then((x) => x.json());
    console.log('  đã tạo:', made.keys?.[0]);

    // Gắn vào license_issues cho demo? Không có API -> dùng key admin
    const key = made.keys[0];
    const tok = await fetch(B + '/api/licenses/' + encodeURIComponent(key) + '/install-token', {
      method: 'POST', headers: { Cookie: ack },
    }).then((x) => x.json());
    await report(B, key, tok);
    return;
  }

  const key = mine.licenses[0].key;
  const tok = await fetch(B + '/api/licenses/' + encodeURIComponent(key) + '/install-token', {
    method: 'POST', headers: { Cookie: ck },
  }).then((x) => x.json());
  await report(B, key, tok);
}

async function report(B, key, tok) {
  console.log('  key:', key);
  if (!tok.cmd) { console.log('  ❌ lỗi token:', JSON.stringify(tok)); return; }

  console.log('');
  console.log('  Lệnh CMD:');
  console.log('   ', tok.cmd);
  console.log('');
  console.log('  Dùng đúng domain   :', tok.cmd.includes('xienhl.com') ? '✅' : '❌');
  console.log('  Không còn workers.dev:', tok.cmd.includes('workers.dev') ? '❌' : '✅');

  // Tải file .cmd
  const dl = await fetch(tok.downloadCmd);
  console.log('  Tải .cmd           :', dl.status, dl.status === 200 ? '✅' : '❌');
  if (dl.status === 200) {
    const body = await dl.text();
    console.log('  Nội dung .cmd dài  :', body.length, 'bytes');
    console.log('  BASE trong script  :', (body.match(/set "BASE=([^"]+)"/) || [])[1] || 'không thấy');
  }

  // Tải EXE
  const exe = await fetch(B + '/download/xa_nofog_pro.exe', { method: 'HEAD' });
  console.log('  Tải EXE            :', exe.status,
    (exe.headers.get('content-length') || '?') + ' bytes', exe.ok ? '✅' : '❌');
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
