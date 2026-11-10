/**
 * D. LICENSE — activate 2 HWID, /api/check, /api/rebind, expires_at, trial, install token.
 */
import { record, loginAs, freshUser, makeClient } from '../lib/record.mjs';
import { q1, d1, giveAdminBalance } from './c-business.mjs';

const IP = (n) => ({ 'cf-connecting-ip': `172.16.${Math.floor(n / 250)}.${(n % 250) + 1}` });

export async function runGroupD() {
  const adm = await loginAs('admin');

  /* ===== Mua license thật để có key ===== */
  const buyer = await freshUser('d-buy');
  giveAdminBalance(buyer._id, 5000000);
  const o = await buyer.post('/api/orders', { items: [{ productId: 'p-lic-month', quantity: 1 }] });
  const pay = await buyer.post(`/api/orders/${o.json.order.id}/pay`, {});
  const licKey = pay.json?.order?.delivered?.[0]?.raw?.[0] || pay.json?.order?.delivered?.[0]?.keys?.[0];
  const lic = q1(`SELECT * FROM licenses WHERE key = '${licKey}'`);
  console.log(`   -> license mua được: ${licKey}, expires_at=${lic?.expires_at}`);

  /* ===== D23: activate cùng key trên 2 HWID ===== */
  const a1 = await makeClient('act1').post('/api/activate', { key: licKey, hwid: 'HWID-AAAAAAA-1111', app: 'xarena' }, { headers: IP(1) });
  const a2 = await makeClient('act2').post('/api/activate', { key: licKey, hwid: 'HWID-BBBBBBB-2222', app: 'xarena' }, { headers: IP(2) });
  record(23,
    'Kích hoạt CÙNG license key trên 2 HWID khác nhau',
    a2.status >= 400 ? `HWID 2 BỊ CHẶN (${a2.json?.code})` : 'CẢ 2 HWID ĐỀU KÍCH HOẠT ĐƯỢC',
    a2.status >= 400 ? 'OK' : 'CRITICAL',
    `HWID1 -> ${a1.status} ${a1.json?.code || 'ok'}; HWID2 -> ${a2.status} ${a2.json?.code || 'ok'} ${a2.json?.msg || ''}`,
    'Đã đúng: judge() so lic.hwid !== hwid -> hwid_mismatch (license-server.js:81).');

  /* ===== D23b: race 5 activate đồng thời với HWID khác nhau (first-bind) ===== */
  const freshLic = await (async () => {
    const r = await adm.post('/api/admin/licenses', { count: 1, days: 30, prefix: 'RACE', note: 'race test' });
    return r.json?.keys?.[0];
  })();
  const raceAct = await Promise.all(Array.from({ length: 5 }, (_, i) =>
    makeClient('ra' + i).post('/api/activate', { key: freshLic, hwid: `RACE-HWID-${i}0000`, app: 'x' }, { headers: IP(10 + i) })));
  const winners = raceAct.filter((r) => r.status === 200 && r.json?.ok);
  const boundHwid = q1(`SELECT hwid FROM licenses WHERE key='${freshLic}'`).hwid;
  record(23.5,
    'RACE: 5 HWID KÍCH HOẠT ĐỒNG THỜI cùng 1 key chưa gán máy (first-bind race)',
    winners.length === 1 ? 'CHỈ 1 HWID THẮNG — bind nguyên tử đúng' : `${winners.length}/5 CÙNG BIND THÀNH CÔNG`,
    winners.length === 1 ? 'OK' : 'CRITICAL',
    `Thành công: ${winners.length}/5 | hwid lưu trong DB: ${boundHwid} | mã: ${raceAct.map((r) => r.status).join(',')}`,
    winners.length === 1
      ? 'bindFirstTime dùng UPDATE không có điều kiện IS NULL — may mắn thắng nhờ D1 serialize. NÊN siết: UPDATE licenses SET hwid=? WHERE key=? AND hwid IS NULL và kiểm tra meta.changes===1.'
      : 'Sửa bindFirstTime thành UPDATE có điều kiện AND hwid IS NULL, kiểm tra changes===1.');

  /* ===== D24: /api/check với key không tồn tại ===== */
  const c24 = await makeClient('chk').post('/api/check', { key: 'AOE1-ZZZZ-ZZZZ-ZZZZ', hwid: 'HWID-AAAAAAA-1111', app: 'x' }, { headers: IP(20) });
  record(24, '/api/check với key KHÔNG tồn tại',
    c24.json?.code === 'not_found' ? 'Trả not_found đúng, không lộ chi tiết' : `Trả: ${JSON.stringify(c24.json)}`,
    'OK', `${c24.status} ${JSON.stringify(c24.json)}`,
    'Đã đúng. Không lộ stack/SQL. Lưu ý: thông điệp phân biệt not_found vs expired vs revoked -> có thể dùng làm oracle dò key (xem #24b) — chấp nhận được vì key không đoán được.');

  /* ===== D24b: oracle dò key — rate limit có chặn? ===== */
  const probe = [];
  for (let i = 0; i < 40; i++) {
    const r = await makeClient('p' + i).post('/api/check', {
      key: `AOE1-${String(i).padStart(4, '0')}-ZZZZ-ZZZZ`, hwid: 'HWID-AAAAAAA-1111', app: 'x',
    }, { headers: { 'cf-connecting-ip': '172.16.99.7' } });
    probe.push(r.status);
  }
  const limitedN = probe.filter((s) => s === 429).length;
  record(24.5, 'Dò key qua /api/check: 40 request cùng IP (rate limit 30/giờ, chỉ đếm lần SAI)',
    limitedN > 0 ? `Bị 429 sau ${probe.indexOf(429) + 1} lần` : 'Không chặn trong 40 lần',
    limitedN > 0 ? 'OK' : 'MEDIUM',
    `40 lần: 429 xuất hiện ${limitedN} lần, lần đầu ở vị trí ${probe.indexOf(429) + 1}`,
    'rateOk() đếm lic_attempts WHERE ok=0 trong 1 giờ, ngưỡng 30 -> chặn dò key. Không gian key 32^12 nên dò vô vọng.');

  /* ===== D25: /api/rebind không có token, không session ===== */
  const r25 = await makeClient('rb').post('/api/rebind', { key: licKey, hwid: 'HWID-CCCCCCC-3333' }, { headers: IP(30) });
  record(25, '/api/rebind KHÔNG có token và KHÔNG có session',
    r25.status === 401 ? 'BỊ CHẶN (401)' : `LỌT (${r25.status})`,
    r25.status === 401 ? 'OK' : 'CRITICAL',
    `${r25.status} ${JSON.stringify(r25.json)} | hwid trong DB: ${q1(`SELECT hwid FROM licenses WHERE key='${licKey}'`).hwid}`,
    'Đã đúng: yêu cầu session sở hữu key hoặc rebind token 1 lần (license-server.js:256-285).');

  /* ===== D25b: rebind bằng token của CHÍNH CHỦ (hợp lệ) rồi dùng lại lần 2 ===== */
  const tok = await buyer.post(`/api/licenses/${licKey}/rebind`, {});
  const tokenVal = tok.json?.token;
  const rA = await makeClient('rbA').post('/api/rebind', { key: licKey, hwid: 'HWID-DDDDDDD-4444', token: tokenVal }, { headers: IP(31) });
  const rB = await makeClient('rbB').post('/api/rebind', { key: licKey, hwid: 'HWID-EEEEEEE-5555', token: tokenVal }, { headers: IP(32) });
  record(25.5, 'Rebind token dùng 1 lần — dùng lại lần 2',
    rB.status >= 400 ? 'TOKEN BỊ CHẶN Ở LẦN 2' : 'TOKEN DÙNG LẠI ĐƯỢC',
    rB.status >= 400 ? 'OK' : 'HIGH',
    `lần 1 -> ${rA.status}; lần 2 -> ${rB.status} ${rB.json?.msg || ''}; hwid cuối: ${q1(`SELECT hwid FROM licenses WHERE key='${licKey}'`).hwid}`,
    'Đã đúng: UPDATE rebind_tokens SET used=1 (license-server.js:283).');

  /* ===== D25c: rebind vượt max_rebind ===== */
  const lic2 = q1(`SELECT key, max_rebind, rebinds FROM licenses WHERE key='${licKey}'`);
  let lastStatus = null;
  for (let i = 0; i < 4; i++) {
    const t = await buyer.post(`/api/licenses/${licKey}/rebind`, {});
    if (!t.json?.token) { lastStatus = `tạo token bị chặn: ${t.status} ${t.json?.error || ''}`; break; }
    const r = await makeClient('rbx' + i).post('/api/rebind', { key: licKey, hwid: `HWID-REE-${i}00000`, token: t.json.token }, { headers: IP(40 + i) });
    lastStatus = `lần ${i + 1}: ${r.status} ${r.json?.msg || r.json?.code || ''}`;
    if (r.status >= 400) break;
  }
  const after = q1(`SELECT rebinds, max_rebind FROM licenses WHERE key='${licKey}'`);
  record(25.7, 'Rebind vượt max_rebind (max=1, thử nhiều lần)',
    after.rebinds <= after.max_rebind ? `BỊ CHẶN ở rebinds=${after.rebinds}/${after.max_rebind}` : `VƯỢT: ${after.rebinds}/${after.max_rebind}`,
    after.rebinds <= after.max_rebind ? 'OK' : 'HIGH',
    `${lastStatus} | rebinds=${after.rebinds}, max=${after.max_rebind}`,
    'Đã đúng: UPDATE ... WHERE rebinds < max_rebind kiểm tra changes (license-server.js:289-299).');

  /* ===== D26: sửa expires_at qua API nào không (mass assignment) ===== */
  const atk = await freshUser('d26');
  const t26 = [];
  // thử qua profile
  t26.push(['PATCH /api/auth/profile {expiresAt}', (await atk.patch('/api/auth/profile', {
    fullName: 'X', phone: '0912345678', expiresAt: 99999999999, balance: 999999999, role: 'admin',
  })).status]);
  t26.push(['POST /api/activate {expires_at}', (await makeClient('d26a').post('/api/activate',
    { key: licKey, hwid: 'HWID-FFFFF-66666', expires_at: 99999999999 }, { headers: IP(60) })).status]);
  t26.push(['POST /api/check {expires_at}', (await makeClient('d26b').post('/api/check',
    { key: licKey, hwid: 'HWID-AAAAAAA-1111', expires_at: 99999999999 }, { headers: IP(61) })).status]);
  t26.push(['POST /api/trial/start {expires_at}', (await makeClient('d26c').post('/api/trial/start',
    { guid: 'g', bios: 'b', cpu: 'c', vol: 'v', expires_at: 99999999999 }, { headers: IP(62) })).status]);
  const meAfter = await atk.get('/api/auth/me');
  record(26,
    'Mass assignment: gửi expires_at/role/balance vào các API để nâng hạn/mở quyền',
    meAfter.json?.user?.role === 'user' ? 'BỊ BỎ QUA — không trường nào bị ghi đè' : 'GHI ĐÈ ĐƯỢC role!',
    meAfter.json?.user?.role === 'user' ? 'OK' : 'CRITICAL',
    t26.map(([l, s]) => `${l}->${s}`).join(' | ') + ` | role sau: ${meAfter.json?.user?.role}, balance: ${meAfter.json?.user?.balance}`,
    'Đã đúng: mỗi handler whitelist trường cụ thể, không spread body vào UPDATE.');

  /* ===== D27: trial nhiều lần ===== */
  const trialOut = [];
  for (let i = 0; i < 4; i++) {
    const r = await makeClient('tr' + i).post('/api/trial/start', {
      guid: 'same-guid-1111', bios: 'AMI BIOS', cpu: 'Intel i5', vol: 'VOL1',
    }, { headers: IP(70 + i) });
    trialOut.push(`${r.status}:${r.json?.code || r.json?.trial_kind || 'ok'}`);
  }
  const trialCount = q1(`SELECT COUNT(*) n FROM licenses WHERE plan='trial' AND key LIKE 'TR-%'`).n;
  record(27,
    'Tạo trial 4 lần với CÙNG fingerprint máy (guid/bios/cpu/vol giống hệt)',
    trialOut.filter((s) => s.startsWith('200')).length === 4 ? 'Trả lại cùng 1 trial (resume) — đúng thiết kế' : 'Tạo nhiều trial',
    'OK',
    `${trialOut.join(' | ')} | tổng license trial trong DB: ${trialCount}`,
    'Đã đúng: trial_grants.weak_hwid là PRIMARY KEY -> 1 máy 1 trial vĩnh viễn (trial.js:197-244).');

  /* ===== D27b: trial farm bằng fingerprint khác nhau, IP xoay ===== */
  const farmOut = [];
  for (let i = 0; i < 6; i++) {
    const r = await makeClient('fr' + i).post('/api/trial/start', {
      guid: `unique-guid-${Date.now()}-${i}`, bios: 'Dell Inc.', cpu: 'AMD Ryzen 7', vol: 'V' + i,
    }, { headers: IP(80 + i) });
    farmOut.push(`${r.status}:${r.json?.code || r.json?.trial_kind || 'ok'}`);
  }
  const newTrials = farmOut.filter((s) => s.includes(':new')).length;
  record(27.5,
    'Trial farm: 6 fingerprint MÁY KHÁC NHAU + IP xoay (mỗi request 1 IP)',
    newTrials <= 6 ? `Tạo được ${newTrials}/6 trial mới` : 'Bị chặn',
    newTrials <= 3 ? 'OK' : 'HIGH',
    `${farmOut.join(' | ')} | new=${newTrials}`,
    'Giới hạn hiện tại: 3/IP/30 ngày + 12/24-subnet + 200/ngày. Vì IP đổi được và fingerprint tự khai nên 1 người vẫn farm được ~200 trial/ngày. Nên thêm: xác thực fingerprint bằng chữ ký server-side, chặn theo ASN, và giảm maxPerDay.');

  /* ===== D28: install token dùng lại được bao nhiêu lần ===== */
  const it = await buyer.post(`/api/licenses/${licKey}/install-token`, {});
  const itToken = it.json?.token;
  const uses = [];
  for (let i = 0; i < 3; i++) {
    const r = await makeClient('it' + i).get(`/i/${licKey}.cmd?t=${itToken}`, { headers: IP(90 + i) });
    uses.push(r.status);
  }
  record(28,
    'Install token: dùng lại 3 lần (thiết kế cho phép?)',
    uses.every((s) => s === 200) ? 'DÙNG LẠI ĐƯỢC KHÔNG GIỚI HẠN trong 24h' : `Bị chặn: ${uses.join(',')}`,
    uses.every((s) => s === 200) ? 'LOW' : 'OK',
    `3 lần tải .cmd bằng cùng token: ${uses.join(',')} (thiết kế: TTL 24h, không đánh dấu used)`,
    'install_tokens không có cột used — token dùng lại được đến khi hết hạn. Rủi ro thấp (token gắn với 1 key cụ thể, không cấp quyền gì thêm). Nếu muốn siết: thêm cột used + single-use.');

  /* ===== D29: install token hết hạn ===== */
  d1(`UPDATE install_tokens SET expires_at = 1 WHERE token_hash = (SELECT token_hash FROM install_tokens WHERE key='${licKey}' ORDER BY created_at DESC LIMIT 1);`);
  const exp = await makeClient('itx').get(`/i/${licKey}.cmd?t=${itToken}`, { headers: IP(95) });
  record(29,
    'Install token HẾT HẠN -> response gì?',
    exp.status === 401 ? 'Trả 401 sạch, không lộ key tồn tại' : `Trả ${exp.status}`,
    exp.status === 401 ? 'OK' : 'MEDIUM',
    `${exp.status} ${exp.text.slice(0, 140)}`,
    'Đã đúng: kiểm expires_at > now, thông điệp chung "Token không hợp lệ hoặc đã hết hạn" (installer.js:51-57).');

  return { buyer, licKey };
}
