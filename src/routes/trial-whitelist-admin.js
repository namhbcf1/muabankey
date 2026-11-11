/**
 * Admin quản lý whitelist dùng thử vô hạn.
 *
 * Dùng cho máy lập trình / test nội bộ.
 * Chỉ admin thật (requireAdminStrict).
 */
import { json } from '../lib/http.js';
import { nowSec } from '../lib/trial-quota.js';

async function readBody(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch {
    return {};
  }
}

/** Chuẩn hoá giá trị theo scope. */
function normValue(scope, v) {
  const s = String(v || '').trim();
  if (scope === 'hwid' || scope === 'weak' || scope === 'device') {
    const x = s.toLowerCase();
    return /^[0-9a-f]{16,64}$/.test(x) ? x : null;
  }
  if (scope === 'ip') {
    // Phải kiểm từng octet 0-255 (trước đây nhận cả 999.999.999.999)
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return null;
    const ok = s.split('.').every((x) => {
      const n = Number(x);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
    return ok ? s : null;
  }
  if (scope === 'user') {
    return s.length >= 1 && s.length <= 64 ? s : null;
  }
  return null;
}

/** GET /api/admin/trial/whitelist */
export async function adminWhitelistList(env, request) {
  const { ok } = await import('../lib/http.js');
  const { requireAdminStrict } = await import('../lib/auth.js');
  await requireAdminStrict(env, request);

  const { results } = await env.DB.prepare(
    'SELECT scope, value, note, created_at, created_by FROM trial_whitelist ORDER BY scope, created_at DESC'
  ).all();

  return ok({
    entries: (results || []).map((r) => ({
      scope: r.scope,
      value: r.value,
      note: r.note,
      createdAt: r.created_at,
      createdBy: r.created_by,
    })),
    count: (results || []).length,
  });
}

/**
 * POST /api/admin/trial/whitelist
 * { scope, value, note }
 */
export async function adminWhitelistAdd(env, request) {
  const { ok, ApiError: AE } = await import('../lib/http.js');
  const { requireAdminStrict } = await import('../lib/auth.js');
  const { audit } = await import('./products.js');
  const admin = await requireAdminStrict(env, request);

  const b = await readBody(request);
  const scope = String(b.scope || '').trim();
  if (!['weak', 'hwid', 'device', 'user', 'ip'].includes(scope)) {
    throw new AE(400, 'scope phải là: weak | hwid | device | user | ip', 'VALIDATION');
  }

  const value = normValue(scope, b.value);
  if (!value) {
    throw new AE(400, `Giá trị không hợp lệ cho scope "${scope}"`, 'VALIDATION');
  }

  const note = String(b.note || '').trim().slice(0, 200) || null;

  await env.DB.prepare(
    `INSERT INTO trial_whitelist (scope, value, note, created_at, created_by)
     VALUES (?,?,?,?,?)
     ON CONFLICT(scope, value) DO UPDATE SET note = excluded.note`
  ).bind(scope, value, note, nowSec(), admin.username || admin.id).run();

  await audit(env, admin.id, 'trial.whitelist.add', value, { scope, note });

  return ok({ added: true, scope, value, note });
}

/**
 * DELETE /api/admin/trial/whitelist?scope=...&value=...
 * hoặc POST { scope, value, remove: true }
 */
export async function adminWhitelistRemove(env, request) {
  const { ok, ApiError: AE } = await import('../lib/http.js');
  const { requireAdminStrict } = await import('../lib/auth.js');
  const { audit } = await import('./products.js');
  const admin = await requireAdminStrict(env, request);

  const url = new URL(request.url);
  let scope = url.searchParams.get('scope');
  let value = url.searchParams.get('value');

  if (!scope) {
    const b = await readBody(request);
    scope = b.scope;
    value = b.value;
  }

  scope = String(scope || '').trim();
  value = String(value || '').trim();

  if (!scope || !value) {
    throw new AE(400, 'Cần scope và value', 'VALIDATION');
  }

  const r = await env.DB.prepare(
    'DELETE FROM trial_whitelist WHERE scope = ? AND value = ?'
  ).bind(scope, value).run();

  if (!r.meta || r.meta.changes !== 1) {
    throw new AE(404, 'Không tìm thấy mục này trong whitelist', 'NOT_FOUND');
  }

  await audit(env, admin.id, 'trial.whitelist.remove', value, { scope });

  return ok({ removed: true, scope, value });
}

/**
 * POST /api/admin/trial/whitelist/this-device
 * Tự thêm máy đang dùng (dựa vào IP gọi API) — dùng khi đang lập trình.
 */
export async function adminWhitelistThisDevice(env, request) {
  const { ok } = await import('../lib/http.js');
  const { requireAdminStrict } = await import('../lib/auth.js');
  const { audit } = await import('./products.js');
  const admin = await requireAdminStrict(env, request);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (ip === 'unknown') {
    return ok({ added: false, reason: 'no_ip' });
  }

  const b = await readBody(request);
  const note = String(b.note || '').trim().slice(0, 200) || `IP hiện tại của ${admin.username || 'admin'}`;

  await env.DB.prepare(
    `INSERT INTO trial_whitelist (scope, value, note, created_at, created_by)
     VALUES ('ip', ?, ?, ?, ?)
     ON CONFLICT(scope, value) DO UPDATE SET note = excluded.note`
  ).bind(ip, note, nowSec(), admin.username || admin.id).run();

  await audit(env, admin.id, 'trial.whitelist.thisdevice', ip, {});

  return ok({ added: true, scope: 'ip', value: ip, note });
}
