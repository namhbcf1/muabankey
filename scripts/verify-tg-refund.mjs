/**
 * Kiểm chứng ĐƯỜNG TELEGRAM hoàn tiền cũng idempotent.
 *
 * VÌ SAO CẦN RIÊNG: đây chính là đường đã bị bỏ sót trước đây — C2 (race
 * hoàn tiền) được vá ở đường web nhưng quên nút bấm Telegram, nên cùng một
 * lỗ hổng vẫn khai thác được từ chat. Test này chứng minh CẢ HAI đường dùng
 * chung sổ refund_ledger và không đường nào cộng tiền 2 lần.
 *
 * Chạy: node scripts/verify-tg-refund.mjs [baseUrl]
 * Cần .dev.vars: TG_WEBHOOK_SECRET, TG_CHAT_ID (đã thêm sẵn cho local).
 */
import { sql } from './_d1local.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const TG_SECRET = process.env.TG_WEBHOOK_SECRET || 'local-tg-secret-abc123';
const TG_CHAT = process.env.TG_CHAT_ID || '1427044674';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'local-test-secret-1234567890';
const ADMIN_USER = process.env.ADMIN_USER || 'testadmin';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'TestAdmin123456';

let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

class Client {
  constructor() { this.cookie = null; }
  async req(path, { method = 'GET', body = null } = {}) {
    const h = { Accept: 'application/json' };
    if (body) h['Content-Type'] = 'application/json';
    if (this.cookie) h.Cookie = this.cookie;
    const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) { const m = sc.match(/mbk_session=[^;]+/); if (m) this.cookie = m[0]; }
    let d = null;
    try { d = await r.json(); } catch { /* */ }
    return { status: r.status, data: d };
  }
}

/** Bấm nút Telegram như admin thật. */
async function press(data) {
  const r = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': TG_SECRET },
    body: JSON.stringify({
      update_id: Math.floor(Math.random() * 1e9),
      callback_query: {
        id: 'cb' + Date.now() + Math.random(),
        from: { id: Number(TG_CHAT), username: 'tester' },
        data,
        message: { message_id: 999, chat: { id: Number(TG_CHAT) } },
      },
    }),
  });
  let d = null;
  try { d = await r.json(); } catch { /* */ }
  return { status: r.status, data: d };
}

const n = (q) => sql(q)[0]?.n ?? 0;
const uniq = Date.now().toString(36);

async function main() {
  console.log(`\n🧪 HOÀN TIỀN QUA TELEGRAM → ${BASE}\n`);

  const u = new Client();
  const uname = `tg${uniq.replace(/[^a-z0-9]/g, '').slice(0, 10)}`;
  const reg = await u.req('/api/auth/register', { method: 'POST', body: { username: uname, password: 'Test123456' } });
  if (reg.status !== 201) { console.error(`đăng ký lỗi ${reg.status}`); process.exit(2); }
  const uid = (await u.req('/api/auth/me')).data.user.id;

  const TOP = 10_000_000;
  sql(`UPDATE users SET balance = balance + ${TOP} WHERE id='${uid}';`);
  sql(`INSERT INTO wallet_transactions
         (id,user_id,type,amount,balance_after,status,reference,description,created_at)
       VALUES ('tg-${uniq}','${uid}','admin_credit',${TOP},
         (SELECT balance FROM users WHERE id='${uid}'),'success','SEED3','seed',${Date.now()});`);
  const balOf = () => sql(`SELECT balance FROM users WHERE id='${uid}'`)[0]?.balance ?? 0;

  const licProd = (await new Client().req('/api/products?perPage=100'))
    .data.products.find((x) => x.slug === 'license-xarena-thang');

  // Tạo + thanh toán 2 đơn để có 2 đơn delivered
  async function payOne(items) {
    const o = await u.req('/api/orders', { method: 'POST', body: { items } });
    if (o.status !== 201) return null;
    const qr = await u.req(`/api/orders/${o.data.order.id}/qr`, { method: 'POST' });
    if (qr.status !== 200) return null;
    await fetch(BASE + '/api/webhooks/sepay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${WEBHOOK_SECRET}` },
      body: JSON.stringify({
        transferType: 'in', transferAmount: qr.data.qr.amount, content: qr.data.qr.memo,
        referenceCode: `TG${uniq}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
    return o.data.order.id;
  }

  const o1 = await payOne([{ productId: licProd.id, quantity: 1 }]);
  console.log(`  đơn 1: ${o1} status=${sql(`SELECT status FROM orders WHERE id='${o1}'`)[0]?.status}`);
  if (!o1) { console.error('không tạo được đơn'); process.exit(2); }

  /* ===== 1. Hoàn qua Telegram lần 1 ===== */
  console.log('\n1️⃣  Telegram refund lần 1');
  const b0 = balOf();
  const t1 = await press(`od:refund:${o1}`);
  const b1 = balOf();
  const total = sql(`SELECT total FROM orders WHERE id='${o1}'`)[0].total;
  console.log(`  response: ${JSON.stringify(t1.data).slice(0, 200)}`);
  console.log(`  balance ${b0} -> ${b1} (total=${total})`);
  ok('Telegram refund lần 1 thành công', t1.data?.refunded === total,
    `refunded=${t1.data?.refunded} total=${total} err=${t1.data?.error || ''}`);
  ok('ví tăng đúng bằng total', b1 === b0 + total, `want=${b0 + total} got=${b1}`);
  ok("sổ có state='done'",
    sql(`SELECT state FROM refund_ledger WHERE order_id='${o1}'`)[0]?.state === 'done',
    `state=${sql(`SELECT state FROM refund_ledger WHERE order_id='${o1}'`)[0]?.state}`);
  ok("sổ ghi source='telegram'",
    sql(`SELECT source FROM refund_ledger WHERE order_id='${o1}'`)[0]?.source === 'telegram',
    `source=${sql(`SELECT source FROM refund_ledger WHERE order_id='${o1}'`)[0]?.source}`);

  /* ===== 2. Bấm lại nút → không cộng lần 2 ===== */
  console.log('\n2️⃣  Bấm LẠI nút Telegram (đơn đã refunded)');
  const t2 = await press(`od:refund:${o1}`);
  const b2 = balOf();
  console.log(`  response: ${JSON.stringify(t2.data).slice(0, 200)}`);
  console.log(`  balance=${b2}`);
  ok('lần 2 KHÔNG cộng tiền', b2 === b1, `b1=${b1} b2=${b2}`);
  ok('lần 2 trả lỗi cho admin', Boolean(t2.data?.error) || t2.data?.refunded === undefined,
    JSON.stringify(t2.data).slice(0, 140));
  ok('refund_ledger vẫn đúng 1 dòng',
    n(`SELECT COUNT(*) n FROM refund_ledger WHERE order_id='${o1}'`) === 1,
    `n=${n(`SELECT COUNT(*) n FROM refund_ledger WHERE order_id='${o1}'`)}`);

  /* ===== 3. Ép lại trạng thái 'paid' rồi bấm Telegram (mô phỏng cron cũ hồi sinh) ===== */
  console.log('\n3️⃣  Mô phỏng cron CŨ hồi sinh đơn về paid rồi bấm Telegram');
  sql(`UPDATE orders SET status='paid' WHERE id='${o1}';`);
  const b3a = balOf();
  const t3 = await press(`od:refund:${o1}`);
  const b3 = balOf();
  console.log(`  response: ${JSON.stringify(t3.data).slice(0, 200)}`);
  console.log(`  balance ${b3a} -> ${b3}`);
  ok('dù status bị hồi sinh về paid, sổ CHẶN cộng tiền lần 2',
    b3 === b3a, `b3a=${b3a} b3=${b3}`);
  ok('trả lỗi "đã ghi sổ hoàn tiền"',
    String(t3.data?.error || '').includes('ghi sổ'),
    JSON.stringify(t3.data).slice(0, 160));
  ok('refund_ledger KHÔNG thêm dòng',
    n(`SELECT COUNT(*) n FROM refund_ledger WHERE order_id='${o1}'`) === 1,
    `n=${n(`SELECT COUNT(*) n FROM refund_ledger WHERE order_id='${o1}'`)}`);

  /* ===== 4. Web + Telegram cùng lúc trên 1 đơn mới ===== */
  console.log('\n4️⃣  Web và Telegram cùng hoàn MỘT đơn (2 đường tranh nhau)');
  const o2 = await payOne([{ productId: licProd.id, quantity: 1 }]);
  if (o2) {
    const admin = new Client();
    await admin.req('/api/auth/login', { method: 'POST', body: { username: ADMIN_USER, password: ADMIN_PW } });
    const bb = balOf();
    const [rw, rt] = await Promise.all([
      admin.req(`/api/admin/orders/${o2}/refund`, { method: 'POST' }),
      press(`od:refund:${o2}`),
    ]);
    const ba = balOf();
    const t2total = sql(`SELECT total FROM orders WHERE id='${o2}'`)[0].total;
    console.log(`  web=${rw.status} telegram=${JSON.stringify(rt.data).slice(0, 120)}`);
    console.log(`  balance ${bb} -> ${ba} (total=${t2total})`);
    ok('chỉ MỘT đường cộng tiền', ba === bb + t2total, `want=${bb + t2total} got=${ba}`);
    ok('refund_ledger đúng 1 dòng',
      n(`SELECT COUNT(*) n FROM refund_ledger WHERE order_id='${o2}'`) === 1,
      `n=${n(`SELECT COUNT(*) n FROM refund_ledger WHERE order_id='${o2}'`)}`);
    const wr = sql(`SELECT COUNT(*) n FROM wallet_transactions
                     WHERE user_id='${uid}' AND reference=(SELECT code FROM orders WHERE id='${o2}')
                       AND type='refund'`)[0].n;
    ok('sổ cái chỉ 1 dòng refund', wr === 1, `n=${wr}`);
  }

  /* ===== 5. Đối soát ===== */
  console.log('\n5️⃣  Đối soát sổ cái');
  const mine = sql(`SELECT u.balance, COALESCE(SUM(w.amount),0) so_cai
                      FROM users u LEFT JOIN wallet_transactions w
                        ON w.user_id=u.id AND w.status='success'
                     WHERE u.id='${uid}' GROUP BY u.id`)[0];
  console.log(`  balance=${mine?.balance} sổ cái=${mine?.so_cai}`);
  ok('sổ cái user test khớp tuyệt đối', mine && mine.balance === mine.so_cai,
    `balance=${mine?.balance} so_cai=${mine?.so_cai}`);

  console.log(`\n${'─'.repeat(58)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  if (fail > 0) { console.log('\nLỗi:'); for (const f of fails) console.log('  • ' + f); }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
