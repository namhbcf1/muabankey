// D1 + HTTP helper for QA
export const T = 'cfut_36vwtVnGqd2KYb59ZWgI9faJGhStWQdeNIdEVWHba90694c6';
export const A = '5b62d10947844251d23e0eac532531dd';
export const D = '81f478c9-5627-458a-a35f-d483e69d400b';
export const BASE = 'https://xienhl.com';

export async function q(sql, params = null) {
  const body = params ? { sql, params } : { sql };
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${D}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

export async function q1(sql, params = null) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

// HTTP client that keeps cookies
export class Client {
  constructor(base = BASE) {
    this.base = base;
    this.cookie = '';
  }
  async req(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const r = await fetch(this.base + path, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = r.headers.getSetCookie?.() || [];
    for (const c of sc) {
      const m = c.match(/mbk_session=([^;]+)/);
      if (m) this.cookie = `mbk_session=${m[1]}`;
    }
    const text = await r.text();
    if (raw) return { status: r.status, headers: r.headers, text };
    let json = null;
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text, headers: r.headers };
  }
}

export function log(...a) { console.log(...a); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
