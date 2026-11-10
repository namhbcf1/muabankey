/** Probe: cf-connecting-ip của client có được tin không? (quyết định thiết kế harness) */
const BASE = 'http://127.0.0.1:8787';

async function hit(ip, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const res = await fetch(BASE + '/api/products', {
      headers: { 'cf-connecting-ip': ip },
    });
    out.push(res.status);
  }
  return out;
}

const results = [];
// 1) Cùng 1 IP giả: 320 request -> phải bị 429 nếu rate limit hoạt động theo header
const r1 = await hit('9.9.9.9', 320);
const c1 = r1.filter((s) => s === 429).length;
results.push({ label: 'same spoofed ip 9.9.9.9 x320', ok: r1.filter((s) => s === 200).length, blocked: c1 });

// 2) Mỗi request 1 IP khác nhau: 320 request -> nếu KHÔNG bị chặn => bypass hoàn toàn
const r2 = [];
for (let i = 0; i < 320; i++) {
  const res = await fetch(BASE + '/api/products', {
    headers: { 'cf-connecting-ip': `10.0.${Math.floor(i / 250)}.${i % 250}` },
  });
  r2.push(res.status);
}
results.push({ label: 'rotating spoofed ip x320', ok: r2.filter((s) => s === 200).length, blocked: r2.filter((s) => s === 429).length });

console.log(JSON.stringify(results, null, 2));
