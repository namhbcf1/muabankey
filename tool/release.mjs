/**
 * release.mjs — SINH MANIFEST PHÁT HÀNH TỪ BINARY THẬT.
 *
 * ============================================================================
 * F13 / F14 — VÌ SAO PHẢI CÓ FILE NÀY
 *
 * Bản cũ: `EXE_VERSION`, `EXE_SHA256`, `EXE_SIZE` là HẰNG SỐ viết tay trong
 * src/routes/arena-installer.js. Hệ quả đo được:
 *
 *   • `download.js` (frontend) còn fallback version 3.0.2.0 trong khi source
 *     app và server đều 3.1.0.0 — khách thấy hai số khác nhau ở hai chỗ.
 *   • Hash không có gì bảo đảm khớp file đang nằm trong R2. Sửa version bằng
 *     tay ở một chỗ mà quên chỗ khác là chuyện đã xảy ra.
 *   • `check_versions.py` vẫn kiểm file server không còn trong inventory.
 *
 * ============================================================================
 * NGUYÊN TẮC: MANIFEST SINH TỪ BYTES, KHÔNG PHẢI TỪ NIỀM TIN
 *
 *   1. Băm FILE THẬT sau khi ký -> sha256/size là sự thật đo được.
 *   2. Ghi ra `release/manifest.json` cùng một file `.sha256` riêng.
 *   3. Ký manifest bằng khoá riêng (tuỳ chọn nhưng phải có ở production).
 *   4. Server đọc manifest lúc build/deploy; KHÔNG có hằng số hash viết tay.
 *
 * Dùng:
 *   node tool/release.mjs --exe tool/dist-arena/xa_arena.exe --version 3.2.0.0
 *   node tool/release.mjs --exe ... --version ... --channel canary
 *   node tool/release.mjs --verify release/manifest.json --exe <file>
 * ============================================================================
 */
import { createHash, sign, verify, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** Đọc tham số dòng lệnh dạng `--key value` và cờ `--flag`. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/** So sánh phiên bản dạng a.b.c.d — trả -1/0/1. */
export function compareVersion(a, b) {
  const pa = String(a || '0').split('.').map((x) => Number(x) || 0);
  const pb = String(b || '0').split('.').map((x) => Number(x) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Băm một file theo luồng, trả {sha256, size}. */
export function hashFile(path) {
  const buf = readFileSync(path);
  return {
    sha256: createHash('sha256').update(buf).digest('hex').toUpperCase(),
    size: buf.length,
  };
}

/**
 * Sinh manifest từ một binary THẬT.
 *
 * @param {object} opts
 * @param {string} opts.exe        đường dẫn binary đã build (và đã ký nếu có)
 * @param {string} opts.version    phiên bản, vd '3.2.0.0'
 * @param {string} [opts.channel]  stable | canary
 * @param {string} [opts.minSupported] phiên bản tối thiểu còn được dùng
 * @param {string} [opts.notes]    ghi chú phát hành
 * @param {string} [opts.commit]   git commit
 * @param {string} [opts.signedBy] chủ thể ký Authenticode
 */
export function buildManifest(opts = {}) {
  const exe = opts.exe;
  if (!exe) throw new Error('buildManifest: thiếu --exe');
  if (!existsSync(exe)) throw new Error(`buildManifest: không thấy file ${exe}`);
  const st = statSync(exe);
  if (!st.isFile()) throw new Error(`buildManifest: ${exe} không phải file`);
  if (st.size < 1024) throw new Error(`buildManifest: ${exe} quá nhỏ (${st.size} B) — build lỗi?`);

  const version = String(opts.version || '').trim();
  if (!/^\d+(\.\d+){1,3}$/.test(version)) {
    throw new Error(`buildManifest: version không hợp lệ "${version}" (cần dạng 3.2.0.0)`);
  }

  const { sha256, size } = hashFile(exe);

  return {
    schema: 1,
    name: opts.name || 'XA ARENA',
    filename: opts.filename || basename(exe),
    version,
    channel: opts.channel || 'stable',
    minSupportedVersion: opts.minSupported || '0.0.0.0',
    sha256,
    size,
    platform: opts.platform || 'Windows 10 / 11 (64-bit)',
    commit: opts.commit || null,
    /** Chữ ký Authenticode của file, nếu đã ký. Null = CHƯA ký (không được giả vờ). */
    signedBy: opts.signedBy || null,
    notes: opts.notes || '',
    builtAt: new Date().toISOString(),
  };
}

/** Little-endian length-prefix cho mỗi trường — tránh đụng độ chuỗi. */
function canonicalBytes(manifest) {
  const keys = Object.keys(manifest)
    .filter((k) => k !== 'signature')
    .sort();
  const parts = [];
  for (const k of keys) {
    const v = manifest[k];
    const s = v === null || v === undefined ? '' : String(v);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(Buffer.byteLength(s, 'utf8'), 0);
    parts.push(Buffer.from(k, 'utf8'), Buffer.from([0]), len, Buffer.from(s, 'utf8'));
  }
  return Buffer.concat(parts);
}

/**
 * Ký manifest bằng khoá riêng (tuỳ chọn).
 *
 * Không tự sinh khoá: khoá ký phát hành phải do người vận hành quản lý và
 * giữ ngoài repo. Hàm này chỉ dùng khoá đã có.
 */
export function signManifest(manifest, privateKeyPem) {
  const data = canonicalBytes(manifest);
  const sig = sign(null, data, createPrivateKey(privateKeyPem));
  return { ...manifest, signature: sig.toString('base64') };
}

/** Kiểm chữ ký manifest bằng khoá công khai. */
export function verifyManifestSignature(manifest, publicKeyPem) {
  if (!manifest) return { ok: false, reason: 'NO_MANIFEST' };
  const sig = manifest.signature;
  if (!sig) return { ok: false, reason: 'UNSIGNED' };
  const data = canonicalBytes(manifest);
  try {
    const ok = verify(null, data, createPublicKey(publicKeyPem), Buffer.from(sig, 'base64'));
    return ok ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
  } catch (e) {
    return { ok: false, reason: `VERIFY_ERROR:${e.message}` };
  }
}

/**
 * Kiểm một file có khớp manifest không.
 *
 * Đây là bước BẮT BUỘC trước khi promote manifest ra khách: hash trong
 * manifest phải khớp đúng bytes đang nằm trong kho phát hành.
 */
export function verifyFileAgainstManifest(manifest, filePath) {
  if (!manifest) return { ok: false, reason: 'NO_MANIFEST' };
  if (!existsSync(filePath)) return { ok: false, reason: 'FILE_NOT_FOUND' };
  const { sha256, size } = hashFile(filePath);
  const problems = [];
  if (String(manifest.sha256).toUpperCase() !== sha256) {
    problems.push(`sha256: manifest=${String(manifest.sha256).slice(0, 12)}… file=${sha256.slice(0, 12)}…`);
  }
  if (Number(manifest.size) !== size) {
    problems.push(`size: manifest=${manifest.size} file=${size}`);
  }
  return problems.length
    ? { ok: false, reason: 'MISMATCH', problems }
    : { ok: true, sha256, size };
}

/* ------------------------------------------------------------------ */
/* Ghi / đọc                                                           */
/* ------------------------------------------------------------------ */

export const MANIFEST_DIR = join(ROOT, 'release');
export const MANIFEST_PATH = join(MANIFEST_DIR, 'manifest.json');

export function writeManifest(manifest, { dir = MANIFEST_DIR } = {}) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'manifest.json');
  writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  // File hash riêng: người vận hành dán vào tin nhắn/email phát hành.
  writeFileSync(join(dir, `${manifest.filename}.sha256`),
    `${manifest.sha256}  ${manifest.filename}\n`, 'utf8');
  return p;
}

export function readManifest(path = MANIFEST_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.verify) {
    const manifest = readManifest(resolve(String(args.verify)));
    const exe = args.exe ? resolve(String(args.exe)) : null;
    if (!exe) {
      console.error('Cần --exe <file> để đối chiếu với manifest');
      process.exit(1);
    }
    const r = verifyFileAgainstManifest(manifest, exe);
    if (r.ok) {
      console.log(`✓ ${basename(exe)} khớp manifest`);
      console.log(`  version ${manifest.version} · sha256 ${r.sha256}`);
      console.log(`  size    ${r.size} B`);
    } else {
      console.error(`✗ KHÔNG khớp: ${r.reason}`);
      for (const p of r.problems || []) console.error(`  - ${p}`);
      process.exit(1);
    }
    return;
  }

  const exe = args.exe ? resolve(String(args.exe)) : null;
  if (!exe) {
    console.error(
      'Dùng:\n'
      + '  node tool/release.mjs --exe <path> --version <a.b.c.d> [--channel stable|canary]\n'
      + '  node tool/release.mjs --verify release/manifest.json --exe <path>',
    );
    process.exit(1);
  }

  const manifest = buildManifest({
    exe,
    version: args.version,
    channel: args.channel,
    minSupported: args['min-supported'],
    notes: args.notes,
    commit: args.commit,
    signedBy: args['signed-by'],
  });

  let final = manifest;
  if (args['sign-key']) {
    const pem = readFileSync(resolve(String(args['sign-key'])), 'utf8');
    final = signManifest(manifest, pem);
    console.log('✓ Đã ký manifest');
  } else {
    console.log('· Không ký manifest (không có --sign-key). Production PHẢI ký.');
  }

  const p = writeManifest(final);
  console.log(`✓ Ghi ${p}`);
  console.log(`  version   ${final.version}`);
  console.log(`  channel   ${final.channel}`);
  console.log(`  sha256    ${final.sha256}`);
  console.log(`  size      ${final.size} B`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  try {
    main();
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
