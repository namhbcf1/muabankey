const B = process.argv[2] || 'https://xienhl.com';

async function main() {
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo', password: 'Demo@123456' }),
  });
  const ck = r.headers.get('set-cookie').match(/mbk_session=[^;]+/)[0];

  const mine = await fetch(B + '/api/licenses/mine', { headers: { Cookie: ck } }).then((x) => x.json());
  const key = mine.licenses[0].key;

  const tok = await fetch(B + '/api/licenses/' + encodeURIComponent(key) + '/install-token', {
    method: 'POST', headers: { Cookie: ck },
  }).then((x) => x.json());

  console.log('\n=== LỆNH CMD TRẢ VỀ ===');
  console.log(tok.cmd);
  console.log('');
  console.log('Thứ tự đúng (.cmd trước ?t=):', /\.cmd\?t=/.test(tok.cmd) ? '✅' : '❌');
  console.log('Dùng xienhl.com            :', tok.cmd.includes('xienhl.com') ? '✅' : '❌');
  console.log('');

  const dl = await fetch(tok.downloadCmd);
  console.log('Tải file .cmd  :', dl.status, dl.status === 200 ? '✅' : '❌');
  if (dl.status === 200) {
    const body = await dl.text();
    const m = body.match(/set "BASE=([^"]+)"/);
    console.log('BASE trong .cmd:', m ? m[1] : 'không thấy');
    const mq = body.match(/set "Q=([^"]*)"/);
    console.log('Token trong .cmd:', mq ? (mq[1] ? 'có' : 'không') : 'không thấy');
  }

  // Test key sai vẫn 404 sạch
  const bad = await fetch(B + '/i/AAAAAA-AAAA-AAAA-AAAA.cmd');
  console.log('Key sai        :', bad.status, bad.status === 404 ? '✅ 404 sạch' : '❌');
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
