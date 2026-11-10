# ĐO MA SÁT THỰC TẾ: mua → cài XArena No Fog (xienhl.com)

**Ngày đo:** 2026-11-10 · **Môi trường:** Chrome 157.0.8103.40 headless, CDP thô qua WebSocket, viewport 1440×900 · **Target:** https://xienhl.com (production, D1 thật) · **Host:** Windows — chạy **thật** lệnh cài, đo cả phần off-site

Mọi số liệu dưới đây là **số đo được**, không phải ước lượng. Script: [ux-final.mjs](scripts/ux-final.mjs), [ux-e2e.mjs](scripts/ux-e2e.mjs), [ux-happy.mjs](scripts/ux-happy.mjs), [ux-verify-buynow.mjs](scripts/ux-verify-buynow.mjs), [ux-probe-install2.mjs](scripts/ux-probe-install2.mjs). Raw JSON: [ux-f2.json](shots/ux-f2.json), [ux-f1.json](shots/ux-f1.json), [ux-h3.json](shots/ux-h3.json).

> **Lưu ý về thời điểm đo:** trong lúc tôi đo, một worker khác đã sửa và deploy 2 bug ở luồng "Mua ngay". Tôi đo **trước** khi fix (bắt được bug) và **sau** khi fix (xác nhận đã hết). Cả hai trạng thái đều được ghi lại dưới đây — mục A.1 là bug đã tìm ra và đã được vá, mục A.2 trở đi là số đo trên code hiện tại.

---

## A. ĐO THỰC TẾ

### A.1 Bug "Mua ngay" — đã tìm ra, đã được vá và đã verify

**Trạng thái TRƯỚC fix** (đo được, giữ làm bằng chứng):

```
Mount error: ReferenceError: store is not defined
    at Object.mountCheckout [as mount] (…/assets/pages/checkout.js:30:5)
    at router (…/assets/app.js:108:24)
```

Bấm `#btn-buy-now` → trang treo vĩnh viễn ở "⏳ Đang chuẩn bị đơn hàng…" ([ảnh](shots/ux-f1-03-buynow-deadlock.png)). Không lỗi hiển thị, không toast, không nút quay lại.

Hai lỗi chồng nhau:

1. [checkout.js:2](public/assets/pages/checkout.js#L2) import thiếu `store`, nhưng dòng 30 dùng `store.get('mbk_buynow')` → `ReferenceError` ngay đầu `mountCheckout`.
2. [product-detail.js:180-185](public/assets/pages/product-detail.js#L180) lọc **bỏ** chính `p` vừa thêm, rồi lấy `[0]` → `{...undefined}` = `{}`. Test thật cho `localStorage.mbk_buynow = "[{}]"`. Nên **dù fix `store`, checkout vẫn render item rỗng**.

**Trạng thái SAU fix** (verify lại trên production, [ux-verify-buynow.mjs](scripts/ux-verify-buynow.mjs)):

```json
{ "hash": "#/checkout?mode=buynow", "stuck": false, "hasPlaceOrder": true,
  "buynow": "[{\"productId\":\"p-lic-month\",\"name\":\"XArena No Fog — Gói Tháng\",\"price\":180000,\"quantity\":1}]",
  "itemName": "XArena No Fog — Gói Tháng", "total": "180.000₫", "balance": "320.000₫" }
```

Thanh toán thật: `{"success":true,"key":"AOE1-2QDS-HGWN-LFRW"}` · 0 page error. ✅

→ **Bug P0 này đã hết.** Đây là bug nghiêm trọng nhất tôi tìm được, và nó đã được vá trong lúc đo.

### A.2 Bảng đo: hành trình khách mới, chưa có tiền trong ví (code hiện tại)

Tài khoản tạo mới hoàn toàn, đếm từng input thật qua `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`.

| # | Bước | Mốc (giây) | Click | Ký tự gõ | Ghi chú đo được |
|---|---|---|---|---|---|
| 1 | Vào trang chủ | 1,2 | 1 | 27 | gõ `xienhl.com` vào thanh địa chỉ |
| 2 | Trang sản phẩm | 3,0 | 2 | 0 | render 547 ms |
| 3 | Bấm "Mua ngay" | 7,0 | 3 | 0 | **ok** (đã fix) → sang `/login?redirect=…` |
| 4 | Đăng ký tài khoản | 11,0 | 4 | 9+15+11 = 35 | 3 field bắt buộc + submit |
| 5 | Tạo mã QR nạp tiền | 14,5 | 2 | 0 | `NAPFUFEB`, STK `8990124112002` |
| — | **RỜI TRÌNH DUYỆT → app ngân hàng** | 14,5 | — | — | **chuyển ngữ cảnh #1** |
| 6 | Chờ webhook cộng tiền | 59,6 | — | — | **45 s KHÔNG thấy cộng tiền** |
| — | Vào `/checkout` | 61 | 1 | 0 | "Giỏ hàng trống" |

**Tổng web phase:** 60,9 s · **7 click** · **47 ký tự gõ** · 10 lần load · 28 call API · **53,5 s là CHỜ**.

> **53,5 / 60,9 = 88% thời gian khách chỉ ngồi chờ.** Đây là con số quan trọng nhất của mục A.

### A.3 Bảng đo: happy path với ví đã có tiền (bỏ qua bước nạp)

| # | Bước | Thời gian | Click | Ghi chú |
|---|---|---|---|---|
| 1 | Trang sản phẩm render | 628 ms | — | |
| 2 | Thêm vào giỏ | 1,4 s | 1 | |
| 3 | Checkout render xong | 628 ms | — | `#btn-place-order` hiện sau 282 ms |
| 4 | **Xác nhận thanh toán** | **3,75 s** | 1 | trừ ví + sinh key + giao ngay |
| 5 | Key hiện trên trang success | 0 ms | — | `AOE1-RXXL-SVBF-7BL2` |
| 6 | Vào License của tôi | ~2,6 s | 1 | phải load lại trang |
| 7 | Bấm "Lấy lệnh cài đặt" | **783 ms** | 1 | sinh token 24 h + lệnh |
| 8 | Copy lệnh | 600 ms | 1 | clipboard OK |
| | **TỔNG web (đã có tiền)** | **~10,5 s** | **5** | **0 ký tự gõ** |

### A.4 Bảng đo: phần OFF-SITE (chạy thật trên Windows, không mô phỏng)

Chạy **đúng chuỗi lệnh** khách copy được, từ trạng thái sạch (xoá EXE, shortcut, `lic.bin`, `%TEMP%\xa.cmd`):

```
curl -L -o "%TEMP%\xa.cmd" "https://xienhl.com/i/AOE1-….cmd?t=<token>" && "%TEMP%\xa.cmd"
```

| Bước off-site | Đo được | Ghi chú |
|---|---|---|
| Mở Run dialog (Win+R) | ~0,5 s | **chuyển ngữ cảnh #2** |
| Gõ `cmd` + Enter | ~1,0 s | 3 ký tự |
| Ctrl+V dán lệnh | ~0,5 s | 1 thao tác |
| Tải EXE 12,59 MB | **7,44 s** | 1,77 MB/s, TTFB 502 ms |
| Kiểm SHA-256 (`certutil`) | **35 ms** | khớp `737152B3…4FFF5` |
| Cài + RUNASADMIN + kích hoạt + shortcut | ~2,0 s | `pwsh` cold start 146 ms |
| **Bấm Yes ở UAC** | ~1,5 s | **chuyển ngữ cảnh #3** |
| Bấm phím đóng cửa sổ (`pause`) | ~0,5 s | **bắt buộc**, cửa sổ không tự đóng |
| Mở shortcut Desktop | ~2,0 s | **chuyển ngữ cảnh #4** |
| **TỔNG off-site (cold)** | **10,5 s** | lần 2 trở đi (warm): **3,8 s** |

### A.5 Tổng hợp toàn hành trình (code hiện tại)

| Chỉ số | Khách mới (chưa nạp tiền) | Khách đã có tiền trong ví |
|---|---|---|
| Số trang web phải qua | 6 | 4 |
| Số lần click (web) | **7** | **5** |
| Số ký tự gõ (web) | **47** | **0** |
| Số ký tự gõ (off-site) | 3 (`cmd`) + 1 lần dán | 3 + 1 lần dán |
| Thời gian web | **60,9 s** | **~10,5 s** |
| Thời gian off-site | 10,5 s | 10,5 s |
| **TỔNG** | **~71 s** | **~21 s** |
| **Số lần chuyển ngữ cảnh** | **5** | **4** |
| Số lần phải CHỜ | 3 (webhook, 7,4 s tải, 2 s cài) | 2 |
| Trong đó **thời gian chờ vô ích** | **53,5 s (88%)** | 7,4 s |

---

## B. ĐIỂM NGHẼN — xếp theo mức nghiêm trọng

### 🔴 P0-1. `[ĐÃ VÁ]` Nút "Mua ngay" từng chết 100%

Chi tiết ở A.1. Đã verify hết trên production. **Giữ lại trong báo cáo vì:** (a) nó cho thấy CTA chính từng không có ai đi qua được; (b) cần xác nhận **deploy thật sự chạy** — tôi verify bằng `curl https://xienhl.com/assets/pages/checkout.js` thấy dòng `import` đã có `store`, và chạy UI thật thấy thanh toán thành công. Nếu Cloudflare cache HTML cũ thì phải purge.

### 🔴 P0-2. Tiền phải đi 2 bước: ví → đơn (điểm nghẽn kiến trúc, CHƯA sửa)

Khách **bắt buộc** nạp tiền vào ví trước rồi mới mua. Chưa nạp mà bấm "Xác nhận thanh toán" → **đá im lặng sang `/wallet`** ([checkout.js:269-272](public/assets/pages/checkout.js#L269-L272)):

```js
if (e.code === 'INSUFFICIENT_BALANCE') { updateTotals(); navigate('/wallet'); }
```

Đo được: bấm "Xác nhận thanh toán" → 30 s sau vẫn ở trang Nạp tiền, giỏ còn 3 món, **không có thông báo nào** giải thích vừa xảy ra gì. Khách tưởng nút hỏng.

Hệ quả kép: khách phải bỏ tiền vào ví **trước khi** biết còn hàng không, và nạp thừa thì tiền kẹt trong ví.

**Bằng chứng trên production:** dashboard `pendingOrders: 3`, và 10/16 đơn là `cancelled`. Ba đơn `pending` gần nhất (180.000₫, 405.000₫, 405.000₫) đều là đơn tạo ra rồi **không trả được**.

### 🔴 P0-3. EXE không ký số → SmartScreen chặn đúng lúc khách vừa trả tiền

```
Get-AuthenticodeSignature → Status: NotSigned
VersionInfo → FileDescription: (rỗng), ProductName: (rỗng), CompanyName: (rỗng)
```

File `.exe` 12,59 MB, unsigned, không metadata, tải từ domain lạ, **tự đòi quyền admin**. Windows 11 mặc định hiện:

> "Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."

Nút mặc định là **"Don't run"**. Đây là điểm rơi lớn nhất **toàn hành trình**, và nó xảy ra **sau khi khách đã trả tiền** — mất tiền nhưng chưa có sản phẩm. Không đo được tỉ lệ rơi trong lab (cần telemetry thật), nhưng đây là hành vi mặc định của OS với file unsigned + RunAs.

Ghi chú: `--uac-admin` chỉ nhúng manifest xin admin, **không phải** chữ ký số. Nó làm tình hình nặng hơn.

### 🟠 P1-4. Secret webhook trong repo SAI → không xác minh được SePay đã nối

| Kiểm tra | Kết quả đo được |
|---|---|
| `POST /api/webhooks/sepay` **không** header | `401 UNAUTHORIZED` → secret **ĐÃ** cấu hình trên Worker |
| `POST` với secret trong [WEBHOOK_SECRET.txt](WEBHOOK_SECRET.txt) | `401 "Sai khoá xác thực webhook"` → **secret trong file KHÔNG khớp** |
| Audit log `topup.paid` | **8** → đã có lúc webhook chạy được |
| Audit log `topup.approve` | **1** → có ít nhất 1 lần admin duyệt tay |

Webhook từng chạy, nhưng secret trong repo **stale**. Khi chạy đúng thì nó **nhanh** — tôi đo được webhook credit trong **180 ms** (giả lập, secret đúng format). Vấn đề là **cấu hình**, không phải code.

**Không thể xác nhận từ ngoài** — cần chủ shop kiểm tra dashboard SePay.

### 🟠 P1-5. Bước nạp tiền không có lối tắt "trả đúng tiền đơn"

[wallet.js:88-90](public/assets/pages/wallet.js#L88-L90) chỉ có nút nhanh cố định 100k / 200k / 500k / 1M / 2M. Gói XArena tháng = **180.000₫**, vĩnh viễn = **1.290.000₫**. **Không nút nào khớp.** Khách phải tự gõ số — và gói 180k thì luôn nạp thừa 20.000₫ (hoặc nạp 100k rồi thiếu).

Thêm nữa: [wallet.js:69](src/routes/wallet.js#L69) làm tròn đến 1.000₫, nhưng khách không được báo sẽ bị làm tròn.

### 🟠 P1-6. Không có email — "nhận key qua email" hiện là bất khả thi

Grep toàn bộ `src/` cho `sendEmail|mailchannels|resend|nodemailer|smtp` → **0 kết quả**.

Đo được: đăng ký bằng `@mailinator.com` (không tồn tại) vẫn **thành công ngay** → email **chưa bao giờ được xác minh**. Khách gõ sai email sẽ mất key nếu đóng tab.

Quan trọng: [checkout.js:190](public/assets/pages/checkout.js#L190) và [product-detail.js:139](public/assets/pages/product-detail.js#L139) **đều hứa** "key… gửi về email của bạn". **Lời hứa sai đang hiển thị cho khách.**

### 🟡 P2-7. UAC là rào cản tâm lý, không phải kỹ thuật

Đo được: UAC hiện **đúng 1 lần**, và chỉ xuất hiện **sau khi** [.cmd đã kiểm xong SHA-256](src/routes/installer.js#L220-L227). Thiết kế này **tốt** — không bắt khách bấm Yes rồi mới báo file hỏng.

Nhưng khách vẫn thấy: cửa sổ cmd xanh → hộp thoại "Do you want to allow this app to make changes" → tải 12 MB. Với khách không rành, đây là chuỗi 3 dấu hiệu "phần mềm lạ".

Điểm trừ nhỏ: [installer.js:339](src/routes/installer.js#L339) kết thúc bằng `pause` → cửa sổ **không tự đóng**, khách phải bấm thêm phím. Không cần thiết, vì đã in "HOÀN TẤT".

### 🟡 P2-8. Token 24 h — không có đường cứu khi hết hạn

Đo được: token **dùng lại được nhiều lần** (fetch 2 lần đều `200`) — [assertCanInstall](src/routes/installer.js#L51-L58) chỉ kiểm `expires_at > now`, không có cờ `used`. Vậy nên **không** phải "dùng 1 lần" như UI hứa ở [licenses.js:62](public/assets/pages/licenses.js#L62) — điều này **có lợi** cho khách (cài lại được), chỉ là text đang nói sai.

Rủi ro thật: khách quay lại sau 2 ngày, bấm link trong bookmark → `401 "Token không hợp lệ hoặc đã hết hạn"` dạng **JSON thô**, không phải trang HTML. Khách thấy trang trắng có chữ JSON, không biết phải quay lại web lấy lệnh mới.

### 🟡 P2-9. Login race: 1/5 lần hard-load bị đá về trang chủ

Đo 5 lần liên tiếp hard-load `/#/licenses` khi **đã đăng nhập**: 4 lần đúng, 1 lần bị đá về `#/`. Nguyên nhân: [licenses.js:37](public/assets/pages/licenses.js#L37) kiểm `state.user` **trước khi** `loadUser()` xong.

Với khách vừa mua xong, bấm "Xem License" mà bị đá về trang chủ thì rất dễ bỏ. **20% là quá cao.**

### ⚪ P3-10. Trang success không cho lấy lệnh ngay tại chỗ

Nút "🔑 Lấy lệnh cài đặt" chỉ `location.hash='#/licenses'` ([checkout.js:332](public/assets/pages/checkout.js#L332)) — bắt khách load lại cả trang License rồi **bấm thêm 1 lần nữa**. Đo được: 2,6 s + 1 click thừa. Gọi thẳng `install-token` tại chỗ được, vì đã biết key.

### ⚪ P3-11. `[REGRESSION MỚI]` Ảnh sản phẩm hỏng ở checkout "Mua ngay"

Bản vá "Mua ngay" vừa deploy lưu sai tên field:

| Nơi lưu | Nơi đọc |
|---|---|
| [product-detail.js:188](public/assets/pages/product-detail.js#L188) → `image:` | [checkout.js:129](public/assets/pages/checkout.js#L129) → `i.imageUrl` |

API trả `imageUrl` (`/img/license-xarena.svg`), **không** trả `image`. Nên `i.imageUrl` = `undefined` → `src=""` → **icon ảnh hỏng** ở checkout Mua ngay ([ảnh](shots/ux-buynow-fixed.png), ô sản phẩm bên trái).

Đường giỏ hàng **không** bị vì [state.js:69](public/assets/state.js#L69) lưu đúng `imageUrl`. Chỉ luồng buy-now bị.

**Fix 1 dòng:** đổi [product-detail.js:188](public/assets/pages/product-detail.js#L188) thành `imageUrl: p.imageUrl || p.image || p.thumbnail || null,` — hoặc sửa [checkout.js:129](public/assets/pages/checkout.js#L129) đọc `i.imageUrl || i.image`. Nên làm **cả hai** cho chắc.

Mức độ: thẩm mỹ, không chặn mua. Nhưng đây là màn hình ngay trước khi khách bấm trả tiền — một ô ảnh hỏng ở đó làm giảm niềm tin đúng lúc cần nhất.

### Kiểm tra riêng theo 5 câu hỏi của đề bài

1. **Đăng ký có bắt buộc không?** — **CÓ, tuyệt đối.** [createOrder](src/routes/orders.js#L57), [createTopup](src/routes/wallet.js#L61), [payOrder](src/routes/orders.js#L163) đều gọi `requireUser`. Không có guest checkout, không có đường nào mua không cần tài khoản.
2. **Nạp trước rồi mới mua — gộp được không?** — **Được, và nên gộp.** Schema **đã sẵn sàng**: [schema.sql:101](db/schema.sql#L101) có `payment_method TEXT DEFAULT 'wallet' -- wallet | sepay | manual`, [schema.sql:102](db/schema.sql#L102) có `payment_ref`. Cột đã có, **chưa có code dùng**. Đây là thay đổi **nhỏ hơn nhiều** so với tưởng tượng.
3. **Webhook SePay đã nối chưa?** — **Không xác nhận được.** Secret đã set (401 khi thiếu header) nhưng secret trong repo sai. Có 8 lần `topup.paid` → đã từng chạy.
4. **Lệnh CMD có phải cách duy nhất?** — **KHÔNG.** Có 3 đường đã code sẵn: `/i/<KEY>.cmd` (file tải về), `/i/<KEY>.ps1`, `/download/xa_nofog_pro.exe` (**đo được `206`, public, không cần auth**). Nhưng tải EXE trực tiếp **không có key** — khách vẫn phải tự chạy `xa_nofog_pro.exe --key AOE1-…`.
5. **Token 24 h — khách để lâu thì sao?** — Hết hạn → `401` JSON thô, màn hình trắng, không giải thích, không link "lấy lệnh mới". Token **không** single-use (khác text UI).

---

## C. ĐỀ XUẤT RÚT GỌN

Mục tiêu: **"1 lệnh là xong"**. Tin tốt — **nút cài đã đúng và đã nhanh**: 783 ms sinh lệnh, **10,5 s cài cold từ số 0**. Ma sát **không** nằm ở cài đặt. Nó nằm ở **trước khi** khách tới được nút đó.

### C.1 `[ĐÃ XONG]` Fix "Mua ngay" — 10 phút, đã verify

Bug P0 nghiêm trọng nhất. Nay: trang sản phẩm → "Mua ngay" → checkout đúng 1 sản phẩm → "Xác nhận" → xong. **2 click, 0 gõ.** Verify: `AOE1-2QDS-HGWN-LFRW` giao thành công.

Việc còn lại: **chắc chắn deploy đã purge cache** và chạy `node scripts/ux-verify-buynow.mjs <email>` để xác nhận trên máy khác.

### C.2 `[P0 — ½ ngày]` Trả tiền trực tiếp cho ĐƠN, bỏ bước nạp ví ⭐ QUAN TRỌNG NHẤT

Xoá khái niệm "nạp tiền trước". Khách mua → web tạo đơn → hiện QR **đúng số tiền đơn** với nội dung `MBK-XXXXXX` → khách quét → webhook khớp mã đơn → giao key **và** lệnh cài.

**Luồng chính xác từng bước:**

| Bước | Hành động | Thời gian |
|---|---|---|
| 1 | Vào trang sản phẩm | 1 click |
| 2 | Bấm "Mua ngay" | 1 click |
| 3 | Chọn "Chuyển khoản (VietQR)" — **mặc định** | 0 click |
| 4 | Quét QR bằng app ngân hàng | **#1** |
| 5 | Chờ ~5 s → tự chuyển sang "Thành công + key + lệnh cài" | ~5 s |
| 6 | Bấm "Copy lệnh cài" | 1 click |
| 7 | Run → cmd → dán → Enter | **#2** |
| 8 | Yes UAC | **#3** |
| 9 | Bấm phím đóng cửa sổ | 1 phím |
| 10 | Mở shortcut | **#4** |

**Click: 4** (từ 7) · **Gõ: 3 ký tự** (từ 47) · **Chờ: ~5 s** (từ 53,5 s) · **Context switch: 4** (từ 5) · **Tổng ~21 s** (từ ~71 s).

**Code cần sửa:**

| File | Thay đổi |
|---|---|
| [src/routes/orders.js](src/routes/orders.js#L56) | `POST /api/orders` nhận `paymentMethod: 'bank'`; sinh `payment_ref` = `code`; trả `qrUrl` + `amount` + `memo`. Schema **đã có** cột. |
| [src/routes/wallet.js](src/routes/wallet.js#L130) | `sepayWebhook`: thêm nhánh nhận `MBK([A-Z0-9]{6})` → tìm `orders.code` → nếu `status='pending'` thì chạy flow `payOrder` (không qua ví). |
| [public/assets/pages/checkout.js](public/assets/pages/checkout.js#L181) | 2 tab: "Chuyển khoản (QR)" **mặc định** + "Trả bằng số dư ví". |
| [public/assets/pages/wallet.js](public/assets/pages/wallet.js) | Giữ trang ví (cho khách nạp trước / mua nhiều lần) nhưng **không còn là đường bắt buộc**. |

**Rủi ro cần chặn:**

- **Chuyển thiếu** → đơn vào `pending` + alert admin. Đã có `topup.partial` để copy.
- **Chuyển 2 lần** → webhook phải idempotent theo `payment_ref` (đã có `ALREADY_PAID` guard).
- **Sai nội dung** → không khớp mã đơn → treo. Cần: (a) QR điền sẵn `addInfo`, (b) cảnh báo đỏ "giữ đúng nội dung MBK-…", (c) trang đơn có "Chưa nhận tiền? Gửi bill cho shop" (đã có `/support`).
- **Không bỏ ví hoàn toàn** — đó là công cụ hoàn tiền. Giữ `refund` → cộng ví.
- **Bảo mật:** thấp hơn hiện tại. Đơn gắn `user_id`, webhook đã timing-safe compare.

### C.3 `[P1 — 1 tuần, cần tiền]` Ký số EXE — chỗ rơi lớn nhất, không fix bằng code được

| Mức | Chi phí | Tác dụng |
|---|---|---|
| **OV Code Signing** | ~$200–400/năm | SmartScreen vẫn cảnh báo vài tuần đầu tới khi tích luỹ reputation |
| **EV Code Signing** | ~$300–600/năm + HSM | **Reputation tức thì**, hết SmartScreen ngay |
| **Azure Trusted Signing** | ~$9/tháng | Rẻ nhất, nhưng cần verify pháp nhân 3 năm |

**Song song, giảm ma sát miễn phí ngay:**

1. **Điền PE metadata** — hiện `ProductName`/`CompanyName`/`FileDescription` đều **rỗng**. Set qua `--version-file` của PyInstaller.
2. **Đặt tên file có nghĩa** — `cai-dat-XArena-NoFog-v1.2.exe`, không phải `xa_nofog_pro.exe`.
3. **Thêm ảnh "More info → Run anyway"** vào modal đã có ở [home.js:206-255](public/assets/pages/home.js#L206-L255) — hiện chưa có bước này.
4. **Giữ nguyên thứ tự SHA-check-trước-UAC** — code đã đúng.

### C.4 `[P1 — 1 ngày]` Mua không cần đăng ký (guest checkout)

**Luồng:** Trang sản phẩm → "Mua ngay" → nhập **chỉ email** → QR → quét → trang thành công hiện key + lệnh cài **ngay trên web**.

**Click: 3 · Gõ: ~25 ký tự (email).**

- **Không bắt email tồn tại** — key hiện ngay trên trang, email chỉ để tra cứu.
- **Code:** nhẹ nhất là tạo user ẩn danh `guest_<uuid>@local` với password random — **không đụng schema**. Nặng hơn: thêm `guest_email`, `guest_token`, cho `user_id` NULL.
- **Rủi ro:** (a) mất key nếu khách đóng tab + email sai; (b) đơn rác → **đã có** rate limit `order:${ip}` 20/10 phút; (c) không truy vết khách quay lại → cần `guest_token` trong URL.
- **Khuyến nghị:** làm **sau** C.2. Guest checkout tiết kiệm 1 click + 35 ký tự; C.2 tiết kiệm **53 giây chờ**. Không đáng làm trước.

### C.5 `[P1 — 2 giờ]` Tải file `.cmd` trực tiếp từ trang thành công — bỏ hẳn CMD ⭐

Server **đã sẵn sàng**. Đo được: `/i/<KEY>.cmd?t=<token>` trả **8.990 bytes**, **CRLF chuẩn** (257 CRLF, **0 bare-LF**), nhúng key+token, `certutil` SHA check, UAC, shortcut, uninstaller.

- **Click: 1** (double-click file trong Downloads) · **Gõ: 0** · **Context switch: 2** (web → Explorer → UAC), giảm từ 5.
- **Code:** [checkout.js](public/assets/pages/checkout.js#L332) — nút "Tải bộ cài" gọi `install-token` rồi `window.location = downloadCmd`.
- **Lợi ích phụ:** `.cmd` double-click tự `Start-Process -Verb RunAs` ([installer.js:147](src/routes/installer.js#L147)) → UAC hiện → **khách không cần biết `cmd`**.
- **Rủi ro:** (a) Mark-of-the-Web cũng cảnh báo trên `.cmd` — nhẹ hơn `.exe`; (b) token lộ qua Referer → thêm `Referrer-Policy: no-referrer`; (c) khách mở bằng Notepad → cần hướng dẫn ảnh.

### C.6 `[P2 — KHÔNG KHUYẾN NGHỊ]` Lệnh PowerShell 1 dòng `irm … | iex`

**ĐÃ KIỂM CHỨNG: CÁCH NÀY HỎNG.** [installer.js:413-415](src/routes/installer.js#L413-L415) dùng `$PSCommandPath` để tự nâng quyền:

```powershell
Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', $PSCommandPath)
```

Đo thật — `$PSCommandPath` **rỗng** khi chạy qua `iex`:

```
under-iex PSCommandPath=[] MyInvocationMyCommandPath=[]
```

→ `-File` nhận chuỗi rỗng → PowerShell mở cửa sổ mới rồi **thoát ngay**, không cài gì. Khách thấy cửa sổ nháy lên rồi biến mất, tưởng xong.

**Nếu vẫn muốn:** phải nhúng lại qua `-EncodedCommand` (base64 UTF-16LE), hoặc fallback tải file rồi `-File`. **Không khuyến nghị:** (a) `iex` từ internet bị AV/EDR gắn cờ **mạnh hơn** file unsigned; (b) lợi ích so với C.5 gần như bằng 0 (C.5 cũng 1 click).

### C.7 `[P2 — đánh giá thấp]` Telegram bot / QR code

- **Telegram bot:** thêm 1 nền tảng, thêm webhook, thêm secret, thêm 1 chỗ để hỏng. Khách vẫn phải chuyển khoản tay. **Không giải quyết điểm nghẽn nào trong B.**
- **QR code:** **đã có sẵn** ([wallet.js:84-86](src/routes/wallet.js#L84-L86), đo được SVG 46 KB trả `200`). Vấn đề **không ph��i thiếu QR** mà là QR nạp **vào ví**, không phải QR trả **cho đơn**. C.2 sửa đúng chỗ này.

### C.8 `[P2]` Key hiện ngay trên web, khách tự tải EXE + tự nhập key

**Đo được:** trang success **đã hiện key** (`AOE1-RXXL-SVBF-7BL2`), và `/download/xa_nofog_pro.exe` **đã public** (`206`, không cần auth). Khách làm được ngay hôm nay: tải EXE → cmd → `xa_nofog_pro.exe --key AOE1-…`.

Nhưng đây là **đường tệ hơn** C.5: phải gõ `cmd`, gõ `--key` + 19 ký tự key, và **không có** shortcut/RUNASADMIN/go-cai-dat. **Không khuyến nghị làm nổi bật.**

---

## D. SO SÁNH CÁC PHƯƠNG ÁN

| # | Phương án | Bước (web→cài xong) | Click | Gõ | Thời gian | Rào cản kỹ thuật | Rủi ro bảo mật | Công sức |
|---|---|---|---|---|---|---|---|---|
| **0** | **Hiện tại (bug Mua ngay đã vá)** | **11** | **7** | **47 + 4** | **~71 s** | Trung bình: biết CMD + UAC | Thấp | 0 |
| 0b | Hiện tại, **trước** khi vá Mua ngay | 11 | 7 | 47 + 4 | **không hoàn thành** | Cao — CTA chính chết | — | — |
| **1** | **C.2 trả tiền cho đơn + C.5 tự tải .cmd** ⭐ | **6** | **4** | **0** | **~21 s** | **Thấp: double-click + UAC** | Thấp | **1 ngày** |
| 2 | C.2 + C.4 guest checkout | 5 | 3 | ~25 | ~20 s | Thấp | Trung bình (đơn rác) | 1,5 ngày |
| 3 | C.2 + C.5 + C.3 ký số EV | 6 | 4 | 0 | ~21 s | **Rất thấp** | Thấp | 1 ngày + $300–600/năm |
| 4 | C.6 `irm \| iex` 1 dòng | 6 | 4 | 0 | ~21 s | Thấp (nếu fix) | **Cao** — AV gắn cờ; `$PSCommandPath` hỏng | 1 ngày + fix bug |
| 5 | C.7 Telegram bot | 10+ | 6 | 30+ | ~90 s+ | Trung bình | Trung bình (thêm secret) | 2–3 ngày |
| 6 | C.8 EXE + tự nhập key | 9 | 6 | **19+** | ~60 s | **Cao** — phải biết `--key` | Thấp | 0 |

**Đọc bảng này thế nào:**

- Cột **"Rào cản kỹ thuật"** = "khách có cần biết cmd không?". Phương án 1 và 3 trả lời **KHÔNG** — chỉ double-click. Đây là khác biệt lớn nhất về UX, lớn hơn cả việc tiết kiệm 50 s.
- Phương án **1** là điểm ngọt: cùng thời gian với phương án 3, nhưng **không tốn tiền**. Ký số chỉ giải quyết cảnh báo SmartScreen — làm sau, khi có doanh thu.
- Phương án **4** trông hấp dẫn nhất trên giấy ("1 dòng!") nhưng **đã kiểm chứng là hỏng**, và kể cả fix xong thì AV sẽ gắn cờ mạnh hơn file unsigned.
- Phương án **5, 6** đều **tệ hơn hiện tại** hoặc không cải thiện điểm nghẽn nào.

---

## KHUYẾN NGHỊ

### Quy trình tối ưu nhất: Phương án 1

> Trang sản phẩm → **Mua ngay** → QR đúng số tiền đơn (nội dung `MBK-XXXXXX`) → quét bằng app NH → web tự chuyển sang "Thành công" → **web tự tải file `cai-dat-XArena.cmd`** → double-click → Yes UAC → xong, shortcut ra Desktop.

**4 click · 0 ký tự gõ · ~21 giây · 2 lần chuyển ngữ cảnh (app NH, UAC)**

So với hiện tại: **7 click → 4**, **51 ký tự → 0**, **71 s → 21 s**, **5 lần chuyển ngữ cảnh → 2**. Quan trọng nhất: **khách không cần biết cmd là gì.**

### 3 việc làm ngay

**1️⃣ `[ĐÃ XONG — còn 1 dòng + xác nhận]` Bug "Mua ngay"**

Đã vá và verify trên production (`AOE1-2QDS-HGWN-LFRW` giao thành công, 0 page error). Còn 2 việc:

- **Fix 1 dòng ảnh hỏng** (P3-11): [product-detail.js:188](public/assets/pages/product-detail.js#L188) đổi `image:` → `imageUrl: p.imageUrl || p.image || p.thumbnail || null`.
- Purge cache Cloudflare cho `/assets/pages/checkout.js` + `/assets/pages/product-detail.js`, rồi chạy `node scripts/ux-verify-buynow.mjs <email>` trên máy khác để chắc chắn.

**2️⃣ `[½ ngày]` Gộp nạp tiền vào thanh toán (C.2) — cắt 53 giây chờ**

Thêm nhánh `MBK` vào [sepayWebhook](src/routes/wallet.js#L130) và cho [createOrder](src/routes/orders.js#L56) trả QR trực tiếp. Schema **đã có** `payment_method` + `payment_ref` — **không cần migrate**. Đây là thay đổi nhỏ nhất tạo khác biệt lớn nhất: **88% thời gian khách hiện đang bỏ ra là để CHỜ**, không phải để làm gì.

Chặn ngay 2 rủi ro: idempotent theo `payment_ref`, cảnh báo đỏ "giữ đúng nội dung `MBK-…`".

**3️⃣ `[2 giờ]` Tải file `.cmd` trực tiếp từ trang thành công (C.5) — bỏ hẳn CMD**

Server **đã sẵn sàng** (8.990 bytes, CRLF chuẩn, 200 OK). Chỉ cần [checkout.js](public/assets/pages/checkout.js#L332) gọi `install-token` trên trang success rồi `location = downloadCmd`. Double-click → [installer.js:147](src/routes/installer.js#L147) tự `RunAs` → UAC → xong. Thêm `Referrer-Policy: no-referrer`.

### Việc thứ 4, chỉ khi đã có doanh thu

**Ký số EV cho EXE** ($300–600/năm). Hiện `NotSigned` + metadata rỗng + tự đòi admin = SmartScreen chặn mặc định **sau khi khách đã trả tiền**. Đây là chỗ rơi **không thể fix bằng code**, và là chỗ rơi duy nhất mà khách **đã mất tiền nhưng chưa có sản phẩm**.

Trong lúc chờ, làm miễn phí ngay: điền PE metadata qua `--version-file`, đổi tên file có nghĩa, thêm ảnh "More info → Run anyway" vào modal đã có ở [home.js:206-255](public/assets/pages/home.js#L206-L255).

### Ba việc cần chủ shop tự xác nhận (tôi không verify được từ ngoài)

**1. SePay đã nối chưa?** Secret trong [WEBHOOK_SECRET.txt](WEBHOOK_SECRET.txt) **sai** (401 khi dùng). Audit có 8 lần `topup.paid` và 1 lần `topup.approve` → đã từng chạy, có lúc phải duyệt tay. Nếu chưa nối thật thì mọi đơn đều chờ admin → đúng cái ma sát lớn nhất cần tránh.

**2. Email có gửi không?** Không có code email nào trong `src/`. Nhưng [checkout.js:190](public/assets/pages/checkout.js#L190) và [product-detail.js:139](public/assets/pages/product-detail.js#L139) đều **hứa** "gửi về email". Sửa text hoặc thêm email — đừng để hứa sai.

**3. Giới hạn trial theo /24 có đang chặn oan khách không?**

Landing page ([home.js:103](public/assets/pages/home.js#L103)) hứa "Dùng thử 3 ngày miễn phí. **Không cần đăng ký**", và tool [tự xin trial khi chạy lần đầu](tool/src/xa_nofog_pro.py#L1627-L1631) — trial là **cửa vào chính** của funnel.

Đo từ IP của máy này:

| Request | Kết quả |
|---|---|
| `trial/status?weak=<máy mới>` | `{"ok":true,"used":false}` — **máy chưa dùng trial** |
| `trial/start` với HWID hoàn toàn mới | `429 trial_limit` — "Kết nối này đã dùng hết lượt" |

Tức **máy chưa dùng nhưng IP/mạng đã hết lượt**. Đây là hành vi **đúng như thiết kế** ([trial.js:250-268](src/routes/trial.js#L250-L268): `maxPerIp=3`, `maxPerNet=12` trong 30 ngày) — không phải bug, và với IP của shop thì hợp lý.

Nhưng nó phơi ra **rủi ro kinh doanh thật**: giới hạn đếm theo `ip` **và** `/24` (`net = ip.split('.').slice(0,3)`). Mạng di động VN và wifi quán net dùng **CGNAT** — hàng nghìn thuê bao chung một /24. Với `maxPerNet=12`/30 ngày, **12 khách trial trong cùng một quận là khoá cả dải**. Khách thấy "Mạng này đã dùng hết lượt dùng thử".

**Kiểm tra trên D1:**
```sql
SELECT ip, COUNT(*) n FROM trial_attempts
WHERE action='start' AND at > strftime('%s','now') - 30*86400
GROUP BY ip ORDER BY n DESC LIMIT 20;
```
Nếu thấy nhiều IP khác nhau cùng một /24 đã chạm trần 12 thì nên nâng `trial_max_per_net` hoặc bỏ hẳn giới hạn /24 (giữ per-IP + per-day là đủ) — vì nó đang chặn oan khách thật mà **không** chặn được kẻ lạm dụng (đổi IP dễ hơn đổi HWID).
