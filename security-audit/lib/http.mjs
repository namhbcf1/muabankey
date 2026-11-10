/** Thư viện HTTP cho harness test bảo mật. */
export const BASE = process.env.BASE || 'http://127.0.0.1:8787';

/** IP riêng cho từng test để không vướng rate-limit toàn cục 300/phút của test khác. */
let ipCounter = 0;
export function nextIp() {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 65000) % 250}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

export function makeClient(label) {
  const jar = new Map();
  let fixedIp = null;
  let ipSeed = Math.floor(Math.random() * 100000);
  const headers = {};

  function ip() {
    if (fixedIp) return fixedIp;
    ipSeed += 1;
    return `10.${Math.floor(ipSeed / 250) % 250}.${ipSeed % 250}.${(ipSeed % 240) + 2}`;
  }

  const api = {
    label,
    setIp(newIp) { fixedIp = newIp; return api; },
    setHeader(k, v) { headers[k] = v; return api; },
    clearHeader(k) { delete headers[k]; return api; },
    jar,
    cookie() {
      if (jar.size === 0) return '';
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    setCookieFrom(res) {
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      const raw = sc.length ? sc : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      for (const c of raw) {
        const first = String(c).split(';')[0];
        const i = first.indexOf('=');
        if (i > 0) {
          const k = first.slice(0, i).trim();
          const v = first.slice(i + 1).trim();
          if (v === '' || /Max-Age=0/i.test(String(c))) jar.delete(k);
          else jar.set(k, v);
        }
      }
      return api;
    },
    async req(method, path, { body, headers: extra, followIp = true } = {}) {
      const h = { ...headers, ...(extra || {}) };
      if (followIp) h['cf-connecting-ip'] = ip();
      const c = api.cookie();
      if (c) h['cookie'] = c;
      let payload;
      if (body !== undefined) {
        if (typeof body === 'string' || body instanceof Uint8Array) payload = body;
        else { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
      }
      const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' });
      api.setCookieFrom(res);
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, text, headers: res.headers };
    },
    get(p, o) { return api.req('GET', p, o); },
    post(p, b, o) { return api.req('POST', p, { ...(o || {}), body: b }); },
    patch(p, b, o) { return api.req('PATCH', p, { ...(o || {}), body: b }); },
    del(p, o) { return api.req('DELETE', p, o); },
    async login(email, password) {
      const r = await api.post('/api/auth/login', { email, password });
      return r;
    },
  };
  return api;
}

/** Tiện ích: parse JWT-like / hex session cookie. */
export function sessionCookieOf(client) {
  return client.jar.get('mbk_session') || null;
}
