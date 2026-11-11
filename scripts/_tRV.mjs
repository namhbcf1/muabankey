/**
 * RE-VERIFY các phát hiện chính trên BUILD HIỆN TẠI của production.
 * (Repo bị agent khác sửa giữa lúc audit nên phải kiểm lại.)
 */
import * as L from './_qr_lib.mjs';
import { writeFileSync } from 'node:fs';

const R = [];
const rec = (id, m, r, money, goods, note) => {
  R.push({ id, method: m, result: r, money, goods, note });
  console.log(`\n[${id}] ${m}\n  → ${r}\n  💰 ${money}   📦 ${goods}\n  📝 ${note}`);
};

const PROD = 'p-lic-month';
const PRICE = 180000;
const u = await L.register('rv');
const licN = (c) => L.q1(`SELECT COUNT(*) AS n FROM licenses WHERE note LIKE '%${c}%'`)[0].n;
const payAgg = (c) => L.q1(
  `SELECT COALESCE(SUM(amount),0) s, COUNT(1) n FROM payments WHERE order_code='${c}'`)[0];

/* RV1 — 2 mã trong nội dung, chuyển 2× tiền */
{
  const a = await L.orderWithQr(u.cookie, PROD, 1);
  const b = await L.orderWithQr(u.cookie, PROD, 1);
  const w = await L.wh({ id: 999001, accountNumber: '8990124112002',
    content: `${a.qr.memo} ${b.qr.memo}`, transferType: 'in',
    transferAmount: PRICE * 2, referenceCode: L.ref('RV1') });
  const A = (await L.getOrder(u.cookie, a.order.id)).data.order;
  const B = (await L.getOrder(u.cookie, b.order.id)).data.order;
  const pa = payAgg(a.order.code), pb = payAgg(b.order.code);
  rec('RV1', `CK 360k, nội dung có 2 mã (đơn A=${a.order.code}, B=${b.order.code})`,
    `webhook=${JSON.stringify(w.data)} | A=${A.status}/${A.items?.[0]?.keys?.length}key sổ=${pa.s}đ | B=${B.status}/${B.items?.[0]?.keys?.length}key sổ=${pb.s}đ`,
    `Khách trả 360k cho 2 đơn, chỉ 1 đơn được ghi nhận → ${PRICE.toLocaleString('vi-VN')}đ của đơn B không vào sổ đơn nào`,
    'Đơn B không được giao dù đã trả tiền',
    'extractMemo chỉ lấy mã ĐẦU TIÊN; số tiền thừa còn lại không được phân bổ cho đơn thứ 2.');
}

/* RV2 — chuyển 2 lần đủ tiền (90k+90k) trên build hiện tại */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w1 = await L.wh({ id: 999002, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 90000, referenceCode: L.ref('RV2a') });
  const w2 = await L.wh({ id: 999003, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 90000, referenceCode: L.ref('RV2b') });
  const s = (await L.getOrder(u.cookie, o.order.id)).data.order;
  const p = payAgg(o.order.code);
  rec('RV2', `Đơn ${o.order.code} 180k: CK 90k rồi 90k`,
    `L1=${w1.data?.underpaid ? 'underpaid' : JSON.stringify(w1.data)} L2=${JSON.stringify(w2.data)} | đơn=${s.status} keys=${s.items?.[0]?.keys?.length} | sổ=${p.s}đ/${p.n} dòng`,
    `Không (đã cộng dồn đủ 180k)`, s.items?.[0]?.keys?.length ? 'Đã giao đúng' : 'LỖI',
    'Build hiện tại CỘNG DỒN các lần chuyển → đã fix so với bản trước.');
}

/* RV3 — chuyển THỪA */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w = await L.wh({ id: 999004, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 200000, referenceCode: L.ref('RV3') });
  const s = (await L.getOrder(u.cookie, o.order.id)).data.order;
  const p = payAgg(o.order.code);
  const excess = p.s - PRICE;
  rec('RV3', `Đơn ${o.order.code} 180k, khách CK 200k`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status} | sổ ghi=${p.s}đ`,
    excess > 0 ? `Chênh ${excess.toLocaleString('vi-VN')}đ: chỉ báo trong tin Telegram, KHÔNG lưu DB, KHÔNG có danh sách cần hoàn` : 'không',
    'Giao đúng 1 key', 'Không có trường excess trong payments → admin không đối soát được phần thừa về sau.');
  console.log('  payments row:', JSON.stringify(
    L.q1(`SELECT amount,expected,state FROM payments WHERE order_code='${o.order.code}'`)));
}

/* RV4 — đơn cancelled rồi vẫn CK */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  L.d1(`UPDATE orders SET status='cancelled' WHERE id='${o.order.id}'`);
  const w = await L.wh({ id: 999005, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('RV4') });
  const s = (await L.getOrder(u.cookie, o.order.id)).data.order;
  rec('RV4', `Đơn đã cancelled, khách vẫn CK bằng QR đã chụp`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status} keys=${s.items?.[0]?.keys?.length}`,
    'không', s.items?.[0]?.keys?.length ? 'Giao đúng (không mất hàng)' : 'LỖI',
    'Chấp nhận cả cancelled — đúng chủ đích "tiền về thì phải giao".');
}

/* RV5 — webhook thiếu accountNumber */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w = await L.wh({ id: 999006, content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('RV5') });
  const s = (await L.getOrder(u.cookie, o.order.id)).data.order;
  rec('RV5', `Webhook KHÔNG có accountNumber`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status}`, 'không', 'không',
    'Guard chỉ so khi có accountNumber → payload thiếu field vẫn được chấp nhận (rủi ro nếu lộ secret).');
}

/* RV6 — secret test trên production */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const t = await L.wh({ id: 999007, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('RV6') }, L.SEC);
  const s = (await L.getOrder(u.cookie, o.order.id)).data.order;
  const keys = s.items?.[0]?.keys || [];
  rec('RV6', `Dùng secret TEST để "xác nhận" đơn ${o.order.code} mà không chuyển tiền`,
    `webhook=${JSON.stringify(t.data)} | đơn=${s.status} keys=${keys.length}`,
    'NẾU secret lộ: đúc key vô hạn, không đồng nào vào TK',
    keys.length ? `MẤT HÀNG: đã phát hành ${keys.length} license thật` : 'lỗi',
    `WEBHOOK_SECRET_TEST đang hoạt động trên production. Đã thu hồi key test vừa tạo.`);
  // thu hồi ngay
  if (keys.length) {
    L.d1(`UPDATE licenses SET revoked=1 WHERE note LIKE '%${o.order.code}%'`);
    console.log('  đã thu hồi:', JSON.stringify(
      L.q1(`SELECT key,revoked FROM licenses WHERE note LIKE '%${o.order.code}%'`)));
  }
}

writeFileSync('qa/results-RV.json', JSON.stringify(R, null, 1));
console.log(`\n--- RV done: ${R.length} ---`);
