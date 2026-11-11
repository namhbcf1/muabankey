/**
 * Lib dùng chung cho audit luồng QR thật (production).
 * KHÔNG sửa source — chỉ gọi API + query D1.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export const B = 'https://xienhl.com';
export const SEC = (process.env.WEBHOOK_SECRET
  || readFileSync(process.env.TEMP + '/testsec.txt', 'utf8')).trim();

const WRANGLER_JS = resolve('node_modules/wrangler/wrangler-dist/cli.js');

/** Chạy SQL trên D1 REMOTE, trả rows của MỌI statement. */
export function d1(sqlText) {
  // execFileSync truyền argv trực tiếp (không qua shell) nên SQL giữ nguyên.
  const out = execFileSync(process.execPath, [
    WRANGLER_JS, 'd1', 'execute', 'muabankey-db', '--remote', '--json',
    `--command=${sqlText}`,
  ], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    },
  });
  const i = out.indexOf('[');
  if (i < 0) return [];
  return JSON.parse(out.slice(i)).map((r) => r.results || []);
}

export const q1 = (sqlText) => d1(sqlText)[0] || [];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function http(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const r = await fetch(B + path, {
    method, headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  let data = null;
  const txt = await r.text();
  try { data = JSON.parse(txt); } catch { data = { _raw: txt.slice(0, 300) }; }
  return { status: r.status, data, cookie: (r.headers.getSetCookie?.() || []).join('; ') };
}

export async function register(prefix = 'aud') {
  const u = prefix + Math.random().toString(36).slice(2, 9);
  const r = await fetch(B + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'abc123' }),
  });
  const ck = (r.headers.getSetCookie?.() || []).join('; ').match(/mbk_session=[^;]+/)?.[0];
  const d = await r.json().catch(() => ({}));
  return { username: u, cookie: ck, id: d.user?.id, status: r.status, data: d };
}

export async function login(identifier, password) {
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: identifier, password }),
  });
  const ck = (r.headers.getSetCookie?.() || []).join('; ').match(/mbk_session=[^;]+/)?.[0];
  return { cookie: ck, status: r.status, data: await r.json().catch(() => ({})) };
}

export const mkOrder = (ck, productId, quantity = 1) =>
  http('/api/orders', { method: 'POST', cookie: ck, body: { items: [{ productId, quantity }] } });

export const getQr = (ck, orderId) =>
  http(`/api/orders/${orderId}/qr`, { method: 'POST', cookie: ck });

export const getOrder = (ck, orderId) =>
  http(`/api/orders/${orderId}`, { cookie: ck });

export const claim = (ck, orderId) =>
  http(`/api/orders/${orderId}/claimed`, { method: 'POST', cookie: ck });

export function wh(payload, secret = SEC) {
  return http('/api/webhooks/sepay', {
    method: 'POST',
    headers: { Authorization: `Apikey ${secret}` },
    body: payload,
  });
}

let refSeq = 0;
export const ref = (tag) => `${tag}-${Date.now()}-${++refSeq}`;

/** Tạo đơn + QR, trả {order, qr}. */
export async function orderWithQr(ck, productId, quantity = 1) {
  const o = await mkOrder(ck, productId, quantity);
  if (!o.data?.order?.id) return { err: o };
  const q = await getQr(ck, o.data.order.id);
  return { order: o.data.order, qr: q.data?.qr, qerr: q.data?.code || null };
}

export const lic = {}; // đếm license sinh cho 1 đơn
export function licCount(orderCode) {
  const r = q1(`SELECT COUNT(*) AS n FROM licenses WHERE note LIKE '%${orderCode}%'`);
  return r[0]?.n ?? 0;
}

export const line = (s) => console.log(s);
export function head(n, t) { console.log(`\n${'='.repeat(70)}\n${n}. ${t}\n${'='.repeat(70)}`); }
