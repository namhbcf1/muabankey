# Nối webhook thanh toán — SePay & payOS

Hệ thống hỗ trợ **cả hai** dịch vụ cùng lúc. Đăng ký cái nào duyệt trước thì dùng cái đó, cái còn lại để dự phòng.

## So sánh nhanh

| | SePay | payOS |
|---|---|---|
| Gói free | 50 giao dịch/tháng | **1.000 GD/năm** (BIDV-1K), gói KLB **không giới hạn** |
| Phí | Trả theo gói | **0đ** — ngân hàng tài trợ |
| MBBank | ✅ | ✅ |
| Thủ tục | Hợp đồng | CCCD + 5 phút |
| Tiền về | Qua SePay | **Trực tiếp TK** |
| Trạng thái trong shop | ✅ Đã cấu hình sẵn | ⏳ Chờ checksum key |

**Khuyến nghị:** payOS làm chính (free nhiều hơn), SePay làm dự phòng.

---

## Cách 1 — SePay (đã sẵn sàng)

### Bước 1: Lấy secret

```powershell
npx wrangler secret list --name muabankey
```

Nếu chưa có `WEBHOOK_SECRET`:

```powershell
npx wrangler secret put WEBHOOK_SECRET --name muabankey
# Dán một chuỗi ngẫu nhiên dài, ví dụ:
# openssl rand -hex 32
```

### Bước 2: Cấu hình trên SePay

Vào [my.sepay.vn](https://my.sepay.vn) → **Cấu hình** → **Webhook**:

```
URL:    https://xienhl.com/api/webhooks/sepay
Method: POST
Auth:   Apikey <WEBHOOK_SECRET>
```

Bật **"Chia sẻ biến động số dư"**, chọn tài khoản MBBank `8990124112002`.

### Bước 3: Kiểm tra

```powershell
curl https://xienhl.com/api/webhooks/health
```

Thấy `"sepay":{"configured":true}` là xong.

---

## Cách 2 — payOS

### Bước 1: Đăng ký

1. Vào [my.payos.vn/register](https://my.payos.vn/register)
2. Đăng ký bằng email → xác thực email
3. **Xác thực tổ chức**: cần CCCD (cá nhân/hộ kinh doanh) hoặc giấy phép KD
   - ⚠️ Tài khoản ngân hàng phải **trùng tên** với tổ chức đã xác thực
   - TK `8990124112002` mang tên `NGUYEN THANH NAM` → tổ chức phải đứng tên bạn
4. **Kênh thu** → chọn **MB** → kết nối tài khoản (cần OTP qua app MB Bank)
5. Vào **Kênh thanh toán** → copy **Checksum Key**

### Bước 2: Lưu checksum key

**Cách A — qua admin UI (nhanh):**
Vào `/#/admin?tab=settings` → mục **Kết nối webhook tự động** → payOS → dán key → **Lưu**

**Cách B — qua secret (bảo mật hơn):**

```powershell
npx wrangler secret put PAYOS_CHECKSUM_KEY --name muabankey
```

Ưu tiên secret: nếu cả hai đều có, secret thắng.

### Bước 3: Cấu hình webhook trên payOS

Vào my.payos.vn → **Kênh thanh toán** → chọn kênh MB → **Webhook URL**:

```
https://xienhl.com/api/webhooks/payos
```

### Bước 4: Kiểm tra

```powershell
curl https://xienhl.com/api/webhooks/health
```

Thấy `"payos":{"configured":true}` là xong.

---

## Cách hoạt động

### Luồng tiền

```
Khách quét VietQR (nội dung: NAPxxxxx)
    ↓
Chuyển khoản vào MBBank 8990124112002
    ↓
SePay/payOS phát hiện biến động số dư
    ↓
POST webhook về xienhl.com
    ↓
Server khớp NAPxxxxx → cộng tiền vào ví
    ↓
Khách thấy số dư tăng sau ~5 giây
```

### Bảo mật

| Dịch vụ | Cơ chế |
|---|---|
| SePay | Header `Authorization: Apikey <secret>` — so sánh timing-safe |
| payOS | HMAC-SHA256 trên toàn bộ `data` với `checksumKey` — so sánh timing-safe |

**Chống cộng trùng:** cả hai dùng atomic claim `UPDATE ... WHERE status != 'paid'`. Gửi lại webhook 10 lần vẫn chỉ cộng 1 lần.

**Chống sửa số tiền:** payOS ký trên `data` gồm `amount`. Sửa amount → chữ ký không khớp → 401.

### Xử lý chuyển thiếu/thừa

| Trường hợp | Xử lý |
|---|---|
| Chuyển đủ | Cộng đúng số tiền, status `paid` |
| Chuyển thiếu | Cộng **phần đã nhận**, status `partial` (không mất tiền khách) |
| Chuyển thừa | Cộng đúng số đặt, phần dư ghi vào audit để đối soát |
| Nội dung sai | Ghi audit `payos.unmatched`, không cộng, admin xem tab Nạp tiền |

---

## Khi webhook chưa nối

Dùng **duyệt tay**: `/#/admin?tab=topups`

1. Mở app MB Bank, tìm giao dịch có nội dung `NAPxxxxx`
2. Bấm **Duyệt**, nhập số tiền thực nhận
3. Tiền vào ví ngay

UI có sẵn nút copy nội dung CK, và cảnh báo số lệnh đang chờ.

---

## Kiểm thử

```powershell
# Kiểm tra cấu hình
node scripts/e2e-webhook.mjs https://xienhl.com

# Test payOS end-to-end (tự ký webhook, kiểm tra cộng tiền + chống replay)
node scripts/e2e-payos.mjs https://xienhl.com
```

Test payOS sẽ:
1. Set checksum key tạm
2. Tạo topup thật
3. Ký webhook bằng thuật toán payOS
4. Kiểm tra tiền vào ví
5. Gửi lại → phải bị chặn
6. Sửa amount → phải bị từ chối
7. Xoá key tạm

---

## Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| `503 NOT_CONFIGURED` | Chưa có secret/key | Đặt `WEBHOOK_SECRET` hoặc `PAYOS_CHECKSUM_KEY` |
| `401 Sai khoá xác thực` | Secret không khớp | Kiểm tra lại, `wrangler secret list` |
| `401 Chữ ký webhook không hợp lệ` | payOS checksum key sai | Copy lại từ my.payos.vn |
| Webhook không được gọi | Chưa bật trên dashboard | Bật "Chia sẻ biến động số dư" / nhập Webhook URL |
| Tiền vào TK nhưng ví không tăng | Nội dung CK sai | Kiểm tra audit log, duyệt tay |
| `matched: false, reason: TOPUP_NOT_FOUND` | Khách ghi sai nội dung | Tab Nạp tiền → duyệt tay |

Xem log:

```powershell
npx wrangler tail muabankey --format pretty
```
