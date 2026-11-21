# BÁO CÁO RÀ SOÁT — CÁI NÀO DÙNG, CÁI NÀO KHÔNG DÙNG

> Ngày rà soát: 2026-11-20
> Phạm vi: `src/`, `public/`, `tool/`, `db/`, và tài nguyên thật trên Cloudflare
> (D1 `muabankey-db`, KV `muabankey-kv`, R2 `muabankey-assets`, Worker `muabankey`)

**Phương pháp:** đối chiếu 3 chiều
1. Code server (`src/`) — route nào được đăng ký, hàm nào được export
2. Client thật — `public/` (web) và `tool/` (app XA ARENA) gọi những gì
3. Tài nguyên thật — số dòng từng bảng D1, số object R2, key KV

**Chưa xoá gì.** Đây là danh sách chờ bạn duyệt.

---

## TÓM TẮT NHANH

| Hạng mục | Dùng | Không dùng | Ghi chú |
|---|---|---|---|
| Route API | 74 | **19** | 1 route còn bị đăng ký 2 lần |
| Hàm export | ~90 | **11** | trong đó 2 webhook trùng lặp |
| Bảng D1 | 31 | **5** | 3 bảng rỗng + không có đường ghi |
| Danh mục | 1 | **6** | 6 danh mục 0 sản phẩm |
| Ảnh SVG | 2 | **19** | chỉ 2 ảnh license được dùng |
| File tool/ | 11 | **4** | bộ cài `xa_setup` đã bỏ |
| File SQL | 3 | **49** | migration một lần, đã chạy rồi |

---

## 1. ROUTE API KHÔNG AI GỌI (19 route)

Đã kiểm tra cả 3 nguồn gọi: `public/` (web), `tool/` (app), `scripts/` (test).

### 1.1 Nhóm "ví / nạp tiền" — cả hệ thống đã bỏ

| Route | Bằng chứng |
|---|---|
| `POST /api/coupons/check` | `checkout.js` ghi rõ *"Trang KHÔNG còn: ... mã giảm giá"* |
| `GET /api/admin/coupons` | Không có tab mã giảm giá trong `admin.js` |
| `POST /api/admin/coupons` | 〃 |
| `DELETE /api/admin/coupons/:id` | 〃 |
| `GET /api/admin/topups` | Tab "Chờ thanh toán" gọi `/api/admin/payments`, không gọi topups |
| `POST /api/admin/topups/:id/approve` | 〃 |
| `POST /api/admin/topups/:id/reject` | 〃 |
| `POST /api/admin/wallet/adjust` | Không có trong `admin.js` (comment cũ nói frontend gọi — **sai**, đã kiểm lại) |

> ⚠️ **Hệ quả:** `wallet.createTopup` không được đăng ký route nào ⇒ **không còn đường tạo lệnh nạp mới**. Bảng `topups` (65 dòng) chỉ còn là dữ liệu lịch sử.

### 1.2 Nhóm "đối soát SePay" — không có giao diện

| Route | Ghi chú |
|---|---|
| `GET /api/admin/sepay/reconcile` | Chỉ dùng tay qua curl; không có nút nào trong admin |
| `POST /api/admin/sepay/sync` | 〃 |
| `GET /api/admin/sepay/quota` | 〃 |

### 1.3 Nhóm "dùng thử" — 3 route mồ côi

| Route | Ghi chú |
|---|---|
| `GET /api/admin/trial/resets` | Không có UI |
| `POST /api/admin/trial/grant` | Không có UI |
| `POST /api/admin/trial/ban` | Không có UI |

> `GET /api/admin/trial/uses` **đang dùng** (admin.js:1209) — giữ lại.

### 1.4 Nhóm XAGrant — app không gọi

| Route | App | Script test |
|---|---|---|
| `POST /api/xg/activate` | ✅ 7 chỗ | ✅ |
| `POST /api/xg/check` | ✅ 7 chỗ | ✅ |
| `POST /api/xg/violation` | ✅ 1 chỗ | ✅ |
| `POST /api/xg/heartbeat` | ❌ **0** | ✅ 5 |
| `POST /api/xg/rebind` | ❌ **0** | ❌ **0** |
| `GET /api/xg/health` | ❌ **0** | ✅ 1 |

> `xg/rebind` không ai gọi ở bất kỳ đâu. `xg/heartbeat` chỉ test gọi.

### 1.5 Route lẻ

| Route | Bằng chứng |
|---|---|
| `GET /api/home` | `home.js` gọi `/api/stats`, `/api/products/featured`, `/api/trial/status` — **không** gọi `/api/home`. Bundle 12 câu SQL không ai dùng |
| `POST /api/orders/:id/claimed` | Không file nào gọi |
| `GET /api/shop/lic` | App đọc file `shop.lic` cục bộ, không tải từ server |
| `POST /api/shop/lic` | 〃 |
| `POST /api/admin/migrate-delivered-keys` | Migration một lần, đã chạy xong |

### 1.6 Route bị đăng ký TRÙNG 2 LẦN

```js
// src/index.js:150
r.post('/api/admin/orders/:id/confirm-payment', ...)
// src/index.js:186  ← trùng y hệt
r.post('/api/admin/orders/:id/confirm-payment', ...)
```
Không gây lỗi (route đầu thắng) nhưng phải xoá 1 dòng.

---

## 2. HÀM EXPORT KHÔNG AI GỌI (11 hàm)

| File | Hàm | Tình trạng |
|---|---|---|
| `lib/auth.js` | `requireCustomer` | 0 lời gọi |
| `lib/auth.js` | `purgeExpiredSessions` | 0 lời gọi (cron tự DELETE riêng) |
| `lib/secrets.js` | `isSealed` | 0 lời gọi |
| `lib/telegram.js` | `notifyOrder` | 0 lời gọi |
| `lib/telegram-actions.js` | `notifyOrderPending` | 0 lời gọi |
| `lib/telegram-actions.js` | `notifyDailyReport` | 0 lời gọi |
| `lib/trial-quota.js` | `trialClock` | 0 lời gọi |
| `routes/license-server.js` | `__test` | 0 lời gọi |
| `routes/wallet.js` | `getWallet` | 0 lời gọi |
| `routes/wallet.js` | `createTopup` | 0 lời gọi ⇒ **bảng `topups` không thể tăng** |
| `routes/wallet.js` | `getTopup` | 0 lời gọi |

### 2.1 Webhook TRÙNG LẶP — nguy hiểm

`src/routes/wallet.js` có `sepayWebhook` và `payosWebhook`, nhưng `index.js` đăng ký bản của **`payments.js`**. Hai bản webhook song song, chỉ 1 bản chạy.

> Rủi ro: sửa nhầm bản không chạy ⇒ tưởng đã vá lỗi nhưng thực tế không.

---

## 3. BẢNG D1 KHÔNG DÙNG (5 bảng)

| Bảng | Số dòng | Tham chiếu trong code | Kết luận |
|---|---|---|---|
| `banned_devices` | 0 | **0** | **Xoá được** |
| `install_tokens` | 0 | 1 (chỉ cron DELETE, không có INSERT) | **Xoá được** |
| `xg_nonce` | 0 | 1 (chỉ cron DELETE, không có INSERT) | **Xoá được** |
| `reviews` | 0 | 3 (chỉ SELECT, **không có đường ghi**) | Tính năng chết |
| `product_keys` | 0 | 17 | Đang dùng nhưng 0 sản phẩm kiểu `key` |

### Chi tiết

- **`banned_devices`**: 0 dòng, 0 tham chiếu. Tàn dư tính năng cấm thiết bị đã bỏ.
- **`install_tokens`**: không còn chỗ nào INSERT (bộ cài cũ đã xoá). Cron vẫn DELETE mỗi 10 phút vào bảng rỗng.
- **`xg_nonce`**: tương tự — không có INSERT, cron vẫn DELETE.
- **`reviews`**: `products.js` đọc để trả `reviews: []`, nhưng **không có route nào ghi đánh giá** ⇒ luôn rỗng.
- **`product_keys`**: 17 chỗ dùng, nhưng **cả 11 sản phẩm đều `delivery_type='license'`** ⇒ kho key không bao giờ được đọc.

### Bảng ĐANG DÙNG nhưng rỗng (giữ lại — không xoá)

`xg_viol` (0), `rebind_tokens` (0), `rate_limits` (0 — fallback khi KV lỗi), `trial_bans` (0)

---

## 4. DỮ LIỆU KHÔNG DÙNG

### 4.1 Danh mục 0 sản phẩm (6/7)

| Danh mục | Sản phẩm |
|---|---|
| `license-xarena` | **11** ✅ |
| `ai-tools` | 0 |
| `bao-mat` | 0 |
| `giai-tri` | 0 |
| `lap-trinh` | 0 |
| `thiet-ke` | 0 |
| `windows-office` | 0 |

> Web vẫn hiện 7 danh mục, 6 cái bấm vào ra trang trống.

### 4.2 Sản phẩm đang tắt (2/11)

- `license-xarena-nam` (`active=0`)
- `license-xarena-grant-year` (`active=0`)

---

## 5. ẢNH SVG KHÔNG DÙNG (19/21)

**Đang dùng** (theo `products.image_url` trong D1):
- `/img/license-xarena.svg`
- `/img/license-xarena-grant.svg`

**Không dùng** — 19 file còn lại (~60 KB):
`adobe-creative-cloud`, `canva-pro`, `chatgpt-plus`, `claude-pro`, `expressvpn`,
`figma-professional`, `gemini-advanced`, `github-copilot`, `jetbrains-all-products`,
`kaspersky-plus`, `license-xagrant`, `microsoft-365-family`, `netflix-premium`,
`office-2021-pro-plus`, `perplexity-pro`, `spotify-premium`, `windows-11-pro`,
`wps-office-pro`, `youtube-premium`

---

## 6. TOOL/ — FILE CHẾT

| File | Lý do |
|---|---|
| `tool/app/xa_grant_plan.py` | Không ai import (chỉ `test_grant_plan.py` dùng) |
| `tool/setup/xa_setup.py` | Bộ cài `xa_setup.exe` **đã bỏ** khỏi R2 và worker |
| `tool/setup/xa_setup_qt.py` | Chỉ `xa_setup.py` dùng |
| `tool/setup/build-setup.ps1` | Build đúng `xa_setup.exe` đã bỏ |

**Giữ lại (có dùng):** `xa_arena_app/api/gui`, `xa_grant*`, `xa_nofog*`, `xa_theme`,
`xa_update`, `xa_trial_rules`, `xa_uninstall`

> `xa_uninstall.py` được `xa_arena_app.py` import → **giữ**.

---

## 7. db/ — 49 FILE SQL MỘT LẦN

Chỉ **3 file** được tài liệu nhắc đến (schema hiện hành):
`schema.sql`, `schema-v2.sql`, `schema-license-server.sql`

49 file còn lại là migration/seed/fix **đã chạy xong** trên production.

---

## 8. TÀI NGUYÊN CLOUDFLARE — KHÔNG XOÁ

| Tài nguyên | Trạng thái |
|---|---|
| Worker `muabankey` | ✅ đang chạy |
| D1 `muabankey-db` | ✅ 36 bảng, đang dùng |
| KV `muabankey-kv` | ✅ 0 key (key rate-limit hết hạn nhanh — bình thường) |
| R2 `muabankey-assets` | ✅ 1 object: `files/xa_arena.exe` |
| 10 secrets | ✅ **tất cả đều được code đọc** |

### Tài nguyên của DỰ ÁN KHÁC — tuyệt đối không đụng

D1: `xa_license`, `tpg-database`, `cuahangtienloizgo-db`, `chi-tieu-db`, `truongphatcomputer`
KV: `telegram_updates`, `tpg-api-CACHE`, `tpcomhn-cache`, `RATE_LIMIT_KV`
Worker: 12 worker khác

---

## ĐỀ XUẤT — 3 MỨC ĐỘ

### Mức 1 — An toàn, xoá ngay (không ảnh hưởng gì)

- 19 route không ai gọi (§1)
- 1 dòng route trùng (§1.6)
- 11 hàm export chết (§2)
- 2 webhook trùng lặp trong `wallet.js` (§2.1)
- 19 ảnh SVG (§5)
- 4 file tool chết (§6)
- 3 bảng D1 rỗng: `banned_devices`, `install_tokens`, `xg_nonce` (§3)

### Mức 2 — Cần bạn xác nhận (có thể còn dùng tay)

- 6 danh mục 0 sản phẩm (§4.1) — xoá thì web gọn, nhưng nếu định mở rộng bán phần mềm khác thì giữ
- `reviews` (§3) — nếu định làm tính năng đánh giá thì giữ
- `product_keys` + `delivery_type='key'` (§3) — nếu định bán key tĩnh thì giữ
- 49 file SQL (§7) — xoá thì mất lịch sử migration

### Mức 3 — Không nên xoá

- `xg_heartbeat`, `xg_health` — app không gọi nhưng là đường chẩn đoán; rẻ, giữ
- `xg_viol`, `rebind_tokens`, `rate_limits`, `trial_bans` — rỗng nhưng code đang dùng
- 10 secrets, D1, KV, R2

---

## RỦI RO NẾU XOÁ SAI

| Xoá nhầm | Hậu quả |
|---|---|
| `payments.sepayWebhook` thay vì `wallet.sepayWebhook` | **Mất tiền thật** — webhook ngừng cộng tiền |
| `product_keys` | Không bán được sản phẩm kiểu `key` (hiện 0 sản phẩm) |
| `rebind_tokens` | Khách không đổi được máy |
| `rate_limits` | Mất lớp chặn khi KV lỗi |
| Bất kỳ bảng D1 nào | Mất dữ liệu vĩnh viễn — **phải backup trước** |

---

**Chờ duyệt:** bạn chọn Mức 1 / Mức 1+2 / hay chỉ định mục cụ thể.
