/**
 * XÃC NHáº¬N luá»“ng Ä‘á»•i mÃ¡y Má»šI (Ä‘Ã£ cÃ³ token) hoáº¡t Ä‘á»™ng Ä‘Ãºng:
 *   1. license Ä‘Ã£ bind, hwid=NULL sau admin reset
 *   2. mÃ¡y CÅ¨  /api/check KHÃ”NG token  -> bá»‹ cháº·n rebind_token_required
 *   3. mÃ¡y Má»šI /api/check CÃ“ token     -> bind OK, hwid ghi vÃ o DB
 *   4. token bá»‹ tiÃªu (dÃ¹ng láº¡i pháº£i há»ng)
 *   5. háº¡n dÃ¹ng KHÃ”NG bá»‹ cá»™ng thÃªm
 */
import { apiActivate, apiCheck } from '../src/routes/license-server.js';

function makeDB(licenses, tokens = []) {
  const db = { licenses, tokens };
  db.prepare = (sql) => {
    const st = { sql, args: [] };
    st.bind = (...a) => { st.args = a; return st; };
    st.first = async () => {
      if (/FROM licenses WHERE key = \?/.test(sql)) return licenses.find((l) => l.key === st.args[0]) || null;
      if (/FROM rebind_tokens WHERE token_hash = \?/.test(sql)) return tokens.find((t) => t.token_hash === st.args[0]) || null;
      if (/COUNT\(\*\) AS n FROM lic_attempts/.test(sql)) return { n: 0 };
      return null;
    };
    st.run = async () => {
      if (/^UPDATE licenses SET hwid = \?, last_seen/.test(sql.trim())) {
        // bind(hwid, now, ip, key) -> key á»Ÿ args[3], rebinds luÃ´n +1
        const l = licenses.find((x) => x.key === st.args[3]);
        if (l) {
          l.hwid = st.args[0];
          l.last_seen = st.args[1];
          if (/rebinds = COALESCE/.test(sql)) {
            l.rebinds = (Number(l.rebinds) || 0) + 1;
            l.reset_pending = 0;
            l.reset_at = null;
          }
        }
      } else if (/^UPDATE licenses SET hwid = \?, activated_at/.test(sql.trim())) {
        const l = licenses.find((x) => x.key === st.args[5]);
        if (l) { l.hwid = st.args[0]; l.activated_at = st.args[1]; l.expires_at = st.args[2]; }
      }
      if (/UPDATE rebind_tokens SET used = 1/.test(sql)) {
        const t = tokens.find((x) => x.token_hash === st.args[0]);
        if (t) t.used = 1;
      }
      return { meta: { changes: 1 } };
    };
    st.all = async () => ({ results: [] });
    return st;
  };
  db.batch = async () => [];
  return db;
}

function mkReq(body) {
  return {
    headers: { get: (k) => (k.toLowerCase() === 'cf-connecting-ip' ? '1.2.3.4' : null) },
    text: async () => JSON.stringify(body),
    url: 'https://x.test/api/check',
  };
}

const sha256hex = async (t) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))),
    (b) => b.toString(16).padStart(2, '0')).join('');

const now = Math.floor(Date.now() / 1000);
const KEY = 'TEST-KEY-0002';
const TOKEN = 'abc123';           // token thÃ´ client gá»­i
const TH = await sha256hex(TOKEN); // hash lÆ°u DB

function freshLic() {
  return {
    key: KEY, hwid: null, plan: 'aoe1',
    created_at: now - 40 * 86400,     // táº¡o 40 ngÃ y trÆ°á»›c
    activated_at: now - 10 * 86400,   // kÃ­ch hoáº¡t 10 ngÃ y trÆ°á»›c
    expires_at: now + 20 * 86400,     // cÃ²n 20 ngÃ y
    revoked: 0, max_rebind: 1, rebinds: 0, last_seen: null, last_ip: null,
  };
}
function freshTokens() {
  return [{ token_hash: TH, key: KEY, user_id: 'u1', created_at: now, expires_at: now + 1800, used: 0 }];
}

async function run(label, { lic, tokens, body, fn }) {
  const db = makeDB([lic], tokens);
  const env = { DB: db, CACHE: { get: async () => null, put: async () => {} } };
  const res = await fn(env, mkReq(body));
  const d = await res.json();
  console.log(`\nâ”€â”€ ${label}`);
  console.log(`   HTTP ${res.status}  ok=${d.ok}  code=${d.code || '-'}  first_bind=${d.first_bind}  rebound=${d.rebound}`);
  console.log(`   DB hwid = ${lic.hwid === null ? 'NULL' : lic.hwid}   rebinds=${lic.rebinds}`);
  console.log(`   DB expires_at = ${lic.expires_at}  (${new Date(lic.expires_at * 1000).toISOString().slice(0, 10)})`);
  console.log(`   Token used = ${tokens[0].used}`);
  return { res, d, lic, tokens };
}

console.log('â•â•â•â•â•â•â•â• KIá»‚M CHá»¨NG LUá»’NG Äá»”I MÃY (báº£n Ä‘Ã£ sá»­a) â•â•â•â•â•â•â•â•');

let lic = freshLic(); let tokens = freshTokens();
const E0 = lic.expires_at;

const a = await run('A. MÃ¡y CÅ¨ /api/check â€” KHÃ”NG token (pháº£i bá»‹ cháº·n)', {
  lic, tokens, fn: apiCheck, body: { key: KEY, hwid: 'o'.repeat(32) },
});

lic = freshLic(); tokens = freshTokens();
const b = await run('B. MÃ¡y Má»šI /api/check â€” CÃ“ token (pháº£i bind Ä‘Æ°á»£c)', {
  lic, tokens, fn: apiCheck, body: { key: KEY, hwid: 'n'.repeat(32), token: TOKEN },
});

// dÃ¹ng láº¡i token
const c = await run('C. MÃ¡y THá»¨ BA dÃ¹ng Láº I token cÅ© (pháº£i bá»‹ cháº·n)', {
  lic, tokens, fn: apiCheck, body: { key: KEY, hwid: 'z'.repeat(32), token: TOKEN },
});

lic = freshLic(); tokens = freshTokens();
const d2 = await run('D. /api/activate mÃ¡y má»›i CÃ“ token (Ä‘Æ°á»ng installer)', {
  lic, tokens, fn: apiActivate, body: { key: KEY, hwid: 'n'.repeat(32), token: TOKEN },
});

console.log('\nâ•â•â•â•â•â•â•â• Káº¾T LUáº¬N â•â•â•â•â•â•â•â•');
const ok = [];
ok.push(['MÃ¡y cÅ© bá»‹ cháº·n', a.d.ok === false && a.d.code === 'rebind_token_required']);
ok.push(['MÃ¡y cÅ© KHÃ”NG giÃ nh Ä‘Æ°á»£c key', a.lic.hwid === null]);
ok.push(['MÃ¡y má»›i bind thÃ nh cÃ´ng', b.d.ok === true]);
ok.push(['hwid Ä‘Ã£ ghi vÃ o DB', b.lic.hwid === 'n'.repeat(32)]);
ok.push(['rebinds tÄƒng', b.lic.rebinds === 1]);
ok.push(['Token bá»‹ tiÃªu', b.tokens[0].used === 1]);
ok.push(['DÃ¹ng láº¡i token bá»‹ cháº·n', c.d.ok === false && (['invalid_token','token_used','hwid_mismatch'].includes(c.d.code))]);
ok.push(['Háº¡n KHÃ”NG bá»‹ cá»™ng thÃªm (A)', a.lic.expires_at === E0]);
ok.push(['Háº¡n KHÃ”NG bá»‹ cá»™ng thÃªm (B)', b.lic.expires_at === E0]);
ok.push(['activate + token cÅ©ng cháº¡y', d2.d.ok === true]);

for (const [n, v] of ok) console.log(`  ${v ? 'âœ…' : 'âŒ'} ${n}`);
const bad = ok.filter(([, v]) => !v);
console.log(`\n  ${ok.length - bad.length}/${ok.length} Ä‘áº¡t`);
if (bad.length) {
  console.log('  Lá»—i:', bad.map(([n]) => n).join(', '));
  // in chi tiáº¿t Ä‘á»ƒ debug
  console.log('\n  Debug A:', JSON.stringify(a.d));
  console.log('  Debug B:', JSON.stringify(b.d));
  console.log('  Debug C:', JSON.stringify(c.d));
  console.log('  Debug D:', JSON.stringify(d2.d));
}
