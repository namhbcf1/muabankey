# MuaBanKey — Nền tảng mua bán key & license

Toàn bộ hệ thống chạy trên **một Cloudflare Worker duy nhất**.

```
https://xienhl.com                          ← tên miền chính
https://muabankey.bangachieu2.workers.dev   ← dự phòng
```

---

## 1. Kiến trúc

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Worker `muabankey` | Cloudflare Workers | Toàn bộ API + phục vụ SPA + license server + installer |
| D1 `muabankey-db` | Cloudflare D1 (SQLite) | User, sản phẩm, đơn hàng, ví, license, log |
| KV `muabankey-kv` | Cloudflare KV | Rate limit |
| R2 `muabankey-assets` | Cloudflare R2 | Chứa `xa_nofog_pro.exe` (12.18 MB) |
| Workers AI | `@cf/meta/llama-3.1-8b-instruct` | Chatbot tư vấn Key Bot |

**Không còn worker riêng cho license** — API `/api/activate`, `/api/check`, `/api/rebind` nằm chung trong worker này.

### Tên miền

`xienhl.com` gắn làm **Custom Domain** của worker (không phải DNS CNAME thủ công). Cấu hình trong `wrangler.toml`:

```toml
routes = [
  { pattern = "xienhl.com", custom_domain = true }
]
```

Deploy lại để áp dụng: `npx wrangler deploy`

---

## 2. Tài khoản mặc định

| Vai trò | Đăng nhập | Mật khẩu |
|---|---|---|
| Admin | xem `ADMIN_CREDENTIALS.txt` | xem `ADMIN_CREDENTIALS.txt` |
| Demo | `demo` hoặc `demo@muabankey.vn` | xem `ADMIN_CREDENTIALS.txt` |

> Mật khẩu **không ghi vào README** (file này được commit lên git).
> Xem `ADMIN_CREDENTIALS.txt` trên máy — file đó đã nằm trong `.gitignore`.

Đăng nhập được bằng **username hoặc email** — hệ thống tự nhận diện.

⚠️ **Đổi mật khẩu ngay sau khi bàn giao** (trang Tài khoản → Đổi mật khẩu).

---

## 3. Luồng bán license (quan trọng nhất)

```
Khách chọn gói
   ↓
Thanh toán bằng ví (VietQR nạp tiền)
   ↓
Worker sinh key THẬT vào bảng `licenses`
   ↓
Trả về: key + lệnh CMD cài đặt tự động
   ↓
Khách dán lệnh vào CMD
   ↓
Script: xin admin → tải EXE → kiểm SHA-256 → ÉP RUNASADMIN
        → kích hoạt license → tạo shortcut Desktop
   ↓
Xong. Mở tool từ Desktop là chạy.
```

### Lệnh khách nhận được

```cmd
curl -L -o "%TEMP%\xa.cmd" "https://muabankey.bangachieu2.workers.dev/i/<KEY>.cmd" && "%TEMP%\xa.cmd"
```

### Các endpoint installer

| Endpoint | Mô tả |
|---|---|
| `GET /i/<KEY>.cmd` | File .cmd cá nhân hoá (chỉ trả khi key tồn tại + chưa thu hồi) |
| `GET /i/<KEY>.ps1` | Biến thể PowerShell |
| `GET /i/<KEY>` | JSON chứa lệnh copy-paste |
| `GET /download/xa_nofog_pro.exe` | Tải EXE từ R2 (hỗ trợ Range/resume) |

### Script cài đặt làm gì

1. `net session` → nếu chưa admin, tự `Start-Process -Verb RunAs`
2. Tạo `C:\Program Files\XArena\_re\chayduoc`
3. Tải EXE: thử `curl` → `WebClient` → `certutil` (3 lớp dự phòng)
4. Kiểm SHA-256: `1D9737069C01AD6BF043A694AC6656268CB9ECA0AD80CA7FC9E7FE436F229FE4`
5. **Ép RUNASADMIN** vào cả `HKCU` và `HKLM` (AppCompatFlags\Layers)
6. `xa_nofog_pro.exe --key <KEY>` → kích hoạt
7. Tạo shortcut Desktop + Start Menu
8. Tạo `go-cai-dat.cmd` để gỡ cài đặt

---

## 4. API license cho client

Giữ nguyên giao thức cũ, client không cần sửa gì ngoài `API_BASE`:

| Endpoint | Body | Trả về |
|---|---|---|
| `POST /api/activate` | `{key, hwid, app}` | `{ok, expires_at, activated_at, plan, forever, grace_hours, first_bind}` |
| `POST /api/check` | `{key, hwid, app}` | như trên (không có `first_bind` khi đã bind) |
| `POST /api/rebind` | `{key, hwid}` | `{ok, rebinds_left, expires_at}` |
| `GET /api/license/health` | — | `{ok, at, licenses, server}` |

**Quy tắc hạn dùng:** tính từ **lần kích hoạt đầu tiên** (`activated_at`), không phải lúc tạo key.

**Grace offline:** 24 giờ kể từ lần check thành công cuối.

**Ràng buộc máy:** 1 key = 1 HWID. HWID = SHA-256(`MachineGuid | BIOS serial | CPU brand | volume serial`).

---

## 5. Trang quản trị

`/#/admin` (cần đăng nhập admin)

| Tab | Chức năng |
|---|---|
| Tổng quan | Doanh thu, đơn hàng, top sản phẩm |
| Đơn hàng | Xem, giao thủ công, hoàn tiền |
| Sản phẩm | Thêm/sửa, chọn kiểu giao hàng |
| Kho key | Nhập key hàng loạt cho sản phẩm `key`/`account` |
| **License** | Quản lý license: thu hồi, reset máy, +30 ngày, tạo thủ công |
| Người dùng | Khoá/mở, điều chỉnh số dư |
| Mã giảm giá | Tạo mã % hoặc số tiền cố định |
| Cài đặt | Thông tin ngân hàng VietQR |
| Nhật ký | Audit log |

### Kiểu giao hàng của sản phẩm

| `delivery_type` | Cơ chế |
|---|---|
| `key` | Lấy từ kho `product_keys`, hết là dừng |
| `account` | Như `key`, secret = base64(`email\|password`) |
| `license` | **Sinh key động vô hạn** — không cần nhập kho |
| `manual` | Admin giao tay |

---

## 6. Nạp tiền VietQR

Thông tin ngân hàng đã cấu hình:

| | |
|---|---|
| Ngân hàng | MBBank |
| Số tài khoản | `8990124112002` |
| Chủ tài khoản | NGUYEN THANH NAM |

1. Khách vào `/#/wallet`, nhập số tiền
2. Hệ thống tạo mã `NAP<5 ký tự>` + QR vietqr.io
3. Khách chuyển khoản đúng nội dung
4. Webhook `POST /api/webhooks/sepay` xác thực bằng `Apikey <WEBHOOK_SECRET>` rồi cộng tiền

**Cần cấu hình:** trỏ webhook của SePay/Casso về
```
https://muabankey.bangachieu2.workers.dev/api/webhooks/sepay
```
với header `Authorization: Apikey <WEBHOOK_SECRET>`.

Cập nhật thông tin ngân hàng tại `/#/admin?tab=settings` nếu cần đổi.

---

## 7. Lệnh vận hành

```powershell
# Token KHÔNG ghi vào README (file này commit lên git).
# Lấy token từ: https://dash.cloudflare.com/profile/api-tokens
# Lưu vào biến môi trường máy, KHÔNG hardcode:
#   [Environment]::SetEnvironmentVariable('CLOUDFLARE_API_TOKEN','<token>','User')
#   [Environment]::SetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID','<account>','User')
#
# Hoặc set tạm trong phiên PowerShell (không lưu lịch sử):
#   $env:CLOUDFLARE_API_TOKEN = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:CLOUDFLARE_ACCOUNT_ID = $env:CLOUDFLARE_ACCOUNT_ID  # đọc từ môi trường máy

# Deploy
npx wrangler@4 deploy

# Xem log realtime
npx wrangler@4 tail muabankey

# Chạy local
npx wrangler@4 dev

# Áp schema
npx wrangler@4 d1 execute muabankey-db --remote --file=./db/schema.sql --yes
npx wrangler@4 d1 execute muabankey-db --remote --file=./db/schema-v2.sql --yes
npx wrangler@4 d1 execute muabankey-db --remote --file=./db/schema-license-server.sql --yes

# Cập nhật EXE lên R2 (sau khi build lại)
npx wrangler@4 r2 object put "muabankey-assets/files/xa_nofog_pro.exe" `
  --file="C:\Program Files\XArena\_re\chayduoc\xa_nofog_pro.exe" `
  --content-type="application/octet-stream" --remote
```

---

## 8. Kiểm thử

```powershell
# 57 test lõi (auth, catalog, order, ví, admin, bảo mật)
node scripts/e2e.mjs https://muabankey.bangachieu2.workers.dev

# 45 test license (mua → sinh key → client kích hoạt → admin)
$env:WEBHOOK_SECRET=(Get-Content .webhook-secret.txt -Raw).Trim()
node scripts/e2e-license.mjs
```

Kết quả hiện tại: **57/57 + 45/45 = 102/102 PASS**.

---

## 9. Bảo mật đã áp dụng

- Mật khẩu: PBKDF2-SHA256, **100.000 vòng** (giới hạn tối đa của Workers)
- Session: cookie `HttpOnly; Secure; SameSite=Lax`, TTL 30 ngày
- Rate limit: KV-based (đăng ký 20/h, đăng nhập 30/15p, toàn cục 300/phút)
- SQL: 100% prepared statement, không nối chuỗi
- XSS: escape toàn bộ output qua `esc()`
- Webhook: so sánh timing-safe
- CORS: chỉ same-origin
- Audit log mọi thao tác admin

---

## 10. Cấu trúc thư mục

```
muabankey/
├── wrangler.toml          # Cấu hình worker + bindings
├── src/
│   ├── index.js           # Entry + router + installer routes
│   ├── lib/               # crypto, http, auth, ratelimit, validate, router
│   └── routes/
│       ├── auth.js        # Đăng ký/đăng nhập/hồ sơ
│       ├── products.js    # Danh mục, sản phẩm, kho key
│       ├── orders.js      # Đơn hàng + giao key/license
│       ├── wallet.js      # Ví, VietQR, webhook
│       ├── admin.js       # Dashboard, users, coupons, settings
│       ├── ai.js          # Chatbot Workers AI
│       ├── license.js     # Cấp/quản lý license
│       ├── license-server.js  # API cho client XArena
│       └── installer.js   # Sinh .cmd/.ps1 + phục vụ EXE
├── public/                # SPA (index.html + assets/)
│   ├── assets/pages/      # home, products, product-detail, auth,
│   │                      # checkout, account, orders, wallet,
│   │                      # licenses, support, admin
│   └── img/               # 19 SVG sản phẩm
├── db/                    # Schema + seed SQL
└── scripts/               # e2e test, build helpers, screenshots
```

---

## 11. Việc cần làm trước khi chạy thật

- [x] Cấu hình thông tin ngân hàng MBBank `8990124112002`
- [x] Đổi tài khoản admin sang `namhbcf`
- [x] Khởi tạo git repo
- [ ] Đăng ký SePay/Casso → trỏ webhook về `/api/webhooks/sepay`
- [ ] Cập nhật link Telegram/Zalo ở footer (`public/assets/components.js`)
- [ ] (Tùy chọn) Gắn tên miền riêng: Cloudflare Dashboard → Workers → muabankey → Custom Domain
- [ ] (Tùy chọn) Bật Cloudflare WAF + Bot Fight Mode cho tên miền

## 12. Git

```powershell
git log --oneline          # xem lịch sử
git status                 # trạng thái
git add -A; git commit -m "..."   # commit thay đổi
```

Secrets đã được `.gitignore` chặn: `ADMIN_CREDENTIALS.txt`, `.webhook-secret.txt`, `.env`, `*.pem`.

---

## 12. Nếu cần build lại EXE

Sau khi sửa `xa_nofog_pro.py` (đổi `API_BASE` chẳng hạn):

```powershell
cd "C:\Program Files\XArena\_re\chayduoc"
python -m PyInstaller --onefile --name xa_nofog_pro `
  --distpath ".\_build_dist" --workpath ".\_build_work" `
  --specpath ".\_build_spec" --noconfirm xa_nofog_pro.py

# Lấy SHA-256 + size mới
$exe = ".\_build_dist\xa_nofog_pro.exe"
(Get-FileHash $exe -Algorithm SHA256).Hash
(Get-Item $exe).Length
```

Rồi cập nhật 2 hằng số trong `src/routes/installer.js`:

```js
const EXE_SHA256 = '<hash mới>';
const EXE_SIZE = <size mới>;
```

Cuối cùng upload R2 + deploy.
