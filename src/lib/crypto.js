/**
 * Tiện ích mã hoá: PBKDF2 password hashing, token ngẫu nhiên, SHA-256.
 * Chạy trên WebCrypto của Cloudflare Workers.
 */

const enc = new TextEncoder();

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function uuid() {
  return crypto.randomUUID();
}

export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return b64(d);
}

/**
 * PBKDF2-SHA256, 100.000 vòng.
 * LƯU Ý: Cloudflare Workers WebCrypto giới hạn PBKDF2 tối đa 100.000 iteration.
 * Vượt quá sẽ ném lỗi runtime trên production (Miniflare local không áp giới hạn này).
 */
export const PBKDF2_ITERATIONS = 100000;

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return { hash: b64(bits), salt: b64(salt) };
}

export async function verifyPassword(password, hashB64, saltB64) {
  const { hash } = await hashPassword(password, saltB64);
  return timingSafeEqual(hash, hashB64);
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mã đơn hàng dạng MBK-XXXXXX */
export function orderCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) s += alphabet[r[i] % alphabet.length];
  return 'MBK-' + s;
}

export function topupCode() {
  const r = crypto.getRandomValues(new Uint8Array(5));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[r[i] % alphabet.length];
  return s;
}
