# -*- coding: utf-8 -*-
"""Sửa Read-Host trong buildPs1 -> dùng hàm Halt an toàn."""
from pathlib import Path

f = Path(__file__).resolve().parent.parent / 'src' / 'routes' / 'installer.js'
s = f.read_text(encoding='utf-8')

# 1. Thêm hàm Halt sau hàm Warn
old_fn = "function Warn($m) { Write-Host \"  [!] $m\" -ForegroundColor Yellow }"
new_fn = old_fn + """
# Read-Host crash khi PowerShell chay o che do NonInteractive (irm | iex,
# hoac -NonInteractive). Halt() chi hoi khi that su co console.
function Halt([int]$code, [string]$msg) {
  if ($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
  try {
    if (-not [Console]::IsInputRedirected) {
      Write-Host ''
      Read-Host 'Nhan Enter de thoat' | Out-Null
    }
  } catch { }
  exit $code
}"""

if old_fn in s:
    s = s.replace(old_fn, new_fn, 1)
    print('OK them ham Halt')
else:
    print('KHONG thay anchor ham Warn')

# 2. Thay các Read-Host ... exit
repls = [
    ("    Warn 'Khong chuan bi duoc bo cai dat. Kiem tra mang roi chay lai.'\n    Read-Host 'Nhan Enter de thoat'\n    exit 6",
     "    Halt 6 'Khong chuan bi duoc bo cai dat. Kiem tra mang roi chay lai.'"),
    ("    Warn 'Khong lay duoc quyen admin.'\n    Warn 'Cach khac: chuot phai file .ps1 -> Run with PowerShell (as admin).'\n    Read-Host 'Nhan Enter de thoat'\n    exit 5",
     "    Halt 5 'Khong lay duoc quyen admin. Chuot phai file .ps1 -> Run as administrator.'"),
    ("    Warn 'Khong tai duoc bo xu ly (hoac file bi thieu). Kiem tra mang roi chay lai.'\n    Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue\n    Read-Host 'Nhan Enter de thoat'\n    exit 7",
     "    Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue\n    Halt 7 'Khong tai duoc bo xu ly. Kiem tra mang roi chay lai.'"),
    ("    Warn 'FILE TAI VE KHONG DUNG CHU KY. Da huy cai dat.'\n    Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue\n    Read-Host 'Nhan Enter de thoat'\n    exit 9",
     "    Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue\n    Halt 9 'FILE TAI VE KHONG DUNG CHU KY. Da huy cai dat.'"),
    ("  Remove-Item -Force -LiteralPath (Join-Path $env:LOCALAPPDATA 'XArenaNoFog/lic.bin') -ErrorAction SilentlyContinue\n  Read-Host 'Nhan Enter de thoat'\n  exit 10",
     "  Remove-Item -Force -LiteralPath (Join-Path $env:LOCALAPPDATA 'XArenaNoFog/lic.bin') -ErrorAction SilentlyContinue\n  Halt 10 \"KICH HOAT THAT BAI (ma $LASTEXITCODE). Kiem tra key tren website.\""),
]

n = 0
for old, new in repls:
    if old in s:
        s = s.replace(old, new, 1)
        n += 1
print(f'OK thay {n}/{len(repls)} khoi Read-Host')

# 3. Cuoi script: Read-Host 'Nhan Enter de dong' -> Halt 0
s = s.replace("Read-Host 'Nhan Enter de dong'", "try { if (-not [Console]::IsInputRedirected) { Read-Host 'Nhan Enter de dong' | Out-Null } } catch { }")
s = s.replace("Read-Host 'Nhan Enter'\n", "try { if (-not [Console]::IsInputRedirected) { Read-Host 'Nhan Enter' | Out-Null } } catch { }\n")

f.write_text(s, encoding='utf-8')

final = f.read_text(encoding='utf-8')
print('')
print('Co ham Halt        :', 'function Halt(' in final)
print('So Read-Host con lai:', final.count('Read-Host'))
