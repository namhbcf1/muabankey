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
| R2 `muabankey-assets` | Cloudflare R2 | Chứa **duy nhất** `xa_arena.exe` |
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

> **KHÔNG CÒN KEY.** Mọi thứ đi theo **TÀI KHOẢN**.
>
> - Khách đăng ký trên web **hoặc ngay trong app** (chỉ cần tên + mật khẩu)
> - Tài khoản mới: **dùng thử 1 NGÀY**, bật **cả map sáng và tài nguyên**
> - Đồng hồ tính từ **lần đầu mở app**, không phải lúc đăng ký
> - Mua trên web → quyền **cộng thẳng vào tài khoản**, app tự nhận khi mở
> - Khách không bao giờ thấy, giữ hay gõ một "key" nào

```
Khách mở app
   ↓
Chưa đăng nhập → BẮT BUỘC đăng nhập / tạo tài khoản (ngay trong app)
   ↓
Tài khoản mới → tự nhận 1 NGÀY dùng thử (cả 2 tính năng)
   ↓
Hết hạn → app chỉ còn nút "Mua"
   ↓
Mua trên web → quyền cộng vào tài khoản
   ↓
Mở app → tự nhận quyền, không thao tác gì
```

### Bảng quyết định quyền

| Nguồn | Tính năng | Bảng dữ liệu |
|---|---|---|
| Dùng thử 1 ngày | `nofog` + `grant` | `account_entitlements` (source=`trial`) |
| Mua gói XARENA | `nofog` | `account_entitlements` (source=`purchase`) |
| Mua gói XA THÊM TÀI NGUYÊN | `grant` | `account_entitlements` (source=`purchase`) |
| Admin cấp tay | tuỳ | `account_entitlements` (source=`admin`) |

### Các endpoint phát hành

| Endpoint | Mô tả |
|---|---|
| `GET /download/xa_arena.exe` | Tải EXE duy nhất từ R2 (hỗ trợ Range/resume) |
| `GET /download/xa_setup.exe` | Đường dẫn CŨ — trỏ về cùng `xa_arena.exe` |
| `GET /api/app/version` | Version + SHA-256 + size + URL của bản phát hành |
| `POST /api/trial/session` | Bắt đầu/tiếp tục lượt dùng thử 1 ngày |
| `GET /api/trial/session` | Xem trạng thái dùng thử (không chạy đồng hồ) |
| `POST /api/account/token` | Cấp token theo quyền tài khoản (đã mua) |
| `GET /api/entitlement` | Quyền + hạn từng tính năng + trạng thái dùng thử |

> Các route cũ `/i/<KEY>.cmd|.ps1`, `/xg/<KEY>.cmd|.ps1`,
> `/api/install-info`, `/api/setup/version` **đã bỏ** và trả `410` kèm
> hướng dẫn tải bản mới.

### App tự cập nhật

1. Mở app → gọi `/api/app/version`
2. Server mới hơn → tải EXE mới + kiểm SHA-256 + thay file + khởi động lại
3. Không gọi được server → **vẫn chạy** (không chặn khách khi mất mạng)

**Không có nút "Bỏ qua".** Vì vậy mỗi lần build **phải tăng version** ở
cả `tool/app/xa_arena_app.py` và `src/routes/arena-installer.js`.

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
| Số tài khoản | `0010131639304` |
| Chủ tài khoản | NGUYEN THANH NAM |

> Số tài khoản lấy từ bảng `settings` (`bank_account`) trên D1, đây là nguồn
> duy nhất đúng — QR sinh ra từ đó. Đổi TK thì sửa `/#/admin?tab=settings`,
> đừng chỉ sửa tài liệu.

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

# Áp schema (file duy nhất, đã là toàn bộ cấu trúc hiện hành)
npx wrangler@4 d1 execute muabankey-db --remote --file=./db/schema.sql --yes

# Cập nhật EXE lên R2 (sau khi build lại) — CHỈ CÓ MỘT FILE
npx wrangler@4 r2 object put "muabankey-assets/files/xa_arena.exe" `
  --file="tool\dist-arena\xa_arena.exe" `
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
│   ├── index.js           # Entry + router
│   ├── lib/               # crypto, http, auth, ratelimit, validate, router
│   └── routes/
│       ├── auth.js        # Đăng ký/đăng nhập/hồ sơ
│       ├── products.js    # Danh mục, sản phẩm, kho key
│       ├── orders.js      # Đơn hàng + giao key/license
│       ├── wallet.js      # Ví, VietQR, webhook
│       ├── admin.js       # Dashboard, users, coupons, settings
│       ├── ai.js          # Chatbot Workers AI
│       ├── license.js     # Cấp/quản lý license
│       ├── license-server.js   # API cho client XA ARENA
│       ├── arena-installer.js  # Phát hành xa_arena.exe (DUY NHẤT)
│       ├── entitlement.js      # Quyền chức năng theo license
│       └── app-info.js         # /api/app/version
├── public/                # SPA (index.html + assets/)
│   ├── assets/pages/      # home, products, product-detail, auth,
│   │                      # checkout, account, orders, wallet,
│   │                      # licenses, support, admin
│   └── img/               # 19 SVG sản phẩm
├── tool/                  # Source app XA ARENA (Python + PyQt6)
│   ├── app/               # xa_arena_app/api/gui, trial_rules
│   ├── grant/             # engine cộng tài nguyên
│   ├── src/               # xa_nofog_pro (engine bỏ sương mù)
│   ├── ui/                # theme + update
│   └── dist-arena/        # xa_arena.exe sau khi build
├── db/                    # Schema + seed SQL
└── scripts/               # e2e test, build helpers, screenshots
```

---

## 11. Việc cần làm trước khi chạy thật

- [x] Cấu hình thông tin ngân hàng MBBank `0010131639304`
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

Secrets đã được `.gitignore` chặn: `secrets/`, `keys/`, `ADMIN_CREDENTIALS.txt`,
`WEBHOOK_SECRET.txt`, `.env`, `.dev.vars`, `.key-enc.txt`, `*.pem`.

Repo GitHub (private): https://github.com/namhbcf1/muabankey

---

## 13. Build lại EXE

Chỉ có **một** app: `tool/app/xa_arena_app.py` (gộp cả map sáng + tài nguyên).

```powershell
cd tool\app
python -m PyInstaller --onefile --windowed --name xa_arena `
  --distpath "..\dist-arena" --workpath "..\.build-arena" `
  --specpath "..\.build-arena" --noconfirm xa_arena_app.py

# Lấy SHA-256 + size mới
$exe = "..\dist-arena\xa_arena.exe"
(Get-FileHash $exe -Algorithm SHA256).Hash
(Get-Item $exe).Length
```

Rồi cập nhật **3 hằng số** trong `src/routes/arena-installer.js`:

```js
export const EXE_VERSION = '<version mới>';   // PHẢI khớp APP_VERSION trong app
export const EXE_SHA256  = '<hash mới>';
export const EXE_SIZE    = <size mới>;
```

Cuối cùng upload R2 + deploy:

```powershell
npx wrangler@4 r2 object put "muabankey-assets/files/xa_arena.exe" `
  --file="tool\dist-arena\xa_arena.exe" `
  --content-type="application/octet-stream" --remote
npx wrangler@4 deploy
```

> ⚠️ **Quên tăng version = không ai nhận được bản mới** (app ép cập nhật
> bằng cách so version, không so hash).
