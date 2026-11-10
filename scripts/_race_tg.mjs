/**
 * race-tg.mjs — #15: 2 telegram/webhook duyệt CÙNG topup đồng thời (worker local).
 * Cũng test: sepay webhook 2 lần cùng txn_ref, và approve topup đã partial.
 */
const L = 'http://127.0.0.1:8799';
const WH = 'TEST_WEBHOOK_SECRET_0123456789abcdef';
const TGS = 'TEST_TG_WEBHOOK_SECRET_0123456789';
const TGC = '999888777';

const out = [];
function rec(id, name, expect, actual, ok, extra) {
  out.push({ id, name, expect, actual, ok });
  const m = ok === true ? 'OK  ' : ok === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${m}] ${id} ${name}\n      kỳ vọng: ${expect}\n      thực tế : ${actual}${extra ? '\n      ' + extra : ''}`);
}
const P = async (p, o = {}) => {
  const r = await fetch(L + p, o);
  return { status: r.status, data: await r.json().catch(() => null) };
};

function tgCb(topupId) {
  return P('/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': TGS },
    body: JSON.stringify({
      callback_query: {
        id: 'cb-' + Math.random().toString(36).slice(2),
        data: `tp:ok:${topupId}`,
        from: { id: Number(TGC), username: 'admin' },
        message: { chat: { id: Number(TGC) }, message_id: 1 },
      },
    }),
  });
}

async function balance() {
  // đọc số dư qua D1 local: dùng route /api/auth/me với session có sẵn? Không có.
  // Thay vào đó dùng sqlite qua wrangler ở ngoài -> script này chỉ trả về hành vi HTTP.
  return null;
}

async function main() {
  console.log('\n== #15 TELEGRAM WEBHOOK — 2 lần duyệt cùng topup (local) ==');
  const h0 = await P('/api/health');
  if (h0.status !== 200) throw new Error('local worker chưa chạy');

  // Bắn 2 callback ĐỒNG THỜI cho tp-race-1
  const res = await Promise.all([tgCb('tp-race-1'), tgCb('tp-race-1')]);
  const approved = res.filter((r) => r.data?.approved === true).length;
  const dup = res.filter((r) => r.data?.duplicated === true).length;
  rec('15a', '2 telegram callback duyệt CÙNG 1 topup đồng thời',
    'chỉ 1 lần cộng tiền (atomic claim WHERE status!=paid)',
    `approved=${approved}, duplicated=${dup}`,
    approved === 1,
    `payload: ${res.map((r) => JSON.stringify(r.data).slice(0, 90)).join(' | ')}`);

  // Bắn 5 lần đồng thời
  const res5 = await Promise.all(Array.from({ length: 5 }, () => tgCb('tp-race-2')));
  const ap5 = res5.filter((r) => r.data?.approved === true).length;
  const dp5 = res5.filter((r) => r.data?.duplicated === true).length;
  rec('15b', '5 telegram callback duyệt CÙNG 1 topup đồng thời',
    'chỉ 1 lần cộng tiền', `approved=${ap5}, duplicated=${dp5}`, ap5 === 1);

  // Duplicate webhook SePay cùng referenceCode 2 lần -> khác topup? cùng topup?
  console.log('\n-- sepay idempotency --');
  const t = await P('/api/wallet/topup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'mbk_session=invalid' },
    body: JSON.stringify({ amount: 20000 }),
  });
  rec('S1', 'createTopup không cần session?', 'phải 401', `HTTP=${t.status}`, t.status === 401);

  // SePay webhook lại cho topup đã paid -> phải duplicated
  const s1 = await P('/api/webhooks/sepay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Apikey ' + WH },
    body: JSON.stringify({ content: 'NAPAAAAA', transferAmount: 100000, referenceCode: 'FT-A' }),
  });
  rec('S2', 'sepay webhook lại cho topup đã paid', 'duplicated, không cộng thêm',
    JSON.stringify(s1.data), s1.data?.duplicated === true);

  // SePay 2 webhook ĐỒNG THỜI cho 1 topup đã partial
  console.log('\n-- sepay 2 webhook đồng thời cho 1 topup đã partial (50k/100k) --');
  const sres = await Promise.all([
    P('/api/webhooks/sepay', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Apikey ' + WH },
      body: JSON.stringify({ content: 'NAPCCCCC', transferAmount: 50000, referenceCode: 'FT-PARTIAL-2' }),
    }),
    P('/api/webhooks/sepay', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Apikey ' + WH },
      body: JSON.stringify({ content: 'NAPCCCCC', transferAmount: 50000, referenceCode: 'FT-PARTIAL-2' }),
    }),
  ]);
  const credited = sres.filter((r) => r.data?.credited > 0).length;
  rec('S3', 'sepay 2 webhook đồng thời cho topup đã partial',
    'chỉ cộng 1 lần (nhánh partial phải có atomic claim như nhánh paid)',
    `số lần cộng tiền = ${credited}/2; ${sres.map((r) => JSON.stringify(r.data).slice(0, 110)).join(' | ')}`,
    credited <= 1,
    'sepayWebhook nhánh PARTIAL (dòng 762-766) và nhánh PAID (dòng 784) đều KHÔNG có "AND status!=paid" -> 2 webhook song song cộng 2 lần');

  console.log('\n' + '═'.repeat(70));
  console.log('TÓM TẮT:', out.filter((r) => r.ok === true).length, 'ĐÚNG |',
    out.filter((r) => r.ok === 'warn').length, 'CẢNH BÁO |',
    out.filter((r) => r.ok !== true && r.ok !== 'warn').length, 'SAI');
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
