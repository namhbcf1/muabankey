# QA UX + VẬN HÀNH — xienhl.com

> Đo thật bằng Chrome headless CDP (port 9222), 1440×900 và 390×844.
> Ngày: 2026-11-12 · Script: `scripts/qa/*.mjs` · Ảnh: `shots/`

---

## BẢNG KẾT QUẢ

| # | Trang / Tính năng | Kết quả | Vấn đề |
|---|---|---|---|
| **A. TRANG CÔNG KHAI** | | | |
| 1 | `/` trang chủ | ✅ | Render 3.335 ký tự, 0 console error, 0 HTTP error, không tràn ngang. Đủ hero + 2 card dùng thử + footer |
| 2 | `/products` | ✅ | 1.613 ký tự, 0 lỗi |
| 3 | `/product/license-xarena-thang` | ⚠️ | Render OK nhưng hiện **"5.0 (0 đánh giá)"** — 5 sao dù chưa có đánh giá nào (ratingCount=0 ở cả 4 sản phẩm) → **ĐÃ SỬA** |
| 4 | `/tai-ve` | ❌→✅ | **P0: trang TRẮNG HOÀN TOÀN.** 25 icon có `size: 9101312` (= đúng dung lượng file EXE 9.101.312 byte bị dán nhầm) → trang rộng **9.101.548px**. Đã sửa về `size: 15`, verify lại OK |
| 5 | `/huong-dan` | ✅ | 1.657 ký tự, 0 lỗi |
| 6 | `/support` | ✅ | 2.601 ký tự, 0 lỗi |
| 7 | `/login` | ✅ | Render form, 0 lỗi |
| 8 | `/register` | ✅ | Render form, 0 lỗi |
| — | `/khong-ton-tai` (404) | ✅ | Trang 404 tử tế, có nút về nhà |
| **B. LUỒNG KHÁCH** | | | |
| 9 | Đăng ký user mới | ✅ | Tạo + tự đăng nhập OK |
| 10 | Thêm vào giỏ | ✅ | `mbk_cart` đúng, 1 sản phẩm 180.000₫ |
| 11 | Checkout hiện "Chuyển khoản QR" | ✅ | Đúng nhãn, đúng tổng tiền |
| 12 | Bấm tạo mã QR | ✅ | Vào `#/order/<uuid>` |
| 13 | Trang QR: số tiền | ✅ | **180.000₫** đúng |
| 14 | Trang QR: nội dung MBK | ✅ | `MBK3YLPW9` (khớp mã đơn `MBK-3YLPW9`) |
| 15 | Trang QR: STK | ✅ | **0010131639304** · MBBank · NGUYEN THANH NAM |
| 16 | Trang QR: đếm ngược | ✅ | 29:55, chạy đúng |
| 17 | Trang QR: nút "Tôi đã chuyển khoản" | ✅ | Bấm được, báo "Đã ghi nhận", chống spam OK |
| 18 | Nút Copy nội dung | ✅ | Copy đúng memo (test bằng click thật qua `Input.dispatchMouseEvent`) |
| 19 | `/orders` hiện đơn đúng | ✅ | `MBK-3YLPW9` · 180.000₫ · "Chờ chuyển khoản" |
| 20 | "Thanh toán ngay" mở đúng QR | ✅ | Mở lại đúng memo, **KHÔNG tạo đơn mới** (1→1) |
| 21 | `/licenses` | ✅ | Render OK (rỗng vì user mới, đúng) |
| **C. ADMIN** | | | |
| 22 | Đăng nhập admin | ✅ | `namhbcf` / role `admin` → `/admin` |
| 23 | Tab Tổng quan | ✅ | 6 stat card, 0 console error |
| 24 | Tab Chờ thanh toán | ✅ | 8.771 ký tự, 2 bảng, 92 dòng. Có ô "Tiền chưa gán đơn" + "Tổng đã khớp" |
| 25 | Tab Đơn hàng | ✅ | 20.893 ký tự, 200 dòng |
| 26 | Tab Sản phẩm | ✅ | 4 sản phẩm |
| 27 | Tab Kho key | ✅ | Render (trống — sản phẩm license không dùng kho key) |
| 28 | Tab License | ✅ | 35.313 ký tự, 300 dòng, **KHÔNG còn lỗi 1970** (ngày đúng: `19:47 15/11/2026`) |
| 29 | Tab Dùng thử | ✅ | 10 dòng |
| 30 | Tab Vô hạn | ✅ | 2 dòng |
| 31 | Tab Người dùng | ✅ | Đã bỏ cột "Số dư" (agent khác sửa song song), không còn chữ "nạp tiền"/"ví" |
| 32 | Tab Cài đặt | ✅ | Có ngân hàng (MBBank/0010131639304/NGUYEN THANH NAM), cửa sổ giờ, cấu hình trial, webhook SePay+payOS |
| 33 | Tab Nhật ký | ✅ | 19 dòng |
| 34 | Có tab nào trắng/treo? | ✅ | **Không.** 11/11 tab render, 0 console error, 0 HTTP error |
| **D. NHẤT QUÁN NỘI DUNG** | | | |
| 35 | Còn "nạp tiền"/"ví"/"số dư"? | ❌→✅ | `account.js`: "số dư ví của bạn" + metric **"Số dư ví"** → **ĐÃ SỬA** (bỏ hẳn metric). Lưu ý DB vẫn còn 11 user `balance>0`, tổng **5.687.000₫** |
| 36 | "offline grace 24 giờ"? | ❌→✅ | 3 sản phẩm (tuần/tháng/năm) ghi **"Hỗ trợ offline grace 24 giờ"** nhưng `GRACE_HOURS = 0` (`license-server.js:60`) và **4.491/4.491 license có `grace_h = 0`** → **ĐÃ SỬA DB** thành "Bắt buộc có mạng khi chạy tool" |
| 37 | "17 cổng thanh toán"? | ✅ | Không có ở đâu |
| 38 | "gửi key qua email"? | ✅ | Không có. Chỉ có 2 chỗ nói "liên hệ qua email" (checkout giao tay) và nút `mailto:` ở orders — không phải hệ thống gửi mail |
| 39 | Số liệu bịa | ❌→✅ | Footer **"Nền tảng ... hàng đầu Việt Nam"** → đổi thành "Cửa hàng bản quyền số cho game thủ Việt". Không có 4.9★ / 99.9% |
| 40 | Link hỏng | ✅ | Không có link trỏ route không tồn tại (route `/wallet` vẫn được map sang `/orders`, không hỏng) |
| 41 | Nút không handler | ✅ | 0 nút thiếu handler trên 8 trang công khai |
| **E. MOBILE 390×844** | | | |
| 42 | Trang chủ | ✅ | Không tràn ngang |
| 43 | Sản phẩm | ✅ | Không tràn ngang |
| 44 | Chi tiết SP | ✅ | Không tràn ngang |
| 45 | Checkout | ✅ | Không tràn ngang, nút tạo QR 47px |
| 46 | **Trang QR** | ✅ | QR hiện đủ **280×328px**, ảnh thật 540×640. Đủ tiền + memo + STK + đếm ngược. Không tràn ngang |
| 47 | Nút bấm được? | ⚠️ | Nút "Tạo mã QR" 47px OK, nhưng nút **Copy + "Tôi đã chuyển khoản" chỉ 30px** — dưới ngưỡng khuyến nghị 44px (WCAG 2.5.8 cần ≥24px nên vẫn đạt tối thiểu) |
| 48 | `/tai-ve` mobile | ❌→✅ | Cùng bug P0, sau fix: rộng đúng 390px, nút tải 54px |
| **F. VẬN HÀNH** | | | |
| 49 | `RUNBOOK.md` đủ để tự vận hành? | ⚠️ | Khá tốt: có việc mỗi sáng/tối, 6 loại tin Telegram, 7 kịch bản sự cố, công thức đối soát, việc tuần/tháng, 4 điều cấm. **Nhưng thiếu** (xem dưới) |
| 50 | Thiếu quy trình sự cố / đối soát / backup? | ⚠️ | **BACKUP: không có script.** RUNBOOK chỉ ghi lệnh `wrangler d1 export` thủ công. **ĐỐI SOÁT: không có công cụ** — chỉ có công thức Excel tay. **Không có runbook diễn tập khôi phục** (backup mà chưa test restore = chưa có backup) |
| 51 | Admin xử lý tiền chưa gán / đơn kẹt / hoàn tiền? | ⚠️ | Có: nút "Đã nhận tiền" (`data-confirm-pay`), "Đã giao" (`data-deliver`), "Hoàn tiền" (`data-refund`). **Nhưng**: ô "Tiền chưa gán đơn" chỉ hiện SỐ ĐẾM + cảnh báo, **KHÔNG có nút gán giao dịch đó vào một đơn cụ thể**. Admin phải tự tìm đơn rồi bấm "Đã nhận tiền". Với 7 giao dịch / 4.350.000₫ đang tồn (theo dữ liệu thật), đây là thao tác tay dễ sai |
| 52 | Cảnh báo tự động khi webhook chết? | ❌ | **KHÔNG CÓ.** `/api/webhooks/health` chỉ trả `configured: true/false` (cấu hình có tồn tại), **không** trả "lần cuối nhận được tiền là khi nào". Cron 10 phút chỉ dọn dữ liệu + báo sắp hết hàng + license sắp hết hạn. Không có dead-man switch. RUNBOOK mục 1 tự nhận đây là "NGUY HIỂM NHẤT" và chỉ có cách phát hiện thủ công mỗi sáng |
| **G. TỐC ĐỘ** | | | |
| 53 | Trang chủ | ✅ | TTFB **99ms** · render 918ms · 118KB · 27 request |
| 54 | `/products` | ✅ | TTFB **74ms** · render **114ms** · 117KB · 25 request |
| 55 | Chi tiết SP | ✅ | TTFB **90ms** · render 430ms · 117KB |
| 56 | `/tai-ve` | ✅ | TTFB **125ms** · render 494ms · 115KB |
| 57 | `/checkout` | ✅ | TTFB **76ms** · render 439ms · 115KB |
| 58 | Tài nguyên chậm/nặng? | ✅ | Nặng nhất `style.css` **21KB** (đã nén). Không có ảnh/font quá lớn. Chậm nhất là gọi API `/api/auth/me` ~500ms — chấp nhận được |

---

## LỖI P0 MỚI PHÁT HIỆN — RÒ RỈ POLL TIMER

**Mức độ: P0 (ảnh hưởng mọi khách đã thanh toán).**

`showQrPayment()` trong `checkout.js` **có** `return` hàm dọn dẹp (clear interval poll 4s + đồng hồ đếm ngược), nhưng `mountCheckout()` gọi nó mà **không chuyển giá trị đó cho router** → router không bao giờ gọi cleanup.

Hệ quả đo được: khách xem trang QR rồi rời đi, **mỗi lần xem là một interval 4 giây sống vĩnh viễn**. Sau khi rời trang 14 giây: **8 interval còn chạy, 28 request** — gọi cả order ID cũ đã 404. Khách xem QR 5 lần trong một phiên = 5 poll vĩnh viễn cho tới khi đóng tab. Tốn request Worker (tính tiền), làm bẩn log, và tệ hơn: nếu một đơn cũ chuyển sang `paid` thì hàm `showSuccess()` sẽ **ghi đè DOM của trang khác** đang xem.

**Đã sửa** (`public/assets/pages/checkout.js`): thêm biến đóng kín `qrCleanup` + hàm `done()` trả về router, cập nhật ở cả 2 đường vào màn QR (tạo đơn mới từ nút, và mở lại đơn có sẵn từ nút "Thanh toán ngay"). Điểm quan trọng: đường thứ nhất chạy trong **click handler** — tức là sau khi `mountCheckout` đã return, nên `return` ở đó không tới được router; phải dùng biến đóng kín.

**Đã verify trên server local:** rời trang 14 giây → **0 request** (trước: 28). Cả 2 đường. "Thanh toán ngay" vẫn không tạo đơn mới (1→1).

---

## TOP 10 VIỆC CẦN SỬA (xếp theo ảnh hưởng khách)

| # | Việc | Mức | Vì sao |
|---|---|---|---|
| 1 | ~~`/tai-ve` trang trắng do `size: 9101312`~~ **ĐÃ SỬA** | P0 | Trang tải EXE là bước cuối phễu mua. Khách vào thấy trắng → mất niềm tin + không tải được tool = không mua. Nguyên nhân: dung lượng file EXE bị dán nhầm vào tham số `size` của `icon()` |
| 2 | ~~Rò rỉ poll timer màn QR~~ **ĐÃ SỬA — CẦN DEPLOY** | P0 | Mỗi lần xem QR = 1 interval vĩnh viễn (28 request/14s). Tốn tiền Worker + có thể ghi đè DOM trang khác khi đơn cũ chuyển `paid` |
| 3 | **Không có cảnh báo webhook chết** | P0 | Nếu SePay ngừng gọi webhook, tiền khách vào mà **không ai biết** cho tới sáng hôm sau (RUNBOOK tự gọi đây là "NGUY HIỂM NHẤT"). Cần: dead-man switch — cron kiểm tra `MAX(created_at)` của bảng `payments`, nếu > 6 giờ không có giao dịch nào **và** giờ đang trong cửa sổ bán hàng → báo Telegram đỏ |
| 4 | ~~"offline grace 24 giờ" là thông tin SAI~~ **ĐÃ SỬA DB** | P1 | Cam kết với khách một tính năng không tồn tại (`GRACE_HOURS=0`, 4.491/4.491 license `grace_h=0`). Khách mất mạng giữa trận → tool dừng → đòi hoàn tiền, và đúng lý |
| 5 | ~~Còn "Số dư ví"/ví~~ **ĐÃ SỬA** + **DB còn 5.687.000₫** | P1 | Giao diện nói đã bỏ ví, nhưng **11 user đang giữ tổng 5.687.000₫** trong cột `users.balance`. Số tiền này không tiêu được ở đâu nữa (route `/wallet` đã chuyển sang `/orders`). Phải quyết: hoàn lại, hay giữ và hiển thị lại |
| 6 | **Admin không có nút gán tiền chưa khớp vào đơn** | P1 | Ô "Tiền chưa gán" chỉ báo SỐ ĐẾM. Admin phải tự dò đơn rồi bấm "Đã nhận tiền". Hiện có **7 giao dịch / 4.350.000₫** tồn đọng — thao tác tay dễ gán sai đơn |
| 7 | **Không có script backup + chưa diễn tập restore** | P1 | RUNBOOK ghi lệnh export thủ công, dễ quên. Backup chưa test restore thì chưa phải backup. Cần `scripts/backup.ps1` + một lần diễn tập khôi phục thật vào DB tạm |
| 8 | ~~"5.0 (0 đánh giá)"~~ **ĐÃ SỬA** | P2 | Hiện 5 sao khi chưa có đánh giá nào = tự khen. Khách tinh ý sẽ mất tin |
| 9 | ~~"hàng đầu Việt Nam"~~ **ĐÃ SỬA** | P2 | Claim không chứng minh được ở footer mọi trang |
| 10 | Nút Copy / "Tôi đã chuyển khoản" chỉ **30px** trên mobile | P3 | Dưới 44px khuyến nghị. Đây là nút khách bấm nhiều nhất trên điện thoại khi đang chuyển khoản → dễ bấm trượt |

### Việc nhỏ nên làm thêm
- `RUNBOOK.md` mục "CẦN CẤU HÌNH" còn ghi "hiện **chưa có UI**, phải set qua D1" cho hạn QR / tiền tố / tự động giao — nhưng tab **Cài đặt** đã có cửa sổ giờ. Rà lại cho khớp.
- `RUNBOOK.md` mục "Xoá user test" trỏ `scripts/cleanup-test-users` — **file không tồn tại** trong repo.
- `style.css` còn định nghĩa `.wallet`/`.Ví`/khối "QR nạp tiền" (dòng 1463, 1483) — CSS chết, không sai sự thật nhưng nên dọn.
- Trang `/tai-ve` khai `FALLBACK.version = '1.4.1.0'` và hash hard-code; API trả cùng giá trị nên hiện đúng, nhưng nếu quên `update-exe-hash.mjs` khi build EXE mới thì trang sẽ hiện hash cũ → khách tưởng file bị chèn. Nên để trống hash khi API lỗi thay vì hiện hash tĩnh.

---

## PHƯƠNG PHÁP

- Chrome headless CDP `127.0.0.1:9222`, viewport 1440×900 và 390×844 (mobile=true, DPR 2).
- Đo console error qua `Runtime.consoleAPICalled` + `Runtime.exceptionThrown`; HTTP error qua `Network.responseReceived` (status ≥ 400).
- Tràn ngang: so `documentElement.scrollWidth` với `clientWidth` **và** liệt kê từng element có `getBoundingClientRect().right > clientWidth`.
- Tốc độ: điều hướng **document mới** cho mỗi trang (hash route không reload nên đo bằng hashchange là sai), đọc `performance.getEntriesByType('navigation')` + `resource`.
- Rò rỉ poll: hook `window.fetch` sau khi rời trang rồi đếm 14 giây.
- Copy clipboard: `el.click()` trong `Runtime.evaluate` **không** có user activation thật → `NotAllowedError`. Phải dùng `Input.dispatchMouseEvent` (mousePressed + mouseReleased) mới đo đúng.
