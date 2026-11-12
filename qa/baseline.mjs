import { q, q1 } from './q.mjs';

const settings = await q('SELECT key, value FROM settings ORDER BY key');
console.log('=== SETTINGS ===');
for (const r of settings) console.log(`  ${r.key} = ${r.value}`);

console.log('\n=== COUNTS ===');
const tables = ['users', 'orders', 'order_items', 'payments', 'products', 'product_keys', 'licenses', 'license_issues', 'sessions'];
for (const t of tables) {
  try {
    const r = await q1(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`  ${t.padEnd(16)} ${r?.n}`);
  } catch (e) { console.log(`  ${t.padEnd(16)} ERR ${e.message.slice(0, 80)}`); }
}

console.log('\n=== ORDERS BY STATUS ===');
for (const r of await q('SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY n DESC')) {
  console.log(`  ${String(r.status).padEnd(14)} ${r.n}`);
}

console.log('\n=== PAYMENTS BY STATE ===');
for (const r of await q(`SELECT state, COUNT(*) AS n, COALESCE(SUM(amount),0) AS s, COALESCE(SUM(COALESCE(is_test,0)),0) AS tests FROM payments GROUP BY state`)) {
  console.log(`  ${String(r.state).padEnd(14)} n=${String(r.n).padStart(4)} sum=${String(r.s).padStart(10)} test=${r.tests}`);
}

console.log('\n=== PRODUCTS ===');
for (const r of await q('SELECT id, name, price, stock_count, delivery_type, active, license_days FROM products ORDER BY price')) {
  console.log(`  ${r.id} | ${String(r.name).slice(0, 34).padEnd(34)} | ${String(r.price).padStart(8)} | stock=${String(r.stock_count).padStart(4)} | ${r.delivery_type} | active=${r.active} | days=${r.license_days}`);
}

console.log('\n=== NOW ===');
const vnHour = new Date(Date.now() + 7 * 3600_000).getUTCHours();
console.log('  VN hour =', vnHour, '| UTC =', new Date().toISOString());
