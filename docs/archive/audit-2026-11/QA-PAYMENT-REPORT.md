# BÁO CÁO QA — LUỒNG THANH TOÁN PRODUCTION xienhl.com

**Thời điểm:** 2026-11-12 19:40–20:20 (VN)
**Môi trường:** production thật (Cloudflare Workers + D1 `81f478c9…`)
**STK đang dùng:** `0010131639304` — MBBank — NGUYEN THANH NAM ✅
**Cửa sổ giờ lúc test:** `sepay_auto_enabled=1`, `0→12` → 19h–20h là NGOÀI cửa sổ

---

## BẢNG KẾT QUẢ — 36/37 PASS

| # | Test | Kết quả | Ghi chú |
|---|------|---------|---------|
| 1 | Đăng ký user mới | PASS | HTTP 201, user id + username trả đúng |
| 2 | Tạo đơn 180k | PASS | total=180000, status=pending, code `MBK-XXXXXX` |
| 3 | Lấy QR | PASS | amount=180000, memo=`MBKXXXXXX`, bank=`0010131639304`, ảnh SVG 46KB tải được |
| 4 | Webhook đúng → tự giao | PASS | Khi tắt cửa sổ: delivered=true, order→delivered |
| 5 | Khách đọc key qua `/api/orders/:id` | PASS | Trả `AOE1-…` sau khi giao |
| 6 | Key KHÔNG lộ khi chưa thanh toán | PASS | `keys: []` ở cả `/orders` và `/orders/:id` khi pending |
| 7 | Ngoài cửa sổ → `AWAITING_ADMIN_APPROVAL` | PASS | delivered=false, order giữ pending, window.hour=19 |
| 8 | Ghi sổ `payments` (state/amount) | PASS | state=matched, amount=180000, confirmed_by=`sepay-window` |
| 9 | Báo Telegram `notifyPaymentClaim` | PASS | `payments.js:954` gọi khi `!duplicated` — *đọc code*, chưa quan sát Telegram thật |
| 10 | Tắt cửa sổ → tự giao → bật lại | PASS | delivered=true; **đã bật lại `sepay_auto_enabled=1`** |
| 11 | Chuyển thiếu | PASS | underpaid=true, state=`wrong_amount`, order pending, có `notifyUnderpaid` |
| 12 | Chuyển bù đủ (90k+90k) | PASS | delivered=true — tính cộng dồn đúng |
| 13 | Chuyển thừa | PASS | delivered=true, `excess` đưa vào `notifyPaymentSuccess` |
| 14 | Chuyển 2 lần | PASS | Lần 2: `ALREADY_DELIVERED`, license_issues vẫn =1 |
| 15 | Webhook lặp cùng referenceCode | PASS | `duplicated=true`, chỉ 1 dòng payments, không báo Telegram lần 2 |
| 16 | `transferType=out` | PASS | `NOT_INBOUND`, không ghi sổ |
| 17 | Sai accountNumber (STK cũ) | PASS | `WRONG_ACCOUNT`, order không đổi |
| 18 | Nội dung không có MBK | PASS | `NO_ORDER_MATCH` + ghi `payments.state='unmatched'` |
| 19 | Đăng nhập admin + dashboard | PASS | role=admin; revenue 20.710.000đ khớp DB, users khớp DB |
| 20 | Tab "Chờ thanh toán" render | PASS | 11 tab render OK, **0 lỗi JS** (đo bằng Chrome CDP), sau khi sửa stats |
| 21 | Nút "Đã nhận tiền" | PASS | 200, delivered=true, order→delivered, cấp license thật |
| 22 | Tab Đơn hàng | PASS | 200 đơn, đủ cột; đã sửa lộ email `@invalid` |
| 23 | Tab Người dùng: bỏ cột số dư | PASS | Đã bỏ cột; nay hiện "Tên đăng nhập" thật |
| 24 | Nút "Giao" cấp key thật | PASS | `license_issues` tăng 1 dòng/đơn |
| 25 | Đơn pending quá 2 giờ | PASS | **0 đơn** |
| 26 | Payments unmatched | **FAIL** | **1 giao dịch thật 1.800.000đ chưa gán đơn** — xem dưới |
| 27 | `is_test=1` không tính hạn mức | PASS | quota used=5 (test=174 loại ra), remaining=45 |
| 28 | User test rác `@local`/`@test.vn` | PASS | 0 và 0 (`@invalid` không tính — email nội bộ hợp lệ) |
| 29 | License gắn HWID không có order | PASS | `source='sold'` mà thiếu order: **0**. (trial=45, stock=11 là hợp lệ) |
| 30 | `product_keys` available | PASS | 0 key — 4 sản phẩm đều `delivery_type=license` |
| 31 | `/api/admin/*` không auth | PASS | 9/9 endpoint trả **401** |
| 32 | User thường gọi admin | PASS | 9/9 endpoint trả **403** |
| 33 | Đọc đơn người khác | PASS | **404** (cả by-id, by-code, và `/qr`) |
| 34 | Sửa giá trong request | PASS | Gửi `price:1, total:1` → server vẫn tính **180000** |
| 35 | Rate limit đơn hàng | PASS | Cho 20 đơn, **request #21 → 429** |
| 36 | `/api/admin/sepay/reconcile?days=1` | PASS | HTTP 200, không lỗi (`checked=0` vì SePay API trả 0 GD) |
| 37 | `/api/admin/sepay/quota` | PASS | used=5, remaining=45, percent=10%, daysLeft=18 |

**Tổng: 36 PASS / 1 FAIL**

---

## LỖI TÌM ĐƯỢC & ĐÃ SỬA (4 lỗi, đã deploy + test lại)

### 🔴 P0 — Admin duyệt tiền bị GHI SỔ HAI LẦN (mất kiểm soát dòng tiền)

**Hiện tượng thật trên production:** ngoài cửa sổ giờ, webhook ghi sổ 180.000đ
(`confirmed_by='sepay-window'`) rồi trả `AWAITING_ADMIN_APPROVAL`. Admin bấm
"Đã nhận tiền" → `confirmOrderPaid(amount=order.total)` → cộng dồn thành **360.000đ**,
và API trả `excess: 180000` → Telegram báo *"Thừa 180.000đ — cần hoàn tay"* dù
khách chỉ chuyển đúng 180.000đ.

**Đơn đã dính trên production:** `MBK-WGWDM7`, `MBK-YLCB36` (sổ 360k/đơn 180k),
`MBK-MLSV4F` (sổ 270k, khách chuyển 90k).

**Nguyên nhân:** `payments` bị dùng lẫn hai vai — *sổ tiền đã nhận* và *sổ quyết định giao*.
Admin bấm duyệt là quyết định GIAO HÀNG, không phải khai thêm một khoản tiền.

**Sửa** (`src/routes/payments.js`, `src/lib/telegram-actions.js`): thêm cờ `ratify`.
Khi sổ đã có chứng từ (`prevPaid > 0`) thì bấm duyệt **không ghi thêm dòng**.
Khi sổ trống (webhook trượt hẳn) vẫn ghi đúng số tiền — đường cứu còn nguyên.
Admin gõ tay số tiền khác = khai khoản MỚI → vẫn ghi sổ bình thường.

**Đã sửa dữ liệu lịch sử:** xoá 4 dòng `manual` trùng (backup `qa/ledger-backup.json`).
Double-write còn lại: **0**.

**Test lại (4/4 PASS):**

| Case | Kỳ vọng | Kết quả |
|------|---------|---------|
| Chuyển đúng 180k + admin duyệt | sổ=180k, excess=0 | ✅ sổ=180k, excess=0 |
| Chuyển thiếu 90k + admin duyệt | sổ=90k, vẫn giao | ✅ sổ=90k, delivered |
| Webhook trượt hẳn + admin duyệt | ghi sổ 180k | ✅ 1 dòng, 180k |
| Admin nhập tay 90k bù | ghi khoản mới | ✅ 2 dòng, tổng 180k |

---

### 🟠 P1 — Số liệu "Tổng đã khớp" trộn dữ liệu test

Thẻ số liệu tab "Chờ thanh toán" hiện **19.660.000đ** trong khi tiền thật chỉ
**1.150.000đ** (18.510.000đ là `is_test=1`). Cảnh báo "6 giao dịch không khớp"
thực chất chỉ **1** là thật.

Admin dùng đúng những con số này để quyết định có kiểm sao kê hay không — số ảo
làm loãng cảnh báo thật.

**Sửa:** `stats` chỉ tính `is_test=0`; thêm `statsAll` để đối soát nội bộ.
**Kết quả sau sửa:** "Tổng đã khớp" 19.660.000đ → **1.150.000đ**; "không khớp" 6 → **1**.

---

### 🟠 P1 — Tab Người dùng hiện "—" toàn bộ

UI mới đổi sang cột "Tên đăng nhập" nhưng `/api/admin/users` **không trả field
`username`** → mọi dòng đều "—", admin không biết ai là ai.

**Sửa** (`src/routes/admin.js`): trả `username`, fallback hợp lý cho user cũ.
**Kết quả:** 200/200 dòng có username thật.

---

### 🟠 P1 — API admin lộ địa chỉ nội bộ `u-<uuid>@invalid`

Cả `/api/admin/orders` và `/api/admin/users` trả email nội bộ dạng
`u-71c13512-96d4-43fa-8212-9a5d1c036d22@invalid` (UUID ngẫu nhiên, vô nghĩa với
admin, trông như dữ liệu hỏng).

**Sửa:** ẩn email `@invalid`, dùng `username`/`full_name`.
**Kết quả:** orders leak=0/200, users leak=0/200.

---

## ❌ CÒN TỒN — cần chủ shop xử lý tay (#26)

**1 giao dịch thật 1.800.000đ chưa gán đơn:**

```
Thời gian : 2026-11-12 16:45:00 (VN)
Số tiền   : 1.800.000đ
Nội dung  : "TRAN TAT VIET CUONG chuyen tien"   ← KHÔNG có mã MBK
Mã GD     : FT26316137983719
Tài khoản : 8990124112002  ← STK CŨ
```

Đây **không phải lỗi code** — khách chuyển vào STK cũ và không ghi mã đơn nên
không thể tự khớp. Nhưng **tiền đã vào ngân hàng thật**, cần chủ shop:

1. Đối chiếu sao kê MBBank ngày 12/11 16:45, số tiền 1.800.000đ
2. Nếu khách có đơn → dùng tab "Chờ thanh toán" → "Đã nhận tiền" trên đúng đơn
3. Nếu không có đơn → hoàn tiền tay cho khách

⚠️ **Lưu ý:** đây là giao dịch **duy nhất** SePay ghi nhận trong ngày. Toàn bộ
giao dịch khác trong sổ đều mang `is_test=1`.

---

## GHI NHẬN THÊM (không tính PASS/FAIL)

- **SePay API trả 0 giao dịch** ở `transactions/list` cả trang 1 và 2 → `reconcile`
  chạy không lỗi nhưng **không đối soát được gì** (`checked=0`).
  Tài khoản `0010131639304` **đã nối đúng** SePay (`bankaccounts/list`:
  active=1, created 2026-11-12 19:24) nhưng `last_transaction=null` — có thể do
  token chưa đủ quyền đọc lịch sử, hoặc GD cũ thuộc tài khoản đã gỡ liên kết.
  **Đề nghị:** kiểm tra lại quyền token SePay để đối soát hoạt động thật.

- **26 `license_issues` trỏ tới order đã bị xoá**, trong đó 19 license còn sống
  (`revoked=0`). Tất cả thuộc user đã bị xoá (`userExists=0`) → là rác từ các đợt
  dọn user test, **không phải lỗ hổng cấp license cho người ngoài**. Nên dọn định kỳ.

- **Đường dẫn admin là hash-route** (`#/admin?tab=…`). Truy cập `/admin` trực tiếp
  sẽ bị `boot()` ghi đè thành `#/` và hiện trang chủ. Không phải lỗi thanh toán
  nhưng gây khó chịu khi mở link trực tiếp.

- **Rate limit đơn hàng:** cấu hình 20 đơn/600s, đo được chặn ở request #21 —
  đúng. (Lần đo đầu ra #22 do KV eventual-consistency; đo lại ổn định #21.)

---

## DỌN DẸP — ĐÃ HOÀN TẤT

| Hạng mục | Trước | Sau |
|---|---|---|
| User QA (`qa*`) | 19 | **0** |
| Payment `txn_ref LIKE 'TEST%'` | 33 | **0** |
| Order của user QA | 56 | **0** |
| Double-write trong sổ | 4 dòng | **0** |
| `sepay_auto_enabled` | 1 | **1** ✅ (đã bật lại) |
| `sepay_auto_from/to` | 0/12 | **0/12** ✅ |
| `bank_account` | 0010131639304 | **0010131639304** ✅ |

**Trạng thái cuối:** 238 user · 306 order · 171 payment · 9 đơn pending (0 đơn >2h)

---

## FILE ĐÃ SỬA & DEPLOY

| File | Thay đổi |
|---|---|
| `src/routes/payments.js` | Cờ `ratify` chống ghi sổ trùng; `stats` tách `is_test` |
| `src/lib/telegram-actions.js` | Truyền `ratify:true` cho nút duyệt Telegram |
| `src/routes/admin.js` | Trả `username`; ẩn email `@invalid` |
| `src/routes/orders.js` | Ẩn email `@invalid`, tìm được theo username |
| `public/assets/pages/admin.js` | Bỏ cột "Số dư" (agent khác sửa song song) |

**Worker version cuối:** `d0391ee7-235e-4ff7-a78a-52a879c87d2a`
**Regression sau khi sửa: 25/25 PASS**
