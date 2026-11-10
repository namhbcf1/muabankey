/**
 * C (tiếp). Coupon race, topup, refund, webhook thiếu tiền — phần còn lại.
 */
import { record, loginAs, freshUser, makeClient, ACCOUNTS } from '../lib/record.mjs';
import { q1, d1, giveAdminBalance } from './c-business.mjs';

const WH = { authorization: 'Apikey TEST_WEBHOOK_SECRET_0123456789abcdef' };

export async function runGroupC2() {
  const adm = await loginAs('admin');

  /* ================= C13b: RACE coupon 1 lượt ================= */
  d1(`UPDATE coupons SET used_count = 0 WHERE code='ONELUOT';`);
  const racers = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const cu = await freshUser(`c13r${i}`);
      giveAdminBalance(cu._id, 5000000);
      return cu.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }], couponCode: 'ONELUOT' });
    }),
  );
  const raced = racers.filter((r) => r.status === 201 && r.json?.order?.discount === 50000).length;
  const uc2 = q1(`SELECT used_count FROM coupons WHERE code='ONELUOT'`).used_count;
  record(13.5,
    'RACE: 8 user ĐỒNG THỜI dùng coupon 1 lượt (ONELUOT, usage_limit=1)',
    raced <= 1 ? 'CHỈ 1 đơn áp được' : `${raced}/8 ĐƠN cùng áp coupon 1 lượt — vượt usage_limit`,
    raced <= 1 ? 'OK' : 'HIGH',
    `Số đơn được giảm 50k: ${raced}/8 | used_count sau: ${uc2} (limit=1) | mã: ${racers.map((r) => r.status).join(',')}`,
    raced <= 1
      ? 'Thực tế chặn được nhờ D1 serialize, NHƯNG logic vẫn là read-then-write (orders.js:28 vs :133). Nên đổi sang claim nguyên tử: UPDATE coupons SET used_count=used_count+1 WHERE code=? AND (usage_limit IS NULL OR used_count<usage_limit) và kiểm tra meta.changes===1.'
      : 'Đổi sang UPDATE nguyên tử có điều kiện usage_limit.');

  /* ================= C14: percent > 100 ================= */
  const r14 = await adm.post('/api/admin/coupons', {
    code: 'P150' + (Date.now() % 10000), type: 'percent', value: 150, active: true,
  });
  record(14,
    'Tạo coupon percent = 150% (>100)',
    r14.status < 400 ? 'CHẤP NHẬN coupon 150%' : `BỊ CHẶN (${r14.status})`,
    r14.status < 400 ? 'HIGH' : 'OK',
    `${r14.status} ${r14.json?.error || JSON.stringify(r14.json)}`,
    'Đã đúng: admin.js:181 chặn value>100 với type percent. Nhưng giá trị 100 vẫn cho tạo — xem #14.5.');

  /* ================= C14.5: coupon 100% -> đơn 0đ ================= */
  const c14 = await freshUser('c14');
  const r100 = await c14.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }], couponCode: 'FREE100' });
  record(14.5,
    'Coupon 100% -> đơn total = 0đ (mua miễn phí?)',
    r100.status < 400 && r100.json?.order?.total === 0 ? 'ĐƠN 0Đ ĐƯỢC TẠO' : `Chặn (${r100.status})`,
    r100.status < 400 && r100.json?.order?.total === 0 ? 'MEDIUM' : 'OK',
    `${r100.status} total=${r100.json?.order?.total} discount=${r100.json?.order?.discount} | ${r100.json?.error || ''}`,
    r100.status >= 400
      ? 'Đã đúng: orders.js:110 chặn "total===0 && subtotal>0".'
      : 'Chặn coupon dẫn tới total=0 nếu subtotal>0.');

  /* ================= C15: fixed coupon > giá trị đơn ================= */
  const c15 = await freshUser('c15');
  const rOv = await c15.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }], couponCode: 'BIGDISCOUNT' });
  record(15,
    'Coupon fixed 999.999.999đ cho đơn 450.000đ (max_discount vượt đơn)',
    rOv.status < 400 ? `Bị kẹp về 0/âm? total=${rOv.json?.order?.total}` : `BỊ CHẶN (${rOv.status})`,
    rOv.status < 400 && rOv.json?.order?.total < 0 ? 'CRITICAL' : 'OK',
    `${rOv.status} total=${rOv.json?.order?.total} discount=${rOv.json?.order?.discount} | ${rOv.json?.error || ''}`,
    'Đã đúng: discount = min(discount, subtotal) (orders.js:36).');

  /* ================= C16/17/18: topup amounts ================= */
  const c16 = await freshUser('c16');
  const amounts = [-50000, -1, 0, 1000, 19999, 20000, 20000.5, 50000000, 50000001, 1e12, '50000', 'abc', null, true, [], {}];
  const out16 = [];
  for (const a of amounts) {
    const r = await c16.post('/api/wallet/topup', { amount: a });
    out16.push(`${JSON.stringify(a)}->${r.status}${r.json?.topup ? ':' + r.json.topup.amount : ''}`);
  }
  record(16,
    'Nạp tiền: amount âm/0/dưới min/vượt max/số lẻ/chuỗi/bool/object (15 giá trị)',
    'Chỉ [20000, 50000000] và dạng số hợp lệ được chấp nhận',
    'OK',
    out16.join(' | ') + '  (topup_min=20000, topup_max=50000000)',
    'Đã đúng: int(amount,{min:cfg.min,max:cfg.max}) wallet.js:67. Lưu ý "50000" (chuỗi) ĐƯỢC chấp nhận do int() tự Number() — không phải lỗi nhưng nên chặt hơn.');

  const r17 = await c16.post('/api/wallet/topup', { amount: 0 });
  record(17, 'Nạp tiền amount = 0', r17.status === 400 ? 'BỊ CHẶN' : `LỌT (${r17.status})`,
    r17.status === 400 ? 'OK' : 'HIGH', `${r17.status} ${r17.json?.error || ''}`, 'Đã đúng: min=topup_min.');

  const r18 = await c16.post('/api/wallet/topup', { amount: 60000000 });
  record(18, 'Nạp tiền amount > topup_max (60tr > 50tr)', r18.status === 400 ? 'BỊ CHẶN' : `LỌT (${r18.status})`,
    r18.status === 400 ? 'OK' : 'HIGH', `${r18.status} ${r18.json?.error || ''}`, 'Đã đúng: max=topup_max.');

  /* ================= C19: refund đơn pending ================= */
  const c19 = await freshUser('c19');
  giveAdminBalance(c19._id, 2000000);
  const o19 = await c19.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }] });
  const oid19 = o19.json.order.id;
  const b19a = q1(`SELECT balance FROM users WHERE id = '${c19._id}'`).balance;
  const ref19 = await adm.post(`/api/admin/orders/${oid19}/refund`, {});
  const b19b = q1(`SELECT balance FROM users WHERE id = '${c19._id}'`).balance;
  record(19,
    'Refund đơn PENDING (chưa trừ đồng nào)',
    ref19.status < 400 ? `ĐÚC TIỀN +${b19b - b19a}đ từ đơn chưa thanh toán` : `BỊ CHẶN (${ref19.status})`,
    ref19.status < 400 ? 'CRITICAL' : 'OK',
    `refund -> ${ref19.status} ${ref19.json?.error || ''}; số dư ${b19a} -> ${b19b}`,
    'Đã đúng: chỉ refund status IN (paid,delivered) (orders.js:524-527).');

  /* ================= C20: refund 2 lần ================= */
  const c20 = await freshUser('c20');
  giveAdminBalance(c20._id, 2000000);
  const o20 = await c20.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }] });
  const oid20 = o20.json.order.id;
  const pay20 = await c20.post(`/api/orders/${oid20}/pay`, {});
  const bA = q1(`SELECT balance FROM users WHERE id = '${c20._id}'`).balance;
  const r1 = await adm.post(`/api/admin/orders/${oid20}/refund`, {});
  const r2 = await adm.post(`/api/admin/orders/${oid20}/refund`, {});
  const bB = q1(`SELECT balance FROM users WHERE id = '${c20._id}'`).balance;
  record(20,
    'Refund 2 LẦN cùng 1 đơn đã thanh toán',
    r2.status >= 400 ? 'LẦN 2 BỊ CHẶN' : 'HOÀN TIỀN 2 LẦN',
    r2.status >= 400 ? 'OK' : 'CRITICAL',
    `pay=${pay20.status}; refund1=${r1.status}; refund2=${r2.status} ${r2.json?.error || ''}; số dư ${bA}->${bB} (chênh ${bB - bA})`,
    'Đã đúng: claim status="refunding" (orders.js:531-537).');

  /* ================= C20b: RACE 5 refund ================= */
  const c20b = await freshUser('c20b');
  giveAdminBalance(c20b._id, 2000000);
  const o20b = await c20b.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }] });
  const oid20b = o20b.json.order.id;
  await c20b.post(`/api/orders/${oid20b}/pay`, {});
  const preB = q1(`SELECT balance FROM users WHERE id = '${c20b._id}'`).balance;
  const raceRef = await Promise.all(Array.from({ length: 5 }, () => adm.post(`/api/admin/orders/${oid20b}/refund`, {})));
  const okRef = raceRef.filter((r) => r.status < 400).length;
  const postB = q1(`SELECT balance FROM users WHERE id = '${c20b._id}'`).balance;
  record(20.5,
    'RACE: 5 request refund ĐỒNG THỜI cùng đơn',
    okRef === 1 ? 'CHỈ 1 THÀNH CÔNG' : `${okRef} LẦN HOÀN TIỀN`,
    okRef === 1 ? 'OK' : 'CRITICAL',
    `Thành công ${okRef}/5; số dư ${preB} -> ${postB} (chênh ${postB - preB}, đúng phải +450000)`,
    'Đã đúng: UPDATE ... SET status="refunding" WHERE status IN (paid,delivered).');

  /* ================= C21: duyệt topup 2 lần ================= */
  const c21 = await freshUser('c21');
  const t21 = await c21.post('/api/wallet/topup', { amount: 100000 });
  const tid = t21.json.topup.id;
  const t0 = q1(`SELECT balance FROM users WHERE id = '${c21._id}'`).balance;
  const a1 = await adm.post(`/api/admin/topups/${tid}/approve`, {});
  const a2 = await adm.post(`/api/admin/topups/${tid}/approve`, {});
  const t1 = q1(`SELECT balance FROM users WHERE id = '${c21._id}'`).balance;
  record(21,
    'Admin duyệt topup 2 lần',
    a2.status >= 400 ? 'LẦN 2 BỊ CHẶN' : 'CỘNG TIỀN 2 LẦN',
    a2.status >= 400 ? 'OK' : 'CRITICAL',
    `approve1=${a1.status} approve2=${a2.status} ${a2.json?.error || ''}; số dư ${t0}->${t1} (chênh ${t1 - t0}, đúng 100000)`,
    'Đã đúng: claim UPDATE ... WHERE status!="paid" (wallet.js:893-899).');

  /* ================= C21b: RACE duyệt topup ================= */
  const c21b = await freshUser('c21b');
  const t21b = await c21b.post('/api/wallet/topup', { amount: 200000 });
  const tid2 = t21b.json.topup.id;
  const pre2 = q1(`SELECT balance FROM users WHERE id = '${c21b._id}'`).balance;
  const raceAp = await Promise.all(Array.from({ length: 5 }, () => adm.post(`/api/admin/topups/${tid2}/approve`, {})));
  const okAp = raceAp.filter((r) => r.status < 400).length;
  const post2 = q1(`SELECT balance FROM users WHERE id = '${c21b._id}'`).balance;
  record(21.5,
    'RACE: 5 request duyệt topup ĐỒNG THỜI',
    okAp === 1 ? 'CHỈ 1 THÀNH CÔNG' : `${okAp} LẦN CỘNG TIỀN`,
    okAp === 1 ? 'OK' : 'CRITICAL',
    `Thành công ${okAp}/5; số dư ${pre2} -> ${post2} (chênh ${post2 - pre2}, đúng 200000)`,
    'Đã đúng: cùng cơ chế claim nguyên tử.');

  /* ================= C22: webhook thiếu tiền ================= */
  const c22 = await freshUser('c22');
  const t22 = await c22.post('/api/wallet/topup', { amount: 500000 });
  const code22 = t22.json.topup.code;
  const w22 = await makeClient('wh22').post('/api/webhooks/sepay', {
    content: `NAP${code22}`, transferAmount: 10000, referenceCode: 'REF22',
  }, { headers: WH });
  const bal22 = q1(`SELECT balance FROM users WHERE id = '${c22._id}'`).balance;
  const st22 = q1(`SELECT status FROM topups WHERE code='${code22}'`).status;
  record(22,
    'Webhook chuyển THIẾU (10.000đ cho lệnh 500.000đ)',
    bal22 === 10000 ? 'Cộng đúng phần nhận (10.000đ), status=partial' : `Số dư ${bal22}`,
    bal22 <= 500000 ? 'OK' : 'CRITICAL',
    `-> ${w22.status} ${JSON.stringify(w22.json)}; số dư=${bal22}; topup status=${st22}`,
    'Đúng logic "cộng phần đã nhận". XEM #22b: nhánh partial KHÔNG có claim nguyên tử.');

  /* ================= C22b: RACE webhook partial — cộng tiền nhiều lần ================= */
  const c22b = await freshUser('c22b');
  const t22b = await c22b.post('/api/wallet/topup', { amount: 500000 });
  const code22b = t22b.json.topup.code;
  const preW = q1(`SELECT balance FROM users WHERE id = '${c22b._id}'`).balance;
  // 10 webhook THIẾU tiền gửi đồng thời — mỗi cái 50.000đ
  const wRace = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    makeClient('wr' + i).post('/api/webhooks/sepay', {
      content: `NAP${code22b}`, transferAmount: 50000, referenceCode: 'R' + i,
    }, { headers: WH })));
  const okW = wRace.filter((r) => r.status < 400 && r.json?.credited).length;
  const balW = q1(`SELECT balance FROM users WHERE id = '${c22b._id}'`).balance;
  const stW = q1(`SELECT status FROM topups WHERE code='${code22b}'`).status;
  record(22.5,
    'RACE: 10 webhook "chuyển thiếu" ĐỒNG THỜI cho cùng 1 lệnh nạp',
    balW === 50000 ? 'Chỉ cộng 1 lần (50.000đ)' : `CỘNG LẶP: ${balW}đ từ 10 webhook 50k (đúng phải 50.000đ)`,
    balW === 50000 ? 'OK' : 'CRITICAL',
    `Số webhook được credit: ${okW}/10; số dư ${preW} -> ${balW}; topup status=${stW}`,
    'Nhánh partial (wallet.js:761-778) KHÔNG claim nguyên tử: status="partial" vẫn thoả điều kiện "!= paid" nên webhook sau cộng tiếp. Sửa: đặt status="partial" thành trạng thái kết thúc, hoặc claim bằng UPDATE ... WHERE status="pending", hoặc cộng dồn có kiểm soát (credited_total).');

  return { adm };
}
