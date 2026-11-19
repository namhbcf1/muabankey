/**
 * /api/shop/lic — KÝ DANH SÁCH MÁY CHỦ SHOP
 *
 * VÌ SAO CẦN: trước đây app đọc danh sách HWID chủ shop từ
 * `%LOCALAPPDATA%\XArenaNoFog\shop.hwid` và biến môi trường
 * `XA_SHOP_HWIDS`. Cả hai đều NẰM TRONG TAY KHÁCH, nên khách chỉ cần
 * tạo một file text 20 byte chứa HWID của họ là BẬT ĐƯỢC tính năng độc
 * quyền. Đã đo và xác nhận lỗ hổng này.
 *
 * NAY: app chỉ tin file do SERVER KÝ bằng ECDSA P-256.
 *   - Khoá RIÊNG nằm trong Cloudflare Secret `SHOP_SIGN_KEY`
 *   - Khoá CÔNG KHAI nhúng trong exe
 * Khách tạo file tùy ý -> chữ ký sai -> app KHÔNG bật.
 *
 * CHỈ ADMIN gọi được endpoint này.
 */

import { ok, fail } from '../lib/http.js';
import { requireAdminStrict } from '../lib/auth.js';
import { str } from '../lib/validate.js';

/** base64 -> Uint8Array */
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uint8Array -> base64 */
function bytesToB64(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

/** base64 (chuẩn hoặc url) -> ArrayBuffer */
function b64ToBuf(b64) {
  const t = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  return b64ToBytes(t).buffer;
}

/**
 * Ký payload bằng ECDSA P-256 (khoá riêng trong secret).
 * @returns {Promise<string>} "<payload_b64>.<sig_b64>"
 */
async function signPayload(env, payloadObj) {
  const raw = String(env.SHOP_SIGN_KEY || '').trim();
  if (!raw) {
    throw new Error('SHOP_SIGN_KEY chưa cấu hình');
  }
  const key = await crypto.subtle.importKey(
    'pkcs8',
    b64ToBuf(raw),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    payloadBytes
  );
  return `${bytesToB64(payloadBytes)}.${bytesToB64(sig)}`;
}

/**
 * Tạo nội dung shop.lic.
 * POST /api/shop/lic  { hwid: "...", days: 365 }
 */
export async function postShopLic(env, request) {
  // requireAdminStrict NÉM ApiError(403) nếu không phải admin.
  // Nó trả về chính `user`, không phải {ok:true}.
  await requireAdminStrict(env, request);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return fail('bad_json', 400);
  }

  const hwid = str(body.hwid, 'hwid', { min: 8, max: 64 }).trim().toLowerCase();
  const days = Number(body.days ?? 365);
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    return fail('bad_days', 400);
  }

  const exp = Math.floor(Date.now() / 1000) + Math.floor(days) * 86400;

  let lic;
  try {
    lic = await signPayload(env, { h: hwid, exp });
  } catch (e) {
    return fail('sign_failed', 500, { detail: String(e.message || e) });
  }

  return ok({
    ok: true,
    hwid,
    exp,
    // Nội dung dán vào %LOCALAPPDATA%\XArenaNoFog\shop.lic
    lic,
    fileName: 'shop.lic',
  });
}

/** GET /api/shop/lic — kiểm tra khoá đã cấu hình chưa (không lộ khoá). */
export async function getShopLicStatus(env, request) {
  await requireAdminStrict(env, request);
  return ok({
    ok: true,
    keyConfigured: !!(env.SHOP_SIGN_KEY && String(env.SHOP_SIGN_KEY).trim()),
  });
}
