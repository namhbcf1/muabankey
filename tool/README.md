# XArena No Fog — Source tool

Source của tool bán trên shop. Sửa ở đây rồi build, không cần copy qua lại.

## Cấu trúc

```
tool/
├── src/
│   ├── xa_config.py       ← SỬA MỌI THỨ Ở ĐÂY
│   ├── xa_nofog_pro.py    ← code chính (không cần sửa)
│   ├── xa_b2b.py          ← công cụ phụ
│   ├── xa_exclude.py
│   ├── xa_measure.py
│   ├── xa_probe.py
│   ├── xa_sync.py
│   └── auto_test.py
├── build.ps1              ← script build
├── dist/                  ← EXE sau khi build
└── .build/                ← file tạm của PyInstaller
```

## Sửa cấu hình

Mở `src/xa_config.py`:

```python
# Đổi server (nếu gắn tên miền khác)
API_BASE = 'https://xienhl.com'

# Đổi tên hiển thị
APP_NAME = 'XArena No Fog'

# Đổi tên process game
PROCESS_NAMES = ('EMPIRESX.EXE', 'EMPIRESX_HD.EXE', 'EMPIRESX_HDR.EXE')

# Đổi chu kỳ kiểm tra game (giây)
RESIDENT_POLL = 2.0

# Đổi khoá registry chống chỉnh đồng hồ
REG_KEY = r'Software\Microsoft\Windows\CurrentVersion\XASupport'
```

Có thể override tạm bằng biến môi trường mà không sửa file:

```powershell
$env:XA_API_BASE = "https://test.example.com"
python src\xa_nofog_pro.py --status
```

## Build EXE

```powershell
cd tool
powershell -File build.ps1
```

Script sẽ:
1. Kiểm tra Python + PyInstaller
2. Kiểm tra syntax
3. Hiện cấu hình hiện tại
4. Build EXE với `--uac-admin` (nhúng manifest yêu cầu quyền admin — chỉ hỏi UAC 1 lần, không cần registry)
5. In SHA-256 + size
6. Hỏi cập nhật vào `src/routes/installer.js`
7. Hỏi upload lên R2
8. Hỏi copy đè bản local ở `Program Files`

Build sạch: `powershell -File build.ps1 -Clean`

Bỏ qua upload: `powershell -File build.ps1 -SkipUpload`

## Chạy không cần build

```powershell
cd tool\src
python xa_nofog_pro.py --status      # xem trạng thái
python xa_nofog_pro.py --list        # liệt kê cổng
python xa_nofog_pro.py --key <KEY>   # kích hoạt
python xa_nofog_pro.py               # chạy thường trú (cần admin)
```

## Sau khi build

Phải cập nhật 2 nơi để khách nhận bản mới:

```powershell
# 1. Upload EXE
npx wrangler r2 object put "muabankey-assets/files/xa_nofog_pro.exe" `
  --file=tool\dist\xa_nofog_pro.exe --content-type="application/octet-stream" --remote

# 2. Deploy worker (installer.js chứa SHA-256 mới)
cd ..
npx wrangler deploy
```

`build.ps1` làm sẵn cả hai nếu bạn trả lời `y`.

## Lưu ý

- EXE build với `--uac-admin` → Windows hỏi UAC **chỉ khi cài**, không hỏi lại mỗi lần mở
- Installer `.cmd` vẫn set registry `RUNASADMIN` như lớp dự phòng
- SHA-256 trong `installer.js` phải khớp EXE trên R2, nếu không script cài sẽ dừng với lỗi "FILE TAI VE KHONG DUNG CHU KY"
