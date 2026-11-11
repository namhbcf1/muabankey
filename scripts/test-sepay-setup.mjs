const B = 'https://xienhl.com';
import { readFileSync } from 'node:fs';

const PW = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

(async () => {
  console.log('\n💳 TEST SEPAY: HẠN MỨC + CỬA SỔ GIỜ + ĐỐI SOÁT\n');

  const lr = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: PW }),
  });
  const ck = lr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];
  ok('admin đăng nhập', !!ck);

  /* ===== 1. Hạn mức ===== */
  console.log('\n1️⃣  Hạn mức 50 GD/tháng');
  const qr = await fetch(B + '/api/admin/sepay/quota', { headers: { Cookie: ck } });
  const qd = await qr.json();
  console.log(`     ${JSON.stringify(qd).slice(0, 250)}`);
  ok('quota 200', qr.status === 200, `status=${qr.status}`);
  if (qd.ok) {
    console.log(`     Đã dùng: ${qd.used}/${qd.limit} (${qd.percent}%)`);
    console.log(`     Còn lại: ${qd.remaining} GD, ${qd.daysLeft} ngày`);
    console.log(`     Cửa sổ: ${qd.window?.from}h - ${qd.window?.to}h | bây giờ ${qd.window?.hour}h`);
    console.log(`     Tự động: ${qd.window?.inWindow ? 'ĐANG BẬT' : 'tắt (admin duyệt tay)'}`);
    ok('có số liệu hạn mức', typeof qd.used === 'number');
    ok('có cửa sổ giờ', qd.window && typeof qd.window.from === 'number');
  }

  /* ===== 2. Đối soát ===== */
  console.log('\n2️⃣  Đối soát giao dịch SePay');
  const rr = await fetch(B + '/api/admin/sepay/reconcile?days=1', { headers: { Cookie: ck } });
  const rd = await rr.json();
  console.log(`     ${JSON.stringify(rd).slice(0, 300)}`);
  ok('reconcile 200', rr.status === 200, `status=${rr.status}`);
  if (rd.ok) {
    if (rd.error) {
      console.log(`     ⚠️  API lỗi: ${rd.error} (token có thể chưa đúng)`);
    } else {
      console.log(`     Đã kiểm: ${rd.checked} GD tiền vào`);
      console.log(`     Thiếu (chưa ghi nhận): ${rd.missing?.length || 0}`);
      if (rd.missing?.length) {
        for (const m of rd.missing.slice(0, 3)) {
          console.log(`       • ${m.amount}đ | ${m.content?.slice(0, 30)} | đơn ${m.orderCode || '?'}`);
        }
      }
    }
    ok('gọi API SePay được', !rd.error, rd.error || '');
  }

  /* ===== 3. Chặn khi chưa đăng nhập ===== */
  console.log('\n3️⃣  Bảo mật');
  const noAuth = await fetch(B + '/api/admin/sepay/quota');
  ok('không auth -> 401', noAuth.status === 401, `status=${noAuth.status}`);

  const badSync = await fetch(B + '/api/admin/sepay/sync', {
    method: 'POST', headers: { Cookie: ck, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  ok('sync thiếu input -> 400', badSync.status === 400, `status=${badSync.status}`);

  const badMemo = await fetch(B + '/api/admin/sepay/sync', {
    method: 'POST', headers: { Cookie: ck, 'Content-Type': 'application/json' },
    body: JSON.stringify({ txnRef: 'X1', amount: 1000, content: 'KHONGCOMA' }),
  });
  const bd = await badMemo.json();
  ok('sync nội dung sai -> 400', badMemo.status === 400,
    bd.error || `status=${badMemo.status}`);

  console.log(`\n${'─'.repeat(54)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
