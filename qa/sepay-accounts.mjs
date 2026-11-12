const SEPAY = process.env.SEPAY_API_TOKEN;

const endpoints = [
  'https://my.sepay.vn/userapi/accounts/list',
  'https://my.sepay.vn/userapi/bankaccounts/list',
  'https://my.sepay.vn/userapi/user/myinfo',
];

for (const url of endpoints) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${SEPAY}` } });
    const txt = await r.text();
    console.log(`\n${url}\n  HTTP=${r.status} (${r.headers.get('content-type')}) len=${txt.length}`);
    console.log('  ', txt.slice(0, 900));
  } catch (e) { console.log(`\n${url}\n  ERR ${e.message}`); }
}
