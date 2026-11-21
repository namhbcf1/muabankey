/**
 * device.test.mjs — Luật "một tài khoản = một máy tại một thời điểm".
 *
 * Khoá lỗi P0 F05: đường cấp token của mô hình mới (trial-account.js) ký token
 * mà không đi qua hàng rào thiết bị, vì `ownerUserId()` chỉ tra
 * `license_issues` — bảng mà key nội bộ KHÔNG BAO GIỜ có dòng.
 */
import { Suite } from './harness.mjs';
import { makeEnv } from './d1.mjs';

const MIGRATIONS = [
  'db/migrate-account-entitlements.sql',
  'db/migrate-trial-account.sql',
  'db/migrate-entitlement-grants.sql',
];

const S = new Suite('Thiết bị theo tài khoản');

const {
  guardAccountDevice, ownerUserId, deviceScope, usesSharedDevice,
  normHwid, SESSION_MOVED,
} = await import('../src/lib/account-device.js');

const HWID_A = 'a'.repeat(32);
const HWID_B = 'b'.repeat(32);

function seedUser(sqlite, id) {
  const t = Date.now();
  sqlite.prepare(
    'INSERT INTO users (id, email, password_hash, password_salt, role, status, balance, created_at, updated_at, username) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(id, `${id}@local`, 'x', 'y', 'user', 'active', 0, t, t, id);
}

function seedTrialAccount(sqlite, { userId, nofogKey, grantKey }) {
  const t = Math.floor(Date.now() / 1000);
  sqlite.prepare(
    `INSERT INTO trial_accounts
       (user_id, state, created_at, started_at, expires_at, nofog_key, grant_key, rebinds, updated_at)
     VALUES (?, 'active', ?, ?, ?, ?, ?, 0, ?)`
  ).run(userId, t, t, t + 86400, nofogKey || null, grantKey || null, t);
}

/* ================================================================== */
S.section('F05 — ownerUserId phải nhận key nội bộ của mô hình mới');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u1');
  seedTrialAccount(sqlite, {
    userId: 'u1', nofogKey: 'TR-AAAA-BBBB-CCCC', grantKey: 'XAGR-DDDD-EEEE-FFFF',
  });

  S.ok(await ownerUserId(env, 'TR-AAAA-BBBB-CCCC') === 'u1',
    'tra được chủ của key map sáng nội bộ');
  S.ok(await ownerUserId(env, 'XAGR-DDDD-EEEE-FFFF') === 'u1',
    'tra được chủ của key tài nguyên nội bộ');
  S.ok(await ownerUserId(env, 'tr-aaaa-bbbb-cccc') === 'u1',
    'không phân biệt chữ hoa/thường');
  S.ok(await ownerUserId(env, 'KHONG-CO-KEY') === null,
    'key lạ -> null');
}

S.section('F05 — ownerUserId vẫn tra được key BÁN (đường cũ)');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u2');
  const t = Math.floor(Date.now() / 1000);
  sqlite.prepare(
    'INSERT INTO license_issues (id, order_id, user_id, product_id, license_key, term_days, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run('li1', 'o1', 'u2', 'p1', 'AOE1-XXXX-YYYY-ZZZZ', 30, 0, t);

  S.ok(await ownerUserId(env, 'AOE1-XXXX-YYYY-ZZZZ') === 'u2',
    'tra được chủ của key đã bán (license_issues)');
}

S.section('F05 — guard phải CHẶN máy thứ hai khi máy đầu còn chạy');

{
  const { env } = makeEnv({ migrations: MIGRATIONS });

  // Máy A đăng nhập lần đầu -> chiếm quyền
  const g1 = await guardAccountDevice(env, {
    userId: 'u3', scope: 'all', hwid: HWID_A, mode: 'login',
  });
  S.ok(g1.ok === true && g1.enforced === true, 'máy A vào được');

  // Máy B cũng bấm đăng nhập ngay sau đó -> bị từ chối
  const g2 = await guardAccountDevice(env, {
    userId: 'u3', scope: 'all', hwid: HWID_B, mode: 'check',
  });
  S.ok(g2.ok === false && g2.code === SESSION_MOVED,
    'máy B bị chặn session_moved khi máy A còn sống', String(g2.code));

  // Máy A hỏi lại -> vẫn vào
  const g3 = await guardAccountDevice(env, {
    userId: 'u3', scope: 'all', hwid: HWID_A, mode: 'check',
  });
  S.ok(g3.ok === true, 'máy A vẫn dùng được');
}

S.section('Đổi máy chủ động (login) được chiếm quyền — máy cũ mất');

{
  const { env } = makeEnv({ migrations: MIGRATIONS });

  await guardAccountDevice(env, {
    userId: 'u4', scope: 'all', hwid: HWID_A, mode: 'login',
  });
  const moved = await guardAccountDevice(env, {
    userId: 'u4', scope: 'all', hwid: HWID_B, mode: 'login',
  });
  S.ok(moved.ok === true && moved.moved === true,
    'đăng nhập trên máy B -> chiếm quyền thành công');

  const back = await guardAccountDevice(env, {
    userId: 'u4', scope: 'all', hwid: HWID_A, mode: 'check',
  });
  S.ok(back.ok === false, 'máy A (cũ) bị chặn sau khi máy B chiếm quyền',
    String(back.code));
}

S.section('Hai tính năng trên CÙNG máy không đá nhau (ô thiết bị chung)');

{
  const { env } = makeEnv({ migrations: MIGRATIONS });

  // Mô hình mới: cả hai tính năng dùng chung một định danh máy
  const a = await guardAccountDevice(env, {
    userId: 'u5', scope: 'all', hwid: HWID_A, mode: 'login',
  });
  const b = await guardAccountDevice(env, {
    userId: 'u5', scope: 'all', hwid: HWID_A, mode: 'check',
  });
  S.ok(a.ok && b.ok, 'cùng máy, hai lần gọi -> không đá nhau');

  // Nếu tách scope theo sản phẩm thì đó sẽ là HAI ô riêng (hành vi cũ).
  const scopeNofog = deviceScope('nofog');
  const scopeGrant = deviceScope('xagrant', { sharedDevice: true });
  S.ok(scopeNofog === 'nofog', 'khách bản cũ: scope theo sản phẩm (nofog)', scopeNofog);
  S.ok(scopeGrant === 'all', 'mô hình mới: scope chung', scopeGrant);
}

S.section('usesSharedDevice');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seedUser(sqlite, 'u6');
  S.ok(await usesSharedDevice(env, 'u6') === false,
    'chưa có trial_accounts -> chưa dùng ô chung');

  seedTrialAccount(sqlite, { userId: 'u6', nofogKey: 'TR-1', grantKey: 'XAGR-1' });
  S.ok(await usesSharedDevice(env, 'u6') === true,
    'có trial_accounts -> dùng ô chung');
}

S.section('Fail-open khi bảng thiếu (không khoá oan khách đã trả tiền)');

{
  /*
   * `account_devices` có trong schema nền, nên phải XOÁ nó để tái hiện đúng
   * tình huống "CSDL chưa chạy migration" — đó mới là lúc luật này phải
   * fail-open thay vì chặn oan khách đã trả tiền.
   */
  const { env, sqlite } = makeEnv({ migrations: [] });
  sqlite.exec('DROP TABLE account_devices');

  const g = await guardAccountDevice(env, {
    userId: 'u7', scope: 'all', hwid: HWID_A, mode: 'login',
  });
  S.ok(g.ok === true, 'thiếu bảng -> CHO QUA (fail-open)');
  S.ok(g.enforced === false, 'đánh dấu enforced=false để vận hành biết',
    `enforced=${g.enforced} reason=${g.reason}`);
  S.ok(g.reason === 'table_missing', 'nêu rõ lý do table_missing', String(g.reason));
}

S.section('Công tắc tắt khẩn cấp ACCOUNT_DEVICE_DISABLED');

{
  const { env } = makeEnv({ migrations: MIGRATIONS });
  env.ACCOUNT_DEVICE_DISABLED = '1';
  const g = await guardAccountDevice(env, {
    userId: 'u8', scope: 'all', hwid: HWID_A, mode: 'login',
  });
  S.ok(g.ok === true && g.enforced === false, 'đặt ACCOUNT_DEVICE_DISABLED=1 -> tắt luật');
}

S.section('Không đủ dữ liệu -> bỏ qua, không chặn oan');

{
  const { env } = makeEnv({ migrations: MIGRATIONS });
  const g1 = await guardAccountDevice(env, {
    userId: '', scope: 'all', hwid: HWID_A, mode: 'check',
  });
  S.ok(g1.ok === true && g1.reason === 'anonymous', 'thiếu userId -> bỏ qua');

  const g2 = await guardAccountDevice(env, {
    userId: 'u9', scope: 'all', hwid: '', mode: 'check',
  });
  S.ok(g2.ok === true && g2.reason === 'anonymous', 'thiếu HWID -> bỏ qua');
}

S.section('normHwid');

{
  S.ok(normHwid('  ABC123  ') === 'abc123', 'trim + lowercase');
  S.ok(normHwid(null) === '', 'null -> chuỗi rỗng');
}

process.exit(S.summary() ? 0 : 1);
