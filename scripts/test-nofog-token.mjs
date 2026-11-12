/**
 * test-nofog-token.mjs — kiểm chứng end-to-end token bảo vệ bảng offset.
 *
 * Chạy:  node scripts/test-nofog-token.mjs
 *
 * KHÔNG cần CSDL, KHÔNG cần mạng, KHÔNG cần wrangler. Nó:
 *   1. Mint token THẬT bằng chính code server (license-server.js::__test)
 *   2. Ghi token ra file tạm
 *   3. Gọi client Python thật (xa_nofog_sec.verify_token_local) để xác minh
 *   4. Kiểm các trường hợp TẤN CÔNG phải bị chặn
 */
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const T = await import('../src/routes/license-server.js').then((m) => m.__test);
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'tool', 'src');
const JWK = JSON.parse(readFileSync(join(ROOT, 'secrets', 'xn-sign-jwk.json'), 'utf8'));
const env = { XN_SIGN_JWK: JSON.stringify(JWK) };

const pass = [];
const fail = [];
function check(name, cond, extra = '') {
  if (cond) { pass.push(name); console.log(`  \x1b[32mOK\x1b[0m   ${name}`); }
  else { fail.push(name + (extra ? ' — ' + extra : '')); console.log(`  \x1b[31mFAIL\x1b[0m ${name} ${extra}`); }
}

function pyVerify(token) {
  const dir = mkdtempSync(join(tmpdir(), 'xntok-'));
  const f = join(dir, 'token.txt');
  writeFileSync(f, token, 'utf8');
  const code = `
import sys, json
sys.path.insert(0, r'${SRC}')
import xa_nofog_sec as S
tok = open(sys.argv[1], 'r', encoding='utf-8').read()
r = S.verify_token_local(tok, app='xa-nofog')
out = {'ok': r.get('ok'), 'code': r.get('code'), 'gate': r.get('gate')}
if r.get('ok'):
    out['count'] = r['count']
    out['groups'] = [[g, len(v)] for g, v in r['groups']]
    out['sites'] = [list(s) for s in r['sites'].all()]
print(json.dumps(out))
`;
  const raw = execFileSync('python', ['-c', code, f], { encoding: 'utf8' });
  return JSON.parse(raw.trim().split('\n').pop());
}

console.log('\n=== 1. Cấu trúc bảng SITES (server) ===');
check('bảng SITES hợp lệ', (() => { try { T.assertSites(); return true; } catch { return false; } })());
check('17 cổng', T.SITES.length === 17, `được ${T.SITES.length}`);
const gcount = T.SITES.reduce((a, r) => (a[r[1]] = (a[r[1]] || 0) + 1, a), {});
check('viewport=3 minimap=7 legacy=7',
  gcount.viewport === 3 && gcount.minimap === 7 && gcount.legacy === 7,
  JSON.stringify(gcount));

console.log('\n=== 2. gate deterministic ===');
const g1 = Buffer.from(await T.deriveGate('AOE1-TEST-KEY-0001')).toString('hex');
const g2 = Buffer.from(await T.deriveGate('aoe1-test-key-0001')).toString('hex');
const g3 = Buffer.from(await T.deriveGate('AOE1-TEST-KEY-0002')).toString('hex');
check('gate 16 byte', g1.length === 32, g1);
check('gate không đổi theo hoa/thường (normKey)', g1 === g2);
check('key khác -> gate khác', g1 !== g3);

console.log('\n=== 3. ciphertext phụ thuộc gate (2 key -> 2 ciphertext) ===');
const c1 = await T.sealSites(Buffer.from(g1, 'hex'));
const c3 = await T.sealSites(Buffer.from(g3, 'hex'));
check('ciphertext khác nhau giữa 2 license', c1 !== c3);
check('ciphertext không chứa "viewport"', !Buffer.from(c1, 'base64').toString('latin1').includes('viewport'));
check('ciphertext không chứa địa chỉ 0x514e0f dạng nhị phân',
  !Buffer.from(c1, 'base64').includes(Buffer.from([0x0f, 0x4e, 0x51, 0x00])));

console.log('\n=== 4. Mint token + client Python giải mã ===');
const lic = { plan: 'aoe1', expires_at: 1893456000 };
const minted = await T.buildToken(env, lic, 'AOE1-TEST-KEY-0001', 'a'.repeat(32));
check('token bắt đầu xn1.', minted.token.startsWith('xn1.'));
check('token có 3 phần', minted.token.split('.').length === 3);

const r = pyVerify(minted.token);
check('client verify OK', r.ok === true, JSON.stringify(r));
check('client giải mã đủ 17 cổng', r.count === 17, `được ${r.count}`);
check('client thấy 3 nhóm', r.groups && r.groups.length === 3, JSON.stringify(r.groups));
check('gate client == gate server', r.gate === minted.gate_hex,
  `client=${r.gate} server=${minted.gate_hex}`);

console.log('\n=== 5. Bảng giải mã khớp CHÍNH XÁC bảng server ===');
const want = T.SITES.map(([k, g, va, o, p]) => [k, va, o.toLowerCase(), p.toLowerCase()]);
const got = r.sites.map(([k, va, o, p]) => [k, va, o, p]);
check('17 dòng khớp thứ tự + giá trị', JSON.stringify(want) === JSON.stringify(got),
  'khác biệt: ' + JSON.stringify(got.filter((x, i) => JSON.stringify(x) !== JSON.stringify(want[i]))));

console.log('\n=== 6. TẤN CÔNG phải bị chặn ===');

// 6a. Sửa payload (đổi hạn dùng) -> chữ ký sai
const [h, p, s] = minted.token.split('.');
const forged = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
forged.e = 9999999999;
const forgedTok = h + '.' + Buffer.from(JSON.stringify(forged)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + s;
check('token bị sửa payload -> chặn', pyVerify(forgedTok).ok === false);

// 6b. Đổi gate nhưng giữ chữ ký -> chữ ký sai
const forged2 = { ...JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) };
forged2.ss = Buffer.alloc(16, 0x41).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const forgedTok2 = h + '.' + Buffer.from(JSON.stringify(forged2)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + s;
check('token bị đổi gate -> chặn', pyVerify(forgedTok2).ok === false);

// 6c. Bịa token hoàn toàn
check('token rác -> chặn', pyVerify('xn1.eyJhIjoieGEtbm9mb2cifQ.AAAA').ok === false);
check('token sai tiền tố -> chặn', pyVerify('xx1.' + p + '.' + s).ok === false);
check('chuỗi rỗng -> chặn', pyVerify('').code === 'no_token');

// 6d. Mint bằng khoá KHÁC (kẻ tấn công tự sinh khoá) -> client phải chặn
const { webcrypto } = await import('node:crypto');
const evil = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const evilJwk = await webcrypto.subtle.exportKey('jwk', evil.privateKey);
const evilMinted = await T.buildToken({ XN_SIGN_JWK: JSON.stringify(evilJwk) },
  lic, 'AOE1-TEST-KEY-0001', 'a'.repeat(32));
check('token ký bằng khoá khác -> chặn', pyVerify(evilMinted.token).ok === false);

console.log('\n=== 7. Fail closed khi thiếu khoá ký ===');
let threw = false;
try { await T.buildToken({}, lic, 'K', 'h'.repeat(32)); } catch (e) { threw = (e.code === 'NOT_CONFIGURED'); }
check('thiếu XN_SIGN_JWK -> ApiError NOT_CONFIGURED', threw);

// 7b. Verify: nếu không có bảng offset thì client phải báo lỗi rõ, không crash
const noSitesJwk = evilJwk; // dùng key bất kỳ để mint payload thiếu khối
const body = 'xn1.' + Buffer.from(JSON.stringify({
  v: 1, a: 'xa-nofog', k: 'X', h: 'y'.repeat(32), e: 0, n: 1,
})).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, evil.privateKey,
  new TextEncoder().encode(body));
const noSiteTok = body + '.' + Buffer.from(sig).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rs = pyVerify(noSiteTok);
check('token không có bảng -> code rõ ràng (không crash)',
  rs.ok === false && (rs.code === 'bad_sig' || rs.code === 'no_sites'), JSON.stringify(rs));

console.log('\n' + '='.repeat(60));
console.log(`  PASS ${pass.length}   FAIL ${fail.length}`);
if (fail.length) {
  console.log('\n  LỖI:');
  for (const f of fail) console.log('   - ' + f);
  process.exit(1);
}
console.log('  TẤT CẢ ĐỀU ĐẠT');
process.exit(0);
