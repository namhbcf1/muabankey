// Query helper: node qa/d1q.mjs "SQL"  -> prints rows as JSON
const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const acct = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const dbid = '81f478c9-5627-458a-a35f-d483e69d400b';

export async function d1(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbid}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    },
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result[0];
}

const sql = process.argv[2];
if (sql) {
  const res = await d1(sql);
  console.log(JSON.stringify(res.results ?? res, null, 1));
}
