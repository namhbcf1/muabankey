import { Client, q, q1, BASE } from './q.mjs';
import { rec, newUser, makeOrder, getQr, hook, dump } from './lib.mjs';
import fs from 'node:fs';

const setS = (k, v) => q(`UPDATE settings SET value = ? WHERE key = ?`, [String(v), k]);
const getS = async (k) => (await q1('SELECT value FROM settings WHERE key = ?', [k]))?.value;

const ORIG = {
  sepay_auto_enabled: await getS('sepay_auto_enabled'),
  sepay_auto_from: await getS('sepay_auto_from'),
  sepay_auto_to: await getS('sepay_auto_to'),
};
console.log('ORIG settings:', ORIG);

const c = await newUser('C');
const created = { orders: [], user: c.userId };

async function freshOrder() {
  const r = await makeOrder(c, 'p-lic-month', 1);
  if (r.status !== 201) throw new Error('order create ' + r.status + ' ' + r.text);
  const o = r.json.order;
  created.orders.push(o.id);
  const g = await getQr(c, o.id);
  return { order: o, qr: g.json.qr, memo: g.json.qr.memo };
}

const memoOfOrder = (code) => 'MBK' + String(code).replace(/[^A-Z0-9]/g, '').replace(/^MBK/, '');
let rn = 0;
const nextRef = (tag) => `TEST${tag}${Date.now().toString(36).toUpperCase()}${(rn++).toString(36).toUpperCase()}`;

try {
  /* ===== #10: TẮT cửa sổ -> tự giao ===== */
  await setS('sepay_auto_enabled', 0);
  {
    const f = await freshOrder();
    const ref = nextRef('AUTO');
    const h = await hook({
      id: 991001, transferType: 'in', accountNumber: '0010131639304',
      transferAmount: 180000, content: f.memo, referenceCode: ref,
    });
    const o = await q1('SELECT status, delivered_at FROM orders WHERE id = ?', [f.order.id]);
    rec(10, 'Tắt cửa sổ (sepay_auto_enabled=0) -> TỰ GIAO',
      h.json?.delivered === true && o?.status === 'delivered',
      `resp=${JSON.stringify(h.json)} orderStatus=${o?.status} delivered_at=${o?.delivered_at}`);

    /* #5: khách đọc được key sau khi giao */
    const g = await c.req(`/api/orders/${f.order.id}`);
    const items = g.json?.order?.items || [];
    const keys = items.flatMap((i) => i.keys || []);
    rec(5, 'Khách đọc được key qua /api/orders/:id sau khi thanh toán',
      g.status === 200 && keys.length > 0 && /XA|MBK|LIC/i.test(keys[0] || ''),
      `keys=${JSON.stringify(keys).slice(0, 120)}`);

    /* license_issues phải có dòng */
    const li = await q1('SELECT COUNT(*) AS n FROM license_issues WHERE order_id = ?', [f.order.id]);
    rec('5b', 'Ghi license_issues khi giao license', (li?.n || 0) >= 1, `license_issues=${li?.n}`);
  }

  /* ===== #14: chuyển 2 lần, lần 2 không giao ===== */
  {
    const f = await freshOrder();
    const ref1 = nextRef('TWICE');
    const h1 = await hook({ id: 991002, transferType: 'in', accountNumber: '0010131639304', transferAmount: 180000, content: f.memo, referenceCode: ref1 });
    const ref2 = nextRef('TWICE');
    const h2 = await hook({ id: 991003, transferType: 'in', accountNumber: '0010131639304', transferAmount: 180000, content: f.memo, referenceCode: ref2 });
    const cnt = await q1('SELECT COUNT(*) AS n FROM license_issues WHERE order_id = ?', [f.order.id]);
    rec(14, 'Chuyển 2 lần -> lần 2 KHÔNG giao lại',
      h1.json?.delivered === true && h2.json?.delivered === false && (cnt?.n || 0) === 1,
      `l1=${h1.json?.reason}/${h1.json?.delivered} l2=${h2.json?.reason}/${h2.json?.delivered} dup=${h2.json?.duplicated} license_issues=${cnt?.n}`);
  }

  /* ===== #11: chuyển thiếu ===== */
  {
    const f = await freshOrder();
    const ref = nextRef('SHORT');
    const h = await hook({ id: 991004, transferType: 'in', accountNumber: '0010131639304', transferAmount: 90000, content: f.memo, referenceCode: ref });
    const o = await q1('SELECT status FROM orders WHERE id = ?', [f.order.id]);
    const p = await q1('SELECT state, amount, expected FROM payments WHERE txn_ref = ?', [ref]);
    rec(11, 'Chuyển thiếu -> underpaid, không giao',
      h.json?.underpaid === true && h.json?.delivered === false && o?.status === 'pending' && p?.state === 'wrong_amount',
      `resp=${JSON.stringify(h.json)} order=${o?.status} pay=${JSON.stringify(p)}`);

    /* ===== #12: chuyển bù đủ -> giao ===== */
    const ref2 = nextRef('SHORT');
    const h2 = await hook({ id: 991005, transferType: 'in', accountNumber: '0010131639304', transferAmount: 90000, content: f.memo, referenceCode: ref2 });
    const o2 = await q1('SELECT status FROM orders WHERE id = ?', [f.order.id]);
    rec(12, 'Chuyển bù đủ (90k+90k) -> giao',
      h2.json?.delivered === true && o2?.status === 'delivered',
      `resp=${JSON.stringify(h2.json)} order=${o2?.status}`);
  }

  /* ===== #13: chuyển thừa ===== */
  {
    const f = await freshOrder();
    const ref = nextRef('OVER');
    const h = await hook({ id: 991006, transferType: 'in', accountNumber: '0010131639304', transferAmount: 200000, content: f.memo, referenceCode: ref });
    const o = await q1('SELECT status FROM orders WHERE id = ?', [f.order.id]);
    rec(13, 'Chuyển thừa -> giao + cảnh báo',
      h.json?.delivered === true && o?.status === 'delivered',
      `resp=${JSON.stringify(h.json)} order=${o?.status} — cảnh báo "Thừa" nằm trong notifyPaymentSuccess(info.excess)`);
  }

  /* ===== #16: transferType=out ===== */
  {
    const f = await freshOrder();
    const ref = nextRef('OUT');
    const h = await hook({ id: 991007, transferType: 'out', accountNumber: '0010131639304', transferAmount: 180000, content: f.memo, referenceCode: ref });
    const o = await q1('SELECT status FROM orders WHERE id = ?', [f.order.id]);
    const p = await q1('SELECT COUNT(*) AS n FROM payments WHERE txn_ref = ?', [ref]);
    rec(16, 'transferType=out -> CHẶN',
      h.json?.reason === 'NOT_INBOUND' && o?.status === 'pending' && p?.n === 0,
      `resp=${JSON.stringify(h.json)} order=${o?.status} payments=${p?.n}`);
  }

  /* ===== #17: sai accountNumber (STK cũ) ===== */
  {
    const f = await freshOrder();
    const ref = nextRef('WRONGACC');
    const h = await hook({ id: 991008, transferType: 'in', accountNumber: '8990124112002', transferAmount: 180000, content: f.memo, referenceCode: ref });
    const o = await q1('SELECT status FROM orders WHERE id = ?', [f.order.id]);
    rec(17, 'Sai accountNumber (STK cũ 8990124112002) -> WRONG_ACCOUNT',
      h.json?.reason === 'WRONG_ACCOUNT' && o?.status === 'pending',
      `resp=${JSON.stringify(h.json)} order=${o?.status}`);
  }

  /* ===== #18: nội dung không có MBK ===== */
  {
    const ref = nextRef('NOMATCH');
    const before = await q1(`SELECT COUNT(*) AS n FROM payments WHERE state='unmatched'`);
    const h = await hook({ id: 991009, transferType: 'in', accountNumber: '0010131639304', transferAmount: 50000, content: 'chuyen tien mua hang', referenceCode: ref });
    const p = await q1('SELECT state, amount FROM payments WHERE txn_ref = ?', [ref]);
    const after = await q1(`SELECT COUNT(*) AS n FROM payments WHERE state='unmatched'`);
    rec(18, 'Nội dung không có MBK -> unmatched, GHI SỔ',
      h.json?.reason === 'NO_ORDER_MATCH' && p?.state === 'unmatched' && Number(p?.amount) === 50000,
      `resp=${JSON.stringify(h.json)} pay=${JSON.stringify(p)} unmatched ${before?.n}->${after?.n}`);
  }
} finally {
  /* ===== BẬT LẠI cửa sổ NGAY ===== */
  await setS('sepay_auto_enabled', ORIG.sepay_auto_enabled);
  await setS('sepay_auto_from', ORIG.sepay_auto_from);
  await setS('sepay_auto_to', ORIG.sepay_auto_to);
  const now = await q(`SELECT key,value FROM settings WHERE key LIKE 'sepay_auto%' ORDER BY key`);
  console.log('\nRESTORED settings:', now.map((x) => `${x.key}=${x.value}`).join(' '));
}

fs.writeFileSync('qa/tmp-c.json', JSON.stringify({ user: c.userId, username: c.username, orders: created.orders, ORIG }, null, 2));
dump();
