/**
 * Mã hoá/giải mã secret dạng tài khoản (email|mật khẩu) của product_keys.
 *
 * VẤN ĐỀ: hiện `product_keys.secret` lưu PLAINTEXT (base64 chỉ là encoding,
 * không phải mã hoá). Ai đọc được DB là có toàn bộ mật khẩu sản phẩm:
 *   bTM2NTAxQG1zMzY1Lm11YWJhbmtleS52bnxNYmtNMzY1QDIwMjUjMDE=
 *   -> m36501@ms365.muabankey.vn|MbkM365@2025#01
 *
 * GIẢI PHÁP: AES-256-GCM. Khoá đọc từ env.KEY_ENC (Worker secret).
 * Định dạng lưu: "enc1:" + base64(iv[12] + ciphertext + tag)
 *
 * TƯƠNG THÍCH NGƯỢC: giá trị không có tiền tố "enc1:" được coi là plaintext
 * (dữ liệu cũ). Khi đọc, tự nhận biết. Khi ghi mới, luôn mã hoá.
 */

const PREFIX = 'enc1:';

/** Chuỗi base64 chuẩn. */
function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Lấy khoá 32 byte từ env.KEY_ENC (hex 64 hoặc base64). */
async function getKey(env) {
  const raw = env && env.KEY_ENC;
  if (!raw || String(raw).length < 32) return null;
  let bytes;
  const s = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(s.substr(i * 2, 2), 16);
  } else {
    try {
      bytes = unb64(s);
    } catch {
      return null;
    }
  }
  if (bytes.length !== 32) {
    // Băm lại cho chắc nếu người dùng nhập chuỗi bất kỳ
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return crypto.subtle.importKey('raw', d, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Mã hoá 1 secret. Trả chuỗi "enc1:...". Nếu không có khoá -> trả nguyên. */
export async function sealSecret(env, plain) {
  const text = String(plain == null ? '' : plain);
  if (!text) return text;
  const key = await getKey(env);
  if (!key) return text; // chưa cấu hình KEY_ENC -> giữ nguyên (tương thích)

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(text)
    )
  );
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv, 0);
  all.set(ct, iv.length);
  return PREFIX + b64(all);
}

/** Giải mã. Nếu không có tiền tố -> coi là plaintext cũ, trả nguyên. */
export async function openSecret(env, stored) {
  const s = String(stored == null ? '' : stored);
  if (!s.startsWith(PREFIX)) return s; // dữ liệu cũ
  const key = await getKey(env);
  if (!key) return ''; // có mã hoá nhưng mất khoá -> không trả bừa

  try {
    const all = unb64(s.slice(PREFIX.length));
    const iv = all.slice(0, 12);
    const ct = all.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return '';
  }
}

/** True nếu chuỗi đã được mã hoá. */
export function isSealed(v) {
  return typeof v === 'string' && v.startsWith(PREFIX);
}
