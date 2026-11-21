/**
 * api.mjs — HTTP client dùng chung cho script QA.
 *
 * Chạy: QA_BASE=http://127.0.0.1:8787 ...
 *
 * P0 — KHÔNG hardcode domain production. Bản cũ ghim
 * `new URL('https://xienhl.com' + path)`, nên MỌI script import file này
 * đều ghi thẳng vào hệ thống thật.
 */
import https from 'node:https';
import http from 'node:http';
import { target } from './qa-guard.mjs';

const BASE = target().base;
const transport = BASE.startsWith('https:') ? https : http;

export function req(path, { method = 'GET', body = null, cookies = '', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const h = { accept: 'application/json', 'accept-encoding': 'identity', ...headers };
    if (cookies) h.cookie = cookies;
    if (body) h['content-type'] = 'application/json';
    const r = transport.request(url, { method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), json });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

export function cookieFrom(res) {
  const sc = res.headers['set-cookie'] || [];
  return sc.map((c) => c.split(';')[0]).join('; ');
}
