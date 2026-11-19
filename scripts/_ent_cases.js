import { featureKeysFor, shapeEntitlement, unionFeatures } from '__URL__';

let ok = 0, fail = 0;
function chk(name, cond, extra) {
  if (cond) { ok++; console.log('  PASS  ' + name.padEnd(44) + (extra || '')); }
  else { fail++; console.log('  FAIL  ' + name.padEnd(44) + (extra || '')); }
}

console.log('=== featureKeysFor ===');
chk('pid=xagrant -> grant',
    JSON.stringify(featureKeysFor({ pid: 'xagrant' })) === '["grant"]',
    JSON.stringify(featureKeysFor({ pid: 'xagrant' })));
chk('pid null -> nofog',
    JSON.stringify(featureKeysFor({ pid: null })) === '["nofog"]',
    JSON.stringify(featureKeysFor({ pid: null })));
chk('pid rong -> nofog',
    JSON.stringify(featureKeysFor({ pid: '' })) === '["nofog"]',
    JSON.stringify(featureKeysFor({ pid: '' })));
chk('pid=aoe1 -> nofog',
    JSON.stringify(featureKeysFor({ pid: 'aoe1' })) === '["nofog"]',
    JSON.stringify(featureKeysFor({ pid: 'aoe1' })));
chk('pid la -> KHONG quyen',
    JSON.stringify(featureKeysFor({ pid: 'xyz-la' })) === '[]',
    JSON.stringify(featureKeysFor({ pid: 'xyz-la' })));
chk('lic null -> KHONG quyen',
    JSON.stringify(featureKeysFor(null)) === '[]');
chk('pid XAGRANT hoa -> grant',
    JSON.stringify(featureKeysFor({ pid: 'XAGRANT' })) === '["grant"]',
    JSON.stringify(featureKeysFor({ pid: 'XAGRANT' })));

console.log('');
console.log('=== shapeEntitlement ===');
const now = 1000000;
const a = shapeEntitlement({ key: 'K', pid: 'xagrant', expires_at: 0 }, now);
chk('expires_at 0 -> forever', a.forever === true);
chk('forever -> active', a.active === true);
chk('hasGrant true', a.hasGrant === true);
chk('hasNofog false', a.hasNofog === false);
chk('hwid null -> hwid_bound false', a.hwid_bound === false);

const b = shapeEntitlement({ key: 'K2', pid: null, expires_at: now - 10 }, now);
chk('het han -> active false', b.active === false);
chk('het han van co features', b.features.length === 1,
    JSON.stringify(b.features));

const c = shapeEntitlement(
    { key: 'K3', pid: 'xagrant', expires_at: 0, revoked: 1 }, now);
chk('revoked -> active false', c.active === false);

console.log('');
console.log('=== unionFeatures ===');
const v1 = shapeEntitlement({ key: 'A', pid: 'xagrant', expires_at: 0 }, now);
const v2 = shapeEntitlement({ key: 'B', pid: null, expires_at: 0 }, now);
chk('2 license -> ca 2 quyen',
    JSON.stringify(unionFeatures([v1, v2]).features) === '["grant","nofog"]',
    JSON.stringify(unionFeatures([v1, v2]).features));
chk('1 license grant -> chi grant',
    JSON.stringify(unionFeatures([v1]).features) === '["grant"]',
    JSON.stringify(unionFeatures([v1]).features));
const expired = shapeEntitlement(
    { key: 'C', pid: null, expires_at: now - 10 }, now);
chk('license het han -> khong quyen',
    JSON.stringify(unionFeatures([expired]).features) === '[]',
    JSON.stringify(unionFeatures([expired]).features));

console.log('');
console.log('Tong: ' + (ok + fail) + ' | PASS ' + ok + ' | FAIL ' + fail);
process.exit(fail === 0 ? 0 : 1);
