# Nghiên cứu mô hình giá & chiến lược chuyển đổi — XArena No Fog

> Tài liệu nội bộ để chủ shop quyết định. Không phải lệnh tăng giá.
> Ngày lập: 10/11/2026 · Nguồn giá: `db/seed-license-products.sql`

## 0. Xác nhận dữ liệu hiện có (đọc từ code)

| Gói | product_id | Giá | compare_price | license_days | warranty_days | Badge |
|---|---|---|---|---|---|---|
| Tuần | `p-lic-week` | 70.000đ | 150.000đ | 7 | 7 | — |
| Tháng | `p-lic-month` | 180.000đ | 300.000đ | 30 | 30 | HOT |
| Năm | `p-lic-year` | 590.000đ | 1.500.000đ | 365 | 365 | SALE |
| Vĩnh viễn | `p-lic-forever` | 1.290.000đ | 2.900.000đ | 0 (=∞) | 365 | HOT |

Cơ chế kỹ thuật đã có sẵn (quan trọng cho trial):
- `issueLicenses()` — sinh key `<PREFIX>-XXXX-XXXX-XXXX`, cấp hạn `(days + 1) * 86400`.
- `bindFirstTime()` — **hạn tính từ lần kích hoạt đầu**, không phải từ lúc mua.
- `judge()` — chặn `expired` / `hwid_mismatch` / `revoked`.
- `lic_events` — log mọi `activate` / `check` / `deny` / `rebind` kèm timestamp.
- Coupon engine đầy đủ: `type`, `value`, `min_subtotal`, `max_discount`, `usage_limit`, `starts_at`, `expires_at`.
- **Chưa có**: bảng trial, chống trùng trial theo HWID, hệ thống email.

---

## A. Phân tích mô hình giá hiện tại

### A1. Giá/ngày

| Gói | Giá | Số ngày | **đ/ngày** | So gói trước |
|---|---:|---:|---:|---:|
| Tuần | 70.000 | 7 | **10.000** | — |
| Tháng | 180.000 | 30 | **6.000** | −40,0% |
| Năm | 590.000 | 365 | **1.616** | −73,1% |
| Vĩnh viễn | 1.290.000 | 1.095 (3 năm) | **1.178** | −27,1% |

Giá/ngày **giảm đơn điệu** — thang giá đúng hướng. Không có bậc nào bị "ngược".

### A2. Chiết khấu có hợp lý không?

Hợp lý, nhưng **lệch pha**:

- Tuần → Tháng: −40%/ngày cho 2,57× tiền. Rất mạnh, chuẩn.
- Tháng → Năm: **−73%/ngày** cho 3,28× tiền. Đây là bậc chiết khấu quá tay.
- Năm → Vĩnh viễn: chỉ −27%/ngày cho 2,19× tiền. Bậc yếu nhất.

Hệ quả: **gói Năm đang là món hời nhất thị trường nội bộ của bạn**. 590k/năm = 49k/tháng — rẻ hơn cả một tháng lẻ (180k) tới 73%. Về mặt kinh tế đơn vị, gói Năm đang bị định giá thấp so với gói Tháng.

Điểm hoà vốn Vĩnh viễn vs Năm: `1.290.000 / 590.000 = 2,19 năm`. Khách phải gắn bó > 2,2 năm mới "lời". Với tool game có rủi ro bị patch/bị ban, 2,2 năm là một canh bạc dài → **gói Vĩnh viễn khó bán, và điều đó không sao**.

### A3. Anchor & best-seller

- **Anchor tốt nhất = Vĩnh viễn 1.290.000đ.** Nó không cần bán chạy; nhiệm vụ của nó là làm 590k trông rẻ. Giữ nguyên.
- **Best-seller nên là gói Tháng 180.000đ.** Đây là điểm cân bằng: đủ tiền để có lãi, đủ rẻ để quyết định trong 1 phút. Hiện đã gắn badge HOT + `featured=1` → đúng.
- **Vấn đề**: đang có **2 badge HOT** (Tháng và Vĩnh viễn). Hai "HOT" = không có HOT nào. Đề xuất: Tháng giữ HOT, Vĩnh viễn đổi thành "TRỌN ĐỜI".

### A4. Thiếu gói gì?

| Gói thiếu | Nên thêm? | Lý do |
|---|---|---|
| 1 ngày | ❌ Không | Giá trị đơn quá nhỏ, phí đối soát VietQR lấn át lãi |
| 3 ngày (trả tiền) | ❌ Không | **Trial 3 ngày đã phủ chỗ này** — bán 3 ngày sẽ giết trial |
| **6 tháng** | ✅ **Có** | Bậc trống lớn nhất: 180k → 590k là cú nhảy 3,3× |
| **Gia hạn (renewal)** | ✅ **Rất nên** | Thiếu hoàn toàn. Khách cũ là tệp chuyển đổi rẻ nhất |

**Đề xuất gói 6 tháng: 379.000đ / 180 ngày** = 2.106 đ/ngày (−65% so Tháng, +30% so Năm).
Tác dụng: làm bậc thang mượt, và làm gói Năm 590k trông như "thêm 211k được gấp đôi thời gian" → đẩy người mua 6 tháng lên Năm.

---

## B. Thiết kế trial 3 ngày

### B5. 3 ngày có hợp lý với giá 70k/tuần?

**Có, rất hợp lý.** Trial 3 ngày = 30.000đ giá trị quy đổi = **43% gói Tuần**. Đây là tỷ lệ lành mạnh (thông lệ 33–50%). Nếu trial 7 ngày = 100% gói Tuần → khách dùng hết tuần rồi biến mất.

Quan trọng hơn: **chi phí biên của 1 ngày trial gần bằng 0** (chỉ là băng thông API). Bạn không mất gì khi cho 3 ngày — cái bạn mất là *cơ hội bán*, và 3 ngày là đủ ngắn để cơ hội đó còn nóng.

### B6. 3 ngày có đủ "nghiện" không? Hay nên 7 ngày?

**3 ngày là đúng. Không nên 7.**

Lý do theo hành vi người chơi AoE:
- AoE chơi theo *phiên*, thường cuối tuần + 2–3 buổi tối. 3 ngày = trọn 1 kỳ chơi điển hình.
- Nỗi đau "bỏ sương mù" được cảm nhận **ngay trận đầu tiên**, không cần tích luỹ. Đây là công cụ, không phải game — không cần 7 ngày để hiểu giá trị.
- 7 ngày free = 23% tháng, ăn mòn gói Tháng và **trì hoãn quyết định mua** (khách có xu hướng chờ tới ngày thứ 6).

**Mẹo quan trọng đã có sẵn trong code:** hạn tính từ **lần kích hoạt đầu** (`bindFirstTime`), không phải lúc phát key. Nghĩa là khách tải key hôm nay, 5 ngày sau mới dùng → vẫn còn đủ 3 ngày. **Hãy quảng bá điểm này**: "3 ngày tính từ lần kích hoạt đầu tiên". Nó vừa công bằng vừa là lợi thế cạnh tranh.

Lưu ý: `issueLicenses()` cộng `term + 1` ngày → trial 3 ngày thực nhận **4 ngày**. Đây là hành vi có sẵn của mọi gói (tháng 30 → 31 ngày). Không cần sửa, nhưng đừng quảng cáo "chính xác 3 ngày".

### B7. Trial có nên giới hạn chức năng?

**KHÔNG. Tuyệt đối không.**

Tool này bản chất chỉ có một giá trị: **bỏ sương mù**. Nếu bạn khoá tính năng, trial không dạy được khách điều gì → tỷ lệ chuyển đổi sụp. Giới hạn chức năng chỉ hợp lý với SaaS nhiều module (nơi bạn bán *phần mở rộng*), không hợp với một tool đơn năng.

Giới hạn đúng chỗ là **thời gian**, không phải tính năng. Cho full quyền, 3–4 ngày.

Cái nên giới hạn (về mặt license):
- `max_rebind = 0` cho key trial → không đổi máy được, muốn đổi thì phải mua.
- Không gia hạn key trial (`extendLicense` phải chặn `plan='trial'`).
- Gắn cờ `plan='trial'` + `note='trial'` để revoke hàng loạt khi cần.

### B8. Hết trial nên bán gói nào?

**Đường upsell tối ưu: Trial → Tháng (không phải Tuần).**

| Vị trí | Gói | Vai trò |
|---|---|---|
| Mặc định (nút lớn, viền vàng) | **Tháng 180.000đ** | Đích chính. Kèm "tặng 7 ngày" → 37 ngày = 4.865đ/ngày |
| Phương án phụ (nút nhỏ) | Tuần 70.000đ | Cứu khách do dự. "Chưa sẵn sàng? Thử 1 tuần" |
| Neo (chỉ hiển thị) | Năm 590.000đ | Làm Tháng trông hợp lý |

Lý do không đẩy Tuần làm mặc định: Tuần 10.000đ/ngày dạy khách thói quen **chu kỳ ngắn, rẻ** — về sau rất khó nâng lên Tháng. Mỗi lần khách mua Tuần, bạn phải bán lại một lần nữa sau 7 ngày.

Ngoại lệ: nếu khách đã xem bảng giá > 2 lần mà chưa mua, chủ động chào Tuần.

---

## C. Chiến lược chuyển đổi trial → paid

### C9. Khi trial còn 1 ngày nên làm gì?

Làm cả 3, theo thứ tự ưu tiên:

**(1) Hiển thị giá trị đã dùng — mạnh nhất, và buildable ngay.**
`lic_events` đã log mọi lần `/api/check` với timestamp. Bạn tính được số phiên và ước lượng giờ chơi:
```sql
SELECT COUNT(*) AS so_lan_check,
       MIN(at) AS bat_dau, MAX(at) AS ket_thuc
FROM lic_events WHERE key = ? AND kind = 'check';
```
Hiển thị: *"3 ngày qua bạn đã vào 7 phiên, ~6,5 giờ chơi không sương mù."* Con số cụ thể mạnh hơn mọi lời chào hàng.

**(2) Giảm giá khẩn cấp — có, nhưng đúng liều.**
Coupon `TRIAL24`: giảm **20%**, chỉ áp cho gói Tháng, `usage_limit=1`, hết hạn sau 24h, `min_subtotal=180000`, `max_discount=36000`.
→ Tháng còn **144.000đ**. Chi phí giành 1 khách = 36.000đ. Rẻ hơn nhiều so với chạy quảng cáo để có 1 khách mới.

Không nên giảm 30–40%: phá thang giá và dạy khách chờ giảm giá.

**(3) Nhắc nhở ở 3 điểm chạm:** banner trong web (khi đăng nhập), trang "License của tôi", và tin nhắn nhóm Zalo.

### C10. Có nên tặng thêm ngày nếu mua ngay lần đầu?

**Có — và nên dùng "tặng ngày" thay vì "giảm giá".**

Đề xuất: **mua gói Tháng trong 24h sau khi trial kết thúc → tặng 7 ngày** (tổng 37 ngày).
- Giá trị tặng: 7 × 6.000 = 42.000đ — tương đương mức giảm 23%.
- Nhưng **giá niêm yết 180k không bị bẩn**. Khách vẫn thấy mình mua đúng giá, chỉ được thưởng thêm.

Nguyên tắc: **giảm giá làm hỏng thang giá, tặng ngày thì không.** Ưu tiên tặng ngày.
Kỹ thuật: cấp key `days=37`, hoặc cấp 30 rồi gọi `extendLicense(key, 7)`.

Quan trọng: **chỉ áp 1 trong 2** (giảm 20% HOẶC tặng 7 ngày), không stack. Stack = mất 43% doanh thu gói đầu.

### C11. Có nên hoàn tiền trong 24h?

**Không.** Và lý do rất rõ: **trial 3 ngày đã thay thế hoàn toàn nhu cầu "dùng thử rồi trả lại".**

Hoàn tiền 24h trên sản phẩm số gắn HWID là lỗ hổng: mua → dùng → hoàn tiền → mua lại. Bạn không lấy lại được gì (license đã tiêu thụ), và mất công đối soát chuyển khoản 2 chiều.

Thay bằng thứ **mạnh hơn và miễn phí**: **"Bảo hành kích hoạt — key không dùng được, đổi key mới ngay"**. Đây không phải hoàn tiền, đây là cam kết kỹ thuật. Với khách Việt mua tool game, nỗi sợ thật là *"mua xong key không chạy"*, không phải *"mua rồi thấy không thích"*. Trial đã xử lý cái thứ hai.

### C12. Email/Zalo nhắc nhở có hiệu quả?

**Zalo: rất hiệu quả. Email: gần như vô dụng. Đừng xây hệ thống email.**

- Shop **chưa có** email system (`grep` xác nhận). Xây mới để gửi nhắc trial là đầu tư sai chỗ — game thủ VN 18–35 gần như không đọc email giao dịch.
- **Zalo là kênh đúng.** Cụ thể: tạo **nhóm Zalo cộng đồng** (miễn phí, mở 90%+). Đây là nơi thông báo: trial sắp hết, mã giảm giá, bản cập nhật chống patch.
- Hiện `SUPPORT_ZALO = "https://zalo.me/0000000000"` và `t.me/muabankey` — **số Zalo vẫn là placeholder 0000000000**, phải sửa trước khi chạy trial.
- Kênh nhắc **hiệu quả nhất lại miễn phí**: banner trong web + trang license của khách. Không cần hạ tầng mới.

Ưu tiên: (1) banner web → (2) nhóm Zalo → (3) email (bỏ).

---

## D. Tâm lý học giá

### D13. Có nên đổi 70k/180k/590k → 69k/179k/589k?

**Không nên.** Đây là trường hợp charm pricing **phản tác dụng** ở thị trường này.

Lý do cụ thể: thanh toán qua **VietQR + đối soát chuyển khoản MBBank**. Số tròn (70.000, 180.000, 590.000) giúp khách chuyển đúng và giúp bạn đối soát nhanh. Số lẻ làm tăng lỗi chuyển sai và tăng thời gian xử lý tay — đổi lấy mức tăng chuyển đổi gần như bằng 0 ở mức giá 70–590k.

Charm pricing hiệu quả ở mức giá tâm lý (99k, 199k) khi khách so sánh nhanh trên sàn. Ở đây khách mua qua chat/nhóm + chuyển khoản, không có ma sát "99 vs 100".

**Nếu vẫn muốn thử**: đổi **duy nhất gói Tháng** thành 179.000đ và đo trong 30 ngày. Đừng đổi cả 4 gói cùng lúc — bạn sẽ không biết cái gì tạo ra tác động.

### D14. Có nên hiển thị "tiết kiệm X%"?

**Đã có sẵn và đang chạy** — `src/routes/products.js:25` tính `discountPercent` từ `compare_price`, và `product-detail.js:108` hiển thị "Tiết kiệm X%".

Vấn đề: các `compare_price` hiện tại **phóng đại**. Ví dụ Tuần: 150.000đ gạch xuống 70.000đ = "tiết kiệm 53%" — nhưng 150k là con số không có thật. Game thủ VN khá nhạy với "giá ảo", và shop bán tool kỹ thuật cần giữ uy tín.

**Đề xuất mạnh hơn: thêm dòng "đ/ngày".** Nó thật, và làm đúng việc thuyết phục:

| Gói | Giá | Hiển thị thêm |
|---|---:|---|
| Tuần | 70.000đ | ~10.000đ/ngày |
| Tháng | 180.000đ | **6.000đ/ngày** — rẻ hơn 40% |
| 6 tháng | 379.000đ | ~2.106đ/ngày |
| Năm | 590.000đ | **~1.616đ/ngày** — rẻ hơn 73% |
| Vĩnh viễn | 1.290.000đ | ~1.178đ/ngày |

"1.616đ/ngày" bán hàng giỏi hơn "tiết kiệm 61%" rất nhiều, vì khách quy đổi được ngay sang "một cốc trà đá". Kỹ thuật: thêm 1 dòng trong `product-detail.js` cạnh `.pd-price`.

Nếu muốn giữ `compare_price`, hãy đặt nó **theo giá trị thật** = giá mua lẻ nhiều kỳ (Tuần: 52 × 70k; Tháng: 12 × 180k). Vừa trung thực vừa vẫn ấn tượng.

### D15. Vĩnh viễn 1.290.000đ có quá cao so với Năm 590.000đ?

**Không cao — và đây là thiết kế tốt, giữ nguyên.**

- Chênh 2,19× tiền cho 3× thời gian → giá/ngày vẫn rẻ hơn 27%. Thang giá **nhất quán**.
- Hoà vốn 2,19 năm. Khách mua Vĩnh viễn là khách tin tool sống lâu — đúng tệp khách giá trị cao.
- Vai trò thật của nó là **anchor**: nó tồn tại để 590k trông rẻ. Bạn không cần bán nhiều gói này.

Điều **nên sửa** không phải giá, mà là **cách trình bày**: bỏ badge HOT thứ hai (xem A3) và nói rõ "tiết kiệm so với 2,2 năm mua gói Năm".

### D16. Có nên bỏ gói Tuần?

**Không. Giữ lại.**

- Tuần là **cửa vào rẻ nhất** cho khách chưa tin shop. Bỏ nó = mất nhóm khách do dự.
- Tuần là **gói lãi/ngày cao nhất** (10.000đ/ngày vs 6.000đ). Nó là động cơ margin, không phải gánh nặng.
- Tuần là **đích upsell tự nhiên của trial** khi khách chưa sẵn sàng Tháng.

Điều cần sửa không phải sự tồn tại của gói Tuần, mà là **thứ tự ưu tiên hiển thị**: Tháng phải là nút chính, Tuần là nút phụ.

---

## E. Doanh thu dự kiến

> ⚠️ **Minh bạch về giả định**: tôi **không có dữ liệu thực** về tỷ lệ chuyển đổi của shop hay của ngành tool game VN. Các con số dưới đây là **ước lượng có lý do**, dùng để lập kế hoạch — không phải số đo. Cách lấy số thật ở mục F.

**Giả định cơ sở:**
- Trial: 3 ngày, full tính năng, gắn HWID, 1 lần/HWID.
- Tỷ lệ chuyển đổi trial→paid: tôi dùng **3% (bi quan) / 5% (cơ sở) / 8% (lạc quan)**. Lý do: trial không cần thẻ, có rào cản tài khoản + HWID → thường rơi vào 3–8%. Trial tool game VN hay được đồn "10–15%" nhưng đó gần như luôn là số tự khai, đã tính cả khách quay lại.
- Giỏ hàng hỗn hợp (basket): 55% Tháng / 25% Tuần / 15% Năm / 5% Vĩnh viễn.
  → Doanh thu/khách = 0,55×180k + 0,25×70k + 0,15×590k + 0,05×1.290k
  = 99.000 + 17.500 + 88.500 + 64.500 = **269.500đ**

### E17. 1.000 khách dùng trial

| Kịch bản | Conv | Số khách mua | Nếu tất cả mua Tháng | Theo basket hỗn hợp |
|---|---:|---:|---:|---:|
| Bi quan | 3% | 30 | 5.400.000đ | **8.085.000đ** |
| Cơ sở | 5% | 50 | 9.000.000đ | **13.475.000đ** |
| Lạc quan | 8% | 80 | 14.400.000đ | **21.560.000đ** |

**Trả lời trực tiếp câu hỏi:** 3% convert, tất cả mua gói Tháng → **5.400.000đ**.

**Nhưng phải trừ cannibalization.** Trong 30 khách đó, ước 30–40% là người *dù không có trial vẫn sẽ mua*. Doanh thu **tăng thêm thực** chỉ còn ~60–70% con số trên:
- 3%: ~5.000.000đ tăng thêm thực
- 5%: ~8.500.000đ tăng thêm thực

Trial vẫn đáng làm, nhưng đừng kỳ vọng nó nhân đôi doanh thu.

### E18. 50 khách mới dùng trial mỗi ngày

- **1 tháng = 50 × 30 = 1.500 trial.**
- Ở 5%: 75 khách mua × 269.500đ = **20.212.500đ/tháng** (gross).

| Conv | Khách mua/tháng | Doanh thu/tháng (basket) |
|---|---:|---:|
| 3% | 45 | 12.127.500đ |
| 5% | 75 | **20.212.500đ** |
| 8% | 120 | 32.340.000đ |

Trừ chi phí coupon (≈20% × 36.000đ × số khách Tháng ≈ 300.000đ) và tặng ngày → vẫn dương rõ rệt.

**Điểm hoà vốn:** trial gần như miễn phí về hạ tầng. Chỉ cần **≥1 khách mua Tháng/tháng** là đã bù chi phí vận hành trial. Rào cản duy nhất là công sức triển khai.

---

## F. Tối ưu sau khi có dữ liệu

### F19. Nếu 80% mua Tuần, có nên tăng giá Tuần?

**Có, nhưng tăng nhẹ và tăng kèm "cà rốt" — đừng tăng trần.**

Nếu 80% mua Tuần nghĩa là khách đang **né gói Tháng**, không phải thích Tuần. Nguyên nhân thường là: (a) chưa tin shop, (b) 180k là ngưỡng tâm lý khó vượt.

Hành động theo thứ tự:
1. **Trước tiên thêm "cà rốt"**, không phải tăng giá: Tháng tặng 7 ngày → hiệu quả 4.865đ/ngày, rẻ hơn Tuần 51%. Truyền thông điệp này rõ ràng.
2. Nếu sau 30 ngày vẫn >70% chọn Tuần → **tăng Tuần 70k → 79k** (10.828đ/ngày). Lúc này Tháng 180k chỉ còn 1,66× giá Tuần cho 4,3× thời gian → chênh lệch quá hấp dẫn để bỏ qua.
3. **Không tăng quá 89k.** Trên ngưỡng đó khách rời shop thay vì nâng gói.

Cách kiểm tra: `SELECT p.name, COUNT(*) FROM order_items oi JOIN products p ON p.id=oi.product_id GROUP BY p.id` trong 30 ngày trước/sau khi đổi.

### F20. Nếu gói Năm bán chạy hơn Vĩnh viễn, có nên tăng giá Vĩnh viễn?

**Không. Đây là tín hiệu thang giá đang CHẠY ĐÚNG.**

Gói Năm bán chạy hơn Vĩnh viễn là điều bạn *muốn*: Năm = 590k lặp lại hằng năm (doanh thu định kỳ), Vĩnh viễn = 1.290k một lần rồi hết. Về dòng tiền dài hạn, **một khách Năm trung thành 3 năm mang lại 1.770k > 1.290k**.

Việc cần làm khi thấy Năm thắng:
- **Không tăng giá Vĩnh viễn** (sẽ phá anchor và đẩy khách sang Năm nhiều hơn nữa — ngược ý muốn).
- Kiểm tra **tỷ lệ gia hạn gói Năm** ở năm thứ 2. Nếu < 50% → vấn đề là retention, không phải giá.
- Cân nhắc **giảm nhẹ giá Năm xuống 549k** để tăng tốc độ bán, nếu thanh khoản cần.

Chỉ tăng Vĩnh viễn khi: gói Năm bán chạy **và** tỷ lệ gia hạn năm 2 **> 80%** (khách trung thành thật, sẵn sàng trả cho trọn đời).

### F21. Có nên thêm gói 6 tháng?

**Có. Đây là đề xuất thêm gói duy nhất tôi khuyến nghị.**

Lý do: khoảng trống 180k → 590k là **3,28×** — quá lớn, khách rơi vào khoảng giữa không có lựa chọn.

**Đề xuất: 379.000đ / 180 ngày (2.106đ/ngày).**

| Gói | Giá | đ/ngày | Vai trò |
|---|---:|---:|---|
| Tháng | 180.000 | 6.000 | Cửa vào |
| **6 tháng** | **379.000** | **2.106** | **Bậc đệm** |
| Năm | 590.000 | 1.616 | Mục tiêu |

Hiệu ứng tâm lý: từ 6 tháng lên Năm chỉ thêm **211.000đ** mà được **gấp đôi thời gian** → đa số sẽ chọn Năm. Gói 6 tháng tồn tại để **bán gói Năm**, không phải để bán chính nó.

Cảnh báo: tổng 5 gói là **trần**. Đừng thêm gói thứ 6 — quá nhiều lựa chọn làm giảm chuyển đổi.

Cách kiểm tra: đo tỷ lệ chọn Năm trước/sau 30 ngày. Nếu tỷ lệ Năm tăng mà tổng doanh thu không giảm → thành công.

---

## G. So sánh đối thủ

### G22. Tool bỏ sương mù AoE trên thị trường VN giá bao nhiêu?

**Tôi không có số liệu xác thực.** Tôi không truy cập được dữ liệu giá thị trường thời gian thực của các shop tool AoE VN, và tôi sẽ không bịa con số để nghe có vẻ chắc chắn.

Những gì tôi **biết chắc** từ code của bạn: bạn định giá 70k/tuần – 1.290k/vĩnh viễn.

Những gì **thường thấy** ở thị trường tool game VN (đây là hiểu biết chung, cần kiểm chứng): tool auto/bỏ sương mù game online VN thường rơi vào **50k–150k/tháng** cho bản cơ bản, và **200k–500k/năm** cho bản "uy tín". Nếu đúng vậy, **gói Năm 590k của bạn đang ở mức cao của thị trường**, còn Tuần 70k thì cạnh tranh.

**Cách tự kiểm chứng trong 30 phút** (tôi khuyên làm trước khi đổi bất kỳ giá nào):
1. Vào 3–5 nhóm Facebook AoE VN lớn, tìm bài bán tool bỏ sương mù → chụp lại bảng giá.
2. Search Google: `tool bỏ sương mù aoe giá`, `xa nofog` → ghi lại 5 shop đầu.
3. Vào group Zalo/Discord AoE, hỏi thẳng: "ae đang dùng tool nào, giá bao nhiêu".
4. Ghi vào bảng: shop / giá tháng / giá năm / có trial không / có bảo hành không.

Đây là dữ liệu bạn cần hơn mọi con số tôi đoán.

### G23. Mức 70k–1.290k có cạnh tranh?

Theo cấu trúc (không theo số tuyệt đối): **có, cấu trúc giá của bạn tốt hơn mặt bằng chung.**

Điểm mạnh hiếm: có **đủ 4 bậc** + **gói vĩnh viễn**. Phần lớn shop tool VN chỉ có 1–2 bậc (tháng/năm), không có neo giá, không có gói vĩnh viễn → họ bán rẻ hơn nhưng **không có công cụ đẩy khách lên gói dài**.

Rủi ro cạnh tranh thật của bạn **không phải giá**, mà là:
- Đối thủ có thể bán **rẻ hơn nhiều** (30–50k/tháng) và vẫn lãi, vì họ không đầu tư hạ tầng.
- Nếu bạn cạnh tranh bằng giá, bạn thua — chi phí hạ tầng của bạn (worker, D1, license server) cao hơn.

→ **Đừng đấu giá. Đấu bằng độ tin cậy.**

### G24. Điểm khác biệt nên nhấn mạnh

Xếp theo sức mạnh thuyết phục thực tế:

1. **Giao key tự động 24/7** — đã có thật (`delivery_type='license'`, sinh key ngay khi webhook xác nhận). Đây là điểm mạnh nhất: khách mua 2h sáng vẫn có key trong 5 giây. Đối thủ bán tay không làm được.
2. **Bảo hành 365 ngày** — đã có trong `warranty_days`. Nhấn mạnh con số 365, nó cụ thể hơn "bảo hành dài".
3. **Trial 3 ngày, không cần thẻ** — sau khi triển khai, đây là điểm khác biệt số 1 về chuyển đổi.
4. **Đổi máy 1 lần miễn phí + hỗ trợ offline grace 24h** — đã có (`max_rebind=1`, `GRACE_HOURS=24`). Rất ít shop nói được điều này.
5. **Thanh toán VietQR MBBank + ví nội bộ** — không cần thẻ quốc tế, không cần tài khoản PayPal. Cực quan trọng với khách VN.

**Không nên nhấn**: "giá rẻ nhất". Bạn không thắng được cuộc đua đó, và nó phá vị thế.

---

## KHUYẾN NGHỊ CUỐI CÙNG

### 1. Bảng giá tối ưu (giữ nguyên giá, thêm 1 gói)

| Gói | Giá | Ngày | đ/ngày | Ghi chú |
|---|---:|---:|---:|---|
| Tuần | 70.000đ | 7 | 10.000 | Giữ. Nút phụ |
| Tháng | **180.000đ** | 30 | 6.000 | **Giữ. Best-seller, nút chính** |
| **6 tháng** | **379.000đ** | 180 | 2.106 | **THÊM MỚI — bậc đệm** |
| Năm | **590.000đ** | 365 | 1.616 | Giữ. Mục tiêu dài hạn |
| Vĩnh viễn | 1.290.000đ | ∞ | 1.178 | Giữ. Anchor |

**Không đổi 4 giá hiện tại.** Thang giá của bạn đã đúng hướng (giảm đơn điệu). Vấn đề duy nhất là thiếu bậc 6 tháng và thiếu gói gia hạn.

Sửa kèm: bỏ badge HOT thứ 2 (Vĩnh viễn → "TRỌN ĐỜI"), thêm dòng "đ/ngày" vào trang sản phẩm.

### 2. Trial: **3 ngày, full tính năng**

- Full quyền, `plan='trial'`, `max_rebind=0`, không gia hạn được.
- Tính hạn từ **lần kích hoạt đầu** (đã có sẵn — hãy quảng bá).
- **Bắt buộc đăng nhập tài khoản** để nhận trial: vừa chống lạm dụng vừa tạo danh sách khách.
- Chống trùng: 1 trial / tài khoản + 1 trial / HWID (bảng `trial_claims`).
- ⚠️ **Rủi ro kỹ thuật cần lưu ý**: giao thức client được ghi là *"giữ nguyên 100%"*. Khi trial hết hạn, `judge()` trả `code: 'expired'` và client hiện "Mã đã hết hạn". Không có chỗ để hiện nút "Mua ngay" *trong tool*. → **Toàn bộ upsell phải nằm trên web + Zalo.** Cần kiểm tra client hiển thị gì với `code` lạ trước khi phát trial.

### 3. Chiến lược chuyển đổi hiệu quả nhất (xếp theo ROI)

| # | Hành động | Chi phí | Sức mạnh |
|---|---|---|---|
| 1 | **Tặng 7 ngày** khi mua Tháng trong 24h sau trial | 42.000đ/khách | Cao nhất — không phá giá |
| 2 | **Hiển thị giá trị đã dùng** ("6,5 giờ chơi") từ `lic_events` | 0đ | Rất cao — bằng chứng cụ thể |
| 3 | **Banner nhắc trong web** ở 3 điểm chạm | 0đ | Cao |
| 4 | **Nhóm Zalo** thông báo + mã giảm giá | 0đ | Cao với tệp VN |
| 5 | Coupon `TRIAL24` giảm 20% (phương án dự phòng) | 36.000đ | Trung bình |

**Không làm**: hệ thống email (không hiệu quả với tệp này), hoàn tiền 24h (trial đã thay thế, dễ lạm dụng).

### 4. Ba việc phải sửa trước khi chạy trial

1. `wrangler.toml:46` — `SUPPORT_ZALO = "https://zalo.me/0000000000"` vẫn là **số placeholder**. Phải điền số thật, nếu không mọi CTA Zalo đều chết.
2. Thêm bảng `trial_claims` + chặn `extendLicense` với `plan='trial'` — hiện **chưa có gì** chống dùng trial nhiều lần.
3. Kiểm tra client hiển thị gì khi server trả `code` không nằm trong `MESSAGES` — quyết định xem có cần sửa client không.

### 5. Điều tôi muốn nói thẳng

Giá hiện tại của bạn **không cần sửa**. Thang 70/180/590/1290 giảm đơn điệu, có anchor, có cửa vào rẻ. Đây là thang giá tốt hơn phần lớn shop tool VN.

Vấn đề thật của shop **không phải giá**, mà là:
- **Thiếu trial** → khách không có lý do để tin trước khi trả 180k.
- **Thiếu gói gia hạn** → mỗi 30 ngày bạn phải bán lại từ đầu.
- **Thiếu bằng chứng giá trị** → bạn bán "bỏ sương mù", nhưng không bao giờ nói được "khách tiết kiệm bao nhiêu".

Trial 3 ngày là đúng. Nhưng **trial một mình sẽ không tạo ra doanh thu** — nó chỉ tạo ra *cơ hội*. Doanh thu đến từ bước sau trial, và bước đó phải được tự động hoá bằng coupon + tặng ngày + nhắc nhở, không phải bằng việc chờ khách tự quay lại.

Ở mức 5% chuyển đổi với 50 trial/ngày, bạn đạt ~20 triệu/tháng gross. Con số đó **có thật và đo được** — nhưng phải đo, đừng tin con số trong tài liệu này. Chạy 30 ngày, đếm bằng SQL, rồi quyết định.
