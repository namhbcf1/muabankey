import { readFileSync, writeFileSync } from 'node:fs';

const OLD = "process.env.ADMIN_PASSWORD || '5PVK7D2dLr2a6m9d'";
const NEW = "process.env.ADMIN_PASSWORD || 'namhbcf123'";

for (const f of ['scripts/e2e.mjs', 'scripts/e2e-license.mjs', 'scripts/e2e-business.mjs']) {
  let c = readFileSync(f, 'utf8');
  const had = c.includes(OLD);
  if (had) {
    c = c.split(OLD).join(NEW);
    writeFileSync(f, c, 'utf8');
    console.log('✓', f);
  } else if (c.includes('namhbcf123')) {
    console.log('  đã đúng:', f);
  } else {
    console.log('⚠️  không tìm thấy pattern:', f);
  }
}
