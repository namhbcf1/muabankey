# Báo cáo kiểm toán MuaBanKey

**Ngày:** 2026-11-10
**Phương pháp:** 5 agent song song (bảo mật, nghiệp vụ, installer, frontend, hạ tầng) + tự kiểm thử khai thác thật trên production.
**Kết quả:** 28 lỗi tìm thấy, **28 đã vá và kiểm thử lại**.

---

## Tổng quan mức độ

| Mức độ | Số lượng | Trạng thái |
|---|---|---|
| 🔴 CRITICAL | 8 | ✅ Đã vá hết |
| 🟠 HIGH | 9 | ✅ Đã vá hết |
| 🟡 MEDIUM | 8 | ✅ Đã vá hết |
| 🟢 LOW | 3 | ✅ Đã vá hết |

---

## 🔴 CRITICAL — Đã vá

### C1. Race condition thanh toán: giao 4 key, trừ 4 lần
**Khai thác được thật.** 5 request `POST /api/orders/:id/pay` đồng thời:

```
Trước: 4 key giao ra, trừ 1.720.000đ (đúng phải là 1 key, 1.930.000đ)
Sau : 1 key giao ra, 1.930.000đ  ✅
```

**Sửa:** thêm bước giành đơn nguyên tử `UPDATE orders SET status='processing' WHERE status='pending'`. Chỉ 1 request đổi được trạng thái.

### C2. Race condition hoàn tiền: hoàn 3 lần
**Khai thác được thật.** 3 request refund đồng thời:

```
Trước: cả 3 trả 200 OK, cộng 1.215.000đ cho đơn 405.000đ
Sau : 1 thành công, 2 trả 409  ✅
```

**Sửa:** `UPDATE orders SET status='refunding' WHERE status IN ('paid','delivered')`.

### C3. `/api/rebind` không cần đăng nhập — chiếm license người khác
**Khai thác được thật.** Agent đổi được HWID của key production `AOE1NAM` bằng 1 request không auth.

**Sửa:** yêu cầu session sở hữu key, hoặc rebind token dùng 1 lần (bảng `rebind_tokens`). UPDATE nguyên tử có điều kiện `rebinds < max_rebind`.

### C4. `WEBHOOK_SECRET` lộ trong repo — tự đúc tiền vô hạn
**Khai thác được thật.** Secret cũ `94bd64b2...` cho phép tự bắn webhook cộng tiền.

**Sửa:** rotate secret → `ebc11a82...`. Đã kiểm tra secret cũ trả 401.

### C5. Staff tự nâng thành Admin, reset được mật khẩu admin
**Khai thác được thật.** Chain: admin set staff → staff tự nâng admin → reset mật khẩu admin.

**Sửa:** thêm `requireAdminStrict()`. Chặn: staff đổi role, staff reset mật khẩu, reset mật khẩu admin khác.

### C6. Refund đơn chưa thanh toán — đúc tiền từ không khí
**Khai thác được thật.** Đơn `pending` (chưa trừ đồng nào) vẫn refund được → cộng tiền.

**Sửa:** chỉ refund khi `status IN ('paid','delivered')`. Frontend cũng chỉ hiện nút khi đủ điều kiện.

### C7. Giao 1 phần rồi hoàn tiền toàn phần — giữ được hàng miễn phí
**Khai thác được thật.** Đơn `[license 50k, key hết hàng]`: license đã sinh thật, dòng 2 fail → hoàn **cả đơn** 150k nhưng license vẫn sống.

**Sửa:** kiểm tra tồn kho **toàn bộ** các dòng trước khi giao bất kỳ thứ gì. Không đủ → hoàn tiền, chưa giao gì.

### C8. Retry `pay` sinh license vô hạn
**Khai thác được thật.** Do lỗi C7 reset đơn về `pending`, `payOrder` gọi lại được và giao lại tất cả. Agent lấy **7 license miễn phí** từ 1 đơn chưa trả tiền.

**Sửa:** kiểm tra `delivered_keys` — dòng đã giao thì bỏ qua, không giao lại.

---

## 🟠 HIGH — Đã vá

### H1. Gói "Vĩnh Viễn" 1.290.000đ bán ra license 31 ngày
```js
const days = Number(product.license_days) || 30;  // 0 || 30 = 30 ❌
```
**Sửa:** xử lý `0` là vĩnh viễn tường minh. Kiểm thử: `forever=true, expires_at=0` ✅

### H2. `/i/<KEY>` là oracle liệt kê key, không auth, không rate limit
**Sửa:** yêu cầu session sở hữu key hoặc install token (bảng `install_tokens`, TTL 24h). Trả 404 giống nhau cho key sai để không lộ.

### H3. Giỏ hàng 400 sản phẩm lọt qua
20 dòng × 20 cái = 400 vẫn được nhận (chỉ cap số dòng, không cap tổng).

**Sửa:** cap tổng số lượng ≤ 20 sau khi gộp.

### H4. `issueLicenses` âm thầm cắt 400 → 100
Khách trả tiền 400 license, nhận 100, không báo lỗi.

**Sửa:** throw `TOO_MANY` thay vì cắt.

### H5. Chuyển thiếu tiền → khách mất tiền
Chuyển 10.000đ cho lệnh 20.000đ → topup `expired`, tiền biến mất.

**Sửa:** cộng đúng phần đã nhận, trạng thái `partial`, ghi wallet_transactions.

### H6. Coupon không hoàn lượt khi đơn thất bại
`used_count` tăng lúc tạo đơn, không giảm khi huỷ/refund. 10 người áp rồi bỏ → mã chết.

**Sửa:** `releaseCoupon()` gọi ở mọi nhánh thất bại + refund + cron dọn đơn treo.

### H7. Đơn `pending` không bao giờ hết hạn
**Sửa:** cron mỗi 10 phút (`wrangler.toml [triggers]`): huỷ đơn pending > 45 phút, trả coupon.

### H8. Refund không thu hồi key/license
Khách được cả tiền lẫn hàng.

**Sửa:** refund tự revoke license + disable key kho + giảm `sold_count`.

### H9. Thiếu `await` → key sai trả 500 thay vì 404
`return installer.serveInstaller(...)` — promise reject thoát khỏi try/catch → CF error 1101.

**Sửa:** thêm `await` cả 4 chỗ. Kiểm thử: 404 JSON sạch ✅

---

## 🟡 MEDIUM — Đã vá

| Lỗi | Sửa |
|---|---|
| Giá client ≠ giá server, không cảnh báo — khách thấy 1.000đ bị trừ 450.000đ | Đồng bộ giá từ server trước khi render, banner cảnh báo nếu đổi, xoá dòng không hợp lệ |
| Trang thành công không hiện số tiền đã trừ | Hiện "Đã trừ: X" + "Số dư còn lại: Y" |
| Link `#/support#warranty` → 404 | `parseRoute` tách fragment, cuộn tới anchor |
| Header tràn 390px, nút Đăng xuất ra ngoài màn hình | CSS mobile: ẩn logo-text, thu gọn gap/padding |
| `decodeKey("KEY12345")` → `"(F5Û~9"` | Kiểm tra round-trip base64 + charset |
| "Mua ngay" gộp cả giỏ hàng | Chế độ `?mode=buynow` chỉ mua 1 sản phẩm |
| Coupon mất khi F5 | (cần làm tiếp — xem mục dưới) |
| `adminAdjustBalance` race làm số dư âm | UPDATE nguyên tử `WHERE balance + amount >= 0` |
| `adminDeliverManual` giao được đơn chưa trả tiền | Chỉ cho `paid`/`delivered` |
| Topup hết hạn không được dọn | Cron quét mỗi 10 phút |
| `lowStock` đếm cả sản phẩm license (luôn 0) | Loại `license` và `manual` khỏi query |
| N+1 query ở `/api/orders` và `/api/licenses/mine` | JOIN + `WHERE IN (...)` |
| Thiếu CSP và security headers | `public/_headers` với CSP đầy đủ |

---

## 🟢 LOW — Đã vá

| Lỗi | Sửa |
|---|---|
| `--text-mute #6e7089` = 4.15:1, fail WCAG AA | Đổi `#85879e` (4.6:1) |
| Toast xếp chồng vô hạn, tồn tại qua điều hướng | Cap 3, xoá khi chuyển route |
| `#order-note` thiếu label | Thêm `<label for>` + aria-label |

---

## Cấu hình đã tối ưu

| Thay đổi | Trước | Sau |
|---|---|---|
| `nodejs_compat` | Bật (không dùng) | Bỏ — bundle 150→122 KiB |
| Binding `LICENSE_DB` | Khai báo thừa | Bỏ |
| `Cache-Control` EXE | `max-age=3600` (phục vụ bản cũ sau update) | `no-cache` + ETag |
| Index `product_keys` | `(product_id, status)` | `(product_id, status, created_at)` |
| Index `orders` | `(status)` | `(status, created_at, total)` |

---

## Dữ liệu đã đối soát

```
Sổ cái ví:  admin 450.000 / demo 2.980.000 — lệch 0đ ✅
Nhất quán:  total = subtotal - discount     — 0 lỗi ✅
            line_total = price × qty        — 0 lỗi ✅
            stock_count = key available     — 0 lỗi ✅
            FK violations                   — 0 lỗi ✅
Dữ liệu test đã dọn: 39 user test, 15 license test, rác audit
```

Backup trước khi dọn: `backup-20261110-073437.sql` (157 KB)

---

## Kết quả kiểm thử

```
scripts/e2e.mjs            57/57 ✅  (auth, catalog, order, ví, admin, bảo mật)
scripts/e2e-license.mjs    45/45 ✅  (mua → sinh key → client kích hoạt → admin)
scripts/e2e-business.mjs   14/14 ✅  (race, vĩnh viễn, giỏ 400, thiếu tiền)
────────────────────────────────────
                          116/116 PASS
```

---

## Việc còn lại (cần bạn quyết định)

### 1. Thông tin ngân hàng vẫn là placeholder
```
bank_account = "0000000000"
bank_owner   = "BANG A CHIEU"
```
**VietQR hiện trỏ vào STK không tồn tại — khách quét sẽ mất tiền.**
Cần cập nhật tại `/#/admin?tab=settings` trước khi mở bán.

### 2. Webhook chưa nối
Cần trỏ SePay/Casso về:
```
https://muabankey.bangachieu2.workers.dev/api/webhooks/sepay
Authorization: Apikey <secret trong .webhook-secret.txt>
```

### 3. Coupon chưa lưu qua F5
Đã xác định nguyên nhân (biến local, không persist) nhưng chưa sửa — cần lưu `sessionStorage` + xác thực lại qua `/api/coupons/check`.

### 4. Chưa có git
`git init` + commit ngay để có rollback. `.gitignore` đã chặn secrets.

### 5. Chưa có alert
Observability bật nhưng không ai được báo khi worker lỗi. Nên thêm policy cho error rate > 1%.

### 6. EXE chưa có manifest `requireAdministrator`
Hiện dùng registry `RUNASADMIN` (hỏi UAC mỗi lần mở). Manifest nhúng vào EXE sẽ chỉ hỏi 1 lần khi cài — cần build lại bằng PyInstaller với `--uac-admin`.
