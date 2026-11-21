# MuaBanKey — Release Checklist

## Release gates

- [ ] `git status` sạch, commit đã tạo.
- [ ] `npm run verify` pass.
- [ ] Migration đã chạy trên staging.
- [ ] Web E2E staging pass, không gọi production.
- [ ] APP_VERSION tăng so với manifest stable trước.
- [ ] Build EXE có version resource.
- [ ] EXE Authenticode hợp lệ + timestamp.
- [ ] SHA-256/size tính sau khi ký.
- [ ] `release/manifest.json` verify khớp bytes.
- [ ] Canary tải/cập nhật thành công.
- [ ] Backup trước deploy.
- [ ] Rollback manifest đã chuẩn bị.

## Build

```powershell
powershell -ExecutionPolicy Bypass -File tool/build-arena.ps1
node tool/release.mjs --verify release/manifest.json --exe tool/dist-arena/xa_arena.exe
```

Không dùng lại các route cũ `/api/install-info`, `/api/setup/version`, `xa_setup.exe` cho bản app hiện hành. Server đọc manifest qua `RELEASE_MANIFEST`; nếu thiếu manifest phải hiện `verified:false`, không bịa hash.

## Promote

1. Upload `xa_arena.exe` vào R2.
2. Kiểm tra tải Range và `X-Release-Sha256`.
3. Set `RELEASE_MANIFEST` trên Worker.
4. Deploy Worker.
5. Smoke `/api/app/version`, `/download/xa_arena.exe`.
6. Canary rồi mới stable.
