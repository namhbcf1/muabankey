/**
 * release.test.mjs — Manifest phát hành sinh từ BYTES, không phải hằng số tay.
 *
 * Khoá lỗi P1 F13/F14:
 *   - EXE_VERSION/EXE_SHA256/EXE_SIZE viết tay, không có gì bảo đảm khớp file
 *   - download.js còn fallback 3.0.2.0 + hash cũ, hiện như thể đã xác minh
 *   - không kiểm chữ ký manifest
 */
import { Suite } from './harness.mjs';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('Phát hành EXE');

const {
  buildManifest, compareVersion, hashFile, signManifest,
  verifyManifestSignature, verifyFileAgainstManifest, readManifest, writeManifest,
} = await import('../tool/release.mjs');

const releaseSrc = readFileSync(join(ROOT, 'src/routes/arena-installer.js'), 'utf8');
const downloadSrc = readFileSync(join(ROOT, 'public/assets/pages/download.js'), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const tmp = mkdtempSync(join(tmpdir(), 'muabankey-rel-'));

/** Tạo một "binary" giả có nội dung khác nhau. */
function fakeExe(name, fill) {
  const p = join(tmp, name);
  writeFileSync(p, Buffer.alloc(4096, fill));
  return p;
}

try {
  /* ================================================================ */
  S.section('buildManifest — hash đo từ file THẬT');

  {
    const exe = fakeExe('a.exe', 0x41);
    const m = buildManifest({ exe, version: '3.2.0.0' });

    const expect = createHash('sha256').update(readFileSync(exe)).digest('hex').toUpperCase();
    S.ok(m.sha256 === expect, 'sha256 khớp hash tự tính của file', m.sha256.slice(0, 12));
    S.ok(m.size === 4096, 'size đúng bằng dung lượng thật', String(m.size));
    S.ok(m.version === '3.2.0.0', 'version giữ nguyên');
    S.ok(m.channel === 'stable', 'channel mặc định stable');
    S.ok(m.signedBy === null, 'chưa ký -> signedBy null (không giả vờ)');
  }

  S.section('buildManifest — từ chối đầu vào không hợp lệ');

  {
    S.throws(() => buildManifest({ version: '1.0.0' }), 'thiếu --exe -> ném lỗi');
    S.throws(() => buildManifest({ exe: join(tmp, 'khong-co.exe'), version: '1.0.0' }),
      'file không tồn tại -> ném lỗi');

    const small = join(tmp, 'small.exe');
    writeFileSync(small, Buffer.alloc(100, 1));
    S.throws(() => buildManifest({ exe: small, version: '1.0.0' }),
      'file quá nhỏ -> ném lỗi (build hỏng)');

    const exe = fakeExe('b.exe', 0x42);
    S.throws(() => buildManifest({ exe, version: 'abc' }), 'version sai định dạng -> ném lỗi');
    S.throws(() => buildManifest({ exe, version: '' }), 'version rỗng -> ném lỗi');
  }

  S.section('Hai file khác nội dung -> hash KHÁC nhau');

  {
    const a = buildManifest({ exe: fakeExe('c1.exe', 0x01), version: '1.0.0' });
    const b = buildManifest({ exe: fakeExe('c2.exe', 0x02), version: '1.0.0' });
    S.ok(a.sha256 !== b.sha256, 'nội dung khác -> sha256 khác',
      `${a.sha256.slice(0, 8)} vs ${b.sha256.slice(0, 8)}`);
  }

  S.section('verifyFileAgainstManifest — phát hiện file bị đổi');

  {
    const exe = fakeExe('d.exe', 0x43);
    const m = buildManifest({ exe, version: '3.2.0.0' });

    const okRes = verifyFileAgainstManifest(m, exe);
    S.ok(okRes.ok === true, 'file đúng -> khớp');

    // Sửa 1 byte (mô phỏng file bị can thiệp sau khi sinh manifest)
    const buf = readFileSync(exe);
    buf[0] = 0x99;
    writeFileSync(exe, buf);

    const bad = verifyFileAgainstManifest(m, exe);
    S.ok(bad.ok === false && bad.reason === 'MISMATCH', 'file bị đổi -> MISMATCH',
      bad.reason);
    S.ok((bad.problems || []).some((p) => p.startsWith('sha256')),
      'báo rõ lệch sha256');

    const missing = verifyFileAgainstManifest(m, join(tmp, 'khong-ton-tai.exe'));
    S.ok(missing.ok === false && missing.reason === 'FILE_NOT_FOUND',
      'file không tồn tại -> FILE_NOT_FOUND');
  }

  S.section('Ký và kiểm manifest');

  {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

    const exe = fakeExe('signed.exe', 0x44);
    const m = buildManifest({ exe, version: '3.3.0.0' });
    const signed = signManifest(m, privPem);

    S.ok(typeof signed.signature === 'string' && signed.signature.length > 10,
      'có trường signature');

    const good = verifyManifestSignature(signed, pubPem);
    S.ok(good.ok === true, 'chữ ký hợp lệ -> verify ok');

    const unsigned = verifyManifestSignature(m, pubPem);
    S.ok(unsigned.ok === false && unsigned.reason === 'UNSIGNED',
      'manifest chưa ký -> UNSIGNED', unsigned.reason);

    // Sửa nội dung sau khi ký -> chữ ký phải hỏng
    const tampered = { ...signed, version: '9.9.9.9' };
    const bad = verifyManifestSignature(tampered, pubPem);
    S.ok(bad.ok === false && bad.reason === 'BAD_SIGNATURE',
      'sửa nội dung -> BAD_SIGNATURE', bad.reason);

    // Đổi khoá khác -> cũng hỏng
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
    const wrongKey = verifyManifestSignature(signed, other);
    S.ok(wrongKey.ok === false, 'khoá sai -> không verify', wrongKey.reason);

    S.ok(verifyManifestSignature(null, pubPem).reason === 'NO_MANIFEST',
      'không có manifest -> NO_MANIFEST');
  }

  S.section('compareVersion');

  {
    S.ok(compareVersion('3.1.0.0', '3.0.2.0') === 1, '3.1.0.0 > 3.0.2.0');
    S.ok(compareVersion('3.0.2.0', '3.1.0.0') === -1, '3.0.2.0 < 3.1.0.0');
    S.ok(compareVersion('3.1.0.0', '3.1.0.0') === 0, 'bằng nhau -> 0');
    S.ok(compareVersion('3.1', '3.1.0.0') === 0, 'thiếu phần -> coi như 0');
  }

  S.section('Ghi / đọc manifest');

  {
    const exe = fakeExe('w.exe', 0x45);
    const m = buildManifest({ exe, version: '4.0.0.0' });
    const dir = join(tmp, 'rel');
    const p = writeManifest(m, { dir });

    const back = readManifest(p);
    S.ok(back.sha256 === m.sha256, 'đọc lại giữ nguyên hash');
    S.ok(back.version === '4.0.0.0', 'đọc lại giữ nguyên version');

    const shaFile = readFileSync(join(dir, `${m.filename}.sha256`), 'utf8');
    S.ok(shaFile.includes(m.sha256), 'có file .sha256 riêng để phát hành');
  }

  /* ================================================================ */
  S.section('F13 — arena-installer.js KHÔNG còn hằng số version/hash');

  {
    const code = stripComments(releaseSrc);
    S.ok(!/export const EXE_VERSION\s*=\s*'[\d.]+'/.test(code),
      'KHÔNG còn EXE_VERSION viết tay');
    S.ok(!/export const EXE_SHA256\s*=\s*'[A-F0-9]{32,}'/.test(code),
      'KHÔNG còn EXE_SHA256 viết tay');
    S.ok(!/export const EXE_SIZE\s*=\s*\d{6,}/.test(code),
      'KHÔNG còn EXE_SIZE viết tay');
    S.ok(code.includes('releaseInfo'), 'có releaseInfo() đọc manifest');
    S.ok(code.includes('RELEASE_MANIFEST'), 'đọc manifest từ RELEASE_MANIFEST');
    S.ok(/verified:\s*false/.test(code), 'chưa có manifest -> verified:false');
  }

  S.section('F13 — download.js KHÔNG bịa hash cũ');

  {
    const code = stripComments(downloadSrc);
    S.ok(!/3\.0\.2\.0/.test(code), 'KHÔNG còn fallback version 3.0.2.0');
    S.ok(!/D74DC26E/.test(code), 'KHÔNG còn hash cũ 8AE4E0AB/D74DC26E');
    S.ok(!/8AE4E0AB/.test(code), 'KHÔNG còn hash cũ 8AE4E0AB');
    S.ok(/serverVerified/.test(code), 'dùng cờ verified của server');
    S.ok(/UNVERIFIED_HASH_TEXT/.test(code), 'có câu "chưa xác minh"');
    S.ok(!/copyHashBtn\.dataset\.value\s*=\s*sha/.test(code)
      || /if \(serverVerified\)/.test(code),
      'chỉ đặt hash khi đã xác minh');
  }

  S.section('F14 — server công bố thông tin phát hành đầy đủ');

  {
    S.ok(/minSupportedVersion/.test(releaseSrc), 'có minSupportedVersion');
    S.ok(/channel/.test(releaseSrc), 'có channel (stable/canary)');
    S.ok(/signedBy/.test(releaseSrc), 'có signedBy');
    S.ok(/X-Release-Sha256/.test(releaseSrc), 'header tải công bố hash');
  }
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* bỏ qua */ }
}

process.exit(S.summary() ? 0 : 1);
