/**
 * sessions.test.mjs — Quản lý phiên đăng nhập (F16).
 *
 * Chạy THẬT các hàm trong `src/lib/auth.js` trên D1 giả (SQLite trong RAM),
 * không đọc code bằng mắt.
 *
 * TRẠNG THÁI TRƯỚC KHI SỬA:
 *   Bảng `sessions` đã lưu ip/ua/created_at/expires_at, nhưng KHÔNG có hàm nào
 *   đọc chúng ra và không có route thu hồi phiên. Khách nghi ngờ lộ mật khẩu
 *   thì chỉ còn cách đổi mật khẩu (xoá hết phiên khác), không chọn được từng
 *   máy; máy đã mất vẫn giữ cookie 30 ngày.
 */
import { Suite } from './harness.mjs';
import { makeEnv } from './d1.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('Quản lý phiên đăng nhập');

const A = await import('../src/lib/auth.js');

/* ------------------------------------------------------------------ */
/* Tiện ích                                                            */
/* ------------------------------------------------------------------ */

/** Request giả có cookie phiên + header thiết bị. */
function makeRequest(token, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', ip = '1.2.3.4') {
  const headers = new Map([
    ['cookie', `mbk_session=${token}`],
    ['user-agent', ua],
    ['cf-connecting-ip', ip],
  ]);
  return { headers: { get: (k) => headers.get(k.toLowerCase()) ?? null } };
}

/** Request KHÔNG có cookie — dùng để tạo phiên mới trong createSession. */
function bareRequest(ua, ip) {
  const headers = new Map([['user-agent', ua], ['cf-connecting-ip', ip]]);
  return { headers: { get: (k) => headers.get(k.toLowerCase()) ?? null } };
}

function seedUser(sqlite, id = 'u1') {
  const now = Date.now();
  sqlite.prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, role, status, balance, created_at, updated_at, username)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(id, `${id}@local`, 'h', 's', 'user', 'active', 0, now, now, id);
}

/** Tạo một phiên và trả token thô. */
async function newSession(env, userId, ua, ip) {
  const { token } = await A.createSession(env, userId, bareRequest(ua, ip));
  return token;
}

/* ================================================================== */
/* 1. Liệt kê phiên                                                    */
/* ================================================================== */

S.section('listUserSessions: thấy đúng phiên của mình');

{
  const { env, sqlite } = makeEnv();
  seedUser(sqlite, 'u1');
  seedUser(sqlite, 'u2');

  const t1 = await newSession(env, 'u1', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', '1.1.1.1');
  const t2 = await newSession(env, 'u1', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1', '2.2.2.2');
  const tOther = await newSession(env, 'u2', 'Mozilla/5.0 (X11; Linux) Firefox/120', '3.3.3.3');

  const list = await A.listUserSessions(env, 'u1', makeRequest(t1));

  S.eq(list.length, 2, 'chỉ thấy phiên của CHÍNH MÌNH (không thấy của u2)');
  S.ok(
    !list.some((s) => s.id === String(tOther).slice(0, 12)),
    'KHÔNG lộ phiên của tài khoản khác',
  );

  /* Đánh dấu đúng phiên hiện tại. */
  const current = list.filter((s) => s.current);
  S.eq(current.length, 1, 'đúng MỘT phiên được đánh dấu là hiện tại');

  /* Mô tả thiết bị phải đọc được, không phải chuỗi UA thô. */
  const devices = list.map((s) => s.device);
  S.ok(
    devices.some((d) => d.includes('Chrome') && d.includes('Windows')),
    'mô tả được "Chrome · Windows"',
  );
  S.ok(
    devices.some((d) => d.includes('Safari') && d.includes('iOS')),
    'mô tả được "Safari · iOS"',
  );

  /* KHÔNG được trả token_hash đầy đủ — đó là khoá tra phiên. */
  const leak = list.some((s) => Object.values(s).some(
    (v) => typeof v === 'string' && v.length === 64 && /^[0-9a-f]{64}$/.test(v),
  ));
  S.ok(!leak, 'KHÔNG trả token_hash đầy đủ (chống chiếm phiên)');
  /*
   * `token_hash` là BASE64 (xem sha256() trong src/lib/crypto.js), không phải
   * hex. Test này khoá lại điều đó để không ai "sửa" sang giả định hex rồi
   * làm hỏng việc thu hồi phiên.
   */
  S.ok(
    list.every((s) => typeof s.id === 'string' && s.id.length === 16),
    'id phiên là 16 ký tự base64',
    list.map((s) => s.id).join(', '),
  );
  S.ok(
    list.every((s) => /^[A-Za-z0-9+/]+$/.test(s.id)),
    'id phiên đúng bảng chữ base64 (không phải hex)',
    list.map((s) => s.id).join(', '),
  );

  /* Có IP và thời gian để khách nhận ra máy lạ. */
  S.ok(list.every((s) => s.ip && s.ip !== ''), 'có IP');
  S.ok(list.every((s) => s.created_at > 0 && s.expires_at > s.created_at), 'có thời gian tạo/hết hạn');
}

/* ================================================================== */
/* 2. Phiên hết hạn không hiện ra                                      */
/* ================================================================== */

S.section('Phiên hết hạn bị dọn khỏi danh sách');

{
  const { env, sqlite } = makeEnv();
  seedUser(sqlite, 'u1');
  const t1 = await newSession(env, 'u1', 'UA-live', '1.1.1.1');
  const tDead = await newSession(env, 'u1', 'UA-dead', '9.9.9.9');

  // Đẩy một phiên về quá khứ.
  sqlite.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash LIKE ?')
    .run(Date.now() - 1000, `${(await A.getSessionUser(env, makeRequest(tDead))) ? '' : ''}`);

  // Đơn giản hơn: xoá theo ua.
  sqlite.prepare("UPDATE sessions SET expires_at = ? WHERE ua = 'UA-dead'").run(Date.now() - 1000);

  const list = await A.listUserSessions(env, 'u1', makeRequest(t1));
  S.eq(list.length, 1, 'chỉ còn phiên còn hiệu lực');
  S.ok(list[0].device.includes('Trình duyệt') || list[0].device.length > 0, 'phiên còn lại đúng');

  const left = sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE ua = ?').get('UA-dead').n;
  S.eq(left, 0, 'phiên hết hạn đã bị XOÁ khỏi DB (không chỉ ẩn)');
}

/* ================================================================== */
/* 3. Thu hồi một phiên                                                */
/* ================================================================== */

S.section('revokeUserSession: đá đúng một máy');

{
  const { env, sqlite } = makeEnv();
  seedUser(sqlite, 'u1');
  seedUser(sqlite, 'u2');

  const tA = await newSession(env, 'u1', 'UA-A', '1.1.1.1');
  const tB = await newSession(env, 'u1', 'UA-B', '2.2.2.2');
  const tOther = await newSession(env, 'u2', 'UA-other', '3.3.3.3');

  const listA = await A.listUserSessions(env, 'u1', makeRequest(tA));
  const targetId = listA.find((s) => !s.current).id;

  const r = await A.revokeUserSession(env, 'u1', targetId, makeRequest(tA));
  S.ok(r.removed, 'thu hồi được phiên khác của mình');
  S.ok(!r.self, 'không phải phiên đang dùng -> self=false');

  const after = await A.listUserSessions(env, 'u1', makeRequest(tA));
  S.eq(after.length, 1, 'còn đúng 1 phiên của u1');

  // Phiên của u2 KHÔNG bị ảnh hưởng.
  const stillThere = sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE ua = ?').get('UA-other').n;
  S.eq(stillThere, 1, 'phiên của tài khoản KHÁC không bị đụng');

  /* Không thể thu hồi phiên người khác dù biết id. */
  const otherList = await A.listUserSessions(env, 'u2', makeRequest(tOther));
  const r2 = await A.revokeUserSession(env, 'u1', otherList[0].id, makeRequest(tA));
  S.ok(!r2.removed, 'KHÔNG thu hồi được phiên của người khác dù đoán đúng id');

  /* id sai định dạng -> không làm gì. */
  const r3 = await A.revokeUserSession(env, 'u1', 'xyz', makeRequest(tA));
  S.ok(!r3.removed, 'id không khớp phiên nào -> không xoá gì');
  const r4 = await A.revokeUserSession(env, 'u1', 'DROP TABLE sessions', makeRequest(tA));
  S.ok(!r4.removed, 'id chứa SQL bị từ chối (không phải SQL injection)');
}

/* ================================================================== */
/* 3b. KHÔNG xoá nhầm khi id chỉ khớp KHÁC HOA/THƯỜNG                  */
/* ================================================================== */

S.section('Không xoá nhầm phiên khi chỉ khác hoa/thường');

{
  /*
   * `token_hash` là base64 nên có cả chữ HOA. Nếu thu hồi dùng `LIKE`, SQLite
   * so khớp KHÔNG phân biệt hoa/thường với ASCII -> 'AbC' sẽ khớp 'abc' và
   * xoá nhầm phiên. Test này chèn tay hai phiên có tiền tố chỉ khác hoa/thường
   * rồi chắc chắn chỉ đúng một cái bị xoá.
   */
  const { env, sqlite } = makeEnv();
  seedUser(sqlite, 'u1');
  const now = Date.now();
  const ins = sqlite.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?)'
  );
  ins.run('AbCdEfGhIjKlMnOp', 'u1', now, now + 86400_000, '1.1.1.1', 'UA-upper');
  ins.run('abcdEfGhIjKlMnOp', 'u1', now, now + 86400_000, '2.2.2.2', 'UA-lower');

  const r = await A.revokeUserSession(env, 'u1', 'AbCdEfGhIjKlMnOp', makeRequest('x'));
  S.ok(r.removed, 'thu hồi được phiên có id khớp CHÍNH XÁC');

  const upper = sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE ua = 'UA-upper'").get().n;
  const lower = sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE ua = 'UA-lower'").get().n;
  S.eq(upper, 0, 'phiên khớp đúng đã bị xoá');
  S.eq(lower, 1, 'phiên chỉ khác HOA/THƯỜNG KHÔNG bị xoá nhầm');
}

/* ================================================================== */
/* 4. Thu hồi chính phiên đang dùng                                    */
/* ================================================================== */

S.section('Thu hồi phiên đang dùng -> self=true');

{
  const { env, sqlite } = makeEnv();
  seedUser(sqlite, 'u1');
  const tA = await newSession(env, 'u1', 'UA-A', '1.1.1.1');

  const list = await A.listUserSessions(env, 'u1', makeRequest(tA));
  const selfId = list[0].id;
  S.ok(list[0].current, 'phiên duy nhất được đánh dấu current');

  const r = await A.revokeUserSession(env, 'u1', selfId, makeRequest(tA));
  S.ok(r.removed, 'thu hồi được chính phiên mình');
  S.ok(r.self, 'self=true để client biết phải về trang đăng nhập');

  const u = await A.getSessionUser(env, makeRequest(tA));
  S.ok(u === null, 'sau khi thu hồi, phiên KHÔNG còn dùng được');
}

/* ================================================================== */
/* 5. Thu hồi mọi phiên khác                                           */
/* ================================================================== */

S.section('revokeOtherSessions: giữ phiên hiện tại');

{
  const { env, sqlite } = makeEnv();
  seedUser(sqlite, 'u1');
  seedUser(sqlite, 'u2');

  const tKeep = await newSession(env, 'u1', 'UA-keep', '1.1.1.1');
  await newSession(env, 'u1', 'UA-B', '2.2.2.2');
  await newSession(env, 'u1', 'UA-C', '3.3.3.3');
  const tOther = await newSession(env, 'u2', 'UA-other', '4.4.4.4');

  const r = await A.revokeOtherSessions(env, 'u1', makeRequest(tKeep));
  S.eq(r.removed, 2, 'xoá đúng 2 phiên khác');

  const mine = sqlite.prepare(
    `SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.id = 'u1'`
  ).get().n;
  S.eq(mine, 1, 'u1 còn đúng 1 phiên (phiên hiện tại)');

  const stillValid = await A.getSessionUser(env, makeRequest(tKeep));
  S.ok(stillValid && stillValid.id === 'u1', 'phiên hiện tại VẪN dùng được');

  const otherAlive = sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE ua = ?').get('UA-other').n;
  S.eq(otherAlive, 1, 'phiên của tài khoản khác KHÔNG bị đụng');
}

/* ================================================================== */
/* 6. describeUserAgent                                                */
/* ================================================================== */

S.section('describeUserAgent: đọc được trình duyệt + hệ điều hành');

const cases = [
  ['Mozilla/5.0 (Windows NT 10.0) Chrome/120.0', 'Chrome', 'Windows'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1', 'Safari', 'macOS'],
  ['Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0', 'Firefox', 'Linux'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1', 'Safari', 'iOS'],
  ['Mozilla/5.0 (Linux; Android 14) Chrome/120.0', 'Chrome', 'Android'],
  ['Mozilla/5.0 (Windows NT 10.0) Edg/120.0', 'Edge', 'Windows'],
];
for (const [ua, browser, os] of cases) {
  const d = A.describeUserAgent(ua);
  S.ok(d.includes(browser) && d.includes(os), `"${ua.slice(0, 30)}…" -> ${browser} · ${os}`, d);
}
S.eq(A.describeUserAgent(''), 'Không rõ thiết bị', 'UA rỗng -> không rõ thiết bị');
S.eq(A.describeUserAgent(null), 'Không rõ thiết bị', 'UA null -> không rõ thiết bị');
S.ok(
  A.describeUserAgent('curl/8.0').length > 0,
  'UA của công cụ dòng lệnh vẫn mô tả được',
);

/* ================================================================== */
/* 7. Route đã đăng ký trong index.js                                  */
/* ================================================================== */

S.section('Route F16 đã đăng ký');

const indexSrc = (await import('node:fs')).readFileSync(join(ROOT, 'src/index.js'), 'utf8');
S.ok(/r\.get\('\/api\/auth\/sessions', auth\.listSessions\)/.test(indexSrc), 'GET /api/auth/sessions');
S.ok(
  /r\.post\('\/api\/auth\/sessions\/revoke-others', auth\.revokeOtherSessionsRoute\)/.test(indexSrc),
  'POST /api/auth/sessions/revoke-others',
);
S.ok(
  /r\.delete\('\/api\/auth\/sessions\/:id'/.test(indexSrc),
  'DELETE /api/auth/sessions/:id',
);

process.exit(S.summary() ? 0 : 1);
