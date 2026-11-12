import { Client, q, q1, BASE } from './q.mjs';

const adm = new Client();
await adm.req('/api/auth/login', { method: 'POST', body: { username: 'namhbcf', password: 'namhbcf123' } });

const pend = await adm.req('/api/admin/orders?status=pending');
console.log('=== Tab "Chờ thanh toán" — cột Khách ===');
for (const o of (pend.json.orders || []).slice(0, 10)) {
  console.log(`  ${o.code} | customer="${o.customer}" | email="${o.email}"`);
}

const all = await adm.req('/api/admin/orders');
console.log('\n=== Tab Đơn hàng — cột Email ===');
for (const o of (all.json.orders || []).slice(0, 10)) {
  console.log(`  ${o.code} | customer="${o.customer}" | email="${o.email}"`);
}

const us = await adm.req('/api/admin/users');
console.log('\n=== Tab Người dùng ===');
const hasUname = (us.json.users || []).filter((u) => u.username !== undefined).length;
console.log(`  total=${us.json.users.length} | rows có field username=${hasUname}`);
for (const u of (us.json.users || []).slice(0, 8)) {
  console.log(`  username=${JSON.stringify(u.username)} | email="${u.email}" | fullName="${u.fullName}" | balance=${u.balance}`);
}

/* UGLY EMAIL check */
const badEmail = (us.json.users || []).filter((u) => String(u.email || '').includes('@invalid'));
console.log(`\n  *** users có email nội bộ @invalid lộ ra API: ${badEmail.length}/${us.json.users.length}`);
const badOrderEmail = (all.json.orders || []).filter((o) => String(o.email || '').includes('@invalid'));
console.log(`  *** orders trả email @invalid: ${badOrderEmail.length}/${(all.json.orders||[]).length}`);
