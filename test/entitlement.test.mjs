/**
 * entitlement.test.mjs — Quyền theo tài khoản: cộng hạn, dùng thử, đồng thời.
 *
 * Tái hiện và khoá các lỗi P0:
 *   F01 — resume dùng thử cộng thêm thời gian vào quyền tài khoản
 *   F03 — hai lần gia hạn đồng thời đọc cùng hạn cũ -> mất lượt cộng
 */
import { Suite } from './harness.mjs';
import { makeEnv, nowSec } from './d1.mjs';

const MIGRATIONS = [
  'db/migrate-account-entitlements.sql',
  'db/migrate-trial-account.sql',
  'db/migrate-entitlement-grants.sql',
];

const S = new Suite('Quyền theo tài khoản');

/** Đặt giờ hệ thống về một mốc cố định trong lúc chạy `fn`. */
async function at(unixSec, fn) {
  const real = Date.now;
  const target = unixSec * 1000;
  Date.now = () => target;
  try { return await fn(); } finally { Date.now = real; }
}

function seedUser(sqlite, id, username = id) {
  const t = nowSec() * 1000;
  sqlite.prepare(
    'INSERT INTO users (id, email, password_hash, password_salt, role, status, balance, created_at, updated_at, username) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(id, `${username}@local`, 'x', 'y', 'user', 'active', 0, t, t, username);
}

const {
  grantFeature, revokeFeature, revokeOrderGrants, shapeAccountEntitlements,
  loadEntitlements, isActive, applyTrialEntitlement, listGrants,
  FEATURE_NOFOG, FEATURE_GRANT,
} = await import('../src/lib/account-entitlement.js');

/* ================================================================== */
S.section('grantFeature — gia hạn cộng dồn');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u1');

  const T = 1_800_000_000;
  await at(T, async () => {
    const r1 = await grantFeature(env, {
      userId: 'u1', feature: FEATURE_NOFOG, days: 30, source: 'purchase',
    });
    S.ok(r1.expiresAt === T + 30 * 86400, 'mua 30 ngày lần đầu -> hạn = now + 30d',
      String(r1.expiresAt - T));

    // 10 ngày sau mua thêm 30 -> cộng dồn từ hạn cũ
    Date.now = () => (T + 10 * 86400) * 1000;
    const r2 = await grantFeature(env, {
      userId: 'u1', feature: FEATURE_NOFOG, days: 30, source: 'purchase',
    });
    S.ok(r2.expiresAt === T + 60 * 86400, 'mua thêm khi còn hạn -> cộng dồn đúng ngày',
      `nhận +${Math.round((r2.expiresAt - T) / 86400)}d, cần +60d`);

    // Hết hạn rồi mua -> tính từ bây giờ
    const T3 = T + 100 * 86400;
    Date.now = () => T3 * 1000;
    const r3 = await grantFeature(env, {
      userId: 'u1', feature: FEATURE_NOFOG, days: 7, source: 'purchase',
    });
    S.ok(r3.expiresAt === T3 + 7 * 86400, 'mua khi đã hết hạn -> tính từ bây giờ',
      String((r3.expiresAt - T3) / 86400));
  });
}

S.section('grantFeature — vĩnh viễn');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u2');
  const T = 1_800_000_000;
  await at(T, async () => {
    const f = await grantFeature(env, {
      userId: 'u2', feature: FEATURE_GRANT, days: 0, source: 'admin',
    });
    S.ok(f.expiresAt === 0, 'days=0 -> vĩnh viễn (0)');

    const d = await grantFeature(env, {
      userId: 'u2', feature: FEATURE_GRANT, days: 30, source: 'purchase',
    });
    S.ok(d.expiresAt === 0, 'đang vĩnh viễn, mua thêm hạn KHÔNG làm giảm quyền');
  });
}

S.section('F03 — hai lần gia hạn ĐỒNG THỜI không được mất ngày');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u3');
  const T = 1_800_000_000;

  /*
   * Tái hiện đúng kịch bản race: cả hai request đọc hạn cũ TRƯỚC khi bên nào
   * ghi. Với bản cũ (SELECT rồi UPSERT giá trị tính trong JS), hai lần mua
   * 30 ngày chỉ cộng được 30 ngày.
   *
   * Cách mô phỏng trung thực: chặn `first()` của câu SELECT hạn để cả hai
   * cùng đọc xong rồi mới cho ghi.
   */
  const origPrepare = env.DB.prepare.bind(env.DB);
  let selectDone = 0;
  let releaseAll;
  const gate = new Promise((r) => { releaseAll = r; });

  env.DB.prepare = (sql) => {
    const st = origPrepare(sql);
    if (/SELECT\s+expires_at\s+FROM\s+account_entitlements/i.test(sql)) {
      const origFirst = st.first.bind(st);
      st.first = async (col) => {
        const row = origFirst(col);
        selectDone++;
        if (selectDone >= 2) releaseAll();
        // Chờ bên kia cũng đọc xong — đúng trình tự interleaving.
        await Promise.race([gate, new Promise((r) => setTimeout(r, 50))]);
        return row;
      };
    }
    return st;
  };

  await at(T, async () => {
    await Promise.all([
      grantFeature(env, { userId: 'u3', feature: FEATURE_NOFOG, days: 30, source: 'purchase' }),
      grantFeature(env, { userId: 'u3', feature: FEATURE_NOFOG, days: 30, source: 'purchase' }),
    ]);
  });

  env.DB.prepare = origPrepare;

  const row = sqlite.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u3', FEATURE_NOFOG);
  const added = row ? Math.round((Number(row.expires_at) - T) / 86400) : 0;
  S.ok(added === 60, 'hai lần mua 30 ngày đồng thời -> cộng đủ 60 ngày', `nhận +${added} ngày`);
}

S.section('F01 — dùng thử resume KHÔNG được cộng thêm thời gian');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u4');
  const T = 1_800_000_000;
  const exp = T + 86400;

  await at(T, async () => {
    // Bắt đầu dùng thử — ĐẶT mốc tuyệt đối
    await applyTrialEntitlement(env, {
      userId: 'u4', feature: FEATURE_NOFOG, expiresAt: exp, trialToken: 'acct:u4',
    });

    // 60 giây sau khách mở app lần nữa -> resume (gọi lại y hệt)
    Date.now = () => (T + 60) * 1000;
    await applyTrialEntitlement(env, {
      userId: 'u4', feature: FEATURE_NOFOG, expiresAt: exp, trialToken: 'acct:u4',
    });

    // 1 giờ sau resume thêm 10 lần nữa — vẫn phải y nguyên
    Date.now = () => (T + 3600) * 1000;
    for (let i = 0; i < 10; i++) {
      await applyTrialEntitlement(env, {
        userId: 'u4', feature: FEATURE_NOFOG, expiresAt: exp, trialToken: 'acct:u4',
      });
    }
  });

  const row = sqlite.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u4', FEATURE_NOFOG);
  const got = Number(row?.expires_at || 0);
  S.ok(got === exp, 'resume 1 lần hay 11 lần đều giữ NGUYÊN hạn dùng thử',
    `hạn lệch ${got - exp} giây (dương = cộng thêm sai)`);
}

S.section('F01b — dùng thử KHÔNG được rút ngắn quyền đã mua');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u4b');
  const T = 1_800_000_000;

  await at(T, async () => {
    // Khách mua 365 ngày trước, rồi mới bấm dùng thử
    await grantFeature(env, {
      userId: 'u4b', feature: FEATURE_NOFOG, days: 365, source: 'purchase', orderId: 'o-1',
    });
    await applyTrialEntitlement(env, {
      userId: 'u4b', feature: FEATURE_NOFOG, expiresAt: T + 86400, trialToken: 'acct:u4b',
    });
  });

  const row = sqlite.prepare(
    'SELECT expires_at, source FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u4b', FEATURE_NOFOG);
  S.ok(Number(row?.expires_at) === T + 365 * 86400,
    'quyền mua 365 ngày không bị trial 1 ngày đè xuống',
    `còn ${Math.round((Number(row?.expires_at) - T) / 86400)} ngày`);
  S.ok(row?.source === 'purchase', 'nguồn quyền vẫn là purchase', String(row?.source));
}

S.section('F01c — dùng thử KHÔNG được hạ quyền vĩnh viễn');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u4c');
  const T = 1_800_000_000;

  await at(T, async () => {
    await grantFeature(env, {
      userId: 'u4c', feature: FEATURE_GRANT, days: 0, source: 'purchase', orderId: 'o-2',
    });
    await applyTrialEntitlement(env, {
      userId: 'u4c', feature: FEATURE_GRANT, expiresAt: T + 86400, trialToken: 'acct:u4c',
    });
  });

  const row = sqlite.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u4c', FEATURE_GRANT);
  S.ok(Number(row?.expires_at) === 0, 'quyền vĩnh viễn vẫn là 0 sau khi dùng thử');
}

S.section('F02 — hoàn tiền trừ ĐÚNG phần của đơn, giữ nguyên đơn khác');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u7');
  const T = 1_800_000_000;

  await at(T, async () => {
    // Đơn A: 30 ngày nofog
    await grantFeature(env, {
      userId: 'u7', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'order-A',
    });
    // Đơn B: 30 ngày nofog nữa (khách mua thêm)
    await grantFeature(env, {
      userId: 'u7', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'order-B',
    });
  });

  let exp = sqlite.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u7', FEATURE_NOFOG);
  S.ok(Number(exp.expires_at) === T + 60 * 86400, 'trước hoàn: +60 ngày',
    `${Math.round((Number(exp.expires_at) - T) / 86400)}`);

  await at(T, async () => {
    const r = await revokeOrderGrants(env, 'order-A', { reason: 'refund' });
    S.eq(r.features, [FEATURE_NOFOG], 'thu hồi đúng tính năng của đơn A');
  });

  exp = sqlite.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u7', FEATURE_NOFOG);
  const left = Math.round((Number(exp.expires_at) - T) / 86400);
  S.ok(left === 30, 'hoàn đơn A -> còn đúng 30 ngày của đơn B', `còn ${left} ngày`);
}

S.section('F02b — hoàn đơn duy nhất -> hết hạn ngay, không xoá dòng');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u8');
  const T = 1_800_000_000;

  await at(T, async () => {
    await grantFeature(env, {
      userId: 'u8', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'order-C',
    });
    // 5 ngày sau hoàn tiền
    Date.now = () => (T + 5 * 86400) * 1000;
    await revokeOrderGrants(env, 'order-C', { reason: 'refund' });
  });

  const row = sqlite.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u8', FEATURE_NOFOG);
  S.ok(!!row, 'dòng quyền vẫn còn để đối soát (không xoá)');
  S.ok(Number(row?.expires_at) <= T + 5 * 86400, 'quyền hết hiệu lực ngay sau hoàn',
    `expires_at=${row?.expires_at}`);

  const s = await shapeAccountEntitlements(env, 'u8', T + 5 * 86400);
  S.ok(s.hasNofog === false, 'sau hoàn: không còn quyền nofog');
}

S.section('F02c — cấp trùng cùng đơn không nhân đôi thời gian');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u9');
  const T = 1_800_000_000;

  await at(T, async () => {
    // grantFeature idempotent theo (user, feature, purchase, orderId).
    await grantFeature(env, {
      userId: 'u9', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'order-D',
    });
    const grants = await listGrants(env, 'u9');
    S.ok(grants.length === 1, 'sổ ghi đúng 1 dòng cho 1 đơn', `có ${grants.length}`);
  });
}

S.section('F02d — RETRY cùng một đơn (webhook gọi lại) không cộng thêm ngày');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u11');
  const T = 1_800_000_000;

  await at(T, async () => {
    const first = await grantFeature(env, {
      userId: 'u11', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'order-R',
    });
    S.ok(first.applied === true, 'lần đầu: quyền được áp');
    S.ok(first.expiresAt === T + 30 * 86400, 'lần đầu: +30 ngày');

    // 3 lần retry (worker chết, webhook gửi lại, admin bấm giao bù)
    for (let i = 0; i < 3; i++) {
      const r = await grantFeature(env, {
        userId: 'u11', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'order-R',
      });
      S.ok(r.applied === false, `retry ${i + 1}: KHÔNG áp lại (idempotent)`);
    }

    // Hai lần "đồng thời" cùng đơn
    await Promise.all([
      grantFeature(env, {
        userId: 'u11', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'order-R',
      }),
      grantFeature(env, {
        userId: 'u11', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'order-R',
      }),
    ]);

    // Đơn khác thì VẪN phải cộng (không chặn nhầm)
    const other = await grantFeature(env, {
      userId: 'u11', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'order-S',
    });
    S.ok(other.applied === true, 'đơn KHÁC vẫn được cộng');
  });

  const row = sqlite.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u11', FEATURE_NOFOG);
  const total = Math.round((Number(row.expires_at) - T) / 86400);
  S.ok(total === 60, 'sau 5 lần retry + 2 đơn -> đúng 60 ngày (không phải 150+)',
    `tổng ${total} ngày`);

  const n = sqlite.prepare('SELECT COUNT(*) AS n FROM entitlement_grants WHERE user_id = ?').get('u11');
  S.ok(Number(n.n) === 2, 'sổ chỉ có 2 dòng (2 đơn)', `${n.n}`);
}

S.section('Sổ cấp quyền — ghi đúng ngày và nguồn');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u10');
  const T = 1_800_000_000;

  await at(T, async () => {
    await grantFeature(env, {
      userId: 'u10', feature: FEATURE_GRANT, days: 15, source: 'purchase', orderId: 'order-E',
    });
    const g = await listGrants(env, 'u10');
    S.ok(g.length === 1, 'có 1 dòng sổ');
    S.ok(Number(g[0].days_added) === 15, 'days_added = 15', String(g[0].days_added));
    S.ok(Number(g[0].new_expires_at) === T + 15 * 86400, 'new_expires_at đúng');
    S.ok(String(g[0].source_id) === 'order-E', 'source_id = mã đơn');
  });
}

S.section('revokeFeature');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u5');
  const T = 1_800_000_000;
  await at(T, async () => {
    await grantFeature(env, { userId: 'u5', feature: FEATURE_NOFOG, days: 30 });
    await revokeFeature(env, 'u5', FEATURE_NOFOG);
    const rows = await loadEntitlements(env, 'u5');
    S.ok(!rows.get(FEATURE_NOFOG), 'thu hồi xoá đúng dòng quyền');
  });
}

S.section('shapeAccountEntitlements');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u6');
  const T = 1_800_000_000;
  await at(T, async () => {
    await grantFeature(env, { userId: 'u6', feature: FEATURE_NOFOG, days: 10 });
    const s = await shapeAccountEntitlements(env, 'u6', T);
    S.ok(s.hasNofog === true, 'có nofog đang hiệu lực');
    S.ok(s.hasGrant === false, 'không có grant');
    S.eq(s.features, ['nofog'], 'features chỉ gồm tính năng đang bật');
    S.ok(s.nofog.daysLeft === 10, 'daysLeft = 10', String(s.nofog.daysLeft));
    S.ok(s.trial.state === 'available', 'trial mặc định available', s.trial.state);
  });
}

S.section('isActive');

{
  const now = 1000;
  S.ok(isActive({ expires_at: 0 }, now) === true, 'expires_at=0 là vĩnh viễn');
  S.ok(isActive({ expires_at: now + 1 }, now) === true, 'còn hạn -> hiệu lực');
  S.ok(isActive({ expires_at: now - 1 }, now) === false, 'quá hạn -> hết hiệu lực');
  S.ok(isActive(null, now) === false, 'không có dòng -> hết hiệu lực');
}

process.exit(S.summary() ? 0 : 1);
