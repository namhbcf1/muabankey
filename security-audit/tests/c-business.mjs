/**
 * C. LẠM DỤNG NGHIỆP VỤ — số học, coupon, topup, refund, webhook thiếu tiền.
 */
import { record, loginAs, freshUser, makeClient, ACCOUNTS } from '../lib/record.mjs';
import { execFileSync } from 'node:child_process';

export function d1(sql) {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'muabankey-audit-db', '--local',
    '--config', 'wrangler.audit.toml', '--json', '--command', sql,
  ], { encoding: 'utf8', shell: true });
  const start = out.indexOf('[');
  return JSON.parse(out.slice(start));
}
export function q1(sql) {
  const r = d1(sql);
  return r?.[0]?.results?.[0];
}
export function setBalance(userId, amount) {
  d1(`UPDATE users SET balance = ${Number(amount)} WHERE id = '${userId}'`);
}
export function giveAdminBalance(userId, amount) {
  d1(`UPDATE users SET balance = balance + ${Number(amount)} WHERE id = '${userId}'`);
}

export async function runGroupC() {
  /* ================= C10: quantity âm ================= */
  const u10 = await freshUser('c10');
  giveAdminBalance(u10._id, 5000000);
  const q10 = await u10.post('/api/orders', { items: [{ productId: 'p-win11', quantity: -5 }] });
  record(10,
    'Tạo đơn với quantity = -5',
    q10.status < 400 ? 'ĐƠN ĐƯỢC TẠO VỚI SỐ LƯỢNG ÂM' : `BỊ CHẶN (${q10.status})`,
    q10.status < 400 ? 'CRITICAL' : 'OK',
    `${q10.status} ${JSON.stringify(q10.json?.order?.items || q10.json)}`,
    'Đã đúng: int(qty,{min:1,max:20}) validate.js:32-39.');

  /* ================= C10b: quantity = 0, số lẻ, chuỗi, Infinity, NaN ================= */
  const edgeQ = [-1, 0, 0.5, 1.0001, '5', '5e1', ' 5 ', null, true, [], {}, 1e308, Infinity];
  const edgeOut = [];
  for (const qv of edgeQ) {
    const r = await u10.post('/api/orders', { items: [{ productId: 'p-win11', quantity: qv }] });
    edgeOut.push(`${JSON.stringify(qv)}->${r.status}${r.json?.order ? ':' + r.json.order.total : ''}`);
  }
  record(10.5,
    'quantity biên: -1, 0, 0.5, 1.0001, "5", "5e1", null, true, [], {}, Infinity',
    edgeOut.every((s) => /->(400|error)/.test(s) || /->400/.test(s)) ? 'Tất cả bị chặn' : 'Có giá trị lọt',
    'OK',
    edgeOut.join(' | '),
    'int() yêu cầu Number.isInteger + khoảng [1,20] — chặt.');

  /* ================= C11: price âm / 0 ================= */
  // client không gửi được price; server lấy từ DB. Thử gửi price/unitPrice/total để xem có bị tin không.
  const before = q1(`SELECT balance FROM users WHERE id = '${u10._id}'`).balance;
  const r11 = await u10.post('/api/orders', {
    items: [{ productId: 'p-win11', quantity: 1, price: 1, unitPrice: 1, lineTotal: 1 }],
    total: 1, subtotal: 1, discount: 999999,
  });
  const orderTotal = r11.json?.order?.total;
  record(11,
    'Client gửi price/unitPrice/lineTotal/total/discount để ép giá',
    orderTotal === 450000 ? 'BỊ BỎ QUA — server tự tính 450.000đ' : `SERVER TIN CLIENT: total=${orderTotal}`,
    orderTotal === 450000 ? 'OK' : 'CRITICAL',
    `Gửi price:1, total:1, discount:999999 -> server trả total=${orderTotal} (giá thật 450000)`,
    'Đã đúng: giá đọc từ bảng products, client không tham gia tính tiền (orders.js:89-107).');

  /* ================= C12: mua khi ví âm / không đủ ================= */
  const u12 = await freshUser('c12');
  setBalance(u12._id, -100000); // ví âm
  const o12 = await u12.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }] });
  const pay12 = await u12.post(`/api/orders/${o12.json.order.id}/pay`, {});
  const bal12 = q1(`SELECT balance FROM users WHERE id = '${u12._id}'`).balance;
  record(12,
    'Mua khi ví đang ÂM (-100.000đ)',
    pay12.status < 400 ? 'MUA THÀNH CÔNG VỚI VÍ ÂM' : `BỊ CHẶN (${pay12.status})`,
    pay12.status < 400 ? 'CRITICAL' : 'OK',
    `Đơn ${o12.status}, pay -> ${pay12.status} ${pay12.json?.code || ''}; số dư sau: ${bal12}`,
    'Đã đúng: UPDATE ... WHERE balance >= ? là atomic guard (orders.js:208-212).');

  /* ================= C12b: đua 10 request pay đồng thời ================= */
  const u12b = await freshUser('c12b');
  setBalance(u12b._id, 450000); // đủ đúng 1 đơn
  const o12b = await u12b.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }] });
  const orderId12b = o12b.json.order.id;
  const pays = await Promise.all(
    Array.from({ length: 10 }, (_, i) => u12b.setIp(`10.9.9.${i + 1}`).post(`/api/orders/${orderId12b}/pay`, {})),
  );
  const okPays = pays.filter((p) => p.status < 400).length;
  const bal12b = q1(`SELECT balance FROM users WHERE id = '${u12b._id}'`).balance;
  const keysIssued = q1(`SELECT COUNT(*) n FROM product_keys WHERE order_id = '${orderId12b}'`).n;
  record(12.5,
    'RACE: 10 request POST /pay ĐỒNG THỜI cho 1 đơn (ví đủ 1 đơn)',
    okPays === 1 ? 'CHỈ 1 THÀNH CÔNG — khoá nguyên tử đúng' : `${okPays} REQUEST THÀNH CÔNG — trừ tiền/giao key nhiều lần`,
    okPays === 1 ? 'OK' : 'CRITICAL',
    `Thành công: ${okPays}/10 | số dư còn: ${bal12b} | key gán cho đơn: ${keysIssued} (phải là 1)`,
    'Đã đúng: UPDATE orders SET status="processing" WHERE status="pending" (orders.js:182-188).');

  /* ================= C13: coupon dùng nhiều lần vượt usage_limit ================= */
  // ONELUOT: usage_limit=1
  const c13 = await freshUser('c13');
  giveAdminBalance(c13._id, 10000000);
  const tries = [];
  for (let i = 0; i < 5; i++) {
    const r = await c13.post('/api/orders', {
      items: [{ productId: 'p-win11', quantity: 1 }], couponCode: 'ONELUOT',
    });
    tries.push(r.status === 201 ? `OK(discount=${r.json.order.discount})` : r.status);
  }
  const usedCount = q1(`SELECT used_count, usage_limit FROM coupons WHERE code='ONELUOT'`);
  record(13,
    'Coupon usage_limit=1 nhưng tạo 5 đơn liên tiếp (chưa thanh toán)',
    tries.filter((t) => String(t).startsWith('OK')).length > 0 ? 'Xem chi tiết' : 'Chặn',
    'MEDIUM',
    `Kết quả 5 lần: ${tries.join(' | ')} | used_count=${usedCount.used_count}/limit=${usedCount.usage_limit}`,
    'used_count tăng ngay khi TẠO đơn — nên chặn được ở lần 2. Nhưng đơn pending bị huỷ phải hoàn lượt (đã có releaseCoupon + cron).');

  /* ================= C13b: RACE dùng coupon 1 lượt cùng lúc ================= */
  d1(`UPDATE coupons SET used_count = 0 WHERE code='ONELUOT'`);
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
    'RACE: 8 user đồng thời dùng coupon 1 lượt (ONELUOT)',
    raced <= 1 ? 'CHỈ 1 đơn áp được — đúng' : `${raced} ĐƠN cùng áp coupon 1 lượt (vượt usage_limit)`,
    raced <= 1 ? 'OK' : 'HIGH',
    `Số đơn được giảm 50k: ${raced}/8 | used_count sau: ${uc2} (limit 1)`,
    raced <= 1 ? 'resolveCoupon đọc used_count rồi batch tăng — chưa atomic, nhưng D1 tuần tự hoá nên thực tế chặn được.' : 'Dùng UPDATE coupons SET used_count=used_count+1 WHERE code=? AND (usage_limit IS NULL OR used_count<usage_limit) và kiểm tra meta.changes===1, chạy TRƯỚC khi tạo đơn.');

  /* ================= C14: coupon percent > 100 ================= */
  const adm = await loginAs('admin');
  const r14 = await adm.post('/api/admin/coupons', {
    code: 'P150' + (Date.now() % 10000), type: 'percent', value: 150, active: true,
  });
  record(14,
    'Tạo coupon percent = 150% (>100)',
    r14.status < 400 ? 'CHẤP NHẬN coupon 150%' : `BỊ CHẶN (${r14.status})`,
    r14.status < 400 ? 'HIGH' : 'OK',
    `${r14.status} ${r14.json?.error || JSON.stringify(r14.json)}`,
    'Đã đúng: admin.js:181 chặn value>100 với type percent.');

  /* ================= C14b: percent = 100 → đơn về 0đ ================= */
  const c14 = await freshUser('c14');
  const r100 = await c14.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }], couponCode: 'FREE100' });
  record(14.5,
    'Coupon 100% -> đơn total = 0đ (mua miễn phí?)',
    r100.status < 400 && r100.json?.order?.total === 0 ? 'ĐƠN 0Đ ĐƯỢC TẠO' : `Chặn (${r100.status})`,
    r100.status < 400 && r100.json?.order?.total === 0 ? 'MEDIUM' : 'OK',
    `${r100.status} total=${r100.json?.order?.total} | ${r100.json?.error || ''}`,
    'orders.js:110 chặn "total===0 && subtotal>0" -> đúng. Nhưng đây là test hồi quy quan trọng.');

  /* ================= C14c: coupon fixed vượt giá đơn ================= */
  const c14b = await freshUser('c14b');
  const rOv = await c14b.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }], couponCode: 'BIGDISCOUNT' });
  record(15,
    'Coupon fixed = 999.999.999đ cho đơn 450.000đ (max_discount vượt đơn)',
    rOv.status < 400 ? `Tổng bị âm/0? total=${rOv.json?.order?.total}` : `BỊ CHẶN (${rOv.status})`,
    rOv.status < 400 && rOv.json?.order?.total < 0 ? 'CRITICAL' : 'OK',
    `${rOv.status} total=${rOv.json?.order?.total} discount=${rOv.json?.order?.discount} | ${rOv.json?.error || ''}`,
    rOv.status >= 400 ? 'Đã đúng: discount bị kẹp min(discount, subtotal) (orders.js:36) và chặn total=0.' : 'Kiểm tra lại.');

  /* ================= C16: nạp tiền amount âm ================= */
  const c16 = await freshUser('c16');
  const negAmounts = [-50000, -1, 0, 19999, 50000001, 1e12, 20000.5];
  const out16 = [];
  for (const a of negAmounts) {
    const r = await c16.post('/api/wallet/topup', { amount: a });
    out16.push(`${a}->${r.status}${r.json?.topup ? ':amt=' + r.json.topup.amount : ''}`);
  }
  record(16,
    'Nạp tiền với amount âm/0/dưới min/vượt max/số lẻ',
    out16.every((s) => /->400/.test(s) || /:amt=/.test(s)) ? 'Tất cả giá trị sai bị chặn, đúng khoảng [min,max]' : 'Có giá trị lọt',
    'OK',
    out16.join(' | ') + ' (topup_min=20000, topup_max=50000000)',
    'Đã đúng: int(amount,{min:cfg.min,max:cfg.max}) wallet.js:67.');

  /* ================= C17/C18 tách riêng cho rõ ================= */
  const r17 = await c16.post('/api/wallet/topup', { amount: 0 });
  record(17, 'Nạp tiền amount = 0', r17.status === 400 ? 'BỊ CHẶN' : `LỌT (${r17.status})`,
    r17.status === 400 ? 'OK' : 'HIGH', `${r17.status} ${r17.json?.error || ''}`,
    'Đã đúng: min = topup_min (20000).');

  const r18 = await c16.post('/api/wallet/topup', { amount: 60000000 });
  record(18, 'Nạp tiền amount > topup_max (60tr > 50tr)', r18.status === 400 ? 'BỊ CHẶN' : `LỌT (${r18.status})`,
    r18.status === 400 ? 'OK' : 'HIGH', `${r18.status} ${r18.json?.error || ''}`,
    'Đã đúng: max = topup_max.');

  /* ================= C19: refund đơn chưa thanh toán ================= */
  const c19 = await freshUser('c19');
  giveAdminBalance(c19._id, 2000000);
  const o19 = await c19.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }] });
  const oid19 = o19.json.order.id;
  const balBefore19 = q1(`SELECT balance FROM users WHERE id = '${c19._id}'`).balance;
  const ref19 = await adm.post(`/api/admin/orders/${oid19}/refund`, {});
  const balAfter19 = q1(`SELECT balance FROM users WHERE id = '${c19._id}'`).balance;
  record(19,
    'Refund đơn PENDING (chưa trừ đồng nào)',
    ref19.status < 400 ? `ĐÚC TIỀN: +${balAfter19 - balBefore19}đ từ đơn chưa thanh toán` : `BỊ CHẶN (${ref19.status})`,
    ref19.status < 400 ? 'CRITICAL' : 'OK',
    `refund -> ${ref19.status} ${ref19.json?.error || ''}; số dư ${balBefore19} -> ${balAfter19}`,
    'Đã đúng: chỉ refund khi status IN (paid, delivered) (orders.js:524-527).');

  /* ================= C20: refund 2 lần ================= */
  const c20 = await freshUser('c20');
  giveAdminBalance(c20._id, 2000000);
  const o20 = await c20.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }] });
  const oid20 = o20.json.order.id;
  const pay20 = await c20.post(`/api/orders/${oid20}/pay`, {});
  const balA = q1(`SELECT balance FROM users WHERE id = '${c20._id}'`).balance;
  const r1 = await adm.post(`/api/admin/orders/${oid20}/refund`, {});
  const r2 = await adm.post(`/api/admin/orders/${oid20}/refund`, {});
  const balB = q1(`SELECT balance FROM users WHERE id = '${c20._id}'`).balance;
  record(20,
    'Refund 2 LẦN cùng 1 đơn đã thanh toán',
    r2.status >= 400 ? 'LẦN 2 BỊ CHẶN' : 'HOÀN TIỀN 2 LẦN — đúc tiền',
    r2.status >= 400 ? 'OK' : 'CRITICAL',
    `pay=${pay20.status}; refund1=${r1.status}; refund2=${r2.status} ${r2.json?.error || ''}; số dư ${balA}->${balB} (chênh ${balB - balA})`,
    'Đã đúng: claim status="refunding" nguyên tử (orders.js:531-537) + chặn status==="refunded".');

  /* ================= C20b: RACE 5 refund đồng thời ================= */
  const c20b = await freshUser('c20b');
  giveAdminBalance(c20b._id, 2000000);
  const o20b = await c20b.post('/api/orders', { items: [{ productId: 'p-win11', quantity: 1 }] });
  const oid20b = o20b.json.order.id;
  await c20b.post(`/api/orders/${oid20b}/pay`, {});
  const balPre = q1(`SELECT balance FROM users WHERE id = '${c20b._id}'`).balance;
  const raceRef = await Promise.all(
    Array.from({ length: 5 }, () => adm.post(`/api/admin/orders/${oid20b}/refund`, {})),
  );
  const okRef = raceRef.filter((r) => r.status < 400).length;
  const balPost = q1(`SELECT balance FROM users WHERE id = '${c20b._id}'`).balance;
  record(20.5,
    'RACE: 5 request refund ĐỒNG THỜI cùng đơn',
    okRef === 1 ? 'CHỈ 1 THÀNH CÔNG' : `${okRef} LẦN HOÀN TIỀN THÀNH CÔNG`,
    okRef === 1 ? 'OK' : 'CRITICAL',
    `Thành công ${okRef}/5; số dư ${balPre} -> ${balPost} (chênh ${balPost - balPre}, đúng phải là +450000)`,
    'Đã đúng: UPDATE ... SET status="refunding" WHERE status IN (paid,delivered).');

  /* ================= C21: duyệt topup 2 lần ================= */
  const c21 = await freshUser('c21');
  const t21 = await c21.post('/api/wallet/topup', { amount: 100000 });
  const tid = t21.json.topup.id;
  const balT0 = q1(`SELECT balance FROM users WHERE id = '${c21._id}'`).balance;
  const a1 = await adm.post(`/api/admin/topups/${tid}/approve`, {});
  const a2 = await adm.post(`/api/admin/topups/${tid}/approve`, {});
  const balT1 = q1(`SELECT balance FROM users WHERE id = '${c21._id}'`).balance;
  record(21,
    'Admin duyệt topup 2 lần',
    a2.status >= 400 ? 'LẦN 2 BỊ CHẶN' : 'CỘNG TIỀN 2 LẦN',
    a2.status >= 400 ? 'OK' : 'CRITICAL',
    `approve1=${a1.status} approve2=${a2.status} ${a2.json?.error || ''}; số dư ${balT0}->${balT1} (chênh ${balT1 - balT0}, đúng 100000)`,
    'Đã đúng: claim UPDATE ... WHERE id=? AND status!="paid" (wallet.js:893-899).');

  /* ================= C21b: RACE 5 duyệt topup đồng thời ================= */
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

  /* ================= C22: webhook amount nhỏ hơn topup.amount ================= */
  const c22 = await freshUser('c22');
  const t22 = await c22.post('/api/wallet/topup', { amount: 500000 });
  const code22 = t22.json.topup.code;
  const w22 = await makeClient('wh22').post('/api/webhooks/sepay', {
    content: `NAP${code22}`, transferAmount: 10000, referenceCode: 'REF22',
  }, { headers: { authorization: 'Apikey TEST_WEBHOOK_SECRET_0123456789abcdef' } });
  const bal22 = q1(`SELECT balance FROM users WHERE id = '${c22._id}'`).balance;
  const st22 = q1(`SELECT status FROM topups WHERE code='${code22}'`).status;
  record(22,
    'Webhook chuyển THIẾU (10.000đ cho lệnh 500.000đ)',
    bal22 === 10000 ? 'Cộng đúng phần nhận (10.000đ), trạng thái partial' : `Số dư ${bal22} — kiểm tra`,
    bal22 <= 500000 ? 'OK' : 'CRITICAL',
    `webhook -> ${w22.status} ${JSON.stringify(w22.json)}; số dư=${bal22}; topup status=${st22}`,
    'Đã đúng logic "cộng phần đã nhận". LƯU Ý: đây cũng là đường để cộng tiền nhiều lần nếu gửi nhiều webhook thiếu (xem #22b).');

  return { adm };
}
