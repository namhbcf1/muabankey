/**
 * Xác minh A3: signJwk() phải FAIL CLOSED khi thiếu secret.
 *
 * Đây là kiểm chứng tĩnh trên chính mã nguồn đang chạy: nếu ai đó thêm lại
 * một bản private key dự phòng, script này sẽ fail.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('src/routes/xa-grant-server.js', 'utf8');
let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`✓ ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`✗ ${name}${detail ? '  — ' + detail : ''}`); }
}

// 1. Không còn private key 'd' nào hardcode trong source
const privKeyPattern = /d:\s*'[A-Za-z0-9_-]{20,}'/;
check('không còn private key ECDSA hardcode', !privKeyPattern.test(src),
  privKeyPattern.test(src) ? 'VẪN CÒN — phải xoá' : '');

// 2. Không còn hằng số fallback
check('không còn SIGN_JWK_DEFAULT', !src.includes('SIGN_JWK_DEFAULT'));

// 3. signJwk throw khi thiếu secret
const fnBody = src.match(/function signJwk\(env\)\s*\{[\s\S]*?\n\}/);
check('tìm thấy hàm signJwk', Boolean(fnBody));
if (fnBody) {
  const b = fnBody[0];
  check('throw khi !raw (fail closed)', /if\s*\(!raw\)\s*\{[\s\S]*?throw/.test(b));
  check('throw khi JSON hỏng', /catch[\s\S]{0,200}throw/.test(b));
  check('validate đủ kty/d/x/y', /v\.kty\s*!==\s*'EC'/.test(b) && /!v\.d/.test(b));
  check('không return bản dự phòng', !/return\s+SIGN_JWK/.test(b));
}

// 4. Toàn repo: không file JS nào chứa EC private key
import { execSync } from 'node:child_process';
let hits = '';
try {
  hits = execSync(
    String.raw`findstr /s /i /c:"\"d\":\"" src\*.js src\**\*.js 2>nul`,
    { shell: 'cmd.exe', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
} catch { hits = ''; }
const ecPrivate = /"d"\s*:\s*"[A-Za-z0-9_-]{20,}"/;
check('không có EC private key nào trong src/', !ecPrivate.test(src + hits));

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail === 0 ? 0 : 1);
