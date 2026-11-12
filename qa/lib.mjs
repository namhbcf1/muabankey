import { Client, q, q1, BASE } from './q.mjs';
import { readFileSync } from 'node:fs';

export const SECRET = readFileSync('WEBHOOK_SECRET.txt', 'utf8').trim();

export const R = []; // results
export function rec(id, name, pass, note = '') {
  R.push({ id, name, pass, note });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${id}. ${name}${note ? ' :: ' + note : ''}`);
}

export async function newUser(tag) {
  const c = new Client();
  const name = `qa${tag}${Date.now().toString(36).slice(-6)}`;
  const r = await c.req('/api/auth/register', {
    method: 'POST',
    body: { username: name, password: 'QaPassw0rd!23' },
  });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${r.text}`);
  c.username = name;
  c.userId = r.json.user.id;
  return c;
}

/** Tạo đơn 180k (p-lic-month) */
export async function makeOrder(c, productId = 'p-lic-month', quantity = 1) {
  const r = await c.req('/api/orders', {
    method: 'POST',
    body: { items: [{ productId, quantity }] },
  });
  return r;
}

export async function getQr(c, orderId) {
  return c.req(`/api/orders/${orderId}/qr`, { method: 'POST' });
}

export function hook(body, secret = SECRET) {
  return fetch(BASE + '/api/webhooks/sepay', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Apikey ${secret}` },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

export function dump() {
  console.log('\n\n===== SUMMARY =====');
  let p = 0, f = 0;
  for (const r of R) { if (r.pass) p++; else f++; }
  console.log(`PASS=${p} FAIL=${f} TOTAL=${R.length}`);
  if (f) { console.log('\nFAILED:'); for (const r of R) if (!r.pass) console.log(`  ${r.id}. ${r.name} :: ${r.note}`); }
}
