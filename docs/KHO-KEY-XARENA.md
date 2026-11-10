# Kho key XArena No Fog

## Đã tạo

| Gói | Số lượng | Hạn | Giá |
|---|---|---|---|
| Tuần | 1000 | 7 ngày (+1 bonus) | 70.000đ |
| Tháng | 1000 | 30 ngày (+1) | 180.000đ |
| Năm | 1000 | 365 ngày (+1) | 590.000đ |
| Vĩnh viễn | 1000 | không giới hạn | 1.290.000đ |
| **Tổng** | **4000** | | |

File: `keys/xarena-<timestamp>.txt` (đọc được) + `.csv` (import Excel/Sheets).

Mọi key **duy nhất** — sinh bằng `crypto.getRandomValues` (CSPRNG), alphabet loại bỏ `0/O/1/I` để khách đọc không nhầm.

## Định dạng key

```
AOE1-MX8V-4HDD-KMX4
```

- Prefix `AOE1` — nhận diện thương hiệu
- 3 nhóm 4 ký tự — dễ đọc qua điện thoại, khó gõ nhầm

## Tạo lệnh cài cho 1 key

```powershell
# Theo key cụ thể
node scripts/make-install.mjs AOE1-MX8V-4HDD-KMX4

# Theo vị trí trong file kho
node scripts/make-install.mjs --file keys/xarena-2026-11-10.txt --index 5
```

Kết quả:

```
── LỆNH GỬI KHÁCH (copy nguyên dòng) ──

powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm https://xienhl.com/i/AOE1-MX8V-4HDD-KMX4.ps1?t=...)"
```

Kèm 3 file trong `keys/cmd/`:
- `cai-dat-<KEY>.cmd` — double-click được
- `cai-dat-<KEY>.ps1` — chuột phải → Run with PowerShell
- `HUONG-DAN-<KEY>.md` — hướng dẫn 3 cách, gửi khách đọc

## Quy trình bán thủ công (Zalo/Telegram)

```
1. Khách chuyển khoản
2. Vào Telegram → bấm Duyệt (tiền vào ví) 
   hoặc xác nhận tay nếu chưa nối webhook
3. Copy 1 key từ file kho
4. node scripts/make-install.mjs <KEY>
5. Gửi khách: lệnh PowerShell (1 dòng) + file HUONG-DAN
6. Khách làm 3 bước: Win+R → dán → Enter → Yes
7. Xong sau ~17 giây
```

## Quy trình bán tự động (qua web)

Khác hoàn toàn — không cần kho:

```
1. Khách nạp tiền vào ví
2. Mua trên web
3. Hệ thống TỰ SINH key mới (không lấy từ kho 4000 key này)
4. Khách bấm "Lấy lệnh cài đặt"
```

**Lưu ý:** kho 4000 key này dành cho **bán thủ công**. Khi khách mua qua web, `deliverLicenseLine()` sinh key mới bằng `issueLicenses()`, không đụng tới kho.

Nếu muốn dùng kho cho web thì phải sửa `deliverLicenseLine()` để lấy key từ `product_keys` thay vì sinh mới — hiện chưa làm.

## Kiểm tra kho

```powershell
# Đếm theo gói
npx wrangler d1 execute muabankey-db --remote --command="
  SELECT CAST(ROUND((expires_at-created_at)/86400.0) AS TEXT) AS ngay, COUNT(*) n
  FROM licenses WHERE plan='aoe1' AND note LIKE 'Kho %'
  GROUP BY ngay"
```

Hoặc xem file: `keys/xarena-*.txt`

## Token cài đặt

- Hiệu lực **24 giờ**
- Dùng lại được nhiều lần trong 24h (không phải 1 lần)
- Hết hạn → gọi `make-install.mjs` lại để sinh token mới

## Lưu ý quan trọng

**Hạn tính từ lần kích hoạt đầu tiên**, không phải lúc tạo key. Key trong kho có `expires_at=null` cho tới khi khách cài lần đầu.

**+1 ngày bonus** — thiết kế có sẵn: gói Tuần 7 ngày → khách nhận 8 ngày. Gói Tháng 30 → 31. Gói Năm 365 → 366.

**Key vĩnh viễn** có `expires_at=0` (không phải null). Cẩn thận khi query — hai giá trị mang nghĩa khác nhau.
