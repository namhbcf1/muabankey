# RUNBOOK VẬN HÀNH — MuaBanKey / XArena No Fog

> In trang này dán màn hình. Làm đúng thứ tự, không bỏ bước.

---

## MỖI SÁNG (5 phút)

| # | Việc | Ở đâu | Dấu hiệu cần xử lý |
|---|---|---|---|
| 1 | Mở Telegram xem đêm qua có tin gì | @bankeynamhbcf_bot | Tin đỏ = xử lý ngay |
| 2 | Vào admin → **Chờ thanh toán** | /#/admin?tab=topups | Ô đỏ "Tiền chưa gán đơn" > 0 |
| 3 | Mở app MBBank, xem biến động số dư | App ngân hàng | Có tiền vào mà admin không có đơn |
| 4 | Đối chiếu: tiền ngân hàng ≈ tổng "Đã khớp" hôm qua | Admin → Chờ thanh toán | Lệch → xem mục SỰ CỐ |
| 5 | Kiểm tra đơn **Đã có tiền, chưa giao** | /#/admin?tab=orders lọc `paid` | Đơn nào > 30 phút → giao ngay |

---

## TRƯỚC KHI NGỦ (2 phút)

| # | Việc |
|---|---|
| 1 | Xem còn đơn `pending` nào tạo > 2 giờ → khách bỏ, kệ |
| 2 | Xem còn `unmatched` (tiền chưa gán) → xử lý hết |
| 3 | Ghi số tiền đối soát hôm nay vào sổ |

---

## TELEGRAM — 6 LOẠI TIN

| Tin | Nghĩa | Phải làm |
|---|---|---|
| ✅ **TIỀN VÀO — ĐÃ TỰ GIAO** | Webhook khớp, key đã gửi khách | Không cần làm gì. Chỉ đọc để biết |
| ⚠️ **TIỀN VÀO KHÔNG KHỚP ĐƠN** | Khách ghi sai nội dung | **XỬ LÝ NGAY** — xem D2 |
| ⚠️ **CHUYỂN THIẾU TIỀN** | Khách CK thiếu | Chờ khách chuyển bù, hoặc bấm "Duyệt dù thiếu" |
| 💰 **KHÁCH BÁO ĐÃ CHUYỂN KHOẢN** | Khách bấm nút trên web | Mở app ngân hàng kiểm tra → bấm "Duyệt & giao key" |
| 📦 **ĐÃ CÓ TIỀN — HẾT HÀNG** | Đã thu tiền nhưng kho trống | Nhập hàng rồi bấm "Đã nhập hàng — giao ngay" |
| 🕐 **ĐƠN CẦN GIAO TAY** | Sản phẩm giao thủ công | Giao tay rồi bấm "Đã giao" |

---

## SỰ CỐ — PHÁT HIỆN & XỬ LÝ

### 1. Webhook SePay chết (NGUY HIỂM NHẤT)

**Dấu hiệu:** Cả ngày không có tin "TIỀN VÀO" nào, nhưng app ngân hàng có tiền.

**Xác minh:**
```powershell
curl.exe "https://xienhl.com/api/webhooks/health"
```
Xem `sepay.configured` = `true` (đã cấu hình) — nhưng vẫn có thể chết.

**Xử lý ngay:**
1. Vào admin → **Chờ thanh toán**
2. Xem ô "Tiền chưa gán đơn" — nếu có số → webhook có chạy một phần
3. Nếu **không có gì** → webhook chết hẳn
4. Mở app ngân hàng, đối chiếu từng giao dịch với đơn `pending`
5. Bấm **"Đã nhận tiền"** cho từng đơn khớp → giao key
6. Kiểm tra lại cấu hình SePay (URL + secret)

**Phòng ngừa:** Mỗi sáng bước 2 phải xem ô đỏ.

---

### 2. Tiền vào không khớp đơn

**Nguyên nhân:** Khách ghi sai nội dung, quên nội dung, hoặc gõ thiếu ký tự.

**Xử lý:**
1. Telegram báo số tiền + nội dung + mã GD
2. Mở admin → **Chờ thanh toán** → xem danh sách đơn `pending`
3. Tìm đơn có **số tiền khớp** + tạo trong **30 phút gần nhất**
4. Bấm **"Đã nhận tiền"** cho đơn đó
5. Nếu không tìm được → nhắn Zalo khách hỏi mã đơn

---

### 3. Khách nhắn "em chuyển 180k rồi sao chưa có key"

**Các bước:**
1. Hỏi: "Anh/chị cho em xin **mã đơn** hoặc **số điện thoại/username** đăng ký"
2. Vào admin → **Đơn hàng**, tìm theo mã đơn
3. Xem trạng thái:
   - `delivered` → "Đơn đã giao, anh/chị vào mục **Đơn hàng** để xem key"
   - `pending` → "Đơn chưa nhận được tiền. Anh/chị kiểm tra lại nội dung CK có đúng `MBKxxxxxx` không?"
   - `paid` → "Đã nhận tiền, em đang giao key, anh/chị chờ 5 phút"
4. Nếu khách gửi ảnh biên lai → đối chiếu số tiền + giờ → bấm **"Đã nhận tiền"**

---

### 4. Chuyển thiếu tiền

**Ví dụ:** Đơn 180k, khách chuyển 160k.

**Xử lý:**
- Hệ thống **KHÔNG giao**, đơn vẫn `pending`
- Telegram báo "CHUYỂN THIẾU TIỀN"
- **Cách 1 (khuyến nghị):** nhắn khách chuyển bù 20k → chuyển bù xong **tự giao**
- **Cách 2:** bấm **"Duyệt dù thiếu"** nếu muốn giữ khách

---

### 5. Khách chuyển 2 lần

**Xử lý:**
- Lần 1: tự giao
- Lần 2: Telegram báo "trùng" → **không giao thêm key**
- Hoàn tiền lần 2 qua chuyển khoản tay
- Vào admin → Đơn hàng → **Hoàn tiền** → ghi chú "hoàn thừa"

---

### 6. Hết hàng nhưng đã thu tiền

**Dấu hiệu:** Telegram "ĐÃ CÓ TIỀN — HẾT HÀNG", đơn ở trạng thái `paid`.

**Xử lý:**
1. Nhập thêm key vào kho (admin → Sản phẩm → Thêm key)
2. Bấm **"Đã nhập hàng — giao ngay"**
3. Nếu không nhập được → bấm **"Hoàn tiền tay"** + chuyển khoản cho khách

---

### 7. Nghi ngờ bị lợi dụng

**Dấu hiệu:** Người lạ chuyển 1.000đ rồi đòi key, hoặc spam nút "Tôi đã chuyển khoản".

**Xử lý:**
1. **KHÔNG** bấm duyệt nếu chưa thấy đủ tiền trong sao kê
2. Nút "Tôi đã chuyển khoản" có chống spam 2 phút/lần
3. Chặn Zalo nếu tiếp tục

---

## ĐỐI SOÁT CUỐI NGÀY

**Công thức:**
```
Số dư cuối ngày (app MB) − Số dư đầu ngày = Tổng tiền vào hôm nay
Tổng tiền vào hôm nay ≈ Tổng đơn "delivered" + "paid" hôm nay
```

**Lệch bao nhiêu thì chấp nhận?** 0đ. Lệch là có vấn đề.

**Nếu lệch:**
1. Xuất danh sách đơn hôm nay (admin → Đơn hàng, lọc theo ngày)
2. Xuất lịch sử giao dịch ngân hàng
3. So từng dòng
4. Ghi lại chỗ lệch, xử lý thủ công

---

## VIỆC HÀNG TUẦN

| Việc | Lệnh / Chỗ |
|---|---|
| Backup D1 | `npx wrangler d1 export muabankey-db --remote --output=backup-<ngày>.sql` |
| Xem dung lượng DB | Admin → Tổng quan (hiện ~2,3 MB / 10 GB — còn rất nhiều) |
| Kiểm tra kho key | Admin → Sản phẩm, xem sản phẩm nào sắp hết |
| Xoá user test | Script `scripts/cleanup-test-users` (trong db/archive) |

## VIỆC HÀNG THÁNG

| Việc | Ghi chú |
|---|---|
| Đổi `WEBHOOK_SECRET` | Tạo mới trong Cloudflare, cập nhật SePay |
| Kiểm tra `KEY_ENC` | **MẤT = MẤT TOÀN BỘ KHO KEY.** Backup file `.key-enc.txt` ra USB |
| Xem doanh thu tháng | Admin → Tổng quan |
| Rotate token Cloudflare | dash.cloudflare.com/profile/api-tokens |

---

## ⛔ 4 ĐIỀU TUYỆT ĐỐI KHÔNG

1. **KHÔNG** bấm "Đã nhận tiền" khi chưa mở app ngân hàng kiểm tra → mất hàng
2. **KHÔNG** xoá bảng `payments` / `orders` → mất chứng từ đối soát
3. **KHÔNG** để mất file `.key-enc.txt` → mất toàn bộ mật khẩu sản phẩm
4. **KHÔNG** chạy file trong `db/archive/` trên production → xoá sạch dữ liệu

---

## CẦN CẤU HÌNH (làm 1 lần)

Kiểm tra hạn QR, tiền tố nội dung, tự động giao — hiện **chưa có UI**, phải set qua D1:

```sql
-- Hạn QR (phút)
INSERT INTO settings (key, value, updated_at) VALUES ('order_ttl_minutes','30',0)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value;

-- Tiền tố nội dung CK
INSERT INTO settings (key, value, updated_at) VALUES ('payment_prefix','MBK',0)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value;

-- Tự động giao khi khớp tiền (1=có, 0=admin phải bấm)
INSERT INTO settings (key, value, updated_at) VALUES ('payment_auto_deliver','1',0)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value;
```

---

## SỐ LIỆU HIỆN TẠI (2026-11-12)

| | |
|---|---|
| Đơn | 88 (delivered 29, cancelled 28, pending 23, expired 5, refunded 3) |
| Sổ tiền vào | 28 dòng: matched 16 (3.030.000đ), unmatched 6 (1.362.000đ), wrong_amount 6 (543.000đ) |
| **Tiền chưa xử lý** | **1.905.000đ** (unmatched + wrong_amount) |
| Users | 152 |
| Licenses | 4.614 (aoe1 4.053, trial 523) |
| DB size | 2,26 MB / 10 GB |
| Region | APAC |
