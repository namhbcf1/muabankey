/**
 * release-signing.test.mjs — EXE phát hành PHẢI được ký, và hash phải tính SAU khi ký.
 *
 * Khoá lỗi P0-7. Trạng thái trước khi sửa:
 *   - `tool/dist-arena/xa_arena.exe` -> Get-AuthenticodeSignature = NotSigned
 *   - VersionInfo rỗng: FileVersion 0.0.0.0, không CompanyName/ProductName
 *   - `tool/sign/sign-exe.ps1` chỉ ký 3 file KHÔNG TỒN TẠI, không ký file đang
 *     phát hành
 *   - `build-arena.ps1` hỏi tay "cập nhật hash? (y/n)" — bấm 'n' là server
 *     trỏ tiếp hash cũ
 *
 * Kiểm thử này soát MÃ của quy trình, vì không thể build + ký EXE trong CI
 * offline. Phần không kiểm được sẽ nói rõ, không giả vờ đã kiểm.
 */
import { Suite } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('Phát hành EXE: ký số');

const buildPath = join(ROOT, 'tool/build-arena.ps1');
const signPath = join(ROOT, 'tool/sign/sign-exe.ps1');
const rcPath = join(ROOT, 'tool/build/version.rc');
const installerPath = join(ROOT, 'src/routes/arena-installer.js');

const build = readFileSync(buildPath, 'utf8');
const sign = readFileSync(signPath, 'utf8');

/* ------------------------------------------------------------------ */
/* 1. Script ký phải nhắm ĐÚNG file đang phát hành                      */
/* ------------------------------------------------------------------ */

S.section('Script ký nhắm đúng xa_arena.exe');

S.ok(
  /tool\\dist-arena\\xa_arena\.exe/.test(sign) || /dist-arena[\\/]xa_arena\.exe/.test(sign),
  'sign-exe.ps1: ký tool/dist-arena/xa_arena.exe',
);

S.ok(
  !/dist-nuitka\\xa_nofog_pro\.exe'\s*\)/.test(sign),
  'sign-exe.ps1: KHÔNG còn ký xa_nofog_pro.exe (sản phẩm đã bỏ)',
);
S.ok(
  !/dist-grant\\xa_grant\.exe'\s*\)/.test(sign),
  'sign-exe.ps1: KHÔNG còn ký xa_grant.exe (sản phẩm đã bỏ)',
);
S.ok(
  !/dist-setup\\xa_setup\.exe'\s*\)/.test(sign),
  'sign-exe.ps1: KHÔNG còn ký xa_setup.exe (bộ cài đã bỏ)',
);

/* ------------------------------------------------------------------ */
/* 2. Build phải ký, và ký TRƯỚC khi băm                                */
/* ------------------------------------------------------------------ */

S.section('Build: ký rồi mới băm (thứ tự quyết định)');

const iSign = build.indexOf('signtool');
const iHash = build.indexOf('Get-FileHash');
S.ok(iSign > 0, 'build-arena.ps1: có bước gọi signtool');
S.ok(iHash > 0, 'build-arena.ps1: có bước băm SHA-256');
S.ok(
  iSign < iHash,
  'build-arena.ps1: KY xảy ra TRƯỚC khi băm SHA-256',
  `vị trí signtool=${iSign}, Get-FileHash=${iHash}`,
);

S.ok(
  /\[CmdletBinding\(\)\]|param\(/.test(build) && /-SkipSign/.test(build),
  'build-arena.ps1: có cờ -SkipSign cho bản thử nghiệm',
);

S.ok(
  /authenticode|Get-AuthenticodeSignature/i.test(build),
  'build-arena.ps1: kiểm lại chữ ký bằng Get-AuthenticodeSignature',
);

S.ok(
  /\/tr|timestamp/i.test(build),
  'build-arena.ps1: ký có TIMESTAMP (chữ ký không hết hạn khi cert hết hạn)',
);

/* ------------------------------------------------------------------ */
/* 3. Không được hỏi tay khi ghi hash                                   */
/* ------------------------------------------------------------------ */

S.section('Ghi hash: tự động, không hỏi tay');

S.ok(
  !/Read-Host[^\n]*Cap nhat SHA-256/i.test(build),
  'build-arena.ps1: KHÔNG còn hỏi tay "cập nhật SHA-256? (y/n)"',
);
S.ok(
  /tool\/release\.mjs/.test(build),
  'build-arena.ps1: sinh manifest bằng tool/release.mjs (từ bytes đã ký)',
);
S.ok(
  /manifest\.json/.test(build) && /KHONG khop|DUNG LAI/.test(build),
  'build-arena.ps1: manifest không khớp file thì DỪNG (không phát hành)',
);

/* Bản thử nghiệm chưa ký thì KHÔNG được ghi hash lên server. */
S.ok(
  /if \(-not \$signed\)/.test(build),
  'build-arena.ps1: bản chưa ký thì không cấp nhật hash (không phát hành)',
);

/* ------------------------------------------------------------------ */
/* 4. Version resource                                                  */
/* ------------------------------------------------------------------ */

S.section('Version resource (CompanyName/FileVersion)');

S.ok(existsSync(rcPath), 'có tool/build/version.rc');
if (existsSync(rcPath)) {
  const rc = readFileSync(rcPath, 'utf8');
  S.ok(/VERSIONINFO/.test(rc), 'version.rc: khai báo VERSIONINFO');
  S.ok(/VALUE "CompanyName"/.test(rc), 'version.rc: có CompanyName');
  S.ok(/VALUE "ProductName"/.test(rc), 'version.rc: có ProductName');
  S.ok(/VALUE "FileVersion"/.test(rc), 'version.rc: có FileVersion');
  S.ok(/__XA_VERSION__/.test(rc), 'version.rc: có placeholder để build thay version');
}
S.ok(
  /version resource|version\.rc/i.test(build),
  'build-arena.ps1: chuẩn bị version resource hoặc ghi rõ giới hạn Nuitka',
);

/* ------------------------------------------------------------------ */
/* 5. Manifest server: hash/size đến từ manifest sinh từ bytes          */
/* ------------------------------------------------------------------ */

S.section('arena-installer.js: không còn hằng số hash viết tay');

const installer = readFileSync(installerPath, 'utf8');

/*
 * Thiết kế đã chuyển sang manifest sinh từ bytes (tool/release.mjs). Điều
 * quan trọng KHÔNG phải "có hằng số" mà là "KHÔNG có con số nào nhập tay
 * được coi là sự thật".
 */
S.ok(
  !/export const EXE_SHA256 = '[A-Fa-f0-9]{64}'/.test(installer),
  'arena-installer.js: KHÔNG còn EXE_SHA256 viết tay',
);
S.ok(
  !/export const EXE_SIZE = \d+/.test(installer),
  'arena-installer.js: KHÔNG còn EXE_SIZE viết tay',
);
S.ok(
  /RELEASE_MANIFEST/.test(installer),
  'arena-installer.js: đọc manifest qua RELEASE_MANIFEST',
);
S.ok(
  /verified/.test(installer),
  'arena-installer.js: có cờ verified để frontend biết số liệu có thật hay không',
);
S.ok(
  /verified: false/.test(installer),
  'arena-installer.js: chưa có manifest -> verified:false (không bịa hash)',
);

/* Manifest thật, nếu đã phát hành, phải khớp version của app. */
const manifestPath = join(ROOT, 'release/manifest.json');
if (existsSync(manifestPath)) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  S.ok(/^[A-F0-9]{64}$/i.test(String(m.sha256 || '')), 'manifest: sha256 hợp lệ');
  S.ok(Number(m.size) > 1_000_000, 'manifest: size hợp lý', `${m.size} B`);

  const appSrc2 = readFileSync(join(ROOT, 'tool/app/xa_arena_app.py'), 'utf8');
  const appVer2 = (appSrc2.match(/APP_VERSION = '([^']+)'/) || [])[1];
  S.ok(
    appVer2 === m.version,
    'manifest.version == APP_VERSION',
    `manifest=${m.version}, app=${appVer2}`,
  );
} else {
  console.log('  · chưa có release/manifest.json (chưa phát hành) — bỏ qua kiểm manifest');
}

/* ------------------------------------------------------------------ */
/* 6. Trang tải về không được hiện hash cũ như thể đã xác minh          */
/* ------------------------------------------------------------------ */

S.section('download.js: không hiện hash cũ giả');

/**
 * Bóc comment: khối sửa lỗi cố ý TRÍCH LẠI version/hash cũ để giải thích,
 * nên phải soát MÃ chứ không soát lời giải thích.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const dlSrc = stripComments(readFileSync(join(ROOT, 'public/assets/pages/download.js'), 'utf8'));
S.ok(
  !/D74DC26EB2C19E10FEA191D6A266EC3D778ED3DACA1C8112505AFD864E7E5584/.test(dlSrc),
  'download.js: KHÔNG còn hash cũ D74DC26E… trong MÃ',
);
S.ok(
  !/3\.0\.2\.0/.test(dlSrc),
  'download.js: KHÔNG còn version 3.0.2.0 trong MÃ',
);

/*
 * KHÔNG kiểm được offline (nói rõ thay vì giả vờ):
 *   - file .exe thực tế có chữ ký hợp lệ hay không (cần Windows + cert)
 *   - VersionInfo nhúng đã đúng chưa (cần build)
 *   - hash trên server khớp bytes đang nằm trên R2 (cần tải về)
 */
S.section('Giới hạn của kiểm thử này');

process.exit(S.summary() ? 0 : 1);
