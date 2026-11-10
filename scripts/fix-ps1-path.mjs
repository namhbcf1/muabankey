/**
 * Sửa lỗi uninstaller PS1: đường dẫn bị mất backslash do here-string single-quote
 * trong template literal. Dùng forward slash (PowerShell chấp nhận cả hai).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const f = 'src/routes/installer.js';
let c = readFileSync(f, 'utf8');

const before = c.includes('Microsoft\\Windows\\Start Menu\\Programs\\XArena No Fog.lnk');
console.log('Tìm thấy dòng lỗi (backslash đơn):', before);

// Trong here-string single-quote của PowerShell, `\W` bị PowerShell hiểu là escape
// -> dùng '/' để an toàn
c = c.replace(
  "(Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\XArena No Fog.lnk')",
  "(Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/XArena No Fog.lnk')"
);
c = c.replace(
  "(Join-Path $env:LOCALAPPDATA 'XArenaNoFog\\lic.bin')",
  "(Join-Path $env:LOCALAPPDATA 'XArenaNoFog/lic.bin')"
);

writeFileSync(f, c, 'utf8');

// Xác minh
const after = readFileSync(f, 'utf8');
let bad = 0;
for (const pattern of ['MicrosoftWindows', "XArenaNoFoglic"]) {
  const n = after.split(pattern).length - 1;
  if (n) { console.log(`  ✗ còn ${n} chỗ "${pattern}"`); bad++; }
}
if (!bad) console.log('✓ Không còn đường dẫn bị hỏng');
