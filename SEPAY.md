# SEPAY — CẤU HÌNH & VẬN HÀNH

> Cập nhật 12/11/2026. Chủ shop chốt: dùng 100% SePay.

---

## ⚠️ VIỆC ĐẦU TIÊN — CHƯA LÀM ĐƯỢC GÌ NẾU BỎ QUA

**SePay CHƯA NỐI NGÂN HÀNG.** Kiểm tra ngày 12/11/2026:

```
Tài khoản ngân hàng nối SePay: 0
Giao dịch SePay: 0
```

**Hậu quả:** Tiền khách chuyển vào MBBank `8990124112002` **KHÔNG đổ về SePay** → webhook không bao giờ chạy → mọi đơn phải duyệt tay.

### Cách nối (5 phút)

1. Vào [my.sepay.vn/bankaccount](https://my.sepay.vn/bankaccount)
2. Bấm **+ Kết nối tài khoản**
3. Chọn **MBBank**
4. Nhập:
   - Số tài khoản: `8990124112002`
   - Chủ tài khoản: `NGUYEN THANH NAM`
5. Chọn phương thức:
   - **API** (khuyến nghị — tức thì, độ trễ thấp)
   - **SMS** (dự phòng nếu API lỗi)
6. Nếu chọn SMS: lấy số điện thoại SePay cung cấp, đăng ký với MBBank làm số thứ 2 nhận biến động số dư (giữ số chính của bạn)
7. Chuyển thử **1.000đ** với nội dung `TEST` → kiểm tra my.sepay.vn/transactions

---

## HẠN MỨC — 50 GD/THÁNG

SePay FREE: **50 giao dịch tiền VÀO/tháng**, tính theo **tài khoản SePay** (không theo ngân hàng).

- Nối thêm ngân hàng **KHÔNG** tăng hạn mức
- Giao dịch **tiền ra** không tính
- Vượt 50 vẫn chạy, chỉ tính phí sau

### Đã tách giao dịch test

Hệ thống tự nhận diện GD test qua tiền tố mã giao dịch:

```
TEST  PROBE  SHORT  TOPUP  OVER  TWICE  MULTI  OUT
WRONGACC  NOMATCH  SAME  TWO  AGAIN  EXP  CAN  OOS
APPROVE  E2E
```

GD có tiền tố này → `is_test = 1` → **KHÔNG tính vào 50 GD**.

**Hiện tại: 0/50 GD thật đã dùng. 85 GD test được tách riêng.**

Kiểm tra bất cứ lúc nào: Admin → **Chờ thanh toán**, hoặc gọi `/api/admin/sepay/quota`.

---

## CỬA SỔ GIỜ TỰ ĐỘNG

| Giờ Việt Nam | Chế độ |
|---|---|
| **00:00 – 11:59** | Tự động xác nhận, giao key ngay khi tiền vào |
| **12:00 – 23:59** | Ghi nhận tiền + báo Telegram, **admin duyệt tay** |

Đổi cấu hình (không cần deploy):

```sql
-- Tắt tự động hoàn toàn
UPDATE settings SET value='0' WHERE key='sepay_auto_enabled';

-- Đổi giờ (ví dụ 6h - 18h)
UPDATE settings SET value='6'  WHERE key='sepay_auto_from';
UPDATE settings SET value='18' WHERE key='sepay_auto_to';
```

Hệ thống tự cộng 7 giờ (giờ Việt Nam) vì Worker chạy UTC.

---

## ĐỐI SOÁT — KHI WEBHOOK TRƯỢT

### Cách 1: Tự động qua admin

Admin → **Chờ thanh toán** → bấm **Đã nhận tiền** cho đơn khớp.

### Cách 2: Kéo từ API SePay

```powershell
# Xem giao dịch SePay hệ thống chưa ghi nhận
curl.exe "https://xienhl.com/api/admin/sepay/reconcile?days=1" `
  -H "Cookie: mbk_session=<session>"
```

Trả về danh sách GD tiền vào có trên SePay nhưng chưa ghi vào sổ, kèm đơn khớp (nếu có).

Ghi nhận 1 GD:
```powershell
curl.exe -X POST "https://xienhl.com/api/admin/sepay/sync" `
  -H "Cookie: mbk_session=<session>" `
  -H "Content-Type: application/json" `
  -d '{\"txnRef\":\"<mã GD>\",\"amount\":180000,\"content\":\"MBKABC123\"}'
```

### Cách 3: Duyệt qua Telegram

Khi có tiền vào ngoài cửa sổ giờ, Telegram nhận tin có nút:
- **✅ Duyệt & giao key** — giao ngay
- **❌ Chưa thấy tiền** — đánh dấu chưa xử lý

---

## QUY TRÌNH MỖI NGÀY

### Sáng (00:00 – 12:00)
Không cần làm gì. Hệ thống tự giao.

### Chiều (12:00 – 24:00)
1. Mở Telegram, xem tin **KHÁCH BÁO ĐÃ CHUYỂN KHOẢN**
2. Mở app MBBank, đối chiếu số tiền + nội dung
3. Bấm **✅ Duyệt & giao key**

### Cuối ngày
1. Admin → **Chờ thanh toán**
2. Xem ô đỏ "Tiền chưa gán đơn" — nếu > 0 thì đối soát
3. Xem hạn mức đã dùng

---

## GIẢM TEST ĐỂ TIẾT KIỆM HẠN MỨC

Chủ shop yêu cầu hạn chế test. Các script test giờ phải:

1. **Dùng tiền tố `TEST`/`E2E`** trong `referenceCode` → tự đánh dấu test
2. **Không gọi webhook thật** khi không cần — dùng `confirmOrderPaid` trực tiếp
3. **Test sau 12h** cũng không tính (ngoài cửa sổ tự động)

Danh sách script test hiện có (đều dùng tiền tố đúng):
- `test-payment-risks.mjs` — TEST, SHORT, TOPUP, OVER, TWICE...
- `e2e-qr-order.mjs` — TEST
- `test-deep-payment.mjs` — TWO, AGAIN, EXP, CAN, OOS
- `test-deliver-btn.mjs` — không gọi webhook

---

## LỖI THƯỜNG GẶP

### Webhook không chạy
1. Kiểm tra SePay đã nối ngân hàng chưa (mục đầu tiên)
2. Kiểm tra `WEBHOOK_SECRET` khớp giữa Cloudflare và SePay
3. Vào my.sepay.vn/transactions xem cột "Tự động" — biểu tượng Pay phải **xanh lá**
4. Nếu đỏ → webhook trả lỗi, xem log: `npx wrangler tail muabankey`

### Tiền vào nhưng không khớp đơn
Khách ghi sai nội dung. Xem mục **ĐỐI SOÁT** ở trên.

### Hạn mức vượt 50
SePay vẫn cho chạy, tính phí sau. Kiểm tra `/api/admin/sepay/quota`.

---

## MÃ API TOKEN

Đã set vào Cloudflare secret `SEPAY_API_TOKEN` ngày 12/11/2026.

Dùng cho:
- Đối soát giao dịch (`/api/admin/sepay/reconcile`)
- Kiểm tra tài khoản ngân hàng

**Lưu ý:** Token này có quyền đọc giao dịch. Không chia sẻ, không commit vào git.

Tạo token mới: my.sepay.vn → Cấu hình công ty → API Token.

---

## DANH SÁCH NHANH

| Việc | Ở đâu |
|---|---|
| Nối ngân hàng | my.sepay.vn/bankaccount |
| Xem giao dịch | my.sepay.vn/transactions |
| Xem hạn mức | my.sepay.vn/company/plans |
| Tạo API token | my.sepay.vn/cau-hinh-chung |
| Đối soát trong hệ thống | Admin → Chờ thanh toán |
| Cấu hình webhook | my.sepay.vn → Tích hợp Webhooks |
