/**
 * Kiểm thử dùng thử THEO TÀI KHOẢN.
 *
 *   node scripts/test-trial-account.mjs [baseUrl]
 *
 * Kịch bản:
 *   1. Đăng ký tài khoản mới
 *   2. GET  /api/trial/session  -> phải là 'available', KHÔNG chạy đồng hồ
 *   3. POST /api/trial/session  -> bắt đầu, trả 2 token
 *   4. POST lần 2               -> 'resume', cùng hạn (không reset đồng hồ)
 *   5. Gọi /api/check bằng key nội bộ  -> phải trả token mới
 *   6. Gọi /api/xg/check bằng key nội bộ -> phải trả token mới
 *   7. Tài khoản thứ 2 trên cùng máy -> vẫn được (giới hạn 3)
 *   8. Kiểm tra /api/entitlement có khối trial
 */

const BASE = process.argv[2] || 'https://xienhl.com';

let pass = 0;
let fail = 0;
const fails = [];

function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    fails.push(`${name}${extra ? ' — ' + extra : ''}`);
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

function section(t) {
  console.log(`\n${t}`);
}

/** Mảng phần cứng giả — server tự băm thành HWID.
 *
 * `seed` phải KHÁC NHAU mỗi lần chạy, nếu không lần chạy thứ 4 sẽ đụng
 * giới hạn "3 tài khoản/máy" và test báo lỗi oan.
 */
function fakeParts(seed) {
  return {
    guid: `guid-${seed}-4f2a-9b1c-${seed}0000000000`,
    bios: `BIOS-${seed}-A1B2C3`,
    cpu: `Intel(R) Core(TM) i7-${seed}`,
    vol: `1234-${seed}AB`,
  };
}

/** Mã ngẫu nhiên ngắn cho mỗi lần chạy (máy + tài khoản khác nhau). */
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();

async function main() {
  console.log('\n🧪 DÙNG THỬ THEO TÀI KHOẢN');
  console.log(`   ${BASE}\n`);

  const uname = `tr${Date.now().toString(36)}`;

  // ---- 1. Đăng ký ----
  section('1. Tài khoản mới');
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, password: 'Test123456' }),
  });
  const regData = await reg.json().catch(() => ({}));
  ok('đăng ký 201', reg.status === 201, `status=${reg.status} ${JSON.stringify(regData).slice(0, 120)}`);
  if (reg.status !== 201) return finish();

  const cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
  ok('có cookie phiên', cookie.includes('='), cookie.slice(0, 40));
  const H = { 'Content-Type': 'application/json', Cookie: cookie };

  // ---- 2. GET trước khi bắt đầu ----
  section('2. Chưa mở app — chỉ xem trạng thái');
  const st1 = await fetch(`${BASE}/api/trial/session`, { headers: { Cookie: cookie } });
  const st1d = await st1.json();
  ok('GET 200', st1.status === 200, `status=${st1.status}`);
  ok('state = available', st1d.state === 'available', st1d.state);
  ok('báo 1 ngày', Number(st1d.days) === 1, `days=${st1d.days}`);
  ok('có cả 2 tính năng', Array.isArray(st1d.features) && st1d.features.length === 2,
    JSON.stringify(st1d.features));

  // ---- 3. POST bắt đầu ----
  section('3. Mở app lần đầu — bắt đầu đồng hồ');
  const p1 = fakeParts(RUN);
  const s1 = await fetch(`${BASE}/api/trial/session`, {
    method: 'POST', headers: H, body: JSON.stringify(p1),
  });
  const s1d = await s1.json();
  ok('POST 200', s1.status === 200, `status=${s1.status} ${JSON.stringify(s1d).slice(0, 200)}`);
  ok('state = new', s1d.state === 'new', s1d.state);
  ok('có started_at', Number(s1d.started_at) > 0, `started_at=${s1d.started_at}`);
  ok('hạn ~1 ngày', Math.abs(Number(s1d.left_sec) - 86400) < 120, `left_sec=${s1d.left_sec}`);
  ok('có token map sáng', typeof s1d.nofog?.token === 'string' && s1d.nofog.token.startsWith('xn1.'),
    (s1d.nofog?.token || '').slice(0, 20));
  ok('có token tài nguyên', typeof s1d.grant?.token === 'string' && s1d.grant.token.startsWith('xg1.'),
    (s1d.grant?.token || '').slice(0, 20));
  ok('key map sáng dạng TR-', /^TR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(s1d.nofog?.key || ''),
    s1d.nofog?.key);
  ok('key tài nguyên dạng XAGR-', /^XAGR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(s1d.grant?.key || ''),
    s1d.grant?.key);

  const nofogKey = s1d.nofog?.key;
  const grantKey = s1d.grant?.key;

  // ---- 4. POST lần 2 — không reset đồng hồ ----
  section('4. Mở app lần 2 — tiếp tục, KHÔNG reset');
  await new Promise((r) => setTimeout(r, 1200));
  const s2 = await fetch(`${BASE}/api/trial/session`, {
    method: 'POST', headers: H, body: JSON.stringify(p1),
  });
  const s2d = await s2.json();
  ok('POST 200', s2.status === 200, `status=${s2.status}`);
  ok('state = resume', s2d.state === 'resume', s2d.state);
  ok('cùng hạn (không reset)', Number(s2d.expires_at) === Number(s1d.expires_at),
    `${s2d.expires_at} vs ${s1d.expires_at}`);
  ok('cùng key', s2d.nofog?.key === nofogKey, s2d.nofog?.key);

  // ---- 5. Kiểm token với server bằng key nội bộ ----
  section('5. Làm mới token bằng key nội bộ');
  const hwid = s2d.hwid || null;

  // Lấy HWID thật từ /api/check (server tính từ parts)
  const chk = await fetch(`${BASE}/api/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: nofogKey, hwid: 'a'.repeat(32), ...p1 }),
  });
  const chkD = await chk.json();
  // hwid 'a'*32 sai -> server phải từ chối hwid_mismatch (chứng tỏ license có khoá máy)
  ok('/api/check từ chối HWID lạ', chk.status === 403, `status=${chk.status} ${chkD.code || ''}`);

  // Giờ gọi đúng cách: app gửi parts, server tự băm -> cần HWID đã băm.
  // Dùng lại endpoint trial để lấy hwid đã băm? Không trả ra. Thay vào đó
  // kiểm /api/xg/check với HWID lấy từ token payload (base64url).
  function payloadOf(tok) {
    try {
      const parts = String(tok).split('.');
      if (parts.length < 2) return null;
      const b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
    } catch { return null; }
  }
  const np = payloadOf(s1d.nofog.token);
  const gp = payloadOf(s1d.grant.token);
  ok('token map sáng có hwid', !!np?.h, np?.h);
  ok('token tài nguyên có hwid', !!gp?.h, gp?.h);
  ok('2 token CÙNG hwid', np?.h === gp?.h, `${np?.h} vs ${gp?.h}`);
  ok('token map sáng đúng app', np?.a === 'xa-nofog', np?.a);
  ok('token tài nguyên đúng app', gp?.a === 'xagrant', gp?.a);
  ok('token có hạn = hạn trial', Number(np?.e) === Number(s1d.expires_at),
    `${np?.e} vs ${s1d.expires_at}`);

  const realHwid = np?.h || '';
  if (realHwid) {
    const c2 = await fetch(`${BASE}/api/check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: nofogKey, hwid: realHwid }),
    });
    const c2d = await c2.json();
    ok('/api/check với key nội bộ 200', c2.status === 200,
      `status=${c2.status} ${JSON.stringify(c2d).slice(0, 150)}`);
    ok('/api/check trả token mới', String(c2d.token || '').startsWith('xn1.'));

    const g2 = await fetch(`${BASE}/api/xg/check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: grantKey, hwid: realHwid }),
    });
    const g2d = await g2.json();
    ok('/api/xg/check với key nội bộ 200', g2.status === 200,
      `status=${g2.status} ${JSON.stringify(g2d).slice(0, 150)}`);
    ok('/api/xg/check trả token mới', String(g2d.token || '').startsWith('xg1.'));
  }

  // ---- 6. Entitlement có khối trial ----
  section('6. /api/entitlement trả khối trial');
  const ent = await fetch(`${BASE}/api/entitlement`, { headers: { Cookie: cookie } });
  const entD = await ent.json();
  ok('entitlement 200', ent.status === 200, `status=${ent.status}`);
  ok('có khối trial', !!entD.trial, JSON.stringify(entD.trial));
  ok('trial.state = active', entD.trial?.state === 'active', entD.trial?.state);
  ok('hasNofog + hasGrant đều bật', entD.hasNofog === true && entD.hasGrant === true,
    `nofog=${entD.hasNofog} grant=${entD.hasGrant}`);

  // ---- 7. Tài khoản thứ 2 cùng máy ----
  section('7. Tài khoản thứ 2 trên cùng máy');
  const u2 = `tr${Date.now().toString(36)}b`;
  const reg2 = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u2, password: 'Test123456' }),
  });
  const c2ck = (reg2.headers.get('set-cookie') || '').split(';')[0];
  ok('đăng ký tài khoản 2', reg2.status === 201, `status=${reg2.status}`);
  const s3 = await fetch(`${BASE}/api/trial/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: c2ck },
    body: JSON.stringify(p1),
  });
  const s3d = await s3.json();
  ok('tài khoản 2 cũng được dùng thử', s3.status === 200,
    `status=${s3.status} ${s3d.code || ''} ${s3d.msg || ''}`);
  ok('có token riêng', s3d.nofog?.token?.startsWith('xn1.') || false);

  // ---- 8. Không đăng nhập ----
  section('8. Chưa đăng nhập');
  const anon = await fetch(`${BASE}/api/trial/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p1),
  });
  ok('chặn 401 login_required', anon.status === 401, `status=${anon.status}`);

  finish();
}

function finish() {
  console.log('\n' + '─'.repeat(52));
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  if (fail) {
    console.log('\nChi tiết lỗi:');
    for (const f of fails) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log('🎉 Tất cả PASS');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
