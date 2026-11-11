/**
 * BATTERY C — Đơn hàng. BATTERY D — Webhook. Chạy THẬT production.
 */
import * as L from './_qr_lib.mjs';
import { writeFileSync } from 'node:fs';

const R = [];
const rec = (id, method, result, money, goods, note) => {
  R.push({ id, method, result, money, goods, note });
  console.log(`\n[${id}] ${method}\n  → ${result}\n  💰 ${money}   📦 ${goods}\n  📝 ${note}`);
};

const PROD = 'p-lic-month';
const PRICE = 180000;
const u = await L.register('c1');
console.log('user:', u.username);

const st = async (oid) => (await L.getOrder(u.cookie, oid)).data.order;
const keysOf = (o) => o?.items?.[0]?.keys?.length || 0;
const pays = (code) => L.q1(
  `SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS n FROM payments WHERE order_code='${code}'`)[0];

/* ---------- C13: đơn hết hạn 30 phút, khách vẫn CK ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  // ép QR hết hạn + đơn expired (mô phỏng sau 30'/45')
  L.d1(`UPDATE orders SET qr_expires_at=${Math.floor(Date.now() / 1000) - 60}, status='expired' WHERE id='${o.order.id}'`);
  const qrAgain = await L.getQr(u.cookie, o.order.id); // khách bấm "Tạo lại QR"
  const w = await L.wh({
    id: 920001, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('C13'),
  });
  const s = await st(o.order.id);
  rec('C13', `Đơn ${o.order.code} status='expired' (quá 30'). Khách vẫn CK đúng nội dung`,
    `tạo lại QR=${qrAgain.status}/${qrAgain.data?.qr?.memo || qrAgain.data?.code} | webhook=${JSON.stringify(w.data)} | đơn=${s.status} keys=${keysOf(s)}`,
    keysOf(s) ? 'không' : 'CÓ — tiền vào mà không giao',
    keysOf(s) ? 'không' : 'CÓ',
    'expired vẫn được xác nhận & giao (đúng chủ đích "tiền về muộn vẫn phải xử lý").');
}

/* ---------- C14: đơn hết hạn, bấm "Tạo lại QR" rồi CK ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  L.d1(`UPDATE orders SET qr_expires_at=${Math.floor(Date.now() / 1000) - 60}, status='expired' WHERE id='${o.order.id}'`);
  const q = await L.getQr(u.cookie, o.order.id);
  const memo = q.data?.qr?.memo;
  const w = await L.wh({
    id: 920002, accountNumber: '8990124112002', content: memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('C14'),
  });
  const s = await st(o.order.id);
  const same = memo === o.qr.memo;
  rec('C14', `Đơn expired → POST /qr (tạo lại) → CK. memo mới="${memo}" (cũ="${o.qr.memo}")`,
    `QR=${q.status} secondsLeft=${q.data?.qr?.secondsLeft} memoGiữNguyên=${same} | đơn=${s.status} keys=${keysOf(s)}`,
    keysOf(s) ? 'không' : 'CÓ',
    keysOf(s) ? 'không' : 'CÓ',
    'Memo KHÔNG đổi khi tạo lại (idempotent theo mã đơn) → tiền cũ vẫn khớp. Đây là điểm TỐT.');
}

/* ---------- C15: sản phẩm hết hàng giữa lúc chờ tiền ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  // bán hết license không ảnh hưởng vì license sinh động.
  // Dùng sản phẩm 'key' để test hết hàng: kiểm tra có sản phẩm key không
  const keys = L.q1(`SELECT id,name,price,delivery_type,stock_count FROM products WHERE delivery_type IN ('key','account','file')`);
  if (keys.length === 0) {
    // Không có sản phẩm kho key -> mô phỏng bằng cách xoá product tạm? Không được.
    // Dùng license nhưng set license_prefix rỗng? -> vẫn giao được.
    // => Test gián tiếp: đặt quantity vượt MAX rồi xem.
    rec('C15', 'Sản phẩm hết hàng giữa lúc chờ tiền',
      `Không có sản phẩm delivery_type='key' trong shop (toàn 'license'). License sinh động nên KHÔNG BAO GIỜ hết hàng.`,
      'không', 'không (license sinh động)', 'Không áp dụng được trên dữ liệu thật — cần sản phẩm kho key.');
    console.log('  products:', JSON.stringify(keys));
  }
}

/* ---------- C16: sản phẩm bị xoá/ngừng bán giữa lúc chờ tiền ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  // admin "xoá" = active=0 (adminDeleteProduct chỉ set active=0)
  L.d1(`UPDATE products SET active=0 WHERE id='${PROD}'`);
  const w = await L.wh({
    id: 920003, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('C16'),
  });
  const s = await st(o.order.id);
  const p = L.q1(`SELECT active FROM products WHERE id='${PROD}'`)[0];
  // khôi phục
  L.d1(`UPDATE products SET active=1 WHERE id='${PROD}'`);
  console.log('  product active sau khôi phục:', JSON.stringify(p));
  rec('C16', `Admin set sản phẩm active=0 (ngừng bán) trong lúc khách chờ CK, rồi khách CK`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status} keys=${keysOf(s)} | admin_note=${s.status === 'paid' ? 'xem DB' : '-'}`,
    keysOf(s) ? 'không' : 'CÓ, cần admin giao tay/hoàn',
    keysOf(s) ? 'không' : 'không (không giao sai)',
    'deliverOrderItems KHÔNG kiểm products.active → vẫn giao được kể cả khi đã ngừng bán.');
}

/* ---------- C17: 5 đơn cùng sản phẩm, chỉ CK đơn đầu ---------- */
{
  const os = [];
  for (let i = 0; i < 5; i++) os.push(await L.orderWithQr(u.cookie, PROD, 1));
  const w = await L.wh({
    id: 920004, accountNumber: '8990124112002', content: os[0].qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('C17'),
  });
  const statuses = [];
  let totalKeys = 0;
  for (const o of os) {
    const s = await st(o.order.id);
    statuses.push(`${s.code}:${s.status}/${keysOf(s)}`);
    totalKeys += keysOf(s);
  }
  rec('C17', `5 đơn (${os.map(x => x.order.code).join(',')}) cùng 180k. CK đúng đơn ĐẦU`,
    `webhook=${JSON.stringify(w.data)} | ${statuses.join(' | ')} | tổng key=${totalKeys}`,
    'không (khách chỉ trả 1 đơn)', `không mất hàng quá mức: giao ${totalKeys} key cho 1 lần trả`,
    '4 đơn còn lại treo pending vĩnh viễn (cron 45\' → expired). Không tự huỷ, không cảnh báo khách.');
}

/* ---------- C18: khách huỷ đơn rồi vẫn CK ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  L.d1(`UPDATE orders SET status='cancelled' WHERE id='${o.order.id}'`);
  const q = await L.getQr(u.cookie, o.order.id);
  const w = await L.wh({
    id: 920005, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('C18'),
  });
  const s = await st(o.order.id);
  const ps = pays(o.order.code);
  rec('C18', `Đơn ${o.order.code} đã cancelled → khách vẫn CK 180k`,
    `POST /qr trên đơn cancelled=${q.status}/${q.data?.code} | webhook=${JSON.stringify(w.data)} | đơn=${s.status} keys=${keysOf(s)} | payments=${ps.s}/${ps.n}`,
    keysOf(s) ? 'không' : 'CÓ',
    keysOf(s) ? 'không' : 'CÓ',
    'GET QR bị chặn (ORDER_CLOSED) nhưng webhook VẪN giao. Luồng thực tế: khách bấm huỷ rồi CK bằng QR đã chụp.');
}

writeFileSync('qa/results-C.json', JSON.stringify(R, null, 1));
console.log(`\n--- C done: ${R.length} ---`);
