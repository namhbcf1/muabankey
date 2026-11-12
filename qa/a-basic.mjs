import { Client, q, q1, BASE } from './q.mjs';
import { rec, newUser, makeOrder, getQr, hook, dump, R } from './lib.mjs';

const TAG = 'A';

try {
  /* ---------- 1. Register ---------- */
  const c = await newUser(TAG);
  rec(1, 'Đăng ký user mới', !!c.userId, `username=${c.username} id=${c.userId?.slice(0, 8)}`);

  /* ---------- 2. Create order 180k ---------- */
  const or = await makeOrder(c, 'p-lic-month', 1);
  const order = or.json?.order;
  rec(2, 'Tạo đơn 180.000đ',
    or.status === 201 && order?.total === 180000 && order?.status === 'pending',
    `HTTP=${or.status} total=${order?.total} status=${order?.status} code=${order?.code}`);

  /* ---------- 3. QR ---------- */
  const qr = await getQr(c, order.id);
  const gq = qr.json?.qr;
  const bankAcc = gq?.bank?.account;
  const memo = gq?.memo || '';
  const amountOk = gq?.amount === 180000;
  const memoOk = memo === 'MBK' + String(order.code).replace(/[^A-Z0-9]/g, '').replace(/^MBK/, '');
  const bankOk = bankAcc === '0010131639304';
  console.log('   QR url:', gq?.url);
  console.log('   memo:', memo, '(order.code =', order.code, ')');

  // Check QR image downloads
  let imgOk = false, imgStatus = 0, imgType = '';
  try {
    const ir = await fetch(gq.url);
    imgStatus = ir.status;
    imgType = ir.headers.get('content-type') || '';
    const buf = await ir.arrayBuffer();
    imgOk = ir.status === 200 && buf.byteLength > 200;
    console.log('   img bytes:', buf.byteLength, imgType);
  } catch (e) { console.log('   img err:', e.message); }

  rec(3, 'QR: số tiền + memo + STK + ảnh tải được',
    amountOk && memoOk && bankOk && imgOk,
    `amount=${gq?.amount}(${amountOk}) memo=${memo}(${memoOk}) bank=${bankAcc}(${bankOk}) img=${imgStatus}/${imgType}/${imgOk}`);

  /* ---------- 6. Key must NOT leak while unpaid ---------- */
  const beforePay = await c.req(`/api/orders/${order.id}`);
  const keysBefore = JSON.stringify(beforePay.json?.order?.items?.map((i) => i.keys) || []);
  const noLeak = keysBefore === '[[],[],[]]' || keysBefore === '[[]]' || !/XA-|MBK-/i.test(keysBefore);
  rec(6, 'Key KHÔNG lộ khi đơn chưa thanh toán',
    beforePay.status === 200 && noLeak,
    `status=${beforePay.status} keysPayload=${keysBefore.slice(0, 80)}`);

  /* ---------- 5b. Key not leak via list ---------- */
  const lst = await c.req('/api/orders');
  const listKeys = JSON.stringify(lst.json?.orders?.[0]?.items?.map((i) => i.keys) || []);
  rec('6b', 'Key KHÔNG lộ qua GET /api/orders (list)',
    !/XA-|MBK-/.test(listKeys), `keysPayload=${listKeys.slice(0, 60)}`);

  console.log('\n   orderId for next step:', order.id, '| code:', order.code);
  // save for next stage
  const fs = await import('node:fs');
  fs.writeFileSync('qa/tmp-a.json', JSON.stringify({ userId: c.userId, username: c.username, orderId: order.id, code: order.code, cookie: c.cookie }, null, 2));
} catch (e) {
  console.error('EXCEPTION:', e.message);
}

dump();
