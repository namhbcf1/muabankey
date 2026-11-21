/**
 * payment-inbox.test.mjs — Chứng từ tiền vào phải bền vững trước mọi nhánh return.
 *
 * Khoá lỗi P0 F07: webhook trả 200 mà chưa ghi sổ = tiền mất dấu vĩnh viễn.
 */
import { Suite } from './harness.mjs';
import { makeEnv, nowSec } from './d1.mjs';

const MIGRATIONS = [
  'db/migrate-account-entitlements.sql',
  'db/migrate-trial-account.sql',
  'db/migrate-entitlement-grants.sql',
  'db/migrate-payment-inbox.sql',
];

const S = new Suite('Hộp thư tiền vào');

const {
  recordInbound, markProcessed, listUnresolved, findByTxn, sumForOrder,
} = await import('../src/lib/payment-inbox.js');

/* ================================================================== */
S.section('Ghi chứng từ cơ bản');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });

  const r = await recordInbound(env, {
    provider: 'sepay', transactionId: 'TXN-001', amount: 180000,
    content: 'MBKABC123', accountNumber: '0123456789', transferType: 'in',
  });
  S.ok(r.recorded === true && r.duplicated === false, 'ghi được chứng từ mới');

  const row = sqlite.prepare('SELECT * FROM payment_inbox WHERE transaction_id = ?').get('TXN-001');
  S.ok(!!row, 'dòng có trong bảng');
  S.ok(Number(row.amount) === 180000, 'số tiền đúng', String(row.amount));
  S.ok(row.state === 'received', 'trạng thái ban đầu = received', String(row.state));
}

S.section('Chống trùng — giao dịch của provider chỉ ghi MỘT lần');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });

  const r1 = await recordInbound(env, {
    provider: 'sepay', transactionId: 'TXN-DUP', amount: 50000,
  });
  S.ok(r1.recorded && !r1.duplicated, 'lần 1 ghi mới');

  const r2 = await recordInbound(env, {
    provider: 'sepay', transactionId: 'TXN-DUP', amount: 50000,
  });
  S.ok(r2.duplicated === true, 'lần 2 nhận diện là trùng');

  const n = sqlite.prepare('SELECT COUNT(*) AS n FROM payment_inbox').get();
  S.ok(Number(n.n) === 1, 'bảng chỉ có 1 dòng', `${n.n}`);

  // Cùng mã nhưng KHÁC provider là giao dịch khác -> phải ghi được.
  const other = await recordInbound(env, {
    provider: 'payos', transactionId: 'TXN-DUP', amount: 50000,
  });
  S.ok(other.recorded && !other.duplicated, 'cùng mã khác provider vẫn ghi được');
}

S.section('Đồng thời — 10 webhook cùng giao dịch chỉ ghi 1 dòng');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });

  const results = await Promise.all(
    Array.from({ length: 10 }, () => recordInbound(env, {
      provider: 'sepay', transactionId: 'TXN-RACE', amount: 99000,
    })),
  );
  const fresh = results.filter((r) => r.recorded && !r.duplicated).length;
  S.ok(fresh === 1, 'chỉ MỘT lượt ghi mới', `${fresh} lượt`);

  const n = sqlite.prepare('SELECT COUNT(*) AS n FROM payment_inbox').get();
  S.ok(Number(n.n) === 1, 'bảng chỉ có 1 dòng sau 10 request đồng thời', `${n.n}`);
}

S.section('Không có mã giao dịch -> KHÔNG ghi (không thể chống trùng)');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  const r = await recordInbound(env, {
    provider: 'sepay', transactionId: '', amount: 100000,
  });
  S.ok(r.recorded === false, 'từ chối ghi khi thiếu mã giao dịch', String(r.state));
  S.ok(Number(sqlite.prepare('SELECT COUNT(*) AS n FROM payment_inbox').get().n) === 0,
    'không tạo dòng rác');
}

S.section('Lỗi ghi thật -> NÉM LỖI để webhook trả 5xx cho provider retry');

{
  const { env } = makeEnv({ migrations: MIGRATIONS });
  // Bảng chưa tồn tại -> phải ném, KHÔNG được im lặng trả "đã ghi".
  const { env: raw } = makeEnv({ migrations: [] });

  let threw = false;
  try {
    await recordInbound(raw, {
      provider: 'sepay', transactionId: 'TXN-NOTABLE', amount: 1000,
    });
  } catch {
    threw = true;
  }
  S.ok(threw === true, 'thiếu bảng -> ném lỗi (không nuốt)', String(threw));

  // Có bảng thì chạy bình thường.
  const ok1 = await recordInbound(env, {
    provider: 'sepay', transactionId: 'TXN-OK', amount: 1000,
  });
  S.ok(ok1.recorded === true, 'có bảng -> ghi được');
}

S.section('Đối soát — khoản chưa xử lý phải nhìn thấy được');

{
  const { env } = makeEnv({ migrations: MIGRATIONS });

  const a = await recordInbound(env, {
    provider: 'sepay', transactionId: 'A', amount: 1000,
  });
  const b = await recordInbound(env, {
    provider: 'sepay', transactionId: 'B', amount: 2000,
  });
  const c = await recordInbound(env, {
    provider: 'sepay', transactionId: 'C', amount: 3000,
  });

  // A: đã khớp + giao xong -> không còn trong danh sách chờ
  await markProcessed(env, a.inboxId, {
    state: 'matched', orderId: 'o-1', orderCode: 'MBK-1', deliverState: 'delivered',
  });
  // B: không khớp đơn -> vẫn nằm trong danh sách chờ
  await markProcessed(env, b.inboxId, { state: 'unmatched' });
  // C: không xử lý gì -> cũng nằm trong danh sách chờ

  const pend = await listUnresolved(env);
  const ids = pend.map((p) => p.transaction_id).sort();
  S.eq(ids, ['B', 'C'], 'chỉ khoản chưa xong mới nằm trong danh sách đối soát');
  void c;
}

S.section('markProcessed — giao hàng thất bại vẫn phải thấy');

{
  const { env } = makeEnv({ migrations: MIGRATIONS });
  const r = await recordInbound(env, {
    provider: 'sepay', transactionId: 'FAIL-1', amount: 5000,
  });
  await markProcessed(env, r.inboxId, {
    state: 'matched', orderId: 'o-9', deliverState: 'failed',
    note: 'không đủ hàng',
  });
  const pend = await listUnresolved(env);
  S.ok(pend.length === 1, 'khoản "đã thu tiền nhưng giao lỗi" vẫn hiện', `${pend.length}`);
  S.ok(pend[0].deliver_state === 'failed', 'đánh dấu deliver_state=failed',
    String(pend[0].deliver_state));
}

S.section('sumForOrder');

{
  const { env } = makeEnv({ migrations: MIGRATIONS });

  const a = await recordInbound(env, {
    provider: 'sepay', transactionId: 'S1', amount: 90000, transferType: 'in',
  });
  await markProcessed(env, a.inboxId, { state: 'matched', orderId: 'o-77' });
  const b = await recordInbound(env, {
    provider: 'sepay', transactionId: 'S2', amount: 90000, transferType: 'in',
  });
  await markProcessed(env, b.inboxId, { state: 'matched', orderId: 'o-77' });

  // Giao dịch test không được tính
  const t = await recordInbound(env, {
    provider: 'sepay', transactionId: 'S3', amount: 500000, transferType: 'in', isTest: true,
  });
  await markProcessed(env, t.inboxId, { state: 'matched', orderId: 'o-77' });

  const sum = await sumForOrder(env, 'o-77');
  S.ok(sum === 180000, 'cộng hai lần chuyển thiếu -> đủ 180.000 (bỏ qua test)', String(sum));
}

S.section('findByTxn');

{
  const { env } = makeEnv({ migrations: MIGRATIONS });
  await recordInbound(env, { provider: 'sepay', transactionId: 'F-1', amount: 1000 });
  const row = await findByTxn(env, 'sepay', 'F-1');
  S.ok(!!row && row.transaction_id === 'F-1', 'tra được theo mã giao dịch');
  const none = await findByTxn(env, 'sepay', 'KHONG-CO');
  S.ok(none === null, 'mã không tồn tại -> null');
}

process.exit(S.summary() ? 0 : 1);
