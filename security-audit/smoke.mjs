import { makeClient } from './lib/http.mjs';

const c = makeClient('smoke');
const r = await c.login('admin@muabankey.vn', '${QA_ADMIN_PASSWORD}');
console.log('admin login:', r.status, JSON.stringify(r.json));
console.log('cookie:', (c.cookie() || '').slice(0, 40));

const me = await c.get('/api/auth/me');
console.log('me:', me.status, JSON.stringify(me.json)?.slice(0, 300));

const d = await c.get('/api/admin/dashboard');
console.log('dashboard:', d.status, JSON.stringify(d.json)?.slice(0, 200));

const u = makeClient('u');
const lu = await u.login('demo@muabankey.vn', 'Demo@123456');
console.log('demo login:', lu.status, JSON.stringify(lu.json)?.slice(0, 200));
