// Kiểm tra bộ lọc token của installer.
const ok = (t) => /^[0-9a-f]{48}$/.test(t);
const cases = [
  ['token hợp lệ 48 hex', 'a'.repeat(48), true],
  ['token thật randomHex(24)', '0782348cd37d16ab9bdfbec3172518dbc74ab13d2098569f', true],
  ['token chứa xuống dòng (injection)', 'x\n echo PWNED\n"', false],
  ['token có khoảng trắng', 'a'.repeat(47) + ' ', false],
  ['token rỗng', '', false],
  ['token quá ngắn', 'abc', false],
  ['token chữ hoa', 'A'.repeat(48), false],
  ['token có ký tự lạ', 'a'.repeat(46) + '";', false],
];
let pass = 0;
for (const [name, input, expect] of cases) {
  const got = ok(input);
  const good = got === expect;
  console.log(`${good ? '✓' : '✗'} ${name.padEnd(36)} -> ${got}`);
  if (good) pass++;
}
console.log(`\n${pass}/${cases.length} pass`);
process.exit(pass === cases.length ? 0 : 1);
