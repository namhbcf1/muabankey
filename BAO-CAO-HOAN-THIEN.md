# Báo cáo hoàn thiện — kế thừa 2 session (21/11/2026)

Kế thừa `session-a3289a6e` (audit web SPA) và `session-46846323` (kế hoạch tổng thể
`KE-HOACH-TONG-THE-WEB-EXE.md`). Tài liệu đó **không sửa mã nguồn** — chỉ lập kế hoạch.
Báo cáo này ghi lại việc **triển khai thật** các phát hiện P0/P1 kèm bằng chứng chạy được.

## 1. Cách chứng minh: kiểm thử chạy thật, không đọc code bằng mắt

Trước đây dự án **không có kiểm thử tự động nào** (`package.json` không có script `test`).
Mọi kết luận đều dựa trên đọc mã. Bản thân kế hoạch cũng ghi rõ: *"Tái hiện bằng helper
thật với DB stub"* — nhưng không có harness nào để chạy lại.

Đã dựng:

| Thành phần | Vai trò |
|---|---|
| [`test/d1.mjs`](test/d1.mjs) | Mô phỏng D1 bằng `node:sqlite` — `prepare/bind/first/all/run`, `batch` là **một transaction thật** |
| [`test/harness.mjs`](test/harness.mjs) | Bộ chạy kiểm thử tối giản, không phụ thuộc thư viện |
| [`test/dom-shim.mjs`](test/dom-shim.mjs) | DOM tối thiểu để kiểm **cấu trúc cây** thật (không đọc code suy đoán) |
| [`test/run.mjs`](test/run.mjs) | Chạy mọi suite trong process riêng |
| [`scripts/check-syntax.mjs`](scripts/check-syntax.mjs) | Kiểm cú pháp + **mọi import tĩnh có đích thật** |

**Kết quả hiện tại: 383 kiểm tra, 0 lỗi.**

```
Hồi quy: chưa migrate bảng mới: 14 ✓
Giao hàng & cấp quyền:          18 ✓
Thiết bị theo tài khoản:        23 ✓
Quyền theo tài khoản:           39 ✓
Migration:                      31 ✓
Hộp thư tiền vào:               20 ✓
QA target guard:                49 ✓
Hoàn tiền:                      41 ✓
Phát hành EXE:                  44 ✓
Cấu trúc SPA:                   44 ✓
Web: chính sách & hiệu năng:    41 ✓
Coordinator app (Python):       25 ✓
```

## 2. Hai lỗi P0 đã tái hiện được TRƯỚC khi sửa

Đây là điểm quan trọng nhất: các con số dưới đây là **đo được**, không phải suy luận.

### F01 — Resume dùng thử cộng thêm thời gian

```
✗ resume giữ NGUYÊN hạn dùng thử — hạn lệch 86340 giây (dương = cộng thêm sai)
```

Đúng bằng con số kế hoạch ghi (86.340 giây ≈ 1 ngày). Nguyên nhân:
[`trial-account.js`](src/routes/trial-account.js) gọi `grantFeature(daysLeft)` ở **mỗi lần**
start/resume, mà `grantFeature` cộng dồn.

### F03 — Hai lần gia hạn đồng thời mất 30 ngày

```
✗ hai lần mua 30 ngày đồng thời -> cộng đủ 60 ngày — nhận +30 ngày
```

Nguyên nhân: `SELECT expires_at` rồi tính trong JS rồi UPSERT — hai request cùng đọc hạn cũ.

## 3. Đã sửa gì (theo từng phát hiện)

### F01 / F02 / F03 — Quyền theo tài khoản

[`src/lib/account-entitlement.js`](src/lib/account-entitlement.js) viết lại:

- **Toàn bộ phép cộng nằm trong SQL**, không còn đọc-rồi-ghi. D1 tự tuần tự hoá.
- Thêm `applyTrialEntitlement()` — **ĐẶT mốc tuyệt đối**, idempotent, và **không rút ngắn
  quyền đã mua** hay hạ quyền vĩnh viễn.
- Thêm sổ cái bất biến `entitlement_grants` ([`db/migrations/0002`](db/migrations/0002-grant-ledger.sql)):
  mỗi lần cấp một dòng; `INSERT ... WHERE NOT EXISTS` + `UPDATE ... WHERE EXISTS(grant_id)`
  trong **cùng một batch** → retry cùng đơn không cộng hai lần.
- `revokeOrderGrants()` trừ **đúng số ngày của đơn bị hoàn**, giữ nguyên các đơn khác.

Bằng chứng ([`test/entitlement.test.mjs`](test/entitlement.test.mjs), 39 kiểm tra):

```
✓ hai lần mua 30 ngày đồng thời -> cộng đủ 60 ngày
✓ resume 1 lần hay 11 lần đều giữ NGUYÊN hạn dùng thử
✓ quyền mua 365 ngày không bị trial 1 ngày đè xuống
✓ quyền vĩnh viễn vẫn là 0 sau khi dùng thử
✓ hoàn đơn A -> còn đúng 30 ngày của đơn B
✓ sau 5 lần retry + 2 đơn -> đúng 60 ngày (không phải 150+)
```

Và F02 quantity ([`test/delivery.test.mjs`](test/delivery.test.mjs)):

```
✓ mua 2 kỳ 30 ngày -> 60 ngày quyền
✓ 3 × 7 = 21 ngày
✓ gọi 3 lần vẫn 30 ngày
✓ days_added = 60 (30 × 2)
```

### F04 — Hoàn tiền: một dịch vụ duy nhất

[`src/lib/refund-service.js`](src/lib/refund-service.js) — web và Telegram gọi **cùng một hàm**.

Bản cũ có hai bản cài đặt khác nhau: web ghi `admin_note`, Telegram **cộng `users.balance`**
(ví đã bị bỏ). Test chứng minh hai kênh giờ cho cùng kết quả:

```
✓ hai kênh cho CÙNG trạng thái đơn
✓ hai kênh hoàn CÙNG số tiền
✓ KHÔNG kênh nào cộng số dư ví (ví đã bỏ)
✓ KHÔNG kênh nào ghi wallet_transactions
✓ sau hoàn: quyền nofog ĐÃ bị thu hồi
```

Đồng thời tách **hai bước**: `refund` (thu hồi quyền) và `refund/complete`
(chốt đã chuyển tiền, **bắt buộc mã giao dịch ngân hàng**).

```
✓ đơn KHÔNG nhảy thẳng sang "refunded" khi chưa có chứng từ
✓ thiếu mã giao dịch -> từ chối chốt
✓ chốt lần hai bị chặn
```

### F05 — Hàng rào thiết bị

[`src/lib/account-device.js`](src/lib/account-device.js): `ownerUserId()` **chỉ tra
`license_issues`** — bảng mà key nội bộ của mô hình mới **không bao giờ có dòng**. Vì vậy
luật "một tài khoản = một máy" chưa bao giờ chạy cho khách mua/dùng thử mới.

Đã sửa: tra thêm `trial_accounts.nofog_key`/`grant_key`, và gắn `guardAccountDevice`
vào `POST /api/account/token` (đường cấp token trước đây **không có hàng rào nào**).

```
✓ tra được chủ của key map sáng nội bộ
✓ máy B bị chặn session_moved khi máy A còn sống
✓ cùng máy, hai lần gọi -> không đá nhau
✓ thiếu bảng -> CHO QUA (fail-open, không khoá oan khách đã trả tiền)
```

### F06 — App EXE: quyền đã mua phải được đọc TRƯỚC trial

[`tool/app/xa_arena_api.py`](tool/app/xa_arena_api.py): `ensure_grant_token()` gọi thẳng
`start_account_trial()` — endpoint **DÙNG THỬ**. Khách đã mua gói tài nguyên sẽ nhận
`trial_used_before`/`trial_expired` dù quyền còn nguyên.

[`tool/app/xa_arena_gui.py`](tool/app/xa_arena_gui.py): `_on_login_required()` bật trial
ngay sau đăng nhập; `_maybe_free_trial()` chỉ xét license mô hình cũ.

Sửa cả ba: `/api/account/token` trước → chỉ trial khi `no_entitlement`; đăng nhập xong
**đọc quyền** trước; `_maybe_free_trial` xét thêm `hasNofog`/`hasGrant`.

### F07 — Chứng từ tiền vào bền vững

[`src/lib/payment-inbox.js`](src/lib/payment-inbox.js) + bảng `payment_inbox` với
`UNIQUE(provider, transaction_id)`.

Bản cũ có **4 nhánh return trước khi ghi sổ**, tất cả đều trả 200 cho provider — tiền vào
ngân hàng mà sổ trống. Nay `recordInbound()` chạy **trước mọi nhánh**, và **ném lỗi** khi
không ghi được (→ webhook trả 5xx → provider retry).

```
✓ chỉ MỘT lượt ghi mới (10 webhook đồng thời)
✓ thiếu bảng -> ném lỗi (không nuốt)
✓ khoản "đã thu tiền nhưng giao lỗi" vẫn hiện trong đối soát
```

### F08 — Migration có đánh số

[`db/migrate.mjs`](db/migrate.mjs): bảng `schema_migrations`, checksum SHA-256, chạy theo
thứ tự, mỗi file một transaction, **dừng khi checksum đổi**, có `--check` và `--baseline`.

`schema.sql` trước đây **thiếu** `account_entitlements`/`trial_accounts` → dựng môi trường
mới ra CSDL thiếu bảng, mọi truy vấn quyền bị `catch {}` nuốt → app báo "khách không có
quyền" cho cả khách đã trả tiền.

```
✓ schema nền THIẾU account_entitlements (đúng như lỗi F08)
✓ sau migrate: có account_entitlements
✓ nâng cấp CSDL cũ không lỗi
✓ dữ liệu orders cũ KHÔNG bị mất
✓ checksum lệch -> BÁO LỖI, không im lặng
```

### F09 — Một chính sách, một nguồn

[`public/assets/policy.js`](public/assets/policy.js) + [`src/lib/policy.js`](src/lib/policy.js).

Bản cũ có 6 nơi viết chính sách với **3 phiên bản mâu thuẫn**: `index.html` "ngay khi mở
app", `home.js` "1 giờ · không cần đăng ký", `licenses.js`/`src/index.js` "1 ngày".

Đã sửa trang chủ, `index.html`, FAQ (dùng `TRIAL_FAQ`), và **bot AI** — bot cũ trả lời
*"vào mục Nạp tiền, quét VietQR, tiền vào ví, mua key"*: cả ba thứ đó **không còn tồn tại**.

```
✓ days KHỚP giữa client và server
✓ home.js KHÔNG còn "1 giờ" trong mã
✓ home.js KHÔNG còn "không cần đăng ký" trong mã
```

### Audit web SPA

| Lỗi | Sửa |
|---|---|
| **HIGH** `<header>`/`<footer>` nằm TRONG `<main>` (ngược WCAG 1.3.1) | `ensureMain` chỉ chuyển node không-phải-chrome, chèn `<main>` giữa header/footer |
| **HIGH** `/api/home` có ở backend nhưng frontend không dùng | `mountHome` gọi **một** request `/api/home` |
| **HIGH** ô tìm kiếm mất focus khi gõ | bỏ `navigate()` khi gõ; chỉ tải lại lưới + `history.replaceState` |
| **MEDIUM** không cập nhật `document.title` | bảng `TITLES` theo route + `setPageTitle()` |
| **MEDIUM** không quản lý focus khi đổi route | `focusMainIfNavigating()`, bỏ qua khi đang gõ |
| **MEDIUM** breadcrumb `<div>` thiếu `aria-label` | đồng nhất `<nav aria-label>` |

Test landmark dựng **cây DOM thật** rồi kiểm quan hệ cha/con — không đọc code suy đoán:

```
✓ HEADER KHÔNG nằm trong <main>
✓ FOOTER KHÔNG nằm trong <main>
✓ thứ tự đúng: header → main → footer
✓ khối search KHÔNG gọi navigate()
✓ đường tải trang chỉ có 1 await api()
```

### F13 / F14 — Phát hành EXE

[`tool/release.mjs`](tool/release.mjs): manifest sinh **từ bytes** của file đã build
(sha256/size đo được), ký bằng khoá riêng, kiểm lại trước khi promote.

Bản cũ: `EXE_VERSION`/`EXE_SHA256`/`EXE_SIZE` viết tay trong
[`arena-installer.js`](src/routes/arena-installer.js), và `download.js` còn fallback
**3.0.2.0 + hash cũ** hiện như thể đã xác minh → khách tải file mới, đối chiếu hash cũ,
thấy lệch, tưởng file bị chèn mã độc.

Nay server trả `verified: true` chỉ khi có manifest thật:

```
✓ KHÔNG còn EXE_VERSION viết tay
✓ KHÔNG còn fallback version 3.0.2.0
✓ file bị đổi -> MISMATCH
✓ sửa nội dung -> BAD_SIGNATURE
✓ chưa có manifest -> verified:false
```

### F15 — QA không còn ghi vào production

[`qa/qa-guard.mjs`](qa/qa-guard.mjs) + [`qa/q.mjs`](qa/q.mjs) + [`qa/lib.mjs`](qa/lib.mjs).

Bản cũ hardcode `D1 = 81f478c9…` và `BASE = 'https://xienhl.com'`, rồi đọc
`WEBHOOK_SECRET.txt` **thật** để tự ký webhook. Chạy bất kỳ script QA nào = ghi thẳng vào
CSDL thật, và chính là cách một đơn 1.290.000đ được giao license vĩnh viễn (qa/results-G.json).

Nay: target từ `QA_BASE`, secret từ `QA_WEBHOOK_SECRET`, SQL ghi bị chặn theo từng câu,
`Client` phải bật `allowWrites` tường minh.

```
✓ ghi vào production -> PRODUCTION_TARGET
✓ chỉ ĐỌC thì vẫn cho phép
✓ D1 production -> coi là production
✓ chặn: DELETE FROM users
✓ cho phép đọc: SELECT 1
```

## 4. Hồi quy: không làm hỏng khách đang dùng

Đây là rủi ro lớn nhất của việc thêm bảng mới: production **chưa** có
`entitlement_grants`/`payment_inbox`. Nếu code mới ném lỗi khi thiếu bảng, deploy là khách
đã trả tiền không lấy được quyền.

[`test/degrade.test.mjs`](test/degrade.test.mjs) chạy **chỉ với migration cũ**:

```
✓ vẫn cộng đúng 30 ngày
✓ dùng thử vẫn ghi đúng mốc
✓ hoàn thành công dù thiếu sổ
✓ lần hai KHÔNG áp lại (idempotent bật khi có sổ)
```

Nguyên tắc: **ghi quyền không phụ thuộc sổ cái**; sổ chỉ để đối soát.

## 5. Thay đổi cần làm khi triển khai

Thứ tự bắt buộc (mỗi bước có đường lùi):

1. **Backup**: `npm run db:export`
2. **Migration**: chạy `db/migrations/0001..0003` (idempotent, `IF NOT EXISTS`)
   ```bash
   npx wrangler d1 execute muabankey-db --remote --file=db/migrations/0001-account-model.sql
   npx wrangler d1 execute muabankey-db --remote --file=db/migrations/0002-grant-ledger.sql
   npx wrangler d1 execute muabankey-db --remote --file=db/migrations/0003-payment-inbox.sql
   ```
3. **Baseline** cho CSDL hiện có: `node db/migrate.mjs --sqlite <prod-copy> --baseline`
4. **Manifest**: `node tool/release.mjs --exe tool/dist-arena/xa_arena.exe --version <ver>`
   rồi set `RELEASE_MANIFEST` (chuỗi JSON) trong Worker env
5. **Deploy** worker
6. **QA**: `QA_BASE=http://127.0.0.1:8787 node qa/e2e.mjs` (không bao giờ trỏ production)

## 6. Việc còn lại (chưa làm trong phiên này)

Kế hoạch có 17 nhóm phát hiện; phiên này đóng **F01–F09, F13–F15** và toàn bộ audit web SPA.
Còn lại, theo đúng thứ tự ưu tiên trong kế hoạch:

- **F10** — Tab Quyền tài khoản/Trial 1 ngày/Đối soát/Hoàn tiền/Sự cố trong admin; phân trang server
- **F11** — Checkout phân biệt "đang đợi tiền / đã nhận / đang cấp / đã cấp / cần hỗ trợ"
- **F12** — SPA lifecycle: AbortController, dispose listener, `confirmDialog` resolve mọi đường đóng
- **F16** — Session inventory/revoke, recovery không email, `secrets.js` fail-closed khi thiếu `KEY_ENC`
- **F17** — Xoá legacy (cart trong `state.js`, ~750 dòng CSS chết), gộp route confirm-payment trùng
- Dọn `admin.js` (1686 dòng) — tách theo tab

Điểm chưa xác minh: **kế hoạch ghi rõ** chưa chạy trên production, chưa đo Lighthouse thật,
chưa kiểm binary đang phân phối. Báo cáo này cũng vậy — mọi kết luận đến từ kiểm thử offline
trên SQLite/DOM shim và phân tích tĩnh, **không phải** chứng nhận production an toàn.
