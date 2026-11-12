const SEPAY = process.env.SEPAY_API_TOKEN;

for (const url of [
  'https://my.sepay.vn/userapi/transactions/list?limit=20',
  'https://my.sepay.vn/userapi/transactions/list?limit=20&page=1',
]) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${SEPAY}` } });
    const ct = r.headers.get('content-type') || '';
    const txt = await r.text();
    console.log(`\n${url}\n  HTTP=${r.status} ct=${ct} len=${txt.length}`);
    if (ct.includes('json')) {
      const j = JSON.parse(txt);
      console.log('  keys:', Object.keys(j).join(','));
      const t = j.transactions || [];
      console.log('  transactions:', t.length);
      for (const x of t.slice(0, 12)) {
        console.log(`    ${x.transaction_date} | in=${String(x.amount_in).padStart(9)} | "${String(x.transaction_content || '').slice(0, 34)}" | ref=${x.reference_number}`);
      }
    } else {
      console.log('  body:', txt.slice(0, 200));
    }
  } catch (e) { console.log('  ERR', e.message); }
}
