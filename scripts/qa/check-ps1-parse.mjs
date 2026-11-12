// Render .ps1 that tu template cua ca 2 installer, roi kiem cu phap PowerShell.
// Ghi script kiem ra file .ps1 rieng de tranh loi quoting khi truyen -Command.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CASES = [
  {
    name: 'XAGrant',
    file: 'src/routes/xa-grant-installer.js',
    args: {
      key: 'XAGR-TEST-0001-AAAA',
      base: 'https://xienhl.com',
      installDir: 'C:\\Program Files\\XArenaNoFog',
      selfUrl: 'https://xienhl.com/xg/XAGR-TEST-0001-AAAA.ps1?t=abc',
    },
  },
  {
    name: 'NoFog',
    file: 'src/routes/installer.js',
    args: {
      key: 'AOE1-TEST-0001-AAAA',
      base: 'https://xienhl.com',
      installDir: 'C:\\Program Files\\XArenaNoFog',
      selfUrl: 'https://xienhl.com/i/AOE1-TEST-0001-AAAA.ps1?t=abc',
      token: 'a'.repeat(48),
    },
  },
];

/** Cat ham buildPs1: bo qua danh sach tham so (destructuring chua '{'). */
function extractFn(src, fnName) {
  const start = src.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  let p = src.indexOf('(', start);
  let pd = 0;
  let afterParams = -1;
  for (let j = p; j < src.length; j++) {
    if (src[j] === '(') pd++;
    else if (src[j] === ')') {
      pd--;
      if (pd === 0) { afterParams = j; break; }
    }
  }
  if (afterParams < 0) return null;
  let i = src.indexOf('{', afterParams);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  return null;
}

/** Lay MOI hang so const o cap module, ke ca dang `export const`. */
function extractAllConsts(src) {
  const out = {};
  for (const m of src.matchAll(/^(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(.+?);\s*$/gm)) {
    out[m[1]] = m[2];
  }
  return out;
}

let failures = 0;

for (const c of CASES) {
  console.log(`\n===== ${c.name} (${c.file}) =====`);
  const src = readFileSync(c.file, 'utf8');
  const fnSrc = extractFn(src, 'buildPs1');
  if (!fnSrc) { console.log('  KHONG tim thay buildPs1'); failures++; continue; }

  const consts = extractAllConsts(src);
  const constsSrc = Object.entries(consts).map(([k, v]) => `const ${k} = ${v};`).join('\n');

  let body;
  try {
    const factory = new Function(`${constsSrc}\n${fnSrc}\nreturn buildPs1;`);
    const buildPs1 = factory();
    body = buildPs1(c.args);
  } catch (e) {
    console.log('  render LOI:', e.message);
    failures++;
    continue;
  }

  const ps1 = join(tmpdir(), `render-${c.name}.ps1`);
  writeFileSync(ps1, body, 'utf8');
  console.log(`  Render OK: ${body.length} ky tu, ${body.split('\n').length} dong`);
  console.log(`  File: ${ps1}`);

  // Script kiem tra viet ra FILE rieng -> khong con van de quoting
  const checker = join(tmpdir(), `checker-${c.name}.ps1`);
  writeFileSync(checker, [
    '$err = $null',
    `[void][System.Management.Automation.Language.Parser]::ParseFile('${ps1.replace(/'/g, "''")}', [ref]$null, [ref]$err)`,
    'if ($err.Count -gt 0) {',
    '  Write-Output ("PARSE_FAIL: " + $err.Count + " loi")',
    '  $err | ForEach-Object { Write-Output ("  dong " + $_.Extent.StartLineNumber + " | " + $_.Message) }',
    '} else {',
    "  Write-Output 'PARSE_OK'",
    '}',
  ].join('\n'), 'utf8');

  try {
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', checker],
      { encoding: 'utf8' });
    const txt = out.trim();
    console.log('  ' + txt.split('\n').join('\n  '));
    if (txt.includes('PARSE_FAIL')) failures++;
  } catch (e) {
    console.log('  powershell loi:', e.message);
    failures++;
  }
}

console.log('\n' + '='.repeat(50));
console.log(failures === 0 ? 'CA HAI .ps1 DEU PARSE DUOC' : `CO ${failures} TRUONG HOP LOI`);
process.exit(failures === 0 ? 0 : 1);
