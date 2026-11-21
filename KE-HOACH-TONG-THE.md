# KẾ HOẠCH TỔNG THỂ — MuaBanKey / XA ARENA
### Web · API · Database · App EXE · Vận hành — bản "gọn + lý tưởng"

> **Lập:** 21/11/2026 (UTC+7) · **Cập nhật:** 21/11/2026 10:00 — sau khi thi hành Giai đoạn 0 + batch P0.
> **Phạm vi:** toàn bộ checkout tại `C:\Users\ADMIN\Desktop\muabankey`, gồm cả thay đổi chưa commit.
> **Thay thế** `KE-HOACH-TONG-THE-WEB-EXE.md` (bản 20/11).

---

## 0. TRẠNG THÁI HIỆN TẠI (đọc mục này trước)

### 0.1 Đã xong trong phiên 21/11

Hai phiên làm việc liên tiếp đã đóng **11 nhóm phát hiện** (`F01–F09`, `F13–F15` + toàn bộ audit web SPA), và phiên này đóng thêm **5 P0**:

| Việc | Trạng thái | Bằng chứng |
|---|---|---|
| Hoàn tiền thu hồi `account_entitlements` (P0-1) | ✅ Xong | `src/lib/refund-service.js:175-176` |
| `/api/account/token` áp luật 1 nick 1 máy (P0-3) | ✅ Xong | `src/routes/trial-account.js:580-588` |
| Cron xoá sạch rate-limit (P0-4) | ✅ **Xong phiên này** | `test/p0-hardening.test.mjs` (38 kiểm tra) |
| PayOS thiếu amount / không kiểm mã (P0-5) | ✅ **Xong phiên này** | `test/payment-amount.test.mjs` (26 kiểm tra) |
| Secret + mật khẩu admin trong git (P0-6) | ✅ **Xong phiên này** | 24 file QA sạch, `qa/qa-guard.mjs:adminCredentials()` |
| EXE chưa ký, script ký sai file (P0-7) | ✅ **Xong phiên này** | `tool/build-arena.ps1`, `tool/build/version.rc`, `test/release-signing.test.mjs` (28 kiểm tra) |
| `license_days` bỏ trống = vĩnh viễn (P0-2) | ✅ **Xong phiên này** | `src/routes/products.js`, `public/assets/pages/admin.js` |

**Kiểm thử: 14 file, 476 kiểm tra, 0 lỗi** (`npm run verify`).

### 0.2 Việc cần làm khi triển khai (theo đúng thứ tự)

```powershell
# 1. Backup trước khi đụng gì
npm run db:export

# 2. Rotate secret webhook (BẮT BUỘC — secret cũ đã nằm trong 79 commit)
#    Cloudflare Dashboard -> Workers -> muabankey -> Settings -> Variables
#    Đặt WEBHOOK_SECRET mới, rồi cập nhật lại phía SePay.

# 3. Chạy migration (idempotent, có --check trước)
npm run db:migrate:check
npm run db:migrate

# 4. Đặt manifest phát hành (sau khi build + ký EXE)
npx wrangler secret put RELEASE_MANIFEST < release\manifest.json

# 5. Deploy
npx wrangler deploy
```

> **Còn thiếu để phát hành EXE:** chứng chỉ code signing. Chưa có cert thì
> `build-arena.ps1` sẽ **dừng** (đúng thiết kế — không phát hành EXE chưa ký).
> Chạy `-SkipSign` chỉ để build thử nội bộ.

### 0.3 Còn lại từ kế hoạch (chưa làm)

`F10` admin tabs · `F11` checkout phân biệt trạng thái · `F12` SPA lifecycle · `F16` session inventory · `F17` xoá legacy (~2.500 dòng) · §6.1 dọn 96 MB rác · §6.3 gộp 19 file `.md` → 6 · §7 web polish · §8.1 tách module app.

---

## 1. Cách đọc tài liệu này

### 0.1 Mức xác minh

| Mức | Nghĩa |
|---|---|
| **[A]** | Đọc trực tiếp mã nguồn, có `file:dòng`. Tin được ngay. |
| **[B]** | Đã tái hiện offline (chạy hàm thật với DB giả / tính tay bằng số). |
| **[C]** | Cần runtime/staging xác nhận (chưa chạy thử trên production). |

### 0.2 ⚠️ CẢNH BÁO: có tiến trình khác đang sửa dự án

Trong lúc kiểm toán (00:17 → 01:30), các file sau **bị thay đổi bên ngoài phiên này**:

| Thời điểm | File | Thay đổi |
|---|---|---|
| 00:11 | `tool/build-arena.ps1` | File mới (7.763 B) |
| 00:13 | `src/routes/account-admin.js` | File mới (8.167 B) — **chưa từng được commit** |
| 00:20 | `src/index.js` | +6 dòng: import + 3 route `/api/admin/accounts*` |
| 00:21 | `tool/dist-arena/xa_arena.exe` | Build lại (23.649.280 B) |
| 00:27 | `src/routes/arena-installer.js` | `EXE_VERSION` 3.0.2.0 → 3.1.0.0, hash/size mới |
| 00:33 | `admin-accounts-block.js` (root) | File nháp (11.404 B) |
| 00:34 | `public/assets/pages/admin.js` | Sửa (74.215 → 79.782 B) |

**Hệ quả cần xử lý trước khi làm bất cứ gì:** `git status` đang bẩn, và `src/index.js` import một file chưa có trong git. Nếu bạn `git clone` ở máy khác hoặc deploy từ CI, build sẽ **fail**. Xem việc #1 ở §14.

Nếu tiến trình kia vẫn đang chạy: **dừng nó lại** trước khi thi hành kế hoạch này, nếu không hai bên sẽ ghi đè nhau.

### 0.3 Số liệu thực tế của dự án

| Mảng | Số liệu |
|---|---|
| Backend | `src/` = 1 entry (593 dòng) + 14 lib (3.194 dòng) + 22 route (~13.400 dòng) |
| Web | `public/` = 17 file JS (~274 KB) + `style.css` 2.069 dòng/88,8 KB + 21 SVG |
| App | `tool/` = 22.828 dòng Python; EXE onefile 23,6 MB |
| DB | 34 bảng, 67 index (**thiếu 2 bảng lõi** — xem P0-3) |
| Route | 98 lượt đăng ký / 97 route duy nhất; **~40 route không còn caller nào** |
| Test | ~1.085 assertion nhưng **~90% trỏ production** |
| Rác | **96,1 MB** file không dùng được ở root |
| Tài liệu | 13 file `.md` ở root + 6 trong `docs/`, phần lớn đã lỗi thời |

---

## 1. Chẩn đoán: 8 nguyên nhân gốc

Đừng sửa 60 lỗi rời rạc. Chúng đến từ 8 nguyên nhân:

| # | Nguyên nhân gốc | Biểu hiện |
|---|---|---|
| R1 | **Chuyển mô hình key → tài khoản chưa hoàn tất** | Hoàn tiền thu hồi `licenses` nhưng quyền nằm ở `account_entitlements`; trial 1h và trial 1 ngày cùng tồn tại; ví/topup/coupon còn code nhưng không còn UI |
| R2 | **Không có tầng service — mọi logic nằm trong handler** | 6 file route >900 dòng; `grantFeature` đọc-rồi-ghi nằm rải ở 3 nơi; refund có 2 bản cài đặt khác nghiệp vụ |
| R3 | **Không có middleware quyền** | `router.js` có chỗ khai báo `authLevel` nhưng không dùng; mỗi route tự gọi guard → route mới quên là public |
| R4 | **Fail-open bằng `catch {}`** | Thiếu bảng → hệ thống trả 200 và tắt luật 1-nick-1-máy / coi mọi khách là chưa mua / bỏ qua chốt hoàn tiền |
| R5 | **Không có migration runner** | `schema.sql` thiếu 2 bảng lõi; `db:migrate` chạy thẳng vào production; không ai biết prod đang ở mức nào |
| R6 | **Thời gian lẫn đơn vị** | `payments.at` dùng giây, `orders.paid_at` dùng mili-giây, cùng một luồng; `rate_limits.window_at` là chỉ số khung, không phải timestamp |
| R7 | **Phát hành thủ công, không chữ ký số** | EXE `NotSigned`; hash/version khai báo tay ở 3 nơi; SmartScreen chặn khách |
| R8 | **Test trỏ production + repo bẩn** | 90% test tạo user/đơn thật; secret webhook nằm trong 2 file đã commit |

---

## 2. P0 — 7 lỗi phải sửa trước khi làm bất cứ việc gì khác

> P0 = **mất tiền thật, mất hàng thật, hoặc lộ toàn bộ hệ thống**. Mỗi lỗi kèm cách sửa cụ thể và điều kiện nghiệm thu.

### P0-1 — Hoàn tiền KHÔNG thu hồi quyền → khách dùng vĩnh viễn sau khi được hoàn **[A]**

- `src/routes/orders.js:736-868` (`adminRefund`) và `src/routes/wallet.js:564-661` (`refundOrder` qua Telegram) chỉ set `licenses.revoked=1` + giảm `products.sold_count`.
- Nhưng quyền thật nằm ở `account_entitlements` — `src/routes/entitlement.js:341-348` và `src/routes/trial-account.js:565+` cấp token trực tiếp từ đó.
- **Hệ quả:** admin bấm Hoàn → tiền ra khỏi ví shop, khách vẫn gọi `/api/account/token` nhận token hợp lệ mới và dùng tiếp. Mất cả tiền lẫn hàng.

**Sửa:** tạo `src/lib/entitlement-ledger.js` với `revokeForOrder(env, orderId)`; gọi sau khi giành `refund_ledger` thành công ở cả 2 đường; đọc `order_items` → `products.license_prefix/pid` để biết thu hồi feature nào; ghi `refund_ledger.revoked=1`.
**Nghiệm thu:** mua → hoàn → `POST /api/account/token` phải trả `403 no_entitlement`; mua 2 gói, hoàn 1 gói, gói còn lại vẫn dùng được.

### P0-2 — Sản phẩm thiếu `license_days` = bán quyền VĨNH VIỄN **[A]**

- `src/routes/orders.js:292`: `const days = Number(product.license_days || 0)` → `0`.
- `src/lib/account-entitlement.js:87-89`: `days === 0` → `expiresAt = 0` = vĩnh viễn.
- `src/routes/products.js:407-409`: admin lưu sản phẩm mà không gửi `licenseDays` → ghi `0`.
- `public/assets/pages/admin.js:585`: form gửi `Number(...) || 0` → ô để trống là `0`.
- Ngược lại `src/routes/license.js:198-210` coi `NULL` = 30 ngày. **Hai định nghĩa mâu thuẫn cho cùng một cột.**

**Sửa:** (a) `products.js` — nếu `deliveryType='license'` và `licenseDays` undefined → `400 VALIDATION`, không mặc định; (b) tạo helper duy nhất `resolveTermDays(product)` dùng ở `orders.js` + `license.js`; (c) migration đặt `license_days NOT NULL DEFAULT 30` sau khi backfill.
**Nghiệm thu:** tạo sản phẩm bỏ trống số ngày → 400. Mua gói 30 ngày → `expires_at ≈ now+30d`, không phải `0`.

### P0-3 — `/api/account/token` không áp luật "1 nick 1 máy" **[A]**

- `guardAccountDevice` chỉ được gọi trong `license-server.js:778` và `xa-grant-server.js:480/969`.
- `src/routes/trial-account.js:565-705` (`issueAccountToken`) — **đường duy nhất app dùng** (`tool/app/xa_arena_api.py:2887-2900`) — không import `account-device.js`.
- **Hệ quả:** 1 tài khoản đăng nhập N máy, cả N máy nhận token hợp lệ đồng thời. Bảng `account_devices` tồn tại nhưng không bao giờ được hỏi.

**Sửa:** gọi `guardAccountDevice` trước khi ký token ở `issueAccountToken` + `startSession`; trả `403 session_moved`. **Lưu ý:** `account-device.js:119-132` suy `ownerUserId` qua `license_issues`, mà license trial không ghi bảng đó (`trial-account.js:137-175`) → phải truyền `userId` thẳng từ `trial_accounts`/session thay vì suy.
**Nghiệm thu:** 2 máy khác HWID gọi liên tiếp → máy đầu nhận `session_moved`. Trial cũng bị áp luật.

### P0-4 — Cron xoá sạch bộ đếm rate-limit mỗi 10 phút **[A] [B]**

- `src/index.js:409-410`: `DELETE FROM rate_limits WHERE window_at < Math.floor((nowS - 86400) / 60)`.
- `src/lib/ratelimit.js:107`: `windowAt = Math.floor(nowS / windowSec)` — là **chỉ số khung**, không phải giây.
- Với `windowSec=900` → `window_at ≈ 1,99e6`, luôn nhỏ hơn ngưỡng `≈ 2,98e7` → **mọi dòng bị xoá mỗi 10 phút**.
- Comment tại `index.js:396-408` khẳng định đã sửa đúng — **comment sai so với code**.
- Mất hiệu lực: `login:<ip>` 500/900s (`auth.js:93`), `lf:<username>` 10 sai/900s (`auth.js:151-153`), `reg:<ip>` 300/3600s (`auth.js:22`).

**Sửa:** thêm cột `expires_at` (unix giây) khi ghi trong `ratelimit.js`, cron đổi thành `DELETE WHERE expires_at < ?`. Không có migration thì tạm dùng `Math.floor((nowS - 86400) / 3600)` (mẫu số = window lớn nhất).
**Nghiệm thu:** sai mật khẩu 11 lần → bị khoá; chờ cron chạy; vẫn bị khoá.

### P0-5 — PayOS: thiếu `amount` → giao hàng miễn phí **[A]**

- `src/routes/payments.js:1153-1213` (`payosWebhook`) không kiểm `amount > 0`, không kiểm `code === '00'`.
- `src/routes/payments.js:559`: `Math.floor(Number(amount) || expected)` — `0` bị biến thành `expected` → `state='matched'` → giành đơn → giao hàng đầy đủ.
- Bản `payosWebhook` trong `wallet.js:230-235` **có** kiểm — nhưng bản được route là bản `payments.js`.

**Sửa:** `if (!(amount > 0)) return ok({matched:false, reason:'ZERO_AMOUNT'})`; `if (String(d.code) !== '00') return ok({matched:false, reason:'NOT_SUCCESS'})`; đổi dòng 559 thành chỉ nhận số dương, không suy từ `expected`.

### P0-6 — Secret webhook thật nằm trong git (79 commit) **[A]**

- `qa/e2e.mjs:9` và `qa/e2e-auto.mjs:6` hardcode `sk_b3a80e8c...a1f` — **trùng byte-cho-byte** với `WEBHOOK_SECRET.txt`.
- Cả hai file **đang được git track**.
- Ai có repo là tự ký được webhook SePay → tự tạo tiền trong hệ thống.

**Sửa (làm ngay, trước mọi việc khác):** rotate `WEBHOOK_SECRET` trên Cloudflare + cập nhật SePay; `git rm --cached qa/e2e.mjs qa/e2e-auto.mjs`; đổi sang `process.env.WEBHOOK_SECRET` bắt buộc. Đồng thời kiểm `wrangler.audit.toml:32-36` và `security-audit/wrangler.iso.toml:32-36` (đang track, chứa TG bot token + payOS key) — nếu là bản thật thì rotate luôn.

### P0-7 — EXE phát hành chưa ký số, script ký không nhắm tới nó **[A]**

- `tool/dist-arena/xa_arena.exe` → `Get-AuthenticodeSignature` = **NotSigned**; `VersionInfo` rỗng (`FileVersion 0.0.0.0`, không CompanyName).
- `tool/sign/sign-exe.ps1:70-74` chỉ ký `dist-setup/xa_setup.exe`, `dist-grant/xa_grant.exe`, `dist-nuitka/xa_nofog_pro.exe` — **cả ba không tồn tại trên đĩa**.
- **Hệ quả:** SmartScreen "Unknown publisher", Defender dễ gắn nhãn HackTool (EXE dùng `OpenProcess` + `CreateRemoteThread`), mỗi bản build lại về 0 reputation.

**Sửa:** thêm `tool\dist-arena\xa_arena.exe` vào `$targets`; nhúng version resource (`--windows-version-file`) trong `build-arena.ps1`; **ký sau build, tính SHA-256 sau khi ký**, rồi mới ghi `arena-installer.js` + upload R2.

---

## 3. P1 — 12 lỗi sai nghiệp vụ / vận hành

| # | Lỗi | Vị trí | Hệ quả | Sửa |
|---|---|---|---|---|
| P1-1 | `grantFeature` đọc-rồi-ghi | `account-entitlement.js:81-111` | 2 luồng cấp đồng thời → mất trọn 1 gói đã mua **[B]** | Một câu UPSERT tính hạn trong SQL, `MAX(expires_at, :now) + days*86400` |
| P1-2 | Trial resume cộng thêm hạn | `trial-account.js:488-497` | Mở app 100 lần → trial dài vô hạn **[B]** | Trial có `expires_at` tuyệt đối, resume là đọc idempotent |
| P1-3 | Nhánh `order.status='paid'` không giành đơn | `payments.js:470-476` | 2 request đồng thời → cộng hạn 2 lần, sinh 2 bộ license | Đưa qua cùng `UPDATE ... WHERE status='paid'` + kiểm `changes===1` |
| P1-4 | `payments.at` giây vs `orders.paid_at` ms | `payments.js:388,589` vs `:691-692` | Join trực tiếp, lệch 1000 lần; đối soát sai | Đồng bộ về ms + `UPDATE payments SET at=at*1000 WHERE at<10000000000` |
| P1-5 | Whitelist scope `ip` là tính năng chết | `trial-whitelist-admin.js:143-166`, `trial-quota.js:105-107` | Admin thêm IP, báo thành công, không có tác dụng | Bỏ scope `ip`; hoặc thêm nhánh tra vào `checkWhitelist` |
| P1-6 | Client tự khai `hwid` (không gửi parts) | `trial-account.js:102-114` | Xoay HWID tuỳ ý → phá trần 3 tài khoản/máy | Fail-closed: bắt buộc `guid+bios+cpu+vol` |
| P1-7 | `deliverOrderItems` không SELECT `pid` | `orders.js:192-194` vs `account-entitlement.js:131-136` | Sản phẩm tài nguyên đặt prefix khác → cấp nhầm `nofog` | Thêm `pid` vào câu SELECT |
| P1-8 | Topup/wallet chết nhưng vẫn tạo tiền được | `wallet.js:9-124`, `:1218-1252` | `POST /api/admin/wallet/adjust` sống, không nút UI | Xoá cả cụm (xem §7) |
| P1-9 | `is_test` suy từ tiền tố `referenceCode` | `payments.js:450-453, 966` | Giao dịch thật bị loại khỏi doanh thu & hạn mức 50 GD | Danh sách test tường minh trong `settings` |
| P1-10 | `deriveGate` suy khoá từ key khách | `license-server.js:290-294` | 1 khách trả tiền → lộ toàn bộ bảng vá game | Gate ngẫu nhiên lưu CSDL (như `xa-grant-server.js:523-525`) |
| P1-11 | ~90% test trỏ production | 15/19 `scripts/e2e*.mjs`, toàn bộ `qa/*.mjs` (`qa/q.mjs:5`) | Test tạo user/đơn thật trên prod | `QA_BASE` bắt buộc; cấm domain prod ở test có mutation |
| P1-12 | EXE: bỏ `--once` khỏi lớp kiểm quyền | `xa_arena_app.py:640-645` | `--once` → `xa_nofog_pro.run()` thẳng, thoát GUI arena | Chặn `--once/--trial/--rebind/--logout/--hidden` |

**Bổ sung P1 đáng chú ý:**

- **`--once` + fail-open update** (`xa_update.py:844-849`): chặn `/api/app/version` bằng hosts → EXE cũ + token cũ chạy mãi.
- **`download.js:35-38` FALLBACK** vẫn `3.0.2.0` + hash cũ `D74DC26E…` trong khi server là `3.1.0.0` + `8AE4E0AB…` → khách so hash thấy sai, tưởng file bị chèn.
- **`CLIENT_VERSION='1.5.0.0'`** (`xa_nofog_pro.py:217`) so với server trả node arena `3.1.0.0` → EXE NoFog cũ **tự thay mình bằng `xa_arena.exe`**.

---

## 4. P2/P3 — nợ kỹ thuật (sửa theo lô, không khẩn)

<details>
<summary><b>Backend (18 mục)</b></summary>

- Không có middleware auth; `meta/authLevel` của router bị bỏ không dùng → route mới mặc định public.
- `telegram-actions.js:56-332` (`handleCallback`) không tự xác thực người bấm; `isAdminChat` (l.35-50) là dead code.
- `telegram-actions.js:89-96`: `bal.balance` deref không kiểm null → 500 giữa luồng duyệt nạp tiền, sổ lệch.
- `account-device.js:252-257`: UPDATE không có `AND active_hwid = ?` → khe TOCTOU dù comment nói không có.
- `trial-quota.js:345`: bảng ký tự `'349BCDEFHJKLMNPQRTUWXY'` **vẫn chứa B và L** — đúng 2 cặp dễ nhầm mà comment nói đã bỏ.
- Cron N+1 tuần tự (`index.js:256-276`) → dễ vượt subrequest limit.
- 6 DELETE cron quét toàn bảng vì thiếu index một cột: `sessions(expires_at)`, `rate_limits(window_at)`, `xg_events(at)`, `xg_viol(last_at)`, `lic_events(at)`, `rebind_tokens(expires_at)`.
- `MAX_BUCKETS` đầy → mọi request rơi xuống D1 (ghi) → khuếch đại chi phí khi bị tấn công.
- `secrets.js:60-61`: thiếu `KEY_ENC` → lưu **plaintext**; `:48-52` `KEY_ENC` sai 32 byte → âm thầm đổi khoá.
- Webhook thanh toán không có rate limit nào (`index.js:612-614` miễn trừ toàn cục).
- PBKDF2 100k thấp hơn OWASP 600k; mật khẩu tối thiểu 6 ký tự.
- Login/register/logout thiếu `SECURITY_HEADERS` (`routes/auth.js:71-88, 251-270, 275-282`).
- Đăng nhập ~7 round-trip D1 tuần tự; lib không dùng `DB.batch` ở đâu.
- Route `confirm-payment` đăng ký 2 lần (`index.js:177` và `:213`) — bản thứ hai chết.
- `entitlement.js:379-448` (`?key=`) là oracle dò key không cần đăng nhập.
- `findOrderByMemo` hardcode `'MBK-'` (`payments.js:867`), bỏ qua `payment_prefix`.
- `wallet.js:818-925`: 108 dòng `sepayWebhook` cũ bị nuốt trong comment.
- Trùng lặp: `nowSec()` **6 bản**, `readBody` **8 bản**, `sha256hex` **5 bản**, base64 **6 biến thể**, `MESSAGES` 3 bản, `judge()`/`toLowS` mỗi thứ 2 bản.

</details>

<details>
<summary><b>Web (12 mục)</b></summary>

- `app.js:248-249`: `ensureMain()` chạy **trước** `mountChrome()` → `<header>` và `<footer>` nằm **trong** `<main>` (sai WCAG 1.3.1; comment nói ngược lại).
- `/api/home` đã có backend (`products.js:266`) nhưng **frontend không dùng** → trang chủ 4 round-trip + waterfall thật (`home.js:433 → 530`).
- Ô tìm kiếm mất focus sau 450ms (`products.js:193-197` → `navigate` → `app.innerHTML=`).
- Không quản lý focus, không cập nhật `document.title` khi đổi route (grep = 0).
- `account.js:206,211` dùng `var(--ok)`, `var(--warning)` — **hai biến này không tồn tại** trong `:root`.
- ~750/2.069 dòng CSS là dead code (cart, drawer, ví, key-box, qr, tabs) + 100 class không tham chiếu.
- `state.js:31-119`: toàn bộ module giỏ hàng không ai import; `subscribe()` chết; `bindProductCards()` là no-op.
- Không có build step → 196 KB eager + 89 KB CSS phục vụ nguyên bản; chỉ tách được admin 77,9 KB.
- Copy dùng thử mâu thuẫn: `home.js:73,105,116,126` nói "1 giờ"; `licenses.js:7` nói "1 ngày".
- 8 breakpoint rải rác (420/520/560/640/760/900/1024); 107 inline style; 10 chỗ hardcode màu.
- `licenses.js:269` dùng `confirm()` native thay vì `confirmDialog()`; `support.js:91` breadcrumb thiếu `aria-label`.
- `qa/*.png`, `qa/results-*.json` đang track.

</details>

<details>
<summary><b>App EXE (10 mục)</b></summary>

- `xa_grant_guard.scan()` chỉ gọi ở `grant/xa_grant.py:524`; đường NoFog **không có** lớp chống debug/VM nào.
- `verify_integrity()` (`xa_grant_guard.py:275`) và `integrity()` (`xa_nofog_sec.py:468`) **không nơi nào gọi** → patch EXE không bị phát hiện.
- 2 hàm HWID khác nhau → `xa_arena_api.py:1813-1855` phải gửi 2 HWID (workaround, không phải bản sửa).
- 7 hàm trùng tên giữa `xa_nofog_pro` và `xa_grant`; 2 bản DPAPI; 2 wrapper update (`XArenaNoFog` vs `XAArena`).
- `app/xa_grant_plan.py` (196 dòng): **0 importer**, logic đã viết lại inline và **lệch** (docstring cap 200/300, code dùng 10/20/30).
- `src/xa_nofog_gui_qt.py` (918 dòng): dead code trong arena nhưng vẫn `--include-module` (`build-arena.ps1:127`) → phình EXE.
- `setup/` có 2 GUI (tkinter ~530 dòng + Qt 898 dòng); chỉ Qt được dùng.
- `.build/` (13 MB) + `dist-arena/xa_arena_app.build/` nằm trong repo.
- `.pyc` mồ côi: `xa_grant_clean`, `xa_grant_gui`, `xa_grant_gui_qt`, `check_sites_sync`, `gen_nofog_const`, `gen_xn_key`, `patch_client`. `gen_nofog_const.py`/`gen_grant_const.py` đã xoá → **hằng số không thể tái sinh**.
- `secrets/xn-sign-jwk.json`, `xg-sign-jwk.json` là private key ECDSA **plaintext trên đĩa**; `xa_grant.py:476` còn fallback đọc từ source tree.

</details>

---

## 5. Kiến trúc đích — "lý tưởng nhưng không over-engineering"

### 5.1 Backend: modular monolith, giữ nguyên 1 Worker

Không đổi stack. Không microservice. Chỉ tách **service** khỏi **handler**:

```
src/
├── index.js                 # ~150 dòng: chỉ fetch + route table + cron dispatcher
├── lib/                     # hạ tầng dùng chung
│   ├── router.js            # + enforceAuth(meta) — fail-closed
│   ├── http.js  auth.js  crypto.js  ratelimit.js  validate.js
│   ├── time.js              # nowSec()/nowMs() — MỘT bản duy nhất
│   ├── b64.js  secrets.js  pii.js
│   ├── device.js            # HWID + device session (gộp từ account-device)
│   └── errors.js            # ApiError + mã lỗi chuẩn
├── services/                # ← TẦNG MỚI: nghiệp vụ, không biết HTTP
│   ├── entitlement.js       # grant/revoke/ledger, MỘT nguồn sự thật
│   ├── fulfillment.js       # giao hàng idempotent theo order_item
│   ├── payment.js           # inbox → match → allocate → confirm
│   ├── refund.js            # MỘT RefundService cho web + Telegram
│   ├── release.js           # manifest, channel, download
│   └── notify.js            # outbox + retry
├── routes/                  # mỏng: parse → authorize → service → shape
└── jobs/                    # mỗi cron job 1 file, có kết quả + cảnh báo
```

**Quy tắc bất biến:**
1. Route **không** viết SQL nghiệp vụ, **không** quyết định quyền — chỉ gọi service.
2. Mọi route khai báo `meta.auth` (`public|user|admin|adminStrict`); thiếu khai báo → **mặc định admin** (fail-closed).
3. Mọi thao tác tiền/quyền có `Idempotency-Key` và ghi `ledger`.
4. Không `catch {}` trần: chỉ nuốt đúng `no such table`/`no such column`, còn lại log + đếm.

### 5.2 Dữ liệu: 3 bảng lõi + ledger bất biến

Giữ D1. Thêm/bổ sung:

| Bảng | Vai trò |
|---|---|
| `entitlement_grants` | **Ledger bất biến**: `grant_id, user_id, feature, source_type, source_id(order_item), starts_at, expires_at, revoked_at, reason, idem_key UNIQUE` |
| `account_entitlements` | **Projection** đọc nhanh (giữ nguyên), rebuild được từ ledger |
| `trial_claims` | 1 claim/tài khoản, `started_at`/`expires_at` **bất biến** |
| `device_sessions` | `session_id, user_id, scope, hwid, generation, status, last_seen` |
| `payment_inbox` | Sự kiện thô từ provider, `UNIQUE(provider, txn_id)` — ghi **trước** mọi xử lý |
| `refund_ledger` | Giữ nguyên + thêm `amount_actual`, `bank_ref`, `confirmed_by` |
| `schema_migrations` | `version TEXT PK, applied_at` |

**Quy ước thời gian (chấm dứt R6):** tất cả cột thời gian = **mili-giây** (hậu tố `_ms`), trừ 3 ngoại lệ có chủ đích được ghi rõ trong comment: `rate_limits.window_at` (chỉ số khung), `licenses.*` (giây, giữ để tương thích client), `account_entitlements.expires_at` (giây). Migration backfill `payments.at`.

### 5.3 Hợp đồng API

- `GET /api/v1/snapshot` — **một** endpoint cho cả web và app: `{user, features:{nofog,grant}, trial, device, server_now, release}`. Thay vì app phải gọi 4 endpoint rồi tự suy.
- Mã lỗi có cấu trúc (`{ok:false, code:'NO_ENTITLEMENT', msg, details}`) — app không parse message tiếng Việt.
- `Idempotency-Key` cho: tạo đơn, cấp quyền, xác nhận thanh toán, hoàn tiền.
- Phân trang server cho mọi danh sách admin (`limit/offset/total`).

---

## 6. Kế hoạch LÀM GỌN — cụ thể đến từng file

### 6.1 Xoá ngay (96,1 MB, 0 rủi ro)

| Mục | Dung lượng | Lý do |
|---|---|---|
| `.wrangler/` | **52,7 MB** | State local, sinh lại tự động |
| `qa/shots/` | 20,2 MB | Ảnh QA cũ |
| `_qa_shots/`, `_qa_exe/`, `_rev/`, `shots/` | 4,1 MB | Output phiên test |
| `strftime` (0 B), `script` (67 B), `_audit_tmp_nowms.txt`, `home.html`, `_cleanup.py`, `_fix_loop.py`, `_interleave.py`, `cleanup-level2.sql`, `__pycache__/`, `_audit_tmp/` | ~23 KB | Rác. 3 file `.py` vá tay **theo số dòng cứng**, file đã đổi → trỏ sai |
| `admin-accounts-block.js` (root) | 11 KB | File nháp của tiến trình khác, nội dung đã nằm trong `pages/admin.js` |
| `tool/.build/`, `tool/dist-arena/xa_arena_app.build/` | ~15 MB | Build artifact |

### 6.2 Giữ nhưng đưa ra khỏi thư mục làm việc

| Mục | Dung lượng | Vì sao |
|---|---|---|
| 8 file `backup-*.sql` | 16,9 MB | Chứa `password_hash`/`password_salt` **của khách thật** |
| `backups/` | 6,4 MB | Dump D1 khách thật |
| `keys/` | 283 KB | Bằng chứng bán hàng — **giữ**, nhưng ngoài repo |

→ Chuyển sang ổ ngoài **mã hoá**, xác nhận đọc lại được, rồi xoá bản local.

### 6.3 Gộp tài liệu: 19 file `.md` → 6

```
README.md                    ← DUY NHẤT ở root, sửa 6 lỗi (xem §6.5)
docs/
├── OPERATIONS.md            ← gộp RUNBOOK + SEPAY + HUONG-DAN-WEBHOOK + HUONG-DAN-TELEGRAM
├── RELEASE.md               ← viết lại (bản cũ dẫn file không tồn tại)
├── TODO.md                  ← gộp RA-SOAT-DUNG + RA-SOAT-WEB-ADMIN + KE-HOACH cũ, chỉ giữ việc CHƯA làm
├── app/                     ← XA-ARENA.md, APP-API.md, APP-GUI.md, APP-GRANT.md, APP-NOFOG.md
│                              (mỗi file mở đầu: "Snapshot v3.1.0.0 — không đảm bảo đúng với bản sau")
└── archive/audit-2026-11/   ← 6 báo cáo audit/QA, đóng băng, KHÔNG sửa
```

**Chuyển vào archive:** `PHAN-TICH-TOAN-DIEN.md`, `AUDIT-REPORT.md`, `QA-PAYMENT-REPORT.md`, `QA-EXE-LICENSE-REPORT.md`, `QA-UX-OPS-REPORT.md`, `BAO-CAO-APP-XA-ARENA.md`.
**Xoá sau khi gộp:** `KE-HOACH-TONG-THE-WEB-EXE.md`, `RA-SOAT-*.md`.
**Giữ nguyên:** `aios/SYSTEM-PROMPT.md` (độc lập, không liên quan shop).

### 6.4 Xoá code chết: ~2.500 dòng

**Backend (~1.900 dòng, 14% route):**

| Khối | Dòng | Ghi chú |
|---|---|---|
| `wallet.js` topup + sepayWebhook cũ | ~800 | `createTopup` không được route; 108 dòng trong comment |
| `trial-admin.js` (toàn file) | 384 | Mô hình trial theo lượt đã bỏ |
| `trial.js` `apiTrialStart/Stop` | ~380 | Giữ `claim/left/command` (client còn dùng) |
| `sepay-reconcile.js` | ~217 | Giữ `autoWindow` (~30 dòng, `payments.js:1039` cần) |
| coupon trong `orders.js` + cron | ~70 | Không còn UI |

**Route chết không còn caller nào (~40 route):**
`/api/coupons/check`, `/api/orders/:id/claimed`, `/api/trial/start|stop`, `/api/license/health`, `/api/xg/heartbeat|rebind|health`, `/api/shop/lic`, `/api/admin/licenses*`, `/api/admin/migrate-delivered-keys`, `/api/admin/coupons*`, `/api/admin/trial/accounts|uses|resets|reset|grant|ban`, `/api/admin/sepay/reconcile|quota|sync`, `/api/admin/topups*`, `/api/admin/wallet/adjust`, `/api/admin/orders/:id/confirm-payment` (bản trùng).

> **Thứ tự ngừng an toàn (bắt buộc):** ① đo hit 2 tuần bằng log đếm → ② ẩn nút UI → ③ trả **410** kèm hướng dẫn (đúng mẫu `index.js:530-544`) → ④ xoá code theo thứ tự rủi ro tăng dần (coupon → topup/wallet → trial-admin → trial/start|stop → license/shop-lic) → ⑤ xoá bảng **sau cùng**. **Không xoá đường hoàn tiền/giao hàng nào trước khi vá P0-1.**

**Web (~750 dòng CSS + ~120 dòng JS):** `style.css` bỏ nhóm `cart-*`, `drawer-*`, `qty-*`, `key-box`, `ck-*`, `qr-*`, `tx-*`, `pd-review*`, `summary-row`, `tabs`, `balance-chip`; `state.js:31-119` xoá cả module giỏ hàng; `lib.js:11 bold()`, `icons.js:135 iconNames`, `state.js:16 aiOpen` xoá.

**App:** `app/xa_grant_plan.py` (196 dòng, 0 importer), `src/xa_nofog_gui_qt.py` (918 dòng) + bỏ `--include-module` khỏi build, GUI tkinter của `setup/` (~530 dòng), 7 `.pyc` mồ côi.

### 6.5 Cây thư mục đích

```
muabankey/
├── README.md                 ← duy nhất ở root
├── wrangler.toml
├── package.json              ← + scripts: test, lint, migrate, build:exe, release
├── src/{index.js,lib,services,routes,jobs}
├── public/{index.html,_headers,assets,pages,img}
├── db/{schema.sql, migrations/001-*.sql …}
├── tool/{app,grant,src,ui,build,sign,dist-arena}
├── tests/{unit,e2e,fixtures}      ← gộp scripts/ + qa/ + security-audit/
├── docs/{OPERATIONS.md,RELEASE.md,TODO.md,app/,archive/}
└── .github/workflows/{ci.yml,release.yml}
```

### 6.6 Sửa 6 lỗi trong README (đang dùng để marketing)

| Dòng | Ghi sai | Đúng |
|---|---|---|
| 127 | "Grace offline 24 giờ" | `license-server.js:94` = `GRACE_HOURS = 0` |
| 241 | "20/h, 30/15p, 300/phút" | `auth.js:22` 300/3600s; `auth.js:93` 500/900s; `index.js:619` 3000/60s |
| 225,233 | "57 test lõi / 102 PASS" | `e2e.mjs` có 67 lời gọi `ok(`, `e2e-business.mjs` có 18 |
| 229 | `.webhook-secret.txt` | Tên thật: `WEBHOOK_SECRET.txt` |
| 274 | "19 SVG" | `public/img/` có 21 |
| **§4 (114-131), §6 (160-185)** | Dạy dùng `{key,hwid}` và nạp ví `#/wallet` | **Xoá cả 2 mục** — mô hình đã bỏ, `app.js:37` ghi `// /wallet bỏ` |

---

## 7. Kế hoạch WEB (public/)

Giữ dark-neutral hiện có — **không thiết kế lại chỉ để đổi mới**.

### 7.1 Việc phải làm

| Ưu tiên | Việc | Chi tiết |
|---|---|---|
| 1 | Sửa landmark | Đổi thứ tự `mountChrome()` **trước** `ensureMain()` (`app.js:248-249`) |
| 2 | Nối `/api/home` | `home.js` gọi 1 endpoint thay 4; bỏ waterfall `home.js:433 → 530` |
| 3 | Sửa ô search | `products.js:193` — re-render chỉ vùng kết quả, không `app.innerHTML=` |
| 4 | Router lifecycle | `AbortController` per-route, dispose bag, `document.title` theo route, focus về `<h1>` |
| 5 | CSS token | Khai báo `--ok`/`--warning`; gom 8 breakpoint về 3 (640/1024/1280); thay 107 inline style |
| 6 | Build step | esbuild: minify + content hash → cache `immutable`; lazy-load 5 trang nặng (guide, download, support, licenses, account) |
| 7 | Dọn dead code | ~750 dòng CSS + module giỏ hàng (xem §6.4) |

### 7.2 Perf budget (đo ở staging, p75 mobile)

| Chỉ số | Mục tiêu |
|---|---|
| LCP | ≤ 2,5 s |
| INP | ≤ 200 ms |
| CLS | ≤ 0,1 |
| JS eager (gzip) | ≤ 60 KB |
| Request trang chủ | 2 (HTML + `/api/home`) |

### 7.3 Từng trang — việc còn thiếu

| Trang | Thiếu gì |
|---|---|
| `/` | Copy "1 giờ" → "1 ngày"; dùng `/api/home`; bỏ metric không đáng tin |
| `/products` | Search giữ focus; nút "Thử lại" khi lỗi |
| `/product/:slug` | `loading="lazy"` cho ảnh; hiện review thật (DB đã có `rating_count`) |
| `/checkout` | Phân biệt 4 trạng thái: chờ tiền / đã nhận / đang cấp / đã cấp; 26 inline style; 6 màu hardcode |
| `/account` | Sửa `var(--ok)/var(--warning)`; hiện quyền từng feature + thiết bị + sessions |
| `/orders` | `hasMore` suy từ `length >= 50` → cần `total` từ server |
| `/licenses` | Thay `confirm()` native bằng `confirmDialog()` |
| `/support` | Breadcrumb thiếu `aria-label`; nội dung nên sửa được từ admin |
| `/huong-dan` | 28 inline style; `✓` text thay vì `icon()`; `mountGuide()` rỗng |
| `/tai-ve` | FALLBACK lệch version/hash (**P1**); 15 inline style |
| `/admin` | Xem §7.4 |

### 7.4 Admin — 10 tab → 9 tab

```
Tổng quan · Đơn hàng · Thanh toán/Đối soát · Quyền tài khoản ·
Khách hàng · Dùng thử · Hoàn tiền · Bản phát hành · Nhật ký · Cài đặt
```

- **Tổng quan** ưu tiên *việc cần làm*: tiền chưa gán, đã thu chưa cấp, refund chưa trả, lỗi cấp token. Bỏ "sắp hết key" (không còn kho key).
- **Ẩn nút theo role**: `staff` hiện đang thấy nút của tab `requireAdminStrict` rồi nhận 403 (`admin.js:1178`, `:1558`).
- **Phân trang server** cho orders/products/users/logs (hiện tải hết).
- Nút cấp/thu hồi/refund phải có **preview tác động** + lý do + audit.
- Xoá tab/cụm gọi route đã chết (topup, coupon, license cũ).

---

## 8. Kế hoạch APP EXE (tool/)

### 8.1 Kiến trúc đích — không rewrite, chỉ tách

```
tool/
├── app/xa_arena_app.py      # entry: mutex, CLI guard, GUI/CLI dispatch (~400 dòng)
├── core/
│   ├── xa_win.py            # HWID (MỘT bản, versioned) + DPAPI + find_game + is_admin
│   ├── xa_license.py        # update_enforce + token store + entitlement snapshot
│   ├── xa_api.py            # client HTTP: timeout, retry, mã lỗi typed
│   └── xa_coordinator.py    # state machine: login → snapshot → device → token → ready
├── features/
│   ├── nofog/               # tách từ xa_nofog_pro.py (5.241 dòng)
│   └── grant/               # tách từ xa_grant.py (4.243 dòng)
├── ui/xa_arena_gui.py       # presentation, không gọi network trực tiếp
└── build/{build-arena.ps1, sign.ps1, version.rc}
```

**State machine (chấm dứt "gọi nhầm trial cho khách đã mua"):**
```
session → snapshot(paid/trial) → device check → token cho feature ĐÃ CÓ → chỉ start trial nếu chưa có & đủ điều kiện
```
Sửa `xa_arena_api.py:2983-2991` (thiếu grant key → gọi `start_account_trial` thay vì `fetch_account_token`) và `xa_arena_gui.py:3431-3447` (login xong luôn khởi động trial).

### 8.2 Build + ký + phát hành — một đường duy nhất

```
build-arena.ps1
  1. Kiểm APP_VERSION ↔ EXE_VERSION
  2. Nhúng version resource (CompanyName/ProductName/FileVersion)
  3. PyInstaller onefile --windowed
  4. KÝ Authenticode + timestamp        ← bước còn thiếu
  5. TÍNH SHA-256 SAU KHI KÝ
  6. Ghi arena-installer.js (không Read-Host)
  7. Upload R2 object bất biến (files/xa_arena-<ver>.exe) + verify tải lại
  8. Promote manifest  →  deploy
```

Bỏ hoàn toàn việc khai báo version ở nhiều nơi: `download.js:35-38` FALLBACK, `scripts/check_versions.py:113`, `xa_nofog_pro.py:217`, `xa_grant.py:100`, `xa_setup.py:72` — **một nguồn duy nhất** sinh ra manifest.

### 8.3 Chống bypass (theo thứ tự hiệu quả/chi phí)

| # | Việc | Chặn được |
|---|---|---|
| 1 | Gọi `xa_grant_guard.scan()` + `verify_integrity()` ở `PatchWorker.run` và trước `apply_set` | Patch EXE, chạy trên VM, gắn debugger |
| 2 | Chặn `--once/--trial/--rebind/--logout/--hidden` (`xa_arena_app.py:640-645`) | Thoát GUI arena |
| 3 | Gate ngẫu nhiên lưu CSDL thay `deriveGate` (`license-server.js:290-294`) | Dump bảng vá sau 1 lượt trial |
| 4 | Snapshot `/api/v1/snapshot` + device session | Share tài khoản |
| 5 | Ký số + version resource | SmartScreen, AV false positive |

> Không hứa "không thể crack" — Python onefile luôn dịch ngược được. Mục tiêu thực tế: **nâng chi phí crack cao hơn giá gói** và **không mất tiền oan**.

---

## 9. Kế hoạch VẬN HÀNH

### 9.1 Tách môi trường

```
local  →  staging (D1/KV/R2/Telegram/secret riêng)  →  production
```
Mọi script có mutation phải kiểm `ENV` + cờ tường minh. Không dùng prefix mã giao dịch thay cho isolation.

### 9.2 Migration runner (thay `db:migrate` hiện tại)

- `db/migrations/001-account-entitlements.sql`, `002-trial-account.sql`, `003-indexes.sql`, …
- Bảng `schema_migrations(version TEXT PK, applied_at INTEGER)`.
- `scripts/migrate.mjs`: đọc `wrangler d1 execute --remote --json` → so tên file → chỉ chạy file thiếu → ghi version.
- Mọi file dùng `IF NOT EXISTS` (idempotent).
- **Việc đầu tiên:** append nguyên văn 2 migration hiện có vào `db/schema.sql` (vì schema đang **thiếu `account_entitlements` + `trial_accounts`** — 45 chỗ trong code đọc 2 bảng này).

### 9.3 CI/CD tối thiểu (đang không có gì)

`.github/workflows/ci.yml` — mỗi PR: `node --check` toàn `src/` → `eslint` → `vitest run` (unit) → build esbuild → `db/schema.sql` parse bằng SQLite in-memory.
`release.yml` — tag `v*`: build web → build EXE → ký → manifest → upload → deploy, có bước **fail nếu `git status --porcelain` khác rỗng**.

### 9.4 Backup & rollback (đang không có)

- D1 export định kỳ (cron GitHub Actions), mã hoá, retention 30 ngày, **diễn tập restore mỗi quý**.
- `wrangler rollback` có trong runbook + script; mỗi deploy ghi lại version id.

### 9.5 Monitoring

Structured log có `request_id/order_id/payment_id/user_pseudonym/release_version`. Metric bắt buộc:

`payment_persisted` · `payment_matched` · `pending_fulfillment` · `duplicate_prevented` · `grant_failure` · `token_issue_failure` · `client_version` · `update_success/rollback`

Alert khi: tiền chưa gán > 0 trong 30 phút · đã thu chưa cấp > 5 phút · `grant_failure` > 0 · cron lỗi.

---

## 10. Kế hoạch TEST

### 10.1 Hiện trạng

| Nhóm | File | Assertion | Chạy offline? |
|---|---|---|---|
| `scripts/e2e*.mjs` | 19 | ~835 | 2/19 |
| `qa/*.mjs` | 48 | 121 | Không (`qa/q.mjs:5` = prod) |
| `scripts/qa/*.mjs` | 19 | 61 | Không |
| `security-audit/tests` | 6 | 68 | Có, nhưng **schema đã lệch** (23 bảng vs 34) |

**Không có test cho:** 11 module `src/lib/`, `scheduled()`, `account_entitlements`, `trial_accounts`, `refund_ledger`, `arena-installer`, `ai`.

### 10.2 Ma trận bắt buộc (P0 gate)

**Tiền:** QR sai tài khoản · amount 0/âm/sai kiểu · replay cùng txn · 2 txn cùng đơn · thiếu+bù · tiền về đơn `expired/cancelled/delivered/paid` · DB lỗi ở từng điểm ghi · worker chết giữa chừng.

**Quyền:** trial lần đầu/resume ×100/đồng thời/hết hạn · paid-only nofog/grant/both · trial còn rồi mua · 2 đơn gia hạn đồng thời · retry cùng `order_item` · **mua → hoàn → token phải 403** · 2 máy khác HWID → `session_moved`.

**Desktop:** login sai/lockout/session hết · token cũ không theo account mới · 2 PC đổi quyền · clock sai · hủy giữa worker · Win10/11 x64 · DPI 100/150/200% · path tiếng Việt · standard user · update: hash sai/manifest sai/disk full/AV lock/swap fail.

**Web:** chuyển route nhanh khi API chậm · back/F5 · nhiều tab · Escape/click ngoài modal · XSS từ tên sản phẩm/error · keyboard/focus/contrast · 360/375/768/1280/1440px · zoom 200%.

---

## 11. Lộ trình 7 giai đoạn

> Ước lượng = **ngày công kỹ sư quen dự án**. Chưa tính chờ chứng chỉ ký số (có thể 3–10 ngày làm việc).

| GĐ | Nội dung | Ngày | Gate hoàn thành |
|---|---|---:|---|
| **0 — Chặn máu** | P0-6 (rotate secret), commit `account-admin.js`, sửa cron rate-limit (P0-4), fix `download.js` FALLBACK | 0,5 | `git status` sạch; secret mới hoạt động; lockout không bị reset |
| **1 — Bảo toàn tiền/quyền** | P0-1, P0-2, P0-3, P0-5, P1-1→P1-4, payment inbox, RefundService | 5–8 | Ma trận P0 pass 100%; đối soát quyền không lệch |
| **2 — Dữ liệu & hợp đồng** | Migration runner, `entitlement_grants` ledger, `device_sessions`, `/api/v1/snapshot`, chuẩn hoá thời gian | 4–6 | Fresh install + upgrade + client cũ đều pass |
| **3 — Web & Admin** | 7 mục §7.1, 10 tab admin mới, copy/policy thống nhất | 4–7 | E2E khách/admin/Telegram đồng nhất |
| **4 — Desktop** | Coordinator, tách module, paid/trial token, chặn `--once`, HWID v2 | 5–8 | Windows matrix pass; paid-only grant hoạt động |
| **5 — Phát hành tin cậy** | Ký số, version resource, manifest, canary, updater recovery, rollback | 3–5 | Binary/manifest/published hash khớp; rollback diễn tập thành công |
| **6 — Thu gọn** | Xoá legacy theo §6 (sau telemetry 2 tuần), dọn 96 MB, gộp docs, perf | 3–5 | Không request khách hợp lệ nào gãy; số đo tốt hơn baseline |

**Tổng: ~25–40 ngày công.** Nhưng **Giai đoạn 0 + 1 nên phát hành trong 1–2 tuần đầu** — đó là phần đang mất tiền thật.

---

## 12. Definition of Done — "hoàn hảo" đo được

1. Không còn P0 nào đã biết; toàn bộ test P0 deterministic pass.
2. Thu tiền → cấp đúng quyền → app nhận ở **cả hai** tính năng, ≤ 60 giây sau xác nhận.
3. Trial resume **không đổi hạn**; retry **không cấp trùng**; 2 đơn gia hạn đồng thời **không mất ngày**.
4. **Hoàn tiền thu hồi đúng nguồn quyền**; web và Telegram dùng **cùng một service**; chưa có chứng từ thì không hiện "đã hoàn".
5. Backfill khách cũ có báo cáo trước/sau + exception queue; **không ai mất quyền** do đổi mô hình.
6. Fresh setup và upgrade **lặp lại được**, không cần nhớ thứ tự SQL lẻ.
7. EXE **đã ký**, manifest khớp hash sau ký, canary + rollback đã diễn tập.
8. Có alert cho: tiền chưa gán, đã thu chưa cấp, lỗi cấp token, cron lỗi.
9. Web/Admin/App/FAQ/bot nói **cùng một policy**; mọi lỗi có đường xử lý.
10. Perf: LCP p75 ≤ 2,5 s · INP ≤ 200 ms · CLS ≤ 0,1 · JS eager ≤ 60 KB (gzip).
11. `README.md` đúng 100% so với code; repo không còn file rác; `git status` sạch trước mỗi deploy.

---

## 13. Việc làm NGAY (hôm nay, ~4 giờ)

| # | Việc | File | Thời gian |
|---|---|---|---|
| 1 | `git add src/routes/account-admin.js` + 3 file đang `M`; commit | — | 5 phút |
| 2 | Rotate `WEBHOOK_SECRET`, cập nhật SePay; `git rm --cached qa/e2e.mjs qa/e2e-auto.mjs`; đổi sang `process.env` | `qa/*.mjs` | 30 phút |
| 3 | Kiểm `wrangler.audit.toml` + `security-audit/wrangler.iso.toml` có phải credential thật → rotate nếu đúng | 2 file toml | 20 phút |
| 4 | Sửa cron rate-limit: `Math.floor((nowS - 86400) / 3600)` | `src/index.js:410` | 5 phút |
| 5 | Append 2 migration vào `db/schema.sql` | `db/` | 20 phút |
| 6 | `license_days`: chặn `0` khi `deliveryType='license'` | `src/routes/products.js:407-409` | 20 phút |
| 7 | Gọi `guardAccountDevice` trong `issueAccountToken` + `startSession` | `src/routes/trial-account.js` | 1 giờ |
| 8 | Hoàn tiền thu hồi `account_entitlements` | `orders.js:736-868`, `wallet.js:564-661` | 1 giờ |
| 9 | PayOS: kiểm `amount > 0` + `code === '00'` | `src/routes/payments.js:1153-1213` | 15 phút |
| 10 | `download.js` FALLBACK → `3.1.0.0` / `8AE4E0AB…` / 23,6 MB (hoặc bỏ hẳn, đọc 100% từ API) | `public/assets/pages/download.js:35-38` | 10 phút |
| 11 | Chặn `--once` khỏi route CLI | `tool/app/xa_arena_app.py:640-645` | 10 phút |
| 12 | Xoá rác 0 rủi ro (§6.1) | — | 10 phút |

> **Thứ tự bắt buộc:** 1 → 2 → 3 trước (repo + secret), sau đó 4 → 11. Việc #8 phụ thuộc #7 đã xong (cần biết `userId`).

---

## 14. Rủi ro & câu hỏi cần bạn chốt

### Rủi ro

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Tiến trình khác đang sửa repo | Ghi đè lẫn nhau, mất việc | Dừng nó trước khi bắt đầu |
| `catch {}` fail-open + thiếu bảng | Hệ thống trả 200 nhưng **tắt luật** mà không báo | Việc #5 + log lỗi schema |
| Xoá legacy quá sớm | Khách bản cũ gãy | Telemetry 2 tuần + trả 410 trước |
| Chưa có chứng chỉ ký số | SmartScreen vẫn chặn | Mua cert EV (~3–10 ngày) hoặc chấp nhận hướng dẫn thủ công |
| `.dev.vars` có `KEY_ENC` khác `.key-enc.txt` | Một trong hai giải mã sai → mất secret đã giao | Kiểm ngay, xác định bản đúng |

### 8 quyết định cần bạn chốt trước Giai đoạn 1

| # | Câu hỏi | Đề xuất |
|---|---|---|
| 1 | Trial bắt đầu khi **mở app** hay khi bấm "Bắt đầu"? | Mở app (đúng hành vi hiện tại) |
| 2 | Trial **1 ngày** hay 3 ngày? | **1 ngày** (README + code đã chốt) |
| 3 | Mua thêm khi còn hạn: **cộng dồn** hay **từ hôm nay**? | Cộng dồn từ `max(now, hạn cũ)` |
| 4 | Trial còn dư khi mua: **cộng** vào gói mua hay bỏ? | Bỏ (trial và paid là 2 nguồn riêng) |
| 5 | 1 tài khoản được **mấy máy**? | 1 máy, đổi máy cần admin duyệt |
| 6 | Mất mật khẩu: có email không? | Không → mã khôi phục 1 lần hoặc admin cấp lại |
| 7 | Hoàn tiền: hoàn **toàn phần** hay cho phép hoàn một phần/thừa? | Toàn phần cho gói, hoàn thừa là refund của payment |
| 8 | Có còn phát hành EXE NoFog/Grant **riêng** không? | Không — chỉ 1 EXE `xa_arena.exe` |

---

## 15. Bảng tổng hợp ưu tiên

| Mức | Số lượng | Ảnh hưởng | Làm ở giai đoạn |
|---|---:|---|---|
| **P0** | 7 | Mất tiền/mất hàng/lộ hệ thống | 0–1 |
| **P1** | 12 | Sai nghiệp vụ, chặn phát hành | 1–4 |
| **P2** | 18 | Nợ kỹ thuật, chi phí, hiệu năng | 3–6 |
| **P3** | ~25 | Dọn dẹp, thẩm mỹ | 6 |

**Nếu chỉ làm được 3 việc:** ① rotate secret + commit repo ② hoàn tiền thu hồi `account_entitlements` ③ `license_days` không được mặc định 0.
Ba việc này chặn được phần lớn thiệt hại đang xảy ra.
