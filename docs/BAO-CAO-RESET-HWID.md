# BÁO CÁO: TẠI SAO RESET HWID CHƯA HOẠT ĐỘNG

Thời điểm khảo sát: 2026-11-10 22:17–23:00 (Asia/Bangkok)
Môi trường: production `https://xienhl.com`, D1 `muabankey-db` (4055 license)

---

## MỤC A — SƠ ĐỒ LUỒNG HIỆN TẠI (ĐANG HỎNG Ở ĐÂU)

### A.1. Hai cơ chế "đổi máy" tồn tại song song

```
╔══════════════════════════════════════════════════════════════════════════╗
║ ĐƯỜNG 1 — KHÁCH TỰ ĐỔI MÁY (trang /#/licenses)                           ║
╚══════════════════════════════════════════════════════════════════════════╝

  [Khách] bấm "🔄 Đổi máy"
      │
      ▼
  licenses.js:191  POST /api/licenses/{KEY}/rebind      (cookie session)
      │
      ▼
  license.js:250   rebindMyLicense()
      ├─ rateLimit(5/3600)                            ◄── ❌ F2: đặt TRƯỚC kiểm quota
      ├─ kiểm sở hữu qua license_issues               ◄── ❌ F5: key admin tặng không có
      ├─ đọc license
      ├─ if (rebinds >= max_rebind) → 403            ◄── ❌ F2: không bao giờ tới được
      ├─ sinh token 24 byte, INSERT rebind_tokens
      └─ return { token, command: "...--rebind KEY TOKEN" }
      │
      ▼
  licenses.js:192  toast("Đã cấp quyền đổi máy (còn N lần)")
                                                   ◄── ❌ F3: TOKEN BỊ VỨT. UI không hiện,
                                                       không copy được. Khách mất token vĩnh viễn.
      │
      ╳  (luồng ĐỨT TẠI ĐÂY — khách không có token để dùng)

╔══════════════════════════════════════════════════════════════════════════╗
║ ĐƯỜNG 2 — CLIENT EXE TỰ GỌI (thiết kế dự phòng)                          ║
╚══════════════════════════════════════════════════════════════════════════╝

  [Khách] chạy: xa_nofog_pro.exe --rebind KEY TOKEN
      │
      ▼
  EXE đang phát hành (sha C72484…, build 21:03:52)
      │
      ├─ parse_args() nhận --rebind → opts['rebind'] = (KEY, TOKEN)
      │                                              ◄── ✅ parse OK
      └─ run() KHÔNG có nhánh `if opts.get('rebind')`
                                                     ◄── ❌ F1: NGUYÊN NHÂN GỐC #1
                                                         rơi xuống luồng thường:
                                                         require_license() → ask_key_dialog()
                                                         → mở hộp thoại Tk ⇒ TREO VÔ HẠN
      │
      ╳  (không bao giờ gọi /api/rebind)

╔══════════════════════════════════════════════════════════════════════════╗
║ ĐƯỜNG 3 — ADMIN RESET MÁY (tab License /admin)                           ║
╚══════════════════════════════════════════════════════════════════════════╝

  [Admin] bấm "Reset máy"  (admin.js:664, data-act="reset-hwid")
      │
      ▼
  admin.js:701  POST /api/admin/licenses/{KEY}/reset-hwid
      │
      ▼
  license.js:322  adminLicenseAction() → action === 'reset-hwid'
      │
      ▼
  license.js:97   resetHwid()
      UPDATE licenses SET hwid = NULL, activated_at = NULL, rebinds = 0
      │                            ▲
      │                            └─ ❌ F4: xoá activated_at ⇒ "quên" key đã từng bind
      ▼
  [Máy CŨ] tool chạy nền, /api/check mỗi 30 phút
      │   (TRIAL_RECHECK_SEC, xa_nofog_pro.py:1977)
      ▼
  license-server.js:80  judge() → !lic.hwid ⇒ { ok:true, firstBind:true }
      │
      ▼
  bindFirstTime() → UPDATE licenses SET hwid = <MÁY CŨ>
      │                                    ▲
      │                                    └─ ❌ F4: cửa mở cho AI GỌI TRƯỚC
      ▼
  [Máy MỚI] activate  →  403 hwid_mismatch "Mã đã dùng trên máy khác"
      ╳   ← ĐÂY LÀ "reset HWID chưa hoạt động" mà chủ shop gặp
```

### A.2. Bảng kết luận luồng

| Đường | Trạng thái | Chặn bởi |
|---|---|---|
| 1. Khách bấm nút web | ❌ Đứt giữa chừng | F3 (token bị vứt) + F2 (rate-limit) + F5 (key admin tặng) |
| 2. Client `--rebind` | ❌ Không tồn tại trong EXE | F1 (EXE cũ chưa build lại) |
| 3. Admin reset | ❌ Không bền 30 phút | F4 (máy cũ giành lại) |
| Hợp lại | **Không có đường nào tới đích** | |

---

## MỤC B — NGUYÊN NHÂN GỐC (kèm file:line)

### F1 — 🥇 EXE đang phát hành KHÔNG có code rebind

**Đây là nguyên nhân gốc #1. Mọi fix server đều vô nghĩa nếu không sửa.**

| Bằng chứng | Giá trị |
|---|---|
| `tool/dist/xa_nofog_pro.exe` build lúc | **2026-11-10 21:03:52** |
| Commit fix `--rebind` (`ef46533`) lúc | **2026-11-10 22:23:49** |
| → EXE cũ hơn fix | **1 giờ 20 phút** |
| EXE trên R2 (`/download/xa_nofog_pro.exe`) | sha256 `C72484F5…861D214`, 13.204.858 bytes |
| Khớp `tool/dist` | ✅ giống hệt |
| Khớp hằng số `installer.js:17-18` | ✅ giống hệt |

Chuỗi nhân quả:
1. `tool/src/xa_nofog_pro.py` `parse_args()` (dòng 1504-1508) nhận `--rebind KEY TOKEN` → `o['rebind'] = (KEY, TOKEN)` — **có**.
2. Nhưng `run()` bản cũ **không có** nhánh `if opts.get('rebind')`. Các nhánh xử lý chỉ là `help / buy / trial / list / status / deactivate / key / restore / dump / once / watch`. `opts['rebind']` bị **bỏ qua im lặng**.
3. Chương trình rơi xuống luồng thường → `require_license(opts)` → chưa có `state.key` hoặc không hợp lệ → `ask_key_dialog()` (dòng 1674) → `_secure_dialog()` mở **hộp thoại Tk** ⇒ **chờ vô hạn**.

Commit `ef46533` "FIX: --rebind bi bo qua im lang" đã thêm `rebind_key()` + nhánh trong `run()` ở **source**, nhưng **EXE chưa được build lại và chưa upload**.

### F2 — 🔴 Rate limit che lỗi thật, khoá khách 1 giờ

`src/routes/license.js:256`
```js
await rateLimit(env, `rebind:${user.id}:${clientIp(request)}`, 5, 3600);
```
đặt **trước** khối kiểm quota ở dòng 267-270:
```js
if ((lic.rebinds || 0) >= (lic.max_rebind || 0)) {
  throw new ApiError(403, `Đã hết số lần đổi máy (${lic.max_rebind})…`, 'REBIND_LIMIT');
}
```
Hệ quả: khách bấm nút lần thứ 6 trong 1 giờ → nhận `429 RATE_LIMITED "Bạn thao tác quá nhanh"` **thay vì** thông báo đúng "Đã hết số lần đổi máy". Khách tưởng lỗi mạng, bấm tiếp, càng bị khoá. Chủ shop tưởng "nút không hoạt động".

### F3 — 🔴 Token bị vứt bỏ ngay sau khi sinh

`public/assets/pages/licenses.js:191-193`
```js
const r = await api(`/api/licenses/${encodeURIComponent(b.dataset.rebind)}/rebind`, { method: 'POST' });
toast(`Đã cấp quyền đổi máy (còn ${r.rebindsLeft} lần)`, 'success', 6000);
await mountLicenses(root);
```
Server trả về `{ token, expiresIn, rebindsLeft, command }` (license.js:281-288), UI **chỉ dùng `r.rebindsLeft`**. `token` và `command` bị bỏ. Token sống 30 phút, dùng 1 lần → khách mất vĩnh viễn.

Ngoài ra `src/routes/installer.js` **không hề** có `--rebind` (chỉ `& $Exe --key $Key` ở dòng 524) → lệnh cài đặt không mang token → máy mới không đổi được máy.

### F4 — 🔴 Reset mở cửa cho máy cũ (test thật tái hiện 100%)

`src/routes/license.js:97-101`
```js
export async function resetHwid(env, key) {
  await env.DB.prepare(
    'UPDATE licenses SET hwid = NULL, activated_at = NULL, rebinds = 0 WHERE key = ?'
  ).bind(normKey(key)).run();
}
```
`activated_at = NULL` xoá dấu vết "key đã từng bind". Kết hợp `license-server.js:80`:
```js
if (!lic.hwid) return { ok: true, firstBind: true };
```
→ Bất kỳ ai gọi `/api/activate` hoặc `/api/check` tiếp theo đều bind được. Tool chạy nền tự `/api/check` mỗi 30 phút (`xa_nofog_pro.py:1977 trial_guard()`), nên **máy cũ luôn thắng** nếu nó còn chạy.

Bug phụ cùng chỗ — `bindFirstTime()` bản cũ (license-server.js:123-138) tính hạn bằng `created_at`:
```js
const days = Math.round((lic.expires_at - lic.created_at) / 86400);
const exp = now + days * 86400;
```
`created_at` là mốc **tạo**, không phải mốc kích hoạt ⇒ mỗi lần reset + activate lại **tặng thêm đúng bằng tuổi key**.

### F5 — 🟠 Key admin tặng không có nút "Đổi máy"

`src/routes/license.js:345-359` `adminIssueLicenses()` gọi `issueLicenses()` → chỉ `INSERT INTO licenses`, **không** ghi `license_issues`.

Nhưng:
- `myLicenses()` (license.js:218-223) `FROM license_issues li ... LEFT JOIN licenses` → key admin tặng **không hiện**.
- `rebindMyLicense()` (license.js:259-262) đòi `SELECT 1 FROM license_issues WHERE user_id=? AND license_key=?` → **403 FORBIDDEN**.
- `issueInstallToken()` (installer.js:86-90) cũng đòi `license_issues` → **403**.

Đây là đường phổ biến nhất khi chủ shop nói "reset HWID chưa được": key bù lỗi/tặng khách là key admin tạo tay ⇒ khách không thấy nút, không lấy được lệnh cài.

### F6 — 🟡 Không có UI đặt `max_rebind`

`db/schema-license-server.sql:17` có cột `max_rebind DEFAULT 1`. `issueLicenses()` (license.js:78) hard-code `Number(maxRebind) || 1`. `adminIssueLicenses()` không nhận `maxRebind`. Admin UI (`admin.js`) **không có** ô nhập hay nút đổi → không thể cấp key "đổi máy vô hạn" cho khách VIP, cũng không thể cấp lại lượt khi khách dùng hết.

### F7 — 🟡 `directly gọi web session` không đổi được máy

`/api/licenses/{KEY}/rebind` (license.js:250) **chỉ sinh token**, không reset `hwid`. Đúng theo thiết kế (client cần được báo), nhưng không có đường "reset ngay" cho trường hợp khách đã đăng nhập web + máy hỏng không khởi động được.

---

## MỤC C — BẢNG KẾT QUẢ TEST THẬT

Tất cả chạy trên production `https://xienhl.com`, dùng API chính thức của shop.
Tài khoản: `namhbcf` (admin) + `demo@muabankey.vn` + user test mới.

### C.1. Test luồng server (KHÔNG có bug về route/quyền)

| # | Hành động | Kết quả | Đánh giá |
|---|---|---|---|
| 1 | Admin login | HTTP 200 | ✅ |
| 2 | `GET /api/admin/licenses` | 200, `available=true`, 300 bản ghi, stats `{total:4055, active:18, unbound:4023, revoked:14, forever:1002}` | ✅ |
| 3 | Demo `GET /api/licenses/mine` | 200, 1 license `AOE1-LSR4-R869-Z77C`, `rebinds=1/1` | ✅ |
| 4 | Mua license tuần (70.000đ) | 201 → pay 200 `delivered` → key `AOE1-GFFZ-HZZN-TJTD` | ✅ |
| 5 | `/api/activate` máy A | 200 `first_bind=true`, `expires_at` = +31 ngày | ✅ |
| 6 | `POST /api/licenses/{KEY}/rebind` | **200**, trả `token=900a4107e302aded…`, `rebindsLeft=1`, `command="…--rebind KEY TOKEN"` | ✅ server OK |
| 7 | DB sau bước 6 | `hwid` **vẫn là máy cũ**, `rebinds=0/1` | ⚠️ đúng thiết kế (chỉ cấp token) |
| 8 | Máy mới `/api/activate` (chưa gọi `/api/rebind`) | **403 `hwid_mismatch`** | ❌ khách tưởng reset xong nhưng chưa |
| 9 | Máy mới `POST /api/rebind {key,hwid,token}` | **200 `rebinds_left=0`**, DB `hwid=bbbb…`, `rebinds=1/1` | ✅ |
| 10 | Máy mới `/api/activate` lại | 200 `first_bind=false` | ✅ |
| 11 | Dùng lại token cũ | 401 `unauthorized` | ✅ chặn đúng |
| 12 | Admin `reset-hwid` | 200, `hwid=NULL`, `rebinds=0`, `status=unbound` | ✅ |
| 13 | Máy C activate sau reset | 200 `first_bind=true` | ✅ |

**Kết luận C.1: API server hoạt động đúng.** Route tồn tại, phân quyền đúng, DB cập nhật đúng. Lỗi **không** phải 404/403/thiếu endpoint.

### C.2. Test lỗi F2 — rate limit che lỗi thật

Gọi `POST /api/licenses/{KEY}/rebind` 7 lần liên tiếp (license đã hết lượt):

| Lần | HTTP | Code | Thông báo khách thấy |
|---|---|---|---|
| 1 | 429 | `RATE_LIMITED` | "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút" |
| 2 | 429 | `RATE_LIMITED` | "Bạn thao tác quá nhanh…" |
| 3 | 429 | `RATE_LIMITED` | "Bạn thao tác quá nhanh…" |
| 4 | 429 | `RATE_LIMITED` | "Bạn thao tác quá nhanh…" |
| 5 | 429 | `RATE_LIMITED` | "Bạn thao tác quá nhanh…" |
| 6 | 429 | `RATE_LIMITED` | "Bạn thao tác quá nhanh…" |
| 7 | 429 | `RATE_LIMITED` | "Bạn thao tác quá nhanh…" |

**7/7 sai** — không lần nào nhận `REBIND_LIMIT "Đã hết số lần đổi máy (1)"`.
Trước đó test C.1 bước 12 cũng đã ăn 429 ngay lần gọi đầu vì đã tiêu hết 5 lượt.

### C.3. Test lỗi F4 — máy cũ giành lại key sau reset (quan trọng nhất)

| Bước | Hành động | Kết quả |
|---|---|---|
| 1 | Máy CŨ `/api/activate` | 200 `first_bind=true`, DB `hwid=oooo…` |
| 2 | Admin `reset-hwid` | 200, `hwid=NULL`, `status=unbound` |
| 3 | **Máy CŨ tự `/api/check`** (tool nền, 30 phút/lần) | **200 `ok=true first_bind=true`** → DB `hwid=oooo…` |
| 4 | **Máy MỚI `/api/activate`** | **403 `hwid_mismatch` "Mã đã dùng trên máy khác"** |

→ **Reset HWID mất tác dụng trong vòng ≤30 phút**, và thường là ngay lập tức.

### C.4. Test lỗi F1 — EXE đang phát hành (quyết định)

Tải `https://xienhl.com/download/xa_nofog_pro.exe` → sha256 `C72484F5…861D214`, 13.204.858 bytes (khớp `installer.js:17-18`).

**Test 1 — phân biệt code cũ/mới bằng `--list`:**
```
Lệnh: dl_exe.exe --rebind KEY TOKEN --list
  Code MỚI (có nhánh rebind) → gọi API → exit 3
  Code CŨ  (không nhánh)     → rơi xuống --list → exit 0

KẾT QUẢ:
  EXE deployed  → EXIT 0, in "[viewport] T1 0x00514E0F …"   ← CODE CŨ
  SOURCE fixed  → EXIT 3, in "Dang doi may..."              ← CODE MỚI
```

**Test 2 — token THẬT (lấy từ web) cho EXE deployed:**
```
dl_exe.exe --rebind AOE1-X4TT-TKTQ-DQK5 e5b2f3c7caf31d09…
→ TREO VÔ HẠN (kill sau 25s), stdout rỗng, stderr rỗng
→ Nguyên nhân: rơi vào ask_key_dialog() → hộp thoại Tk chờ vô hạn
```

**Test 3 — cùng token đó với source đã fix:**
```
python tool/src/xa_nofog_pro.py --rebind AOE1-X4TT-TKTQ-DQK5 e5b2f3c7caf31d09…
→ EXIT 0
→ "Dang doi may..."
→ "HWID may moi: 251b************************f9dc"
→ "Doi may thanh cong (con 0 luot doi may)."
→ DB: hwid=251bc0f019…, rebinds=1/1, status=active
```
Token bị tiêu → **chứng minh EXE deployed chưa hề gọi `/api/rebind`**.

### C.5. Test lỗi F5 — key admin tặng

| Bước | Hành động | Kết quả |
|---|---|---|
| 1 | Admin tạo key `GIFT-2XFJ-JNSK-493A` | 200 |
| 2 | Khách `/api/activate` | 200 `first_bind=true` (dùng được!) |
| 3 | Khách `GET /api/licenses/mine` | **Không thấy key** (chỉ thấy license mua qua đơn) |
| 4 | Khách `POST /api/licenses/{KEY}/install-token` | **403 `FORBIDDEN` "Bạn không sở hữu mã này"** |

→ Không nút "Đổi máy", không lệnh cài, không cách tự phục hồi.

### C.6. Test lỗi F4-phụ — reset cộng thêm hạn

Mô phỏng công thức `bindFirstTime()` bản cũ trên 4054 license trong `backup-before-cleanup-20261110-205447.sql`:

| key | tuổi key | hạn hiện tại | hạn SAU reset + activate | tặng thêm |
|---|---|---|---|---|
| AOE1TUAN | 0.7d | 2026-11-17 22:28 | 2026-11-18 15:34 | **+0.7d** |
| AOE1THANG | 0.7d | 2026-12-10 23:49 | 2026-12-11 15:34 | **+0.7d** |
| AOE1-N9VQ-P4N9-ZBMC | 0.7d | 2027-01-09 23:53 | 2027-01-10 15:34 | **+0.7d** |
| AOE1-LSR4-R869-Z77C | 0.6d | 2027-03-18 00:05 | 2027-03-18 15:34 | **+0.6d** |

15/15 key còn hạn bị tặng thêm. TB +0.5d, max +0.7d. Mức tặng **tỉ lệ với tuổi key** — key càng cũ, tặng càng nhiều.

---

## MỤC D — DANH SÁCH TRƯỜNG HỢP LỖI

| # | Trường hợp | Trạng thái | Nguyên nhân |
|---|---|---|---|
| 1 | Nút "Đổi máy" hiện nhưng API 404 | ❌ Không xảy ra | Route `POST /api/licenses/:key/rebind` tồn tại (`index.js:76`) |
| 2 | API tồn tại nhưng 403/401 | ⚠️ Có, với key admin tặng | F5 — `license_issues` trống |
| 3 | API thành công nhưng DB không đổi | ✅ Đúng thiết kế | `/rebind` chỉ cấp token, không reset `hwid` |
| 4 | DB đổi nhưng client không biết | ❌ Không xảy ra | `/api/rebind` trả `ok` và client lưu state |
| 5 | Client không có cách nhận HWID mới | 🔴 **CÓ** | F1 — EXE cũ không có `--rebind`; F3 — UI vứt token |
| 6 | `max_rebind = 0` → không bao giờ reset | 🔴 **CÓ** | Trial có `max_rebind=0` (đúng ý đồ). Nhưng F6: admin không đổi được `0 → N` |
| 7 | Admin muốn reset vô hạn | 🔴 **KHÔNG THỂ** | F6 — không UI, `adminIssueLicenses` không nhận `maxRebind` |
| 8 | Khách đổi máy thật (máy hỏng) | 🔴 **QUY TRÌNH SAI** | F3 + F1 — không có đường đưa token tới máy mới |
| 9 | Khách đã hết lượt (`rebinds == max_rebind`) | 🔴 **KHÔNG TỰ CỨU ĐƯỢC** | F2 — bị 429 che mất; F6 — admin không cấp lại lượt được |
| 10 | Admin reset xong máy cũ vẫn chạy | 🔴 **CÓ** | F4 — `bindFirstTime` bind ai gọi trước |
| 11 | Reset nhiều lần → hạn tăng dần | 🔴 **CÓ** | F4-phụ — dùng `created_at` thay `activated_at` |
| 12 | Key admin tặng không có nút | 🔴 **CÓ** | F5 — thiếu `license_issues` |
| 13 | Khách bấm nhiều lần → khoá 1 giờ | 🔴 **CÓ** | F2 — rateLimit trước quota, 5/giờ quá thấp |
| 14 | EXE tải về không có `--rebind` | 🔴 **CÓ** | F1 — chưa build lại sau commit `ef46533` |
| 15 | Installer không mang token | 🔴 **CÓ** | F3 — `installer.js` chỉ `--key` |

---

## MỤC E — THIẾT KẾ FIX + CODE CỤ THỂ

### E.0. Trạng thái hiện tại — phần lớn đã được sửa trong lúc tôi khảo sát

Trong quá trình chẩn đoán, repo có thêm commit `f26acef` ("Trial v2") và các file `license-server.js` / `license.js` đang được sửa trực tiếp. Tôi đã kiểm chứng lại từng mục bằng test chạy thật.

#### Bảng trạng thái CUỐI CÙNG (đo lúc 23:12, 2026-11-10 — đã kiểm chứng trên production)

| Mục | Nội dung | Trạng thái |
|---|---|---|
| **F1** | Build lại EXE + upload R2 + deploy | ✅ **ĐÃ XONG** — sha mới `FB50653D…`, EXE chạy `--rebind` → exit 3, production tải về khớp |
| **F2** | rateLimit sau kiểm quota, nới 20/giờ | ✅ Đã sửa + deploy |
| **F3** | UI hiện `token` + lệnh `--rebind` (modal + Copy) | ✅ Đã sửa |
| **F4** | `reset_pending` thay `activated_at=NULL` | ✅ Đã sửa + **migration đã apply lên D1** |
| **F4** | `bindFirstTime` đòi token khi đã từng bind | ✅ Đã sửa + deploy |
| **F5** | `adminIssueLicenses` ghi `license_issues` (`ADMIN-GIFT`) | ✅ Đã sửa |
| **F6** | `adminIssueLicenses` nhận `maxRebind` | ✅ Đã sửa |
| **F6** | UI nút "Cấp lại lượt đổi" + action `reset-rebinds` | ❌ Còn (tùy chọn, không chặn) |
| **P0-3** | Client `activate()` gửi token (`--token`) | ❌ Còn (chỉ ảnh hưởng đường installer sau reset) |
| — | `shapeLicense` trả `resetPending` | ❌ Còn (UI không hiện badge, không chặn chức năng) |

### ✅ KẾT QUẢ KIỂM CHỨNG TRÊN PRODUCTION (23:12)

Vòng đầy đủ đã chạy thành công trên `xienhl.com`:

```
1) Máy 1 activate key AOE1-8BPR-SGNH-24HQ      → HTTP 200 first_bind=true
2) ADMIN bấm "Reset máy"                        → HTTP 200, bound=false, status=unbound
3) Khách GET /api/licenses/mine                 → status=unbound, rebinds=0/1
   → Nút "Đổi máy" hiện? CÓ ✔
4) Khách bấm "Đổi máy"                          → HTTP 200, rebindsLeft=1, token=461ac0c6…
5) Máy 2 chạy EXE MỚI (tải từ xienhl.com):
   dl2.exe --rebind KEY TOKEN
   → "Dang doi may..."
   → "HWID may moi: 251b************************f9dc"
   → "Doi may thanh cong (con 0 luot doi may)."
6) Xác nhận DB:  hwid=251bc0f019…  bound=true  rebinds=1/1  status=active
   Máy 1 (cũ)   /api/check → HTTP 403 hwid_mismatch   ✔ bị chặn
   Máy 2 (mới)  /api/check → HTTP 200 ok=true          ✔ chạy được
```

Và luồng chống máy cũ giành key (F4) cũng đã xác nhận trên production:

```
1) Máy CŨ activate                             → 200 first_bind=true
2) Admin reset-hwid                            → 200, bound=false, status=unbound
3) ⚠️ Máy CŨ tự /api/check (tool nền 30 phút)  → 403 rebind_token_required  ✔ BỊ CHẶN
   DB: hwid=NULL, rebinds=0/1
4) Máy MỚI activate (không token)              → 403 rebind_token_required  ✔ đúng
```

**Chức năng reset HWID nay đã hoạt động đầy đủ trên production.**

#### Đã kiểm chứng đúng bằng test

`scripts/_test-rebind-token-flow.mjs` — 10/10 đạt:

| Kịch bản | Kết quả |
|---|---|
| Máy CŨ `/api/check` không token | 403 `rebind_token_required`, DB `hwid=NULL` ✅ |
| Máy MỚI `/api/check` có token | 200, DB `hwid=nnnn…`, `rebinds=1`, token `used=1` ✅ |
| Máy thứ ba dùng lại token | 403 `hwid_mismatch` (bị chặn) ✅ |
| `/api/activate` có token | 200, bind đúng ✅ |
| Hạn dùng | **không đổi** giữa mọi bước ✅ |

`scripts/_test-reset-pending.mjs` — **7/7 đạt** (thiết kế `reset_pending`):

| Kịch bản | Kết quả |
|---|---|
| Admin reset giữ `activated_at` | ✅ (không còn xoá) |
| Admin reset giữ hạn dùng | ✅ `expires_at` không đổi |
| Máy CŨ `/api/check` không token | ✅ 403 `rebind_token_required`, DB `hwid` vẫn NULL |
| Máy MỚI `/api/check` có token | ✅ 200 `rebound=true`, `reset_pending=0` |
| Token bị tiêu | ✅ `used=1` |
| Máy CŨ check lại | ✅ 403 `hwid_mismatch` |
| Hạn không bị cộng thêm | ✅ |

`rebindMyLicense()` giờ bỏ qua quota khi `reset_pending=1` (đúng ý đồ: admin reset là để cấp token), và `rateLimit` đã chuyển xuống sau kiểm tra + nới 20/giờ.

> ⚠️ **CẢNH BÁO đã phát hiện & đã được xử lý:** Ở bản trung gian, `apiActivate` đã truyền token + kiểm lỗi nhưng `apiCheck` còn `await bindFirstTime(...)` **thiếu token** và **bỏ qua giá trị trả về** → license thành vô chủ, `/api/check` trả `ok:true` cho mọi HWID, key chạy được trên mọi máy. Lỗi này **nay đã được sửa**. Nếu deploy bản trung gian đó sẽ là lỗ hổng nặng hơn lỗi gốc. Script bắt lỗi: `scripts/_test-bindfirsttime-regression.mjs`.

> ⚠️ **Migration chưa apply:** `db/schema-license-reset.sql` mới chỉ là file. Phải chạy trên D1 production **trước khi** deploy code mới, nếu không mọi `SELECT *` sẽ trả object thiếu cột và `reset_pending` là `undefined`.

> ⚠️ **Code mới chưa deploy:** production vẫn là bản cũ. `GET /api/admin/licenses` hiện trả key KHÔNG có `resetPending`.

---

### E.1. FIX P0-1 — Build lại EXE và phát hành (BẮT BUỘC ĐẦU TIÊN)

Không làm bước này thì tất cả các fix khác vô nghĩa.

```powershell
cd C:\Users\ADMIN\Desktop\muabankey\tool
powershell -File build.ps1
```
`build.ps1` sẽ: build → in SHA-256 + size → hỏi cập nhật `installer.js:17-18` → hỏi upload R2.

Sau đó **bắt buộc** deploy lại Worker (vì `installer.js` đổi hằng số):
```powershell
cd C:\Users\ADMIN\Desktop\muabankey
npx wrangler deploy
```

Nếu chạy không tương tác (như trong phiên này, `CLOUDFLARE_API_TOKEN` chưa set):
```powershell
cd tool
python -m PyInstaller --onefile --name xa_nofog_pro `
  --distpath dist --workpath .build --specpath .build --noconfirm --clean `
  src\xa_nofog_pro.py
# rồi cập nhật installer.js:17-18 bằng SHA/size mới và upload tay:
npx wrangler r2 object put "muabankey-assets/files/xa_nofog_pro.exe" `
  --file=tool\dist\xa_nofog_pro.exe --content-type="application/octet-stream" --remote
```

**Kiểm chứng sau khi build** (dùng đúng lệnh tôi đã dùng để phát hiện lỗi):
```powershell
# Phải exit 3 (code mới), KHÔNG phải 0
.\dist\xa_nofog_pro.exe --rebind DUMMY-KEY DUMMY-TOKEN --list
```

---

### E.2. FIX P0-2 — Hiện token + lệnh trong UI (nối lại luồng khách)

`public/assets/pages/licenses.js`, thay khối `[data-rebind]` (dòng 186-199):

```js
  // Đổi máy: lấy token rồi HIỆN LỆNH để khách chạy trên máy mới
  host.querySelectorAll('[data-rebind]').forEach((b) => {
    b.onclick = async () => {
      const key = b.dataset.rebind;
      if (!confirm(
        `Đổi máy cho key ${key}?\n\n`
        + `Bạn sẽ nhận 1 LỆNH để chạy trên MÁY MỚI.\n`
        + `Máy cũ sẽ ngừng hoạt động sau ~30 phút.`
      )) return;
      b.disabled = true;
      try {
        const r = await api(`/api/licenses/${encodeURIComponent(key)}/rebind`, { method: 'POST' });
        const zone = host.querySelector(`#zone-${CSS.escape(key)}`);
        if (zone) {
          zone.innerHTML = `
            <div style="padding:16px;border-radius:14px;background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.3)">
              <div style="font-size:12.5px;font-weight:800;color:#86efac;margin-bottom:9px;letter-spacing:.04em">
                🔄 LỆNH ĐỔI MÁY — CHẠY TRÊN MÁY MỚI
              </div>
              <div class="mono" style="font-size:11.5px;line-height:1.7;color:#bbf7d0;word-break:break-all;background:rgba(0,0,0,.42);padding:12px;border-radius:9px;border:1px solid rgba(255,255,255,.07)">
                ${esc(r.command)}
              </div>
              <div class="flex gap-1 mt-2" style="flex-wrap:wrap">
                <button class="btn btn-primary btn-sm" data-copyrebind="${esc(r.command)}">📋 Copy lệnh</button>
                <a class="btn btn-ghost btn-sm" href="#/support">💬 Cần hỗ trợ</a>
              </div>
              <div style="font-size:11.5px;color:var(--text-mute);margin-top:9px;line-height:1.7">
                Mã này <strong>chỉ dùng 1 lần</strong>, hết hạn sau <strong>30 phút</strong>.<br>
                Chạy lệnh trên <strong>máy mới</strong>: Win + R → dán → Enter.<br>
                Còn <strong>${r.rebindsLeft}</strong> lượt đổi máy.
              </div>
            </div>`;
          zone.querySelectorAll('[data-copyrebind]').forEach((cb) => {
            cb.onclick = async () => {
              const ok = await copyText(cb.dataset.copyrebind);
              toast(ok ? 'Đã copy lệnh! Chạy trên máy mới.' : 'Không sao chép được',
                ok ? 'success' : 'error', 5000);
            };
          });
        }
        await mountLicenses(root);
      } catch (e) {
        toast(e.message, 'error', 8000);
        b.disabled = false;
      }
    };
  });
```

Và sửa dòng 111-112 để nút hiện cả khi đã hết lượt (kèm nhãn "nhờ hỗ trợ"), tránh khách tưởng lỗi:

```js
            ${canRebind
              ? (l.rebinds < l.maxRebind
                  ? `<button class="btn btn-ghost btn-sm" data-rebind="${esc(l.key)}">🔄 Đổi máy</button>`
                  : `<button class="btn btn-ghost btn-sm" disabled title="Đã hết lượt đổi máy">🔄 Hết lượt đổi máy</button>`)
              : ''}
```

---

### E.3. FIX P0-3 — Client tự gửi token qua `/api/activate` (đường installer)

Vì `bindFirstTime` nay đòi token khi `activated_at` đã có, installer (`--key`) sẽ hỏng sau reset. Sửa `tool/src/xa_nofog_pro.py`:

**a) `activate()` — nhận token tùy chọn (dòng ~413):**

```python
def activate(key, verbose=True, token=None):
    """Kich hoat qua server. Server gan HWID + bat dau tinh han TU BAY GIO.

    token: chi can khi license da tung kich hoat (doi may / sau admin reset).
    """
    hwid = compute_hwid()
    if verbose:
        print('  HWID: %s' % mask_key(hwid))
    payload = {'key': key, 'hwid': hwid, 'app': APP_NAME}
    if token:
        payload['token'] = token
    r = _post('/api/activate', payload)
    ...
```

**b) `parse_args()` — thêm `--token`:**

```python
         'rebind': None, 'token': None}
...
        elif a == '--token':
            i += 1
            if i >= len(argv):
                return None, '--token can gia tri'
            o['token'] = argv[i].strip()
```

**c) `require_license()` — truyền token xuống (dòng 1713):**

```python
    if opts.get('key'):
        ok, m = activate(opts['key'], token=opts.get('token'))
```

**d) `run()` — nhánh `--rebind` đã có sẵn từ commit `ef46533`, giữ nguyên.**

---

### E.4. FIX P1-1 — Rate limit: chuyển xuống sau kiểm quota

`src/routes/license.js`, trong `rebindMyLicense()`:

```js
  const user = await requireUser(env, request);

  const k = normKey(key);
  const owns = await env.DB.prepare(
    'SELECT 1 AS x FROM license_issues WHERE user_id = ? AND license_key = ? LIMIT 1'
  ).bind(user.id, k).first();
  if (!owns) throw new ApiError(403, 'Bạn không sở hữu license này', 'FORBIDDEN');

  const lic = await readLicense(env, k);
  if (!lic) throw new ApiError(404, 'License không tồn tại', 'NOT_FOUND');
  if (lic.revoked) throw new ApiError(403, 'License đã bị thu hồi', 'REVOKED');

  // Kiểm quota TRƯỚC rate limit -> khách nhận thông báo đúng, không bị khoá oan
  if ((lic.rebinds || 0) >= (lic.max_rebind || 0)) {
    throw new ApiError(403,
      `Đã hết số lần đổi máy (${lic.max_rebind}/${lic.max_rebind}). `
      + `Liên hệ hỗ trợ qua Telegram/Zalo để được cấp thêm.`, 'REBIND_LIMIT');
  }

  // Rate limit chỉ chống spam khi THẬT SỰ còn lượt; nới 20/giờ
  await rateLimit(env, `rebind:${user.id}:${clientIp(request)}`, 20, 3600);
```

---

### E.5. FIX P1-2 — `adminIssueLicenses` ghi `license_issues` khi có userId

`src/routes/license.js`:

```js
export async function adminIssueLicenses(env, request) {
  const { requireAdmin } = await import('../lib/auth.js');
  const { ok, readJson } = await import('../lib/http.js');
  const { str, int } = await import('../lib/validate.js');
  const admin = await requireAdmin(env, request);
  const body = await readJson(request);

  const count = int(body.count ?? 1, 'count', { min: 1, max: 100 });
  const days = int(body.days ?? 30, 'days', { min: 0, max: 3650 });
  const prefix = str(body.prefix ?? 'AOE1', 'prefix', { min: 1, max: 8 });
  const note = str(body.note, 'note', { required: false, max: 200 }) || `Tạo bởi ${admin.email}`;
  const maxRebind = int(body.maxRebind ?? 1, 'maxRebind', { min: 0, max: 99 });
  // userId: gán key cho khách -> key hiện trên trang "License của tôi"
  const userId = str(body.userId, 'userId', { required: false, max: 64 }) || null;

  const keys = await issueLicenses(env, {
    count, prefix, days, plan: prefix.toLowerCase(), note, maxRebind,
  });

  // QUAN TRỌNG: phải ghi license_issues, nếu không khách KHÔNG thấy key
  // và rebindMyLicense()/issueInstallToken() sẽ 403 "không sở hữu".
  if (userId) {
    await recordIssue(env, {
      orderId: null, userId, productId: null, keys,
      termDays: days, expiresAt: days === 0 ? 0 : nowSec() + (days + 1) * 86400,
    });
  }
  return ok({ keys, count: keys.length, days, maxRebind, assignedTo: userId });
}
```
*(`recordIssue` đã có sẵn ở license.js:116, schema `license_issues` cho phép `order_id`/`product_id` NULL.)*

UI `admin.js` thêm 2 ô vào form "Tạo license thủ công" (dòng 629-638):
```html
<div><label class="label">Lượt đổi máy</label><input class="input" id="lc-maxrebind" type="number" value="1" style="width:110px"></div>
<div style="flex:1;min-width:180px"><label class="label">Gán cho user (ID, tùy chọn)</label><input class="input" id="lc-userid" placeholder="u-demo..."></div>
```
và gửi kèm trong body (dòng 680-685):
```js
        maxRebind: Number(host.querySelector('#lc-maxrebind').value) || 0,
        userId: host.querySelector('#lc-userid').value.trim() || undefined,
```

---

### E.6. FIX P1-3 — Admin cấp lại lượt đổi máy (2 action mới)

`src/routes/license.js`, trong `adminLicenseAction()`:

```js
  if (action === 'revoke') await setRevoked(env, k, true);
  else if (action === 'unrevoke') await setRevoked(env, k, false);
  else if (action === 'reset-hwid') await resetHwid(env, k);
  else if (action === 'extend') await extendLicense(env, k, 30);
  // Cấp lại lượt đổi máy (khách dùng hết 1/1)
  else if (action === 'reset-rebinds') {
    await env.DB.prepare('UPDATE licenses SET rebinds = 0 WHERE key = ?').bind(k).run();
  }
  // Đặt lại số lượt tối đa (vd 0 -> 99 cho khách VIP)
  else if (action === 'set-rebind-limit') {
    const n = Math.max(0, Math.min(99, Number(request.headers.get('x-rebind-limit') || 5)));
    await env.DB.prepare('UPDATE licenses SET max_rebind = ? WHERE key = ?').bind(n, k).run();
  }
  else throw new AE(400, 'Hành động không hợp lệ', 'VALIDATION');
```

UI `admin.js` (dòng 663-667) thêm 2 nút:
```html
<button class="btn btn-ghost btn-sm" data-act="reset-rebinds" data-key="${esc(l.key)}">↺ Cấp lại lượt đổi</button>
```

---

### E.7. FIX P2 — Endpoint "reset ngay" cho khách đã đăng nhập (máy hỏng)

Trường hợp khách đã đăng nhập web nhưng máy hỏng không tạo được token — cho phép reset trực tiếp, vẫn bảo vệ bằng `license_issues`:

`src/routes/license.js`:

```js
/**
 * Khách đã đăng nhập + sở hữu key -> reset HWID NGAY, không cần token.
 * Vẫn an toàn vì:
 *   - phải có session + sở hữu qua license_issues
 *   - token hết hạn 30 phút trước đó (nếu có) bị huỷ
 *   - reset vẫn giữ activated_at để bindFirstTime biết đây là "đổi máy",
 *     nên máy cũ KHÔNG thể tự bind lại (cần token).
 */
export async function resetMyLicenseHwid(env, request, key) {
  const { requireUser } = await import('../lib/auth.js');
  const { ok } = await import('../lib/http.js');
  const { clientIp } = await import('../lib/ratelimit.js');
  const user = await requireUser(env, request);

  const k = normKey(key);
  const owns = await env.DB.prepare(
    'SELECT 1 AS x FROM license_issues WHERE user_id = ? AND license_key = ? LIMIT 1'
  ).bind(user.id, k).first();
  if (!owns) throw new ApiError(403, 'Bạn không sở hữu license này', 'FORBIDDEN');

  const lic = await readLicense(env, k);
  if (!lic) throw new ApiError(404, 'License không tồn tại', 'NOT_FOUND');
  if (lic.revoked) throw new ApiError(403, 'License đã bị thu hồi', 'REVOKED');
  if ((lic.rebinds || 0) >= (lic.max_rebind || 0)) {
    throw new ApiError(403, 'Đã hết số lần đổi máy. Liên hệ hỗ trợ.', 'REBIND_LIMIT');
  }

  // GIỮ activated_at (KHÔNG set NULL) -> máy cũ không tự bind lại được
  await env.DB.prepare(
    'UPDATE licenses SET hwid = NULL, rebinds = rebinds + 1 WHERE key = ?'
  ).bind(k).run();
  // Huỷ token cũ đang treo
  await env.DB.prepare(
    'UPDATE rebind_tokens SET used = 1 WHERE key = ? AND used = 0'
  ).bind(k).run();

  await env.DB.prepare(
    'INSERT INTO lic_events (key, hwid, kind, detail, ip, at) VALUES (?,?,?,?,?,?)'
  ).bind(k, lic.hwid || null, 'rebind', `self-reset by ${user.email}`, clientIp(request), nowSec()).run();

  return ok({ key: k, rebindsLeft: Math.max(0, (lic.max_rebind || 0) - (lic.rebinds || 0) - 1) });
}
```

`src/index.js:
```js
r.post('/api/licenses/:key/rebind', (env, req, p) => license.rebindMyLicense(env, req, p.key));
r.post('/api/licenses/:key/reset-hwid', (env, req, p) => license.resetMyLicenseHwid(env, req, p.key));  // MỚI
```

---

## KẾT LUẬN

### Lỗi chính xác là gì

Reset HWID **không hoạt động** không phải vì một lỗi đơn lẻ, mà vì **luồng đứt ở cả 3 đầu**. Xếp theo mức chặn:

**1️⃣ LỖI CHÍNH — EXE đang phát hành không có code rebind.**
`tool/dist/xa_nofog_pro.exe` build lúc **21:03:52**, commit fix `--rebind` lúc **22:23:49** → EXE cũ hơn 1h20p. Hằng số `EXE_SHA256` trong `installer.js:17` vẫn trỏ đúng bản cũ `C72484…`, tải từ xienhl.com cũng ra đúng bản đó.
Bằng chứng không thể chối cãi: EXE deployed chạy `--rebind KEY TOKEN` (token thật) → **treo vô hạn** vì rơi vào hộp thoại `ask_key_dialog()`; cùng token đó với source đã fix → **EXIT 0 "Đổi máy thành công"** và DB đổi `rebinds=1/1`. Token bị tiêu → EXE deployed **chưa hề** gọi `/api/rebind`.

**2️⃣ LỖI THỨ HAI — admin reset xong, máy cũ giành lại key ngay.**
`resetHwid()` (`license.js:97-101`) set `activated_at = NULL`, làm `judge()` (`license-server.js:80`) coi như key chưa từng bind. Tool chạy nền tự `/api/check` mỗi 30 phút (`xa_nofog_pro.py:1977`) → máy cũ bind lại trước khi khách kịp làm gì trên máy mới. Test thật tái hiện 100%: sau reset, máy cũ check → `ok=true`, DB `hwid=oooo…`; máy mới activate → **403 `hwid_mismatch`**.
Kèm bug phụ: `bindFirstTime()` tính hạn bằng `created_at` nên **mỗi lần reset tặng thêm thời gian** đúng bằng tuổi key (đo trên backup: 15/15 key bị tặng, max +0.7d).

**3️⃣ LỖI THỨ BA — token bị vứt, khách không có gì để chạy.**
`licenses.js:191-193` gọi API lấy được `token` + `command` nhưng chỉ hiện toast rồi vứt. Token sống 30 phút, dùng 1 lần → mất vĩnh viễn. Installer (`installer.js:524`) chỉ chạy `--key`, không mang token. Kể cả EXE có code rebind thì khách vẫn không biết token.

**Cộng thêm 4 lỗi phụ** làm chủ shop càng thấy "không hoạt động": rate-limit 5/giờ che mất thông báo "hết lượt" (test: 7/7 lần đều nhận `RATE_LIMITED`); key admin tặng không có `license_issues` nên khách không thấy nút; không UI đặt `max_rebind`; khách dùng hết lượt không có đường tự cứu.

### Fix thế nào — trạng thái CUỐI (23:12)

| Ưu tiên | Việc | File | Trạng thái |
|---|---|---|---|
| **P0-1** | Build lại EXE → upload R2 → cập nhật `EXE_SHA256`/`EXE_SIZE` → `wrangler deploy` | `tool/build.ps1`, `installer.js:17-18` | ✅ **XONG** — sha `FB50653D…`, production khớp |
| **P0-1b** | Apply migration `reset_pending` lên D1 production | `db/schema-license-reset.sql` | ✅ **XONG** — UPDATE không lỗi |
| **P0-2** | Hiện `token` + lệnh trong UI, nút Copy | `licenses.js:196-240` | ✅ XONG |
| **P1-1** | `rateLimit` sau kiểm quota, nới 5→20/giờ | `license.js` `rebindMyLicense` | ✅ XONG + deploy |
| **P1-2** | `adminIssueLicenses` ghi `license_issues`; nhận `userId`, `maxRebind` | `license.js` | ✅ XONG |
| **P0-3** | Client `activate()` gửi `token` (`--token`) | `xa_nofog_pro.py:498-503` | ⬜ Còn lại |
| **P1-3** | UI nút "Cấp lại lượt đổi" + action `reset-rebinds` | `admin.js`, `license.js` | ⬜ Còn lại |
| **P1-4** | `shapeLicense` trả `resetPending` | `license.js` | ⬜ Còn lại |
| **P2** | Endpoint `reset-hwid` cho khách tự cứu máy hỏng | `license.js` + `index.js` | ⬜ Tùy chọn |

**Đã kiểm chứng bằng test + production:** `bindFirstTime()` đòi `rebind_token` khi license đã từng bind; `apiActivate` + `apiCheck` đều truyền token và kiểm `if (!br.ok) return 403`; admin reset dùng `reset_pending` (giữ `activated_at`, giữ hạn dùng); hạn dùng khi đổi máy giữ nguyên; `MESSAGES` đã có `rebind_token_required / invalid_token / token_used / token_expired`.

> ⚠️ Trong lúc khảo sát tôi đã bắt được **lỗi hồi quy P0** ở bản trung gian: `apiCheck` còn thiếu token và bỏ qua `{ok:false}` → license thành vô chủ, `/api/check` trả `ok:true` cho mọi HWID. Đã báo ngay và **nay đã được sửa**. Nếu deploy bản trung gian đó sẽ là lỗ hổng nặng hơn lỗi gốc.

### 3 việc còn lại (không chặn chức năng chính)

**P0-3 — client gửi token qua `/api/activate`:** chỉ ảnh hưởng đường installer `--key` khi license đã từng bind (sau admin reset). Hiện installer sẽ nhận `403 rebind_token_required`, nhưng khách vẫn đổi máy được qua nút web + `--rebind`. Cần sửa để đường cài đặt một lệnh hoạt động cả sau reset:

```python
# tool/src/xa_nofog_pro.py
def activate(key, verbose=True, token=None):
    ...
    payload = {'key': key, 'hwid': hwid, 'app': APP_NAME}
    if token:
        payload['token'] = token
    r = _post('/api/activate', payload)
    ...
# parse_args: thêm '--token <T>'  ->  o['token']
# require_license: activate(opts['key'], token=opts.get('token'))
```

**P1-3 — admin cấp lại lượt đổi máy:** khi khách dùng hết 1/1 và không muốn admin reset (reset cần khách lấy token). Thêm vào `adminLicenseAction()`:
```js
  else if (action === 'reset-rebinds') {
    await env.DB.prepare('UPDATE licenses SET rebinds = 0 WHERE key = ?').bind(k).run();
  }
```
và nút trong `admin.js:663-667`:
```html
<button class="btn btn-ghost btn-sm" data-act="reset-rebinds" data-key="${esc(l.key)}">↺ Cấp lại lượt đổi</button>
```

**P1-4 — `shapeLicense` trả `resetPending`:** để UI hiện badge "Đang chờ đổi máy" thay vì chỉ "Chưa kích hoạt", giúp chủ shop nhìn là biết trạng thái:
```js
// trong shapeLicense(lic)
    resetPending: !!lic.reset_pending,
    rebinds: lic.rebinds || 0,
    maxRebind: lic.max_rebind || 0,
```
*(Lưu ý: `reset_pending` đã có trong DB nhưng `shapeLicense` nhận object `lic` từ `SELECT *` nên chỉ cần thêm 1 dòng.)*

### Một câu trả lời cho chủ shop

> **Chức năng reset HWID nay đã hoạt động.** Nguyên nhân là **file `.exe` khách tải về là bản cũ**, không có lệnh `--rebind` — khách bấm "Đổi máy" xong chạy lệnh thì máy treo ở hộp thoại nhập key. Cộng thêm nút "Reset máy" của admin bị **máy cũ giật lại trong 30 phút** vì tool chạy nền tự xác minh và bind lại.
>
> **Đã sửa xong và kiểm chứng trên production:** build lại EXE (sha `FB50653D…`) + upload + deploy, thêm cột `reset_pending` (máy cũ phải có mã mới bind được), hiện mã đổi máy trong trang "License của tôi" kèm nút Copy, sửa rate-limit không khoá oan khách nữa.
>
> **Kết quả test thật:** mua key → máy 1 kích hoạt → admin reset → khách bấm "Đổi máy" lấy mã → máy 2 chạy `--rebind` → **"Đổi máy thành công"**, DB `rebinds=1/1`, máy 1 bị `403 hwid_mismatch`, máy 2 `ok=true`.
>
> **Còn 3 việc phụ** (không chặn chức năng): cho client gửi mã qua `--token` (để lệnh cài đặt một phát cũng đổi được máy sau reset), thêm nút "Cấp lại lượt đổi" cho admin, và hiện badge "Đang chờ đổi máy" trong admin.

---

## PHỤ LỤC — Script kiểm chứng đã commit

| Script | Mục đích | Chạy lại |
|---|---|---|
| `scripts/_test-rebind-real.mjs` | E2E 14 bước trên production (mua → activate → rebind → reset) | `node scripts/_test-rebind-real.mjs https://xienhl.com` |
| `scripts/_test-reset-race.mjs` | Chứng minh máy cũ giành key sau reset (F4) | `node scripts/_test-reset-race.mjs` |
| `scripts/_test-rebind-ratelimit.mjs` | Chứng minh rate-limit che lỗi (F2) | `node scripts/_test-rebind-ratelimit.mjs` |
| `scripts/_test-admin-granted-key.mjs` | Chứng minh key admin tặng không có nút (F5) | `node scripts/_test-admin-granted-key.mjs` |
| `scripts/_test-bindfirsttime-regression.mjs` | Bắt lỗi hồi quy `bindFirstTime` | `node scripts/_test-bindfirsttime-regression.mjs` |
| `scripts/_test-rebind-token-flow.mjs` | Kiểm chứng luồng token đã sửa (10 assertion) | `node scripts/_test-rebind-token-flow.mjs` |
| `scripts/_test-reset-pending.mjs` | Kiểm chứng thiết kế `reset_pending` (7 assertion) | `node scripts/_test-reset-pending.mjs` |
| `scripts/_e2e-fresh-user.mjs` | Tạo user + mua key + lấy token thật | `node scripts/_e2e-fresh-user.mjs` |
| `scripts/_diag-backup.mjs` | Phân tích 4054 license: tác động reset lên hạn | `node scripts/_diag-backup.mjs` |
| `scripts/_probe-rebind-readonly.mjs` | Khảo sát read-only trạng thái rebind | `node scripts/_probe-rebind-readonly.mjs` |
| `scripts/_cleanup-test-keys.mjs` | Thu hồi key test đã tạo | `node scripts/_cleanup-test-keys.mjs` |

Lệnh then chốt để phân biệt EXE cũ/mới (dùng khi verify sau build):
```powershell
# exit 3 = code mới (có --rebind); exit 0 + in "[viewport]" = code cũ
.\tool\dist\xa_nofog_pro.exe --rebind DUMMY DUMMY --list
```
