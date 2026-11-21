# MuaBanKey — Phân tích nguyên lý hoạt động toàn hệ thống

Tài liệu này mô tả **cách hệ thống thật sự chạy**, từ lúc khách mở trình duyệt tới lúc license được kích hoạt trên máy họ, kèm **số đo thật** và **danh sách điểm cần tối ưu** xếp theo mức tác động.

Thang đo dùng xuyên suốt:
- **QUAN SÁT** — đọc từ file/DB, có dẫn chứng `file:line`
- **KIỂM CHỨNG** — đã chạy, có output
- **SUY RA** — lập luận từ dữ kiện trên
- **CHƯA BIẾT** — chưa xác định được

---

## PHẦN 0 — Bản đồ tổng thể

Một Cloudflare Worker duy nhất gánh 5 vai trò:

```
┌─────────────────────────────────────────────────────────────────┐
│  xienhl.com  (1 Worker: muabankey, 372 KiB, startup 2ms)        │
├─────────────────────────────────────────────────────────────────┤
│ 1. Web server SPA   → ASSETS binding (public/, 44 file)         │
│ 2. REST API         → 85 route dưới /api/*                      │
│ 3. License server   → /api/activate · /check · /rebind          │
│ 4. Installer        → /i/<KEY>.cmd · .ps1  + /download/*.exe     │
│ 5. Cron             → */10 * * * * (dọn rác + báo Telegram)     │
└─────────────────────────────────────────────────────────────────┘
        │                │                │              │
     D1 (SQLite)      KV (CACHE)       R2 (MEDIA)    Workers AI
     2.6 MB           rate limit +      2 file EXE   llama-3.1-8b
     ~7.500 dòng      cache stats       9.1 MB
```

**Dữ liệu thực tế (QUAN SÁT, query D1 production):**

| Bảng | Số dòng | Vai trò |
|---|---|---|
| `orders` | 306 | Đơn hàng, máy trạng thái |
| `order_items` | 311 | Dòng đơn, chứa key đã giao (mã hoá) |
| `users` | 238 | Khách + admin |
| `licenses` | 4.525 | License sinh ra (gồm kho 4.000) |
| `license_issues` | 130 | Bằng chứng license thuộc đơn nào |
| `payments` | 171 | **Sổ cái tiền vào** — nguồn sự thật duy nhất |
| `lic_events` | 338 | Nhật ký kích hoạt/thu hồi |

Quy mô còn nhỏ: toàn bộ DB 2,6 MB / 10 GB. Tức là **mọi vấn đề hiệu năng hiện tại không đến từ dữ liệu**.

---

## PHẦN 1 — Kiến trúc frontend (SPA)

### 1.1 Cơ chế định tuyến

Hash-based router, **không dùng History API**. (`QUAN SÁT`)

```js
// app.js:22-53 — bảng 15 route, so khớp regex theo thứ tự
const ROUTES = [
  { pattern: /^\/$/, render: renderHome, mount: mountHome },
  { pattern: /^\/products$/, ... },
  { pattern: /^\/product\/([^/]+)$/, param: true },
  ...
];

// app.js:223 — một listener duy nhất
window.addEventListener('hashchange', router);
```

`parseRoute()` (`lib.js:187-195`) tách hash thành 4 phần: path / segments / query / anchor. Nhờ vậy `#/support#warranty` hoạt động — tách `#` trước, rồi mới tách `?`.

**Hệ quả của lựa chọn này:** URL không bao giờ tới server → SEO kém (mọi trang là `xienhl.com/#/...`, Google chỉ thấy 1 URL), và không có SSR. Đổi lại: deploy cực đơn giản, không cần build step.

**15 route SPA:**

| Route | Trang | Auth | API gọi |
|---|---|---|---|
| `#/` | Trang chủ | guest | trial/status, products/featured, stats |
| `#/products` | Danh mục | guest | products (1 call, có phân trang) |
| `#/product/:slug` | Chi tiết | guest | products/:slug |
| `#/login` `#/register` | Đăng nhập/Đăng ký | guest | auth/login, auth/me |
| `#/checkout` | Thanh toán giỏ | user | products/:slug × N, orders, orders/:id/qr |
| `#/order/:id` | QR theo đơn | user | orders/:id/qr, orders/:id (poll 4s) |
| `#/orders` | Đơn của tôi | user | orders?perPage=50 |
| `#/licenses` | License của tôi | user | licenses/mine |
| `#/account` | Tài khoản | user | auth/profile |
| `#/support` `#/huong-dan` | Tĩnh | guest | — |
| `#/tai-ve` | Tải EXE | guest | app/version |
| `#/admin?tab=` | Quản trị (11 tab) | admin | ~10 endpoint/tab |
| `#/wallet` | → redirect orders | user | (trùng route orders) |

### 1.2 Boot sequence — **chuỗi waterfall 4 tầng**

Đây là điểm chậm nhất của frontend. (`QUAN SÁT` + `KIỂM CHỨNG`)

```
T0  HTML 2.805 B (brotli)           ← TTFB 68-191 ms
T1  CSS render-blocking:
      - Google Fonts (cross-origin)  ← chặn paint
      - style.css 85.602 B → 20 KB br
T2  app.js (module) → 12 import TĨNH tải hết 277 KB JS (83 KB br)
T3  boot(): Promise.all([/api/auth/me, /api/categories])
T4  router() → render trang → mount() → API của trang
T5  xoá boot-screen  ← CHỈ SAU KHI T5 mọi thứ xong
```

**Số đo thật trên production (trung bình 3-10 lần):**

| Endpoint | Thời gian |
|---|---|
| `/api/auth/me` | 657 ms |
| `/api/categories` | 542 ms |
| `/api/trial/status` | 491 ms |
| `/api/products/featured` | 448 ms |
| `/api/stats` | 397 ms |

→ Trang chủ phải xong **4 tầng nối tiếp** (`auth/me` ∥ `categories` → `trial/status` → `featured`) trước khi khách thấy nội dung: **~1.600 ms chỉ riêng API**, cộng vào là khách nhìn màn hình loading gần 2 giây.

### 1.3 Module loading — tất cả tải eager

```js
// app.js:9-20 — 12 import tĩnh, KHÔNG có dynamic import nào cho route
import { renderHome, mountHome } from './pages/home.js';
import { renderAdmin, mountAdmin } from './pages/admin.js';  // 78 KB!
...
```

| Nhóm | Byte | % |
|---|---|---|
| **admin.js** | **78.590** | **28,3%** |
| checkout.js | 24.410 | 8,8% |
| home.js | 22.244 | 8,0% |
| components.js | 19.607 | 7,1% |
| download.js | 15.431 | 5,6% |
| licenses.js | 13.487 | 4,9% |
| lib.js | 12.593 | 4,5% |
| icons.js | 12.406 | 4,5% |
| còn lại (9 file) | 78.906 | 28,4% |
| **TỔNG** | **277.674** | **→ 83 KB brotli** |

**Vấn đề cốt lõi:** khách vào trang chủ tải **78 KB admin panel** — trang họ không bao giờ mở. Đó là 28% trọng lượng JS phục vụ 0% người dùng.

Ngoài ra `public/assets/pages/download.js.bak` (15.553 B) vẫn truy cập được qua HTTP tại `/assets/pages/download.js.bak`.

### 1.4 State & rò rỉ giữa các route

`state.js` giữ `{ user, cart, categories, aiOpen, aiHistory }`.

| Dữ liệu | Lưu ở đâu | Vấn đề |
|---|---|---|
| Cart | `localStorage['mbk_cart']` | **Không xoá khi logout** → user B thấy giỏ của user A |
| AI history | `state.aiHistory` (RAM) | **Không xoá khi logout** → gửi kèm làm context cho user sau |
| Coupon | — | Đã bỏ hẳn, `discount` luôn = 0 |
| `xa_device_id` | localStorage | Định danh thiết bị cho trial |

**Rò rỉ listener** (`KIỂM CHỨNG`): `components.js` có **0 lời gọi `removeEventListener`**. Mỗi lần chuyển trang, `bindHeader()` gắn thêm một `window.addEventListener('scroll')` mới và một cặp `click`+`keydown` mới, không bao giờ gỡ. Sau 20 lần điều hướng, mỗi sự kiện scroll kích hoạt 20 handler.

`currentCleanup` thì đúng — `checkout.js` thật sự dọn `setInterval` 4s của nó (`app.js:136-139`, `checkout.js:461-464`).

### 1.5 Xử lý lỗi — 3 lỗ hổng

(`KIỂM CHỨNG` bằng grep)

1. **Không có xử lý 401 tập trung.** Grep `401` trong `lib.js` = 0 kết quả. Session hết hạn giữa chừng → trang hiện nguyên message lỗi server, **không redirect về login**.
2. **Không có timeout cho fetch.** Grep `AbortController|signal:` = 0. `api()` gọi `fetch()` trần. Mạng treo = skeleton loading quay **vĩnh viễn**.
3. **`unhandledrejection` bỏ sót lỗi mạng.** `app.js:243-248` chỉ toast khi `e.reason.status` truthy; lỗi NETWORK có `status: 0` (falsy) → im lặng hoàn toàn.

---

## PHẦN 2 — Nguyên lý backend

### 2.1 Router & middleware

```js
// index.js:493-502 — mọi request /api/* đi qua đây
if (!url.pathname.startsWith('/api/webhooks/')) {
  await rateLimit(env, `g:${clientIp(request)}`, 3000, 60);   // ← NÚT THẮT CỔ CHAI
}
const res = await match.handler(env, request, match.params);
```

Trước đó: `index.js:418-461` xử lý 4 tuyến **ngoài** `/api/` (installer `.cmd`/`.ps1`, tải EXE) — các tuyến này **không** đi qua rate limit toàn cục.

### 2.2 ⚠️ NÚT THẮT CỔ CHAI SỐ 1 — Rate limiter tốn 462 ms/request

`ratelimit.js:10-22` gọi **2 lần KV** mỗi request:

```js
const raw = await env.CACHE.get(cacheKey);        // KV read  ~200ms
...
await env.CACHE.put(cacheKey, String(count+1));   // KV write ~250ms
```

**A/B test trên production (10 lần mỗi bên, cùng khối lượng `SELECT 1`):**

| Endpoint | Rate limit | avg | min |
|---|---|---|---|
| `/api/webhooks/health` | **KHÔNG** | **84 ms** | 48 ms |
| `/api/health` | **CÓ** | **546 ms** | 487 ms |

> **Rate limiter thêm 462 ms cho mỗi request.**

Trang chủ gọi 5 API → **~2.310 ms lãng phí** chỉ để đếm request. Toàn bộ API chậm 500ms mà ai cũng tưởng là "DB chậm" — thực ra DB chỉ mất vài ms.

Nguyên nhân: Cloudflare KV **không được thiết kế cho read-modify-write đồng bộ**. Mỗi `get`+`put` là 2 round-trip tới PoP trung tâm. KV là eventually consistent, nên cách đếm này còn **không chính xác** dưới tải đồng thời — sai cả về tốc độ lẫn độ đúng.

**Cách đúng:** dùng **Durable Object** (đếm chính xác, ~1 round-trip, state trong RAM) hoặc **Rate Limiting binding** của Cloudflare (native, miễn phí round-trip), hoặc đơn giản nhất — bỏ rate limit toàn cục và chỉ giữ ở các endpoint nhạy cảm (login, register, order) nơi thực sự cần.

### 2.3 Cron (mỗi 10 phút)

`index.js:195-411`, chạy `ctx.waitUntil()`. 9 việc:

| # | Việc | Bảng |
|---|---|---|
| 1 | Topup hết hạn → `expired` | `topups` |
| 2 | Đơn `pending` > 45 phút → `expired` + trả coupon | `orders` |
| 3 | `processing` kẹt > 10 phút → `paid` | `orders` |
| 4 | `refunding` kẹt: sổ `done` → `refunded`; chưa → `refund_stuck` | `orders`, `refund_ledger` |
| 5 | Xoá token hết hạn (rebind/install/session/lic_attempts/xg_nonce) | 5 bảng |
| 6 | Xoá `xg_session`/`xg_events`/`xg_viol` cũ | 3 bảng |
| 7 | Xoá log append-only (lic_events 90d, audit 180d, trial 30d) | 4 bảng |
| 8 | Dọn `rate_limits` giữ 24h | `rate_limits` |
| 9 | Báo Telegram: sắp hết hàng (6h/lần), license sắp hết hạn (1d/lần) | — |

Điểm tốt (`QUAN SÁT`): các comment tại `index.js:247-287` ghi lại **sự cố thật** — `MBK-L5W87H` bị hoàn 70.000đ **hai lần** vì cron cũ đưa `refunding` về `paid`. Nay đưa sang `refund_stuck` — trạng thái không có nút Hoàn trong UI.

### 2.4 Xác thực & phân quyền

| Hàm | Yêu cầu | Dùng ở |
|---|---|---|
| `getSessionUser` | session hợp lệ, hoặc null | boot, trial |
| `requireUser` | phải đăng nhập | orders, licenses, profile |
| `requireAdmin` | role `admin` **hoặc** `staff` | hầu hết admin route |
| `requireAdminStrict` | role `admin` **thật** | đổi settings, duyệt tiền, payOS key |

Phân biệt `requireAdmin` vs `requireAdminStrict` là điểm thiết kế tốt: staff xem được dashboard nhưng **không** đổi được số tài khoản ngân hàng hay duyệt tiền.

**Mật khẩu:** PBKDF2-SHA256, **100.000 vòng** (`crypto.js:42`). Đây là **giới hạn cứng của Cloudflare Workers WebCrypto** — không thể tăng. Salt 16 byte random, output base64.

**Session:** token 64 hex random, lưu server dưới dạng **SHA-256 hash** (không lưu plaintext), cookie `HttpOnly; Secure; SameSite=Lax`, TTL 30 ngày.

### 2.4b Phân quyền — điểm yếu đã kiểm chứng

Có **5 guard**, nhưng một cái là no-op và một cặp bị bất đối xứng.

| Guard | Yêu cầu | Ghi chú |
|---|---|---|
| `getSessionUser` | session hợp lệ + `status='active'` | trả `null`, không ném |
| `requireUser` | phải đăng nhập | 401 |
| `requireAdmin` | `admin` **hoặc** `staff` | 403 |
| `requireAdminStrict` | `admin` **thật** | 403 |
| `requireCustomer` | **KHÔNG GÌ CẢ** | ❌ no-op |

**(a) `requireCustomer` là guard giả** (`auth.js:119-126`, `KIỂM CHỨNG`): cả hai nhánh `if` và fall-through đều `return user`. Grep toàn `src/` = **1 dòng duy nhất** (chính định nghĩa), **0 call site**. Hiện vô hại nhưng là bẫy: người viết sau sẽ tưởng nó kiểm tra gì đó.

**(b) `staff` có toàn quyền tài chính** qua `requireAdmin` (`KIỂM CHỨNG` bằng đọc handler):

| Route | Quyền staff có được | Guard |
|---|---|---|
| `POST /admin/licenses` | **Đúc license vô hạn** (chọn `days`, `count`, `userId`) | `requireAdmin` ⚠️ |
| `POST /admin/licenses/:key/:action` | Thu hồi / gia hạn +30d / reset HWID | `requireAdmin` ⚠️ |
| `POST /admin/orders/:id/deliver` | Giao hàng chưa thanh toán | `requireAdmin` ⚠️ |
| `POST /admin/orders/:id/refund` | Hoàn tiền + thu hồi hàng | `requireAdmin` ⚠️ |
| `POST/DELETE /admin/products/:id/keys` | Sửa kho | `requireAdmin` ⚠️ |

**(c) Bất đối xứng ở cặp duyệt/từ chối nạp tiền** (`KIỂM CHỨNG` tại `wallet.js`):

```
adminApproveTopup  L1012 → requireAdminStrict   ✅ admin thật
adminRejectTopup   L1112 → requireAdmin         ⚠️ staff cũng được
```

`staff` huỷ được lệnh nạp đang chờ — kể cả lệnh mà tiền **đã vào tài khoản** nhưng webhook chưa bắn. Cặp sinh đôi mà một bên chặt một bên lỏng là lỗi thiết kế, bất kể có khai thác được hay không.

**(d) Rate limit fail-open** (`ratelimit.js:52-56`): KV **và** D1 cùng lỗi → `return {count:0, degraded:true}` = **cho qua không giới hạn**. Đây là lựa chọn availability-over-security có chủ ý, nhưng nghĩa là KV chập chờn = mất toàn bộ throttle, kể cả login.

**(e) Không có lockout theo tài khoản**: `login:${ip}` = **500 lần / 15 phút**, key theo IP. Không có bảng `login_attempts`, không đếm theo username. Spray password qua nhiều account từ 1 IP gần như không bị chặn; có IP rotation thì hoàn toàn tự do.

**(f) Header API yếu hơn HTML** (`http.js:3-9`): response `/api/*` **không có HSTS, không có CSP**, lại thêm `X-XSS-Protection` (đã bị loại bỏ khỏi browser hiện đại). Hai bộ header đã lệch nhau âm thầm — thấp, nhưng nên đồng bộ.

### 2.5 Bảo mật đã áp dụng

| Lớp | Cơ chế | Trạng thái |
|---|---|---|
| SQL injection | 100% prepared statement | ✅ xác nhận |
| XSS | `esc()` 5-pass, áp dụng mọi output | ✅ |
| CSP | `script-src 'self'` (không inline) | ✅ |
| Header | CSP, XFO:DENY, XCTO, HSTS, Referrer-Policy | ✅ đủ 5 |
| Webhook | `timingSafeEqual`, timing-safe | ✅ |
| Replay | Unique index `ux_pay_txn` trên `txn_ref` | ✅ |
| Cookie | HttpOnly + Secure + SameSite | ✅ |

---

## PHẦN 3 — Luồng tiền (quan trọng nhất)

### 3.1 Máy trạng thái đơn hàng

9 trạng thái, **không có CHECK constraint** — mọi bảo vệ là `WHERE` trong `UPDATE`.

```
                    ┌──────────┐
      tạo đơn ────► │ pending  │
                    └────┬─────┘
                         │
        ┌────────────────┼─────────────────┐
        │                │                 │
   cron 45'        webhook khớp      admin duyệt
        ▼                ▼                 ▼
  ┌──────────┐    ┌──────────┐      ┌──────────┐
  │ expired  │───►│processing│◄─────│   paid   │
  └──────────┘QR  └────┬─────┘      └────┬─────┘
   (còn nhận             │                │
    tiền muộn)      ┌────┴────┐           │
                    ▼         ▼           ▼
              ┌──────────┐ ┌────────┐ ┌──────────┐
              │delivered │ │ paid   │ │refunding │
              └──────────┘ │(giao   │ └────┬─────┘
                           │ lỗi)   │      │
                           └────────┘  ┌───┴────┐
                                       ▼        ▼
                                  ┌────────┐ ┌────────────┐
                                  │refunded│ │refund_stuck│
                                  └────────┘ └────────────┘
```

**Chi tiết quan trọng (`QUAN SÁT`):**
- `expired` **vẫn nhận được tiền** — `confirmOrderPaid` cho phép `status IN ('pending','expired','processing','cancelled')` (`payments.js:651`). Đây là thiết kế đúng: khách chuyển muộn vẫn được giao.
- `cancelled` **không thể xảy ra** — không có `UPDATE orders SET status='cancelled'` nào trong code. Chỉ còn dữ liệu cũ.
- `refund_stuck` là bãi đỗ cuối, không có nút nào trong UI → admin phải đối soát tay.

### 3.2 Luồng thanh toán QR

```
1. Khách bấm "Mua" 
   POST /api/orders  → status='pending', code='MBK-XXXXXX'
   ★ GIÁ TÍNH SERVER-SIDE, client không sửa được

2. POST /api/orders/:id/qr
   → sinh memo: MBK-XXXXXX → strip '-' → MBKXXXXXX
   → lưu orders.payment_ref = memo          ← KHOÁ LIÊN KẾT
   → trả URL ảnh:
     https://img.vietqr.io/image/MB-0010131639304-compact2.svg?amount=...&addInfo=MBKXXXXXX

3. Khách quét QR, chuyển khoản

4. Ngân hàng → SePay → POST /api/webhooks/sepay
   Authorization: Apikey <WEBHOOK_SECRET>     ← timing-safe
   ├─ transferType != 'in'      → NOT_INBOUND (chặn lệnh rút)
   ├─ amount <= 0               → ZERO_AMOUNT
   ├─ txn_ref đã tồn tại?       → WEBHOOK_REPLAY (chống replay)
   ├─ tìm đơn theo memo         → payment_ref, hoặc REPLACE(code,'-','')
   └─ CỬA SỔ GIỜ (VN):
        00:00–11:59 → TỰ ĐỘNG giao
        12:00–23:59 → GHI SỔ + báo Telegram, CHỜ ADMIN DUYỆT

5. Giao hàng: deliverOrderItems()
   Đợi 1: kiểm tra TẤT CẢ dòng trước khi giữ bất kỳ thứ gì
   Đợi 2: giữ key nguyên tử (WHERE status='available' AND changes===1)
           hoặc sinh license (gọi MỘT lần với quantity)
   Lỗi  : rollbackDelivered() — thu hồi đúng những gì request này tạo
```

**Điểm thiết kế xuất sắc** (`QUAN SÁT`): `rollbackDelivered()` (`orders.js:375-424`) dùng **sổ tài nguyên riêng của từng request** (`made = {licenses, keyIds, items, soldCount}`). Nhờ vậy rollback **không bao giờ** thu hồi nhầm hàng đã giao thành công ở lần trước. Đây là bài học từ sự cố C7 thật: đơn giao license dòng 1, dòng 2 lỗi → hoàn tiền 100% nhưng license vẫn sống → khách lấy hàng miễn phí vô hạn.

### 3.3 Sổ cái — bảng nào là sự thật?

**`payments` là nguồn sự thật duy nhất cho "khách đã trả tiền chưa":**

```sql
SELECT SUM(amount) FROM payments
WHERE order_id = ? AND state IN ('matched','wrong_amount')
```

`orders.status` chỉ là **quyết định**, không phải bằng chứng tiền. `refund_ledger` chỉ là quyết định hoàn.

| Bảng | Vai trò | Còn đúng? |
|---|---|---|
| `payments` | Tiền vào thật | ✅ tốt nhất hệ thống |
| `refund_ledger` | PK `order_id` = chống hoàn trùng | ✅ |
| `orders` | Quyết định trạng thái | ⚠️ có thể lệch |
| `wallet_transactions` | Sổ ví cũ | ❌ **mâu thuẫn** |
| `users.balance` | Số dư ví | ⚠️ chỉ 1 phần code cập nhật |

**Mâu thuẫn ví (`QUAN SÁT`):** cùng một hành động "duyệt nạp tiền" nhưng:
- `adminApproveTopup` (`wallet.js:1086-1103`): ghi `wallet_transactions`, **KHÔNG** cộng `balance`
- Telegram `tp:ok` (`wallet.js:66-73`): **CÓ** cộng `balance`

→ `SUM(wallet_transactions)` không bao giờ khớp `users.balance`. Mọi query đối soát ví đều báo sai vĩnh viễn. Ví hiện **không tiêu được** (không có route nào trừ), nên đây là lỗi sổ sách chứ chưa phải lỗi tiền.

### 3.4 Tiền thật đang treo (query production)

| Trạng thái | Số GD | Số tiền |
|---|---|---|
| `matched` + đơn `delivered` | 3 | 430.000đ ✅ |
| `matched` + đơn `expired` (chờ admin duyệt) | 3 | 540.000đ ⚠️ |
| `unmatched` (không khớp đơn nào) | 1 | **1.800.000đ** ⚠️ |
| `claimed` (khách báo đã CK, chưa xác nhận) | 2 | 0đ (amount=0) |

**1.800.000đ chưa khớp:** `txn_ref FT26316137983719`, nội dung `"TRAN TAT VIET CUONG chuyen tien"` — **khách không ghi mã đơn**. Đây là tiền thật trong tài khoản, chưa gán được đơn. Cần xử lý tay.

3 đơn `expired` kia là tài khoản test (`@invalid`), kênh `sepay-window` (ngoài cửa sổ giờ) — đúng thiết kế.

---

## PHẦN 4 — Hệ thống license & tool

### 4.1 Định dạng key

```
AOE1-MX8V-4HDD-KMX4
└┬─┘ └──┬──┘ └──┬──┘
 │      │       └── 3 nhóm 4 ký tự, alphabet loại 0/O/1/I
 │      └────────── dễ đọc qua điện thoại
 └───────────────── prefix → ánh xạ sản phẩm
```

`expires_at` có **hai nghĩa khác nhau, không được lẫn:**
- `0` = **vĩnh viễn**
- `null` = **chưa kích hoạt**

Đây là nguồn của một lỗi P0 tôi đã sửa: nút "+30 ngày" trên Telegram biến license vĩnh viễn (1.290.000đ) thành 30 ngày, không hoàn tác được.

### 4.2 Giao thức client ↔ server

| Endpoint | Body | Trả về |
|---|---|---|
| `POST /api/activate` | `{key, hwid, app}` | `{ok, expires_at, plan, forever, first_bind}` |
| `POST /api/check` | `{key, hwid, app}` | như trên (grace 24h offline) |
| `POST /api/rebind` | `{key, hwid}` | `{ok, rebinds_left}` |

**HWID** = SHA-256(`MachineGuid | BIOS serial | CPU brand | volume serial`) — **server tự băm**, không tin client gửi.

**Hạn dùng tính từ lần kích hoạt đầu**, không phải lúc tạo key.

### 4.3 Token ký `xn1.` — cơ chế bảo vệ bảng vá

Đây là phần tinh vi nhất. (`QUAN SÁT`)

```
TRƯỚC: 17 cổng (địa chỉ + byte gốc + byte vá) nằm PLAINTEXT trong EXE
        → pyinstxtractor lấy 100% source, đọc nguyên bảng

SAU:   bảng KHÔNG nằm trong binary
        ↓
   gate = sha256(license_key || 'xa-nofog-gate-v1')[:16]
        ↓
   Server ký ECDSA P-256 token chứa bảng đã mã hoá theo gate
        ↓
   Client verify chữ ký → lấy gate → giải mã bảng
        ↓
   Không token hợp lệ = không có bảng = không biết vá vào đâu
```

**Cấu trúc token** (3 phần, ngăn bởi `.`):
```
xn1.<base64(payload)>.<base64(ECDSA-P256-signature)>
```

**Bug đã sửa và tại sao quan trọng:** WebCrypto trả chữ ký ECDSA với **high-S ~50% số lần**. Verify chuẩn chỉ chấp nhận low-S → **50% kích hoạt fail ngẫu nhiên**. Đã chuẩn hoá low-S phía server: trước 2/8 fail, sau 12/12 PASS.

**Fail-closed:** thiếu `XN_SIGN_JWK` → `ApiError NOT_CONFIGURED`, không sinh token rỗng.

### 4.3b ⚠️ Token `xn1.` KHÔNG ràng buộc máy — đã khai thác được

Token có verify chữ ký (thật, không thể giả), nhưng **client chỉ kiểm 3 trường**.

`tool/src/xa_nofog_sec.py:556-599` — `verify_token_local()` chỉ đọc:
```python
if app is not None:
    got = payload.get('a')
    if got != app: return {'ok': False, 'code': 'wrong_app', ...}
...
gate_hex = b64u_dec(payload.get('ss') or '').hex()
```

Payload mà **server** ký có 9 trường (`license-server.js:24-25, 357-358`):
`{v, a, k, h, p, e, n, g, ss, sv}` — tức `h`=hwid, `e`=hạn, `n`=nonce, `k`=key **đều có mặt**.

| Trường | Server ký | Client kiểm |
|---|---|---|
| `a` (app) | ✅ | ✅ `:570` |
| `ss`/`sv` (bảng vá) | ✅ | ✅ dùng để giải mã |
| **`h` (hwid)** | ✅ | ❌ **KHÔNG** |
| **`e` (expires_at)** | ✅ | ❌ **KHÔNG** |
| **`n` (nonce)** | ✅ | ❌ **KHÔNG** |
| **`k` (key)** | ✅ | ❌ **KHÔNG** |

**KIỂM CHỨNG thực nghiệm** (`scripts/qa/prove-token-not-bound.py`): token mint cho `hwid='a'*32` →

```
=== verify_token_local(app="xa-nofog") — không xét hwid ===
  ok = True   count = 17   groups = 3
```

→ Token của máy A giải mã **đủ 17 cổng / 3 nhóm** trên bất kỳ máy nào.

**Nhưng mức độ thực tế thấp hơn vẻ ngoài** (`SUY RA`, quan trọng để không đánh giá sai):
1. `gate = SHA-256(key || 'xa-nofog-gate-v1')[:16]` — phụ thuộc **key**, nên bảng vá giống nhau cho mọi key cùng sản phẩm. Bản thân bảng không bí mật theo key.
2. Client vẫn phải qua `/api/check` để lấy token. `check` kiểm HWID **phía server**.
3. `GRACE_HOURS = 0` (`license-server.js:60`) — **bắt buộc online**, không có offline grace.

Nên đường tấn công thật là: **giả lập/lách `/api/check`**. Token chỉ là "giấy thông hành" mà client không tự kiểm hạn hay máy. Kẻ có tool đã sửa (họ sở hữu file `.py`/`.exe`) bỏ qua được cả bước này.

**Sửa đề xuất:** client nên kiểm `h` (so với HWID tự tính) và `e` (so với giờ hệ thống) trước khi vá. Đây là phòng thủ theo chiều sâu — không chặn được người sửa binary, nhưng chặn được kịch bản "copy `lic.bin` sang máy khác", vốn là kịch bản phổ biến nhất.

### 4.3c Tài liệu quảng cáo sai: grace offline 24h

`license-server.js:59-60` (`QUAN SÁT`):
```js
// Bắt buộc online: không có offline grace cho bất kỳ key nào.
const GRACE_HOURS = 0;
```

Nhưng tài liệu thiết kế vẫn ghi (`docs/nghien-cuu-gia-license-trial-3-ngay.md:362`):
> "Đổi máy 1 lần miễn phí + hỗ trợ offline grace 24h — đã có (`max_rebind=1`, `GRACE_HOURS=24`). Rất ít shop nói được điều này."

`README.md` cũng ghi "Grace offline: 24 giờ". **Cả hai đều sai** — code là 0. Nếu đem câu này đi marketing là quảng cáo sai sự thật.
### 4.4 Installer tự động

`GET /i/<KEY>.cmd` — chỉ trả khi key tồn tại + chưa thu hồi (`KIỂM CHỨNG`: key giả → 404, không rò script).

Script làm 8 bước:
1. `net session` → chưa admin thì `Start-Process -Verb RunAs`
2. Tạo `C:\Program Files\XArenaNoFog\_re\chayduoc`
3. Tải EXE: thử `curl` → `WebClient` → `certutil` (3 lớp dự phòng)
4. **Kiểm SHA-256** = `053A6C49…EB75` + size 9.101.312
5. Tạo Scheduled Task (thay `RUNASADMIN` — không hiện UAC mỗi lần)
6. `xa_nofog_pro.exe --key <KEY>` → kích hoạt
7. Shortcut Desktop + Start Menu
8. Tạo `go-cai-dat.cmd` để gỡ

**Phát hiện quan trọng từ lịch sử:** spec cũ định xoá sạch `C:\Program Files\XArena` — nhưng đó là **game client Arena.vn thật** (có `Arena.exe`, SoftEther VPN, `Game\`). Đã đổi sang `XArenaNoFog\` riêng. Nếu không phát hiện, mỗi lần cài sẽ **xoá game + mất config VPN của khách**.

### 4.4b ⚠️ Installer XAGrant: 3 lỗi (1 đã sửa)

**Đã sửa trong phiên — `/xg/<KEY>.ps1` TRƯỚC ĐÂY KHÔNG CHẠY ĐƯỢC.**

Template `.ps1` chứa **comment JavaScript `//`** ở giữa (`xa-grant-installer.js:543-544` trước khi sửa):

```powershell
    $s.TargetPath = $env:COMSPEC
    // Backtick trong template string JS phải escape (\`), nếu không sẽ
    // đóng sớm template literal -> esbuild báo 'Expected ";"'
    $s.Arguments = "/k \`"$launcher\`""
```

Dòng `//` không phải comment trong PowerShell. Nó làm **vỡ cú pháp toàn bộ file** — đó là cách duy nhất một lệnh `irm | iex` (chính là one-liner shop quảng cáo) chết ngay.

**KIỂM CHỨNG** (`scripts/qa/check-ps1-parse.mjs` render template thật rồi đưa qua parser PowerShell):

| | Trước sửa | Sau sửa |
|---|---|---|
| XAGrant `.ps1` | **PARSE_FAIL: 7 lỗi** — dòng 144 "Missing argument in parameter list", 184 "string is missing the terminator", 140/139 "Missing closing '}'", 185 "Try statement is missing its Catch" | **PARSE_OK** (6.642 ký tự, 183 dòng) |
| NoFog `.ps1` | PARSE_OK | PARSE_OK (9.712 ký tự, 258 dòng) |

Nghĩa là: khách mua XAGrant và dán one-liner **không cài được gì**, chỉ thấy lỗi PowerShell. Riêng NoFog (sản phẩm chính) vẫn tốt.

**2 lỗi CÒN LẠI trong installer XAGrant (`QUAN SÁT`, chưa sửa):**

**(a) Cache chỉ kiểm SIZE, không kiểm hash** — `xa-grant-installer.js:191-197`:
```bat
if exist "%EXE%" (
  for /f "usebackq delims=" %%H in (`powershell ... .Length -eq %EXESIZE% ...`) do set "GOT=%%H"
)
if defined GOT ( set "FROMCACHE=1" & echo Da co san, bo qua tai. )
```
Chỉ cần file cùng **kích thước** là được chấp nhận, không kiểm SHA. Kẻ tấn công thay file cùng size (có thể đệm byte) → chạy mã độc với quyền Administrator. **Chính installer NoFog đã fix đúng chỗ này** (luôn hash cả nhánh cache) — XAGrant bị bỏ sót.

**(b) `:verifyhash` fail-open** — `xa-grant-installer.js:378-382`:
```bat
:verifyhash
if not defined ACTUALSHA (
  echo  [!] Khong doc duoc chu ky file. Bo qua kiem tra.
  exit /b 0
)
```
Không đọc được hash → **bỏ qua kiểm tra, coi như đạt**. Nguyên tắc đúng phải là fail-closed (dừng cài).
### 4.5 Hệ thống dùng thử

Hai loại: **1 giờ** và **3 ngày**, mỗi loại 10 lượt/tài khoản.

| Chặn | Cơ chế | Đánh giá |
|---|---|---|
| Số lượt | `consumeUse` CAS `UPDATE WHERE used < quota` | ✅ nguyên tử |
| Máy ảo | `looksVirtual(bios, cpu)` | ⚠️ client gửi parts |
| 1 máy = N tài khoản | `deviceAccountCount` | ⚠️ bỏ qua nếu không gửi HWID |
| Theo IP | 20/ngày | ⚠️ IP rotate được |
| Whitelist | Bảng riêng | ✅ |

**Lỗ hổng (`QUAN SÁT`):** đường **không cần đăng nhập** (`/api/trial/command`) buộc định danh vào `device_id` **do client chọn**. Đổi `localStorage.device_id` = lượt trial mới. Với settings hiện tại (per-IP 100/ngày), một IP tạo được **100 trial/ngày**, mỗi cái là license `plan='trial'` thật + token hợp lệ.

---

## PHẦN 5 — BẢNG XẾP HẠNG TỐI ƯU

Xếp theo **tác động đo được ÷ công sức sửa**.

### 🔴 P0 — Sửa ngay, hiệu quả lớn nhất

| # | Vấn đề | Bằng chứng | Tác động | Cách sửa |
|---|---|---|---|---|
| **1** | **Rate limiter tốn 462 ms/request** (2 round-trip KV) | A/B: 84ms → 546ms | **Trang chủ chậm thêm ~2.3s**. Mọi API chậm gấp 6 lần | Dùng Durable Object hoặc Rate Limiting binding; hoặc bỏ limit toàn cục, chỉ giữ ở login/register/order |
| **2** | **12 trang import tĩnh** — khách tải 78 KB admin | `app.js:9-20` | 28% JS phục vụ 0% người dùng | `const m = await import('./pages/admin.js')` trong route handler |
| **3** | **Boot chặn render**: `await` auth/me trước khi vẽ gì | `app.js:208` | +657 ms trước first paint | Vẽ shell trước, hydrate user sau (skeleton header) |
| **4** | **Waterfall 4 tầng** ở trang chủ | 5 API nối tiếp | ~1.6 s | Gộp: 1 endpoint `/api/home` trả products+stats+trial trong 1 query batch |

### 🟠 P1 — Tác động rõ, sửa vừa

| # | Vấn đề | Bằng chứng | Cách sửa |
|---|---|---|---|
| **5** | Không memoize `Intl.NumberFormat` | `lib.js:53-56`, gọi mỗi dòng bảng + mỗi frame animation | Tạo 2 instance module-level, dùng lại |
| **6** | Không có `AbortController`/timeout | grep = 0 | Thêm timeout 10s vào `api()` |
| **7** | Session 401 không redirect | grep `401` trong lib.js = 0 | Interceptor: 401 → clear state → `#/login` |
| **8** | Rò rỉ listener mỗi lần chuyển trang | 0 `removeEventListener` trong components.js | Trả cleanup từ `bindHeader`, gọi trong `router()` |
| **9** | Logout không xoá cart/AI history | `components.js:82-89` | `store.del('mbk_cart')` + `state.aiHistory = []` |
| **10** | Admin không có phân trang (render 10k `<tr>`) | `admin.js` mọi tab | Thêm `LIMIT/OFFSET` + nút phân trang |
| **11** | `/assets/*` không có content-hash | `_headers:9-10` `max-age=3600, must-revalidate` | Đổi tên file theo hash → `max-age=31536000, immutable` |
| **12** | Google Fonts render-blocking, cross-origin | `index.html:16` | `font-display: swap` + self-host hoặc `preload` |

### 🟡 P2 — Nên sửa

| # | Vấn đề |
|---|---|
| 13 | `home.js:505-513` render cùng danh sách sản phẩm **2 lần** |
| 14 | `products.js` search → `navigate()` → `innerHTML` toàn trang → **mất focus ô tìm kiếm mỗi 450ms** |
| 15 | `orders.js:152` nhét toàn bộ key vào `data-copy-all` attribute + `mailto:` → **rò key vào lịch sử mail** |
| 16 | `wallet.js` ~250 dòng webhook **chết trong block comment** — bẫy người đọc |
| 17 | `payments.js:75-77` `bankSlug: 'MB'` hardcode trong khi `bank_name` admin sửa được → đổi bank là QR sai |
| 18 | `payments.js:553-555` `state` tính theo `paid` từng lần, không theo `totalPaid` → đơn trả 90k+90k hiện 2 dòng `wrong_amount` |
| 19 | Telegram callback: `TG_CHAT_ID` unset → **mất kiểm tra quyền** (`wallet.js:436-442`) |
| 20 | `is_test` suy từ prefix `referenceCode` — ref thật MBBank là `FT…` nên chưa trúng, nhưng nếu trúng thì GD thật biến mất khỏi doanh thu |
| 21 | Nhóm Telegram: mọi thành viên bấm được nút duyệt (`msgChat === allowed`) |
| 22 | Không set `document.title` khi chuyển route; focus không về `<main>` |
| 23 | `confirmDialog` thiếu focus trap + `aria-labelledby` |
| 24 | `download.js.bak` (15 KB) vẫn truy cập được qua HTTP |
| 25 | `staff` đúc được license vô hạn + hoàn tiền được (`requireAdmin` thay vì `requireAdminStrict`) |
| 26 | `adminRejectTopup` dùng `requireAdmin` trong khi `adminApproveTopup` dùng `requireAdminStrict` |
| 27 | Rate limit **fail-open**: KV+D1 cùng lỗi → bỏ chặn hoàn toàn |
| 28 | Không lockout theo tài khoản; login 500 lần/15 phút/IP |
| 29 | `requireCustomer` là guard giả (0 call site) |
| 30 | Password tối thiểu 6 ký tự, không complexity, không check breach |
| 31 | Enumeration: `409 USERNAME_EXISTS` và `403 ACCOUNT_LOCKED` khác `401` |
| 32 | Header `/api/*` thiếu HSTS + CSP, có `X-XSS-Protection` (deprecated) |
| 33 | `GET /api/webhooks/health` công khai = oracle cấu hình |
| 34 | `botTokenHint` (8 ký tự đầu) lộ cho cả `staff` |

### Đã sửa trong phiên này

| Lỗi | Mức |
|---|---|
| Cửa hậu `WEBHOOK_SECRET_TEST` đúc license miễn phí | P0 |
| Telegram "Giao đơn" không cấp key | P0 |
| Đường cứu đơn 0-key từ chối cứu | P0 |
| Nút "+30 ngày" phá license vĩnh viễn | P1 |
| `?page=abc` → 500 | P1 |
| `confirmDialog` object → hiện `[object Object]` ở nút giao key | P1 |
| 4 credential sống trong 13 file tracked | P0 |
| README ghi sai số tài khoản ngân hàng | P1 |

---

## PHẦN 6 — Kiến trúc đề xuất (nếu muốn đi xa)

Hiện tại mỗi request phải: KV read → KV write → D1 → render. Đó là lý do 500ms.

```
HIỆN TẠI                          ĐỀ XUẤT
────────────────────────────────  ─────────────────────────────────
Mọi API:                          Chỉ endpoint nhạy cảm:
  KV.get  (200ms)                   /api/auth/login    → DO counter
  KV.put  (250ms)                   /api/auth/register → DO counter
  D1      (~5ms)                    /api/orders        → DO counter
  ─────────────                     Còn lại: KHÔNG limit
  = 500ms                               = ~10ms

Trang chủ: 5 API nối tiếp         Trang chủ: 1 API
  auth/me   657ms                    GET /api/home  (~15ms)
  categories 542ms                   └─ DB.batch([products, stats, trial])
  trial/status 491ms                     trả 1 JSON duy nhất
  featured  448ms
  stats     397ms
  ─────────────────
  = 1.6s (nối tiếp)

JS: 277KB eager                    Core 40KB + lazy 237KB
  admin.js 78KB ở mọi trang          admin.js load khi vào #/admin
```

**Ước tính sau tối ưu** (`SUY RA` từ số đo): first paint từ ~2.0s xuống **~0.5s**; API p50 từ ~500ms xuống **~30ms**.

---

## Tóm tắt một câu

Hệ thống này **được viết cẩn thận ở tầng nghiệp vụ** — rollback theo request, idempotency bằng PK, chống race bằng CAS, comment ghi lại từng sự cố thật đã xảy ra. Nhưng **tầng vận chuyển bị bỏ quên**: rate limiter KV tốn 462ms/request, toàn bộ JS tải eager, và trang chủ waterfall 4 tầng. Sửa 4 điểm P0 là lấy lại gần như toàn bộ tốc độ.
