const T = (await import('../src/routes/license-server.js')).__test;
const { readFileSync, writeFileSync } = await import('node:fs');
const jwk = JSON.parse(readFileSync('secrets/xn-sign-jwk.json', 'utf8'));
const t = await T.buildToken({ XN_SIGN_JWK: JSON.stringify(jwk) },
  { plan: 'aoe1', expires_at: 1893456000 }, 'AOE1-TEST-KEY-0001', 'a'.repeat(32));
writeFileSync('_scratch/token.txt', t.token, 'utf8');
console.log('gate', t.gate_hex);
console.log('len', t.token.length);
