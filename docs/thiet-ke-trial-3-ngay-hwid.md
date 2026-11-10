# THIẾT KẾ HỆ THỐNG DÙNG THỬ 3 NGÀY MIỄN PHÍ THEO HWID

**Dự án:** muabankey / xienhl.com — shop license XArena No Fog
**Phạm vi:** Thiết kế (không code). Tài liệu này là bản đặc tả để triển khai sau.
**Ngày:** 2026-11-10

---

## 0. HIỆN TRẠNG ĐÃ ĐỌC (tóm tắt có căn cứ)

| Thành phần | Hiện trạng |
|---|---|
| HWID | `SHA-256(MachineGuid \| BIOS serial(SMBIOS type 2) \| CPU brand \| VolumeSerial C:)[:32]` — 32 hex |
| State client | `%LOCALAPPDATA%\XArenaNoFog\lic.bin`, prefix `XANF` + DPAPI (per-user, per-machine) |
| API client | `POST /api/activate`, `POST /api/check`, `POST /api/rebind` |
| Bảng | `licenses(key PK, hwid, plan, note, created_at, activated_at, expires_at, last_seen, last_ip, revoked, max_rebind, rebinds)` |
| Hạn | `expires_at` unix GIÂY, `0` = vĩnh viễn. `bindFirstTime()` tính `days = (expires_at - created_at)/86400` rồi `exp = now + days*86400` → **hạn tính từ lần bind đầu** |
| Bonus | `issueLicenses()` cộng sẵn `+1 ngày` khi tạo key |
| Grace offline | `GRACE_HOURS = 24`, server trả về, client tự đếm bằng `time.time()` |
| Rate limit | `lic_attempts(ip, at, ok)` — 30 lần **thất bại**/IP/giờ; + global KV 300 req/phút/IP |
| Chống lùi đồng hồ | Có hàm `_time_state()` + anchor file/registry — **NHƯNG KHÔNG ĐƯỢC GỌI Ở ĐÂU** → dead code |
| Trial | `db/schema-trial.sql` **đã có sẵn** (`trials`, `trial_attempts`, `banned_devices`) nhưng **0 dòng code** trong `src/` dùng tới |

### 3 lỗ hổng hiện tại phải sửa trước khi làm trial

| # | Vấn đề | Hệ quả với trial |
|---|---|---|
| **B1** | `/api/check` trả `code: rate_limit` (429). `ensure_licensed()` **không** coi đây là từ chối dứt khoát → rơi xuống grace | Cố tình spam sai để bị rate-limit = **được 24h offline miễn phí**. Với trial 3 ngày thì 24h grace = 33% thời lượng |
| **B2** | `_time_state()` là dead code. Không nơi nào so `now` với mốc đã lưu | Lùi đồng hồ hệ thống → grace không bao giờ hết |
| **B3** | `hwid` do client tự khai, không chữ ký, không kiểm tra chéo | Postman gửi `{"key":"...","hwid":"abc12345"}` là xong — farm trial không giới hạn |

**Kết luận:** không thể chỉ "thêm bảng trial". Phải vá B1–B3 thì trial 3 ngày mới có nghĩa.

---

## A. THIẾT KẾ DỮ LIỆU

### A1. Cần bảng gì?

**4 bảng**, tách hoàn toàn khỏi `licenses`:

| Bảng | Vai trò | Khoá chính |
|---|---|---|
| `trials` | 1 dòng / 1 máy, **nhớ vĩnh viễn** (không bao giờ xoá) | `hwid` |
| `trial_attempts` | Nhật ký mọi lần thử (kể cả bị từ chối) — dùng để phát hiện farm | `id` autoincrement |
| `banned_devices` | Danh sách máy bị chặn cứng | `hwid` |
| `trial_links` | Cầu nối trial (theo HWID) → tài khoản web (theo user_id) | `hwid` |

**Vì sao `hwid` là PRIMARY KEY của `trials`:** đây chính là cơ chế "xoá lic.bin cũng không reset được trial". Tra cứu là point-lookup trên PK, rẻ nhất trên D1.

### A2. Cột của bảng `trials` (nhóm theo mục đích)

| Nhóm | Cột | Vì sao cần |
|---|---|---|
| Định danh | `hwid` (PK), `token_hash` (UNIQUE) | `hwid` = danh tính máy. `token_hash` = bằng chứng sở hữu, để không ai đoán HWID người khác mà query được |
| Thời gian | `started_at`, `expires_at`, `ttl_days` | `expires_at` **luôn do server tính**. `ttl_days` lưu lại để sau này đổi chính sách 3→7 ngày vẫn truy được record cũ |
| Định danh mềm | `fp_guid`, `fp_cpu`, `fp_bios`, `fp_vol` | **Đây là cột quan trọng nhất chống đổi linh kiện.** Lưu hash riêng từng thành phần → phát hiện "cùng một máy, đổi 1 thứ" |
| Ngữ cảnh | `ip_first`, `ip_last`, `ip_set` (JSON ≤8 IP), `ua_first`, `country_first`, `asn_first` | Chấm điểm lạm dụng, phát hiện VPN/datacenter, phát hiện "du hành bất khả thi" |
| Máy ảo | `vm_flag`, `vm_detail` | Quyết định cho trial trên VM hay không |
| Nghi vấn | `suspect`, `suspect_reason` | Đánh dấu để admin xem lại, **không chặn tự động** (tránh giết khách thật) |
| Thống kê | `check_count`, `last_check_at`, `last_client_time`, `offline_overrun` | `last_client_time` để phát hiện client báo giờ lùi. `offline_overrun` để trừ ngày khi phát hiện chạy offline quá mức |
| Chuyển đổi | `converted_key`, `converted_at`, `linked_user_id`, `link_code` | Đo conversion rate + cộng dồn ngày khi mua |
| Khác | `status`, `plan`, `note`, `created_at` | |

### A3. Index cần có

```sql
CREATE UNIQUE INDEX ux_trials_token   ON trials(token_hash);
CREATE INDEX idx_trials_expires       ON trials(expires_at);
CREATE INDEX idx_trials_status_exp    ON trials(status, expires_at);
CREATE INDEX idx_trials_fp_bios       ON trials(fp_bios);     -- gom cụm VM/clone
CREATE INDEX idx_trials_fp_guid       ON trials(fp_guid);     -- đổi MachineGuid
CREATE INDEX idx_trials_ip_first      ON trials(ip_first, started_at);
CREATE INDEX idx_trials_last_check    ON trials(last_check_at);
CREATE INDEX idx_trials_link          ON trials(linked_user_id);
CREATE INDEX idx_trials_converted     ON trials(converted_at) WHERE converted_at IS NOT NULL;
```

Lý do từng index:
- `ux_trials_token`: bắt buộc UNIQUE, tránh hai máy trùng token.
- `idx_trials_fp_bios`: query "có bao nhiêu HWID khác nhau dùng chung BIOS serial này trong 180 ngày" — đây là **bẫy VM template / ghost image** hiệu quả nhất.
- `idx_trials_fp_guid`: query "MachineGuid này đã từng xuất hiện chưa".
- `idx_trials_ip_first`: đếm trial theo IP/nhóm IP trong cửa sổ 30 ngày.
- Index bộ phận (`WHERE ... NOT NULL`) cho conversion: D1/SQLite hỗ trợ, giữ index nhỏ.

**Chống phình bảng:** `trials` **không bao giờ xoá** (kể cả hết hạn) — đó là bộ nhớ chống lạm dụng. Chỉ `trial_attempts` bị dọn sau 180 ngày bằng cron.

### A4. Trial gắn với HWID? HWID + app? Có cần user_id?

| Phương án | Đánh giá |
|---|---|
| **Chỉ HWID** | Đơn giản nhất nhưng: nếu sau này có tool thứ 2 (XArena khác, tool khác), khách sẽ được trial 3 ngày cho mỗi tool → phải chấp nhận hoặc chặn |
| **HWID + app/plan** | ✅ **Chọn cái này.** PK vẫn là `hwid`, nhưng thêm cột `app` + UNIQUE `(app, hwid)`. Cho phép chính sách "1 trial/1 máy/1 sản phẩm", đồng thời vẫn query được "máy này đã từng trial sản phẩm nào" |
| **HWID + user_id** | ❌ Không dùng làm khoá. Khách trial **không có tài khoản** — đó là yêu cầu gốc ("không cần đăng ký"). `user_id` chỉ nên là **cột nullable** để nối khi khách tự link hoặc khi mua |

**Khuyến nghị:** `PRIMARY KEY (app, hwid)` với `app` mặc định `'xa_nofog'`. Khi chỉ có 1 tool thì hành vi y hệt "chỉ HWID", nhưng không phải migrate DB sau này.
Nếu muốn giữ PK đơn giản là `hwid` thì dùng thêm cột `app` + UNIQUE index `(hwid, app)`. **Chọn PK phức hợp `(app, hwid)`** vì D1/SQLite hỗ trợ tốt và tra cứu vẫn là point-lookup.

`user_id` **có cần** — nhưng ở bảng riêng `trial_links`, không phải cột chính:
- Trial → paid conversion cần biết "máy nào đã trial" khi khách đăng ký mua.
- Nhưng bắt buộc đăng ký mới trial là **trái yêu cầu**. Nên: trial chạy được ngay không cần tài khoản; nếu khách muốn xem trạng thái trên web thì tool in ra một `link_code` 8 ký tự, khách nhập vào `/#/link` sau khi đăng nhập → tạo `trial_links(hwid, user_id)`. Tự nguyện, không bắt buộc.

### A5. Trạng thái trial — cần những state nào?

**5 state là đủ:**

| State | Ý nghĩa | Chuyển từ |
|---|---|---|
| `active` | Đang trong 3 ngày | (khởi tạo) |
| `expired` | Hết hạn tự nhiên | `active` khi `now > expires_at` |
| `converted` | Khách đã mua key chính thức | `active` hoặc `expired` |
| `revoked` | Admin thu hồi (gian lận rõ ràng) | bất kỳ |
| `banned` | Máy bị chặn vĩnh viễn, không được trial lại kể cả sản phẩm khác | bất kỳ |

**Không cần** các state sau (dễ sinh bug, không mang thêm thông tin):
- `pending` — trial bắt đầu ngay khi gọi API, không có bước duyệt
- `paused` — không có khái niệm tạm dừng trial
- `abused` — **dùng cờ `suspect = 1` + `suspect_reason` thay vì state**. Lý do: "abused" là *phán đoán*, không phải *trạng thái thời gian*. Nếu để thành state thì mất thông tin "nó vẫn đang active nhưng bị nghi". Cần cả hai chiều.
- `expired_grace` — grace là thuộc tính của phiên offline, không phải state của record.

`status` **phải được cập nhật lười (lazy)** khi có request, không cần cron: cron 10 phút chỉ dùng để ghi `expired` hàng loạt cho dashboard đẹp.

### A6. Có cần bảng audit riêng cho trial?

**Có — `trial_attempts`, và nó khác `lic_events` ở chỗ: ghi cả lần THẤT BẠI.**

| Bảng | Ghi gì | Vì sao không dùng `lic_events` |
|---|---|---|
| `lic_events` | Sự kiện của key **đã tồn tại**: activate / check / rebind / revoke / deny | Có cột `key NOT NULL` — trial không có key bán. Trộn vào sẽ làm hỏng mọi query `GROUP BY key` |
| `trial_attempts` | **Mọi** lần gọi: `start`, `resume`, `check`, `denied_duplicate`, `denied_fp`, `denied_ip`, `denied_vm`, `denied_cap`, `denied_banned`, `denied_sig`, `denied_nonce` | Đây là **dữ liệu tình báo**. `denied_ip` lặp lại 50 lần từ 1 /24 = đang farm. Không có bảng này thì không thấy được tấn công |

Ghi `trial_attempts` là **fire-and-forget** (`try/catch` nuốt lỗi) để không chặn luồng chính — giống `logEvent()` hiện có.
Chi phí: mỗi lần `start`/`deny` = 1 write. `check` hợp lệ thì **chỉ UPDATE `trials`**, không insert attempt (tránh 1 write thừa mỗi lần chạy tool).

---

## B. LUỒNG NGHIỆP VỤ

### B5. Khách mở tool lần đầu (chưa có key) — gọi API gì?

Hiện tại `run()` → `require_license()` → `ensure_licensed()` → `'chua kich hoat'` → mở hộp thoại nhập key. Đó là chỗ chèn trial.

**Luồng mới:**

```
1. GET  /api/trial/challenge        → {ok, nonce, server_time, trial_days, enabled}
2. POST /api/trial/start            → {ok, credential, token, expires_at, ...}
3. POST /api/check (mỗi lần chạy)   → giữ nguyên endpoint, dispatch theo prefix credential
```

**Vì sao cần `/api/trial/challenge`:** nonce dùng-1-lần, TTL 180s, để chặn replay và buộc client phải "đi đúng đường". Nếu không có nonce, một script có thể gọi thẳng `/api/trial/start` với HWID ngẫu nhiên hàng loạt.

**Vì sao dùng lại `/api/check` thay vì `/api/trial/check`:** `ensure_licensed()`, `_grace_left()`, `show_status()` đều đang đọc `st['key']`, `st['expires_at']`, `st['last_ok']`. Thêm endpoint song song buộc phải nhân đôi toàn bộ logic grace/hiển thị → dễ sinh bug. Dispatch theo prefix trong `apiCheck()` chỉ tốn ~10 dòng.

Điều kiện kích hoạt tự động trong `run()`:

```
if opts['key']            → activate như cũ
elif state có credential  → ensure_licensed()
elif /api/trial/start OK  → lưu state, chạy luôn, KHÔNG hỏi key
else                      → mở hộp thoại nhập key (như cũ)
```

### B6. Server cấp gì cho khách?

**Bộ 3 giá trị**, không phải "một key":

| Trường | Ví dụ | Vai trò |
|---|---|---|
| `credential` | `TR-7K2M-9PXQ-4WDA` | Định danh công khai. Hiện trong `--status`, log, hỗ trợ khách. Prefix `TR` để dispatch |
| `token` | 48 hex | **Bí mật**. Bằng chứng sở hữu. Client gửi kèm mỗi lần check |
| `expires_at` | `1794800000` | Hạn tuyệt đối **do server tính**. Client chỉ hiển thị, không quyết định |

**Có cấp `key` kiểu `TRIAL-XXXX` không?** Không nên cấp thứ *trông giống key bán*. Lý do: (a) khách sẽ tưởng là key thật rồi đem đi bán/share; (b) nếu vô tình lọt vào bảng `licenses` thì admin khó phân biệt. Dùng `TR-` + token riêng là rõ ràng nhất.

Trả về thêm (quan trọng cho "thông minh"):
```
grace_hours: 2          (KHÔNG phải 24 — xem C18)
server_time: <unix>
days_total: 3
days_left: 3.0
upgrade_url: https://xienhl.com/#/products?category=license-xarena
link_code: "K7M9PXQ4"   (để khách nối máy với tài khoản nếu muốn)
features: ["viewport","minimap"]   (không có "legacy" — xem D25)
```

### B7. Khách đã có trial và hết hạn, gọi lại thì sao?

**Đây là điểm "thông minh" quan trọng nhất — không được trả lỗi thô.**

`/api/trial/start` khi tìm thấy record:

| Tình trạng record | Phản hồi | Hành vi client |
|---|---|---|
| `active`, còn hạn | `ok:true`, **trả lại đúng credential+token cũ**, `resumed:true`, `days_left` | Chạy luôn. Không hỏi gì |
| `active`, đã quá `expires_at` | `ok:false, code:'trial_expired'`, kèm `expires_at` + `upgrade_url` | Hiện màn hình "Dùng thử đã kết thúc — còn X ngày với gói…", mở hộp thoại nhập key |
| `expired` | Như trên | Như trên |
| `converted` | `ok:false, code:'trial_converted'`, kèm `converted_key` (mask) | "Máy này đã được nâng cấp — nhập key của bạn" |
| `revoked` / `banned` | `ok:false, code:'trial_blocked'` | Thông báo liên hệ hỗ trợ, **không** mở hộp thoại nhập key (vô nghĩa) |

**Nguyên tắc:** trả `200 + ok:false + code` (giống các endpoint hiện có) chứ không phải `4xx`, để client phân nhánh bằng `code`. Trừ khi bị rate-limit thì giữ `429`.

Điểm tinh tế: `resume` phải trả **token cũ**, không sinh token mới. Nếu sinh mới, mỗi lần xoá lic.bin là mỗi lần có token mới → `trial_attempts` đầy rác và không phát hiện được hành vi xoá đi xoá lại (đếm `resume` count là tín hiệu).

### B8. Khách xoá `lic.bin` để reset trial?

**Server nhớ theo HWID → tự chặn, và chặn một cách "dễ chịu":**

```
Xoá lic.bin
  → chạy tool
  → /api/trial/challenge + /api/trial/start
  → server tìm thấy trials(app='xa_nofog', hwid=...)
  → status='active'  → TRẢ LẠI ĐÚNG thời gian còn lại (resumed)
  → status='expired' → báo hết hạn
```

**Trải nghiệm:** khách xoá file sẽ thấy y nguyên thời gian cũ → hiểu ngay "không reset được". Không cần thông báo buộc tội.

Bổ sung: đếm `resumes` trong `trials` (hoặc đếm `trial_attempts WHERE action='resume'`). Nếu `resume_count >= 3` trong 24h mà `status='expired'` → đánh `suspect=1, reason='delete_state_loop'`. Không chặn (có thể do lỗi máy thật), chỉ để admin thấy.

**Lưu ý kỹ thuật:** `lic.bin` được DPAPI mã hoá **per-user**. Nếu khách tạo user Windows mới trên cùng máy → HWID **vẫn giữ nguyên** (MachineGuid/BIOS/CPU/volume là của máy) → trial vẫn bị nhớ. Đây là lý do HWID-based đúng đắn hơn file-based.

### B9. Khách mua key chính thức SAU KHI dùng trial

**Ba việc phải xảy ra tự động, không cần admin:**

```
1. Ghi nhận conversion
   Khi /api/activate bind lần đầu cho key PAID:
     trial = SELECT * FROM trials WHERE app=? AND hwid=? AND status IN ('active','expired')
     if trial and !trial.converted_key:
        UPDATE trials SET status='converted', converted_key=<key>, converted_at=now

2. Cộng dồn ngày còn lại (chỉ khi trial còn hạn)
   bonus = min(trial.expires_at - now, trial.ttl_days*86400)   // ≤ 3 ngày
   if bonus > 0: exp = now + days*86400 + bonus

3. Ghi vào lic_events
   ('convert', 'trial +2.4d -> AOE1-XXXX')
```

**Quy tắc cộng dồn (chống lạm dụng):**
- Chỉ cộng **một lần duy nhất** (`converted_key IS NULL` là điều kiện).
- Chỉ cộng khi trial đang `active` (còn hạn). Trial đã hết hạn thì **không** cộng — nếu cộng thì khách có động cơ chờ hết hạn rồi mua để "ăn" thêm.
- Cộng tối đa `ttl_days * 86400` (3 ngày), không cộng theo `expires_at` nếu record bị sửa tay.
- Chỉ cộng cho key **plan trả tiền** — không cộng khi key là trial/test/`plan='test'`.

**Vì sao cộng dồn là đúng về kinh doanh:** khách dùng trial 2 ngày, ngày thứ 2 mua gói tháng → nhận 30 + 1 (bonus sẵn có) + 1 (trial còn lại) ngày. Cảm giác "không mất gì" → tăng tỉ lệ mua sớm, đúng ý chủ shop "thông minh".

**Giữ `trials` lại vĩnh viễn** là điều kiện để biết máy này đã convert — nếu xoá thì khách đổi máy rồi quay lại có thể "trial lại".

### B10. Trial có bị ảnh hưởng bởi `/api/check` như key thường không?

**Có — dùng chung endpoint, nhưng logic riêng nằm ở 3 chỗ:**

| Vị trí | Xử lý |
|---|---|
| `apiCheck()` đầu hàm | `const isTrial = cred.startsWith('TR-'); if (isTrial) return await trialCheck(env, request, b);` — **return sớm**, không đi vào `judge()` |
| `judge()` | **Không sửa.** Trial không đi qua `judge()` vì `judge` giả định có row trong `licenses`. Sửa `judge` sẽ ảnh hưởng key thật → rủi ro cao |
| `publicLic()` | Tách `publicTrial()` riêng. Trial cần thêm `days_left`, `upgrade_url`, `link_code`, `features`, và **`grace_hours` khác** (2 vs 24) |

**Khác biệt bắt buộc giữa trial và paid trong `/api/check`:**

| Khía cạnh | Key paid | Trial |
|---|---|---|
| Bảng tra | `licenses` | `trials` |
| `expires_at = 0` (vĩnh viễn) | Có thể | **Không bao giờ** |
| `hwid_mismatch` | Từ chối (đã bind máy khác) | Không có khái niệm — HWID là PK, token phải khớp đúng máy |
| Rebind | Có (`/api/rebind`) | **Không có**. Trial không được đổi máy — đổi máy = máy khác = trial khác (đã bị chặn ở start) |
| `grace_hours` | 24 | **2** |
| Ghi log mỗi check | `lic_events` mỗi lần | **Không**. Chỉ `UPDATE trials SET check_count+1, last_check_at` |
| Ghi `last_ip` | Có | Có, + gom vào `ip_set` (JSON, tối đa 8) |
| `firstBind` | Có (tính hạn từ lúc bind) | Không — hạn tính từ lúc **start**, kể cả khách không chạy ngày đầu |

**Chi tiết cuối cùng rất quan trọng:** hạn trial tính từ **lúc start API**, không phải "3 ngày sử dụng thực tế". Nếu tính theo giờ chạy thật thì phải lưu `used_seconds` và client phải báo giờ chạy — client báo giờ là dữ liệu không tin được. **Chọn: hạn tuyệt đối từ lúc start.** Ghi rõ trong UI để khách không thắc mắc.

---

## C. CHỐNG LẠM DỤNG

### Bảng tổng hợp 12 vector

| # | Cách tấn công | Khả thi | Thiệt hại | Biện pháp chặn | Tầng |
|---|---|---|---|---|---|
| 11 | **Xoá `lic.bin`** | 🟢 Rất dễ | 0 (bị chặn) | `trials` PK = `(app, hwid)`. Record sống vĩnh viễn. Start lại → trả đúng hạn cũ | Server |
| 12 | **Đổi `MachineGuid`** (1 registry value) | 🟢 Rất dễ | 1 trial/3 ngày | `fp_guid` index + chấm điểm cụm: nếu `fp_bios`+`fp_cpu`+`fp_vol` khớp record cũ → `denied_fp` | Server |
| 13 | **Đổi BIOS serial** (VM) | 🟡 TB | 1 trial | `fp_guid`+`fp_vol`+`fp_cpu` khớp → `denied_fp`. Kèm `vm_flag` → chặn hẳn | Server |
| 14 | **Chạy trên VM / máy ảo** | 🟢 Rất dễ | ∞ (VM snapshot → 1000 trial) | `vm_flag` từ client (CPUID hypervisor bit + BIOS vendor string + MAC OUI). Mặc định **không cho trial trên VM**. `vm_detail` lưu bằng chứng | Server + client |
| 15 | **Đổi ổ cứng khác** | 🟡 TB | 1 trial | `fp_guid`+`fp_bios`+`fp_cpu` khớp → `denied_fp` (volume serial đổi, 3 thành phần kia giữ) | Server |
| 16 | **Nhiều máy thật khác nhau** | 🔴 Khó (tốn tiền) | 1 trial/máy **— CHẤP NHẬN** | Không chặn được về mặt kỹ thuật (máy khác thật thì phải cho trial). Chặn bằng **kinh tế**: giới hạn `trial_max_per_ip` (3/30 ngày) + `trial_max_per_net` (5/24 trong 30 ngày) + giá gói tuần 70k | Server |
| 17 | **Reset Windows** | 🟡 TB (mất 30–60 phút) | 1 trial | Reset → `MachineGuid` mới + volume serial mới, nhưng `fp_cpu` + `fp_bios` khớp (2/4). Ngưỡng: khớp `fp_bios` → `denied_fp`. Chỉ cần BIOS serial là đủ | Server |
| 18 | **Chặn `hosts`, dùng grace offline** | 🟢 Rất dễ | ∞ nếu grace dài | **grace trial = 2h** (không phải 24h). + Phát hiện `offline_overrun`: lần check sau, nếu `now - last_check_at > grace + 6h` → trừ đúng phần vượt khỏi `expires_at`, ghi `offline_overrun += n`. + Lần vượt thứ 3 → `suspect=1` | Server + client |
| 19 | **Lùi đồng hồ hệ thống** | 🟢 Rất dễ (kéo ngày/giờ) | ∞ nếu grace dựa vào giờ máy | (a) **Gọi `_time_state()`** — hiện là dead code. (b) Thêm mốc `GetTickCount64` + `boot_id`: `if wall_now < last_wall - 600 → deny`; `if uptime_now < last_uptime → đã reboot` → yêu cầu `wall_delta ≥ uptime_delta - skew`. (c) Client gửi `client_time` + `uptime` lên, server so với `last_client_time` của chính record → báo giờ lùi = `denied_clock`. (d) **Hạn tuyệt đối do server** → lùi đồng hồ không làm tăng hạn, chỉ làm grace kéo dài → giới hạn ở 2h | Client + server |
| 20 | **Copy `lic.bin` + registry sang máy khác** | 🔴 Khó | 0 (đã chặn) | DPAPI (`CryptProtectData` pot per-user+per-machine) → giải mã fail trên máy khác. + HWID bind. + Trial token phải khớp HWID. **Baseline hiện tại đã đúng** | Client + server |
| 21 | **Gọi thẳng API (Postman) với HWID giả** | 🟢 Rất dễ (hiện tại) | ∞ | (a) **Nonce 1 lần** (`/api/trial/challenge`, TTL 180s), (b) **HMAC-SHA256** trên `nonce\|guid\|cpu\|bios\|vol\|app` bằng khoá nhúng, (c) **server tự tính HWID** từ raw parts → không cho client khai hwid, (d) kiểm tra hợp lệ của raw parts (BIOS serial không được là `Default string`, `To be filled by O.E.M.`, rỗng, toàn số 0), (e) giới hạn theo IP | Server + client |
| 22 | **VPN / proxy đổi IP** | 🟢 Rất dễ | 1 trial/IP | **Không block cứng** (giết khách thật dùng 4G/CGNAT). Chấm điểm: `cf.asOrganization`/`cf.asn` thuộc danh sách datacenter → trọng số cao hơn; `country_first` khác `country_last` trong < 6h → `suspect` | Server |

### C.1 Ba lớp phòng thủ (defense in depth)

**Lớp 1 — Server là nguồn sự thật duy nhất.** Mọi con số thời gian do server tính. Client chỉ hiển thị. Đây là lý do trial sống trong D1, không phải trong file.

**Lớp 2 — Định danh mềm (fuzzy fingerprint).** Đây là phần "thông minh" thực sự: HWID cứng (sha256 4 thành phần) **+** 4 hash thành phần riêng. Cùng một máy đổi 1 thành phần → HWID đổi hoàn toàn, nhưng vector 4 phần vẫn khớp 3/4 → phát hiện.

Thuật toán chấm điểm (chạy ở `/api/trial/start`, chỉ khi HWID chưa có record):

```
score = 0
score += 4  nếu tồn tại trial có fp_bios == fp_bios_mới      // BIOS serial: bền nhất, đổi khó nhất
score += 2  nếu tồn tại trial có fp_guid == fp_guid_mới      // MachineGuid: đổi được bằng 1 reg key
score += 2  nếu tồn tại trial có fp_vol  == fp_vol_mới       // volume serial: đổi khi format
score += 1  nếu tồn tại trial có fp_cpu  == fp_cpu_mới       // CPU brand: RẤT phổ biến, trọng số thấp

if score >= 4  → denied_fp  (suspect_reason ghi rõ thành phần nào khớp)
if score == 2 hoặc 3 → CHO QUA nhưng suspect=1  (tránh false positive)
if score <= 1 → cho qua bình thường
```

**Tại sao trọng số như vậy:**
- `fp_cpu` = 1: hàng nghìn máy cùng `Intel(R) Core(TM) i5-10400F` → không được dùng để kết luận.
- `fp_bios` = 4: BIOS serial gần như duy nhất theo mainboard. Nhưng **cảnh báo**: máy clone/ghost image từ cùng một lô có thể trùng BIOS serial → đây là tín hiệu tốt để chặn farm, nhưng cũng có thể là false positive với quán net mua 20 máy cùng lô. **Xử lý: nếu `score>=4` do `fp_bios` và `fp_guid` khác → cho qua + suspect (quán net). Nếu `fp_bios` VÀ `fp_guid` đều khớp → denied (đổi volume/CPU).**
- Bổ sung bẫy VM: nếu một `fp_bios` xuất hiện với **> 5 HWID khác nhau trong 30 ngày** → chặn toàn bộ cụm (VM template / ghost). Đây là bẫy mạnh nhất, chi phí query 1 index.

**Lớp 3 — Kinh tế học.** Không cố chặn 100% (bất khả thi về mặt kỹ thuật, vì "máy thật khác nhau" thì phải cho trial). Thay vào đó làm cho việc farm **đắt hơn mua**:

| Giới hạn | Giá trị mặc định | Cấu hình ở đâu |
|---|---|---|
| `trial_days` | 3 | `settings` |
| `trial_max_per_ip` | 3 / 30 ngày | `settings` |
| `trial_max_per_net24` | 5 / 30 ngày (IPv4 /24, IPv6 /64) | `settings` |
| `trial_max_per_day` (toàn hệ thống) | 200 | `settings` |
| `trial_allow_vm` | 0 | `settings` |
| `trial_grace_hours` | 2 | hằng số code |
| `trial_start_per_ip_hour` | 5 | rate limit |

Với giá gói tuần 70.000đ, việc dựng VM + đổi BIOS serial + VPN mỗi 3 ngày **đắt hơn 70k** → kinh tế tự cân bằng.

### C.2 Phân tích riêng: vector 18 (hosts file) — vector nguy hiểm nhất

Đây là vector thực tế nhất vì **không cần kỹ thuật**: mở `C:\Windows\System32\drivers\etc\hosts`, thêm `0.0.0.0 xienhl.com`, xong.

Hiện tại phòng thủ duy nhất là grace 24h → **24h/72h = 33% trial miễn phí vĩnh viễn** nếu khách chặn hosts ngay từ đầu (chỉ cần check online 1 lần đầu, rồi chặn → grace 24h → hết → tool không chạy).

Chuỗi phòng thủ đề xuất:

| Bước | Cơ chế | Hiệu quả |
|---|---|---|
| 1 | `grace_hours = 2` cho trial | Trần offline = 2h. Chặn hosts chỉ mua được 2h |
| 2 | `_time_state()` phải được gọi (hiện dead code) | Không lùi đồng hồ để kéo dài grace |
| 3 | Server phát hiện khoảng trống: lần check sau, `gap = now - last_check_at`; nếu `gap > grace + 6h` thì `offline_overrun += (gap - grace)`, và `expires_at -= min(overrun, 3d)` | Khách chặn hosts 2 ngày rồi bỏ chặn → mất 2 ngày trial, không lợi gì |
| 4 | Client: hết grace thì **thoát với mã `EXIT_NO_LICENSE`**, không xoá state | Bỏ chặn hosts → chạy lại bình thường với thời gian đã bị trừ |
| 5 | Thông điệp rõ: "Cần internet 1 lần mỗi 2 giờ. Kiểm tra kết nối." | Giảm ticket hỗ trợ |

> **Đánh đổi phải nêu với chủ shop:** grace 2h sẽ làm khách dùng wifi chập chờn khó chịu hơn. Đề xuất: **2h cho trial, giữ 24h cho key trả tiền**. Khách trả tiền xứng đáng được ưu ái hơn — và đây cũng là động lực mua.

### C.3 Phân tích riêng: vector 21 (gọi API trực tiếp) — vector phải vá TRƯỚC

Hiện tại `POST /api/activate` tin tưởng tuyệt đối `hwid` từ body. Không có gì ngăn:
```bash
for i in $(seq 1 1000); do
  curl -s -X POST https://xienhl.com/api/trial/start \
    -H 'content-type: application/json' \
    -d "{\"hwid\":\"fake$i\",\"app\":\"xarena\"}"
done
```

Thiết kế chặn (theo thứ tự tăng dần chi phí tấn công):

| Lớp | Cơ chế | Chặn được | Không chặn được |
|---|---|---|---|
| L1 | Nonce 1 lần từ `/api/trial/challenge` (TTL 180s, xoá khi dùng) | Script ngây thơ gọi thẳng endpoint | Script biết gọi 2 bước |
| L2 | HMAC-SHA256(khoá nhúng, `nonce\|guid\|cpu\|bios\|vol\|app`) | Postman, sửa body bằng tay, curl đơn giản | Người dịch ngược EXE lấy khoá |
| L3 | **Server tự tính HWID** từ raw parts | Mọi trường hợp "HWID giả" — vì HWID không do client cung cấp nữa | (chỉ cần raw parts giả) |
| L4 | **Kiểm tra hợp lệ raw parts**: BIOS serial không rỗng / không placeholder; `guid` phải đúng format UUID 36 ký tự; `cpu` phải chứa "Intel"/"AMD"/"ARM"; `vol` phải đúng 8 hex | Farm hàng loạt bằng giá trị rác | Người nhập giá trị trông-hợp-lệ |
| L5 | Giới hạn IP/nhóm mạng/ngày | Farm từ 1 máy | Farm phân tán |

**L3 là thay đổi quan trọng nhất về kiến trúc:** đổi `POST /api/trial/start` để nhận `fp:{guid,cpu,bios,vol}` thay vì `hwid`, server tự băm. Lợi ích phụ: server có raw parts → **tự phát hiện VM** (BIOS vendor chứa "VMware"/"VirtualBox"/"QEMU"/"innotek"/"Xen"), tự phát hiện placeholder, và lưu `fp_*` hash để fuzzy match.

**Riêng tư:** không lưu raw. Server lưu `fp_guid = SHA256(HWID_SALT + guid)` — vẫn fuzzy match được, không giữ dữ liệu phần cứng thô.

**Giới hạn phải nói thẳng:** `--onefile` PyInstaller → khoá HMAC nằm trong EXE, người có kỹ năng trích được. Vì vậy **không được coi HMAC là hàng rào chính** — nó chỉ nâng chi phí từ "5 phút curl" lên "2 giờ dịch ngược". Hàng rào chính là L5 (giới hạn) + L3/L4 (server tính hwid) + giá rẻ.

### C.4 Ma trận: vector × tầng chặn

| Vector | Client | Server | Kinh tế | Tổng |
|---|---|---|---|---|
| 11 xoá lic.bin | — | ✅ PK=hwid | — | **Chặn được** |
| 12 đổi MachineGuid | gửi `fp` | ✅ `fp_guid`+score | — | **Chặn được** |
| 13 đổi BIOS serial | gửi `fp` | ✅ `fp_*`+score | — | **Chặn được** |
| 14 VM | ✅ `vm_flag` | ✅ `trial_allow_vm=0` | — | **Chặn được** |
| 15 đổi ổ cứng | gửi `fp` | ✅ `fp_bios`+`fp_guid` | — | **Chặn được** |
| 16 nhiều máy thật | — | ⚠️ chỉ giới hạn IP | ✅ giá 70k/tuần | **Giảm thiểu** |
| 17 reset Windows | gửi `fp` | ✅ `fp_bios` khớp | — | **Chặn được** |
| 18 chặn hosts | ✅ grace 2h | ✅ overrun penalty | — | **Giảm thiểu tốt** |
| 19 lùi đồng hồ | ✅ `_time_state()`+uptime | ✅ server-authoritative | — | **Chặn được** |
| 20 copy state | ✅ DPAPI | ✅ token↔hwid | — | **Chặn được** |
| 21 Postman | ✅ HMAC | ✅ nonce+L3+L4+L5 | — | **Chặn được (cấp độ thực tế)** |
| 22 VPN | — | ⚠️ scoring, không block | ✅ giới hạn | **Giảm thiểu** |

**Đánh giá thẳng thắn:** 8/12 chặn được, 4/12 chỉ giảm thiểu. Với mô hình "trial không cần tài khoản", đây là **trần kỹ thuật**. Nếu chủ shop muốn chặn cả 4 vector còn lại thì bắt buộc phải thêm yếu tố danh tính (SĐT/Gmail/OTP) — nhưng như vậy là trái yêu cầu "không cần đăng ký".

---

## D. TÍNH NĂNG THÔNG MINH

### D23. Làm trial "thông minh"

| # | Tính năng | Thiết kế | Tác động |
|---|---|---|---|
| 1 | **Nhắc trước khi hết hạn** | Server trả `days_left` mỗi check. Client in banner khi `days_left <= 1`: "⏳ Còn 1 ngày dùng thử. Gói Tháng 180.000đ — dùng tiếp không gián đoạn." | Tăng conversion ở đúng thời điểm quyết định |
| 2 | **Nhắc 3 mốc, không spam** | In khi bắt đầu (ngày 0), khi `days_left < 1`, và khi vừa hết hạn. Không in mỗi 2 giây | Không gây khó chịu |
| 3 | **Gợi ý gói phù hợp** | Server trả `recommend: {plan:'thang', price:180000, reason:'tiết kiệm 40% so với gói tuần'}`. Logic: nếu `check_count >= 5` (dùng nhiều) → gợi ý Tháng/Năm; nếu `check_count <= 2` → gợi ý Tuần (rào cản thấp) | Tăng tỉ lệ chuyển đổi |
| 4 | **Cộng dồn khi mua trong hạn** | Xem B9: cộng `min(trial_remaining, 3d)` vào key mới. Client hiện: "✅ Đã cộng 1.8 ngày dùng thử còn lại vào key của bạn" | Loại bỏ lý do "chờ hết hạn rồi mua" |
| 5 | **`link_code` nối máy ↔ tài khoản** | Khi start, server sinh `link_code` 8 ký tự (`K7M9PXQ4`). Tool in: "Nhập mã K7M9PXQ4 tại xienhl.com/#/link để xem hạn và nhận ưu đãi." Khách đăng nhập web, nhập mã → `trial_links(hwid, user_id)` | Có danh tính mà **không bắt buộc**. Khi khách mua, web đã biết máy nào đang trial → tự cộng ngày, tự hiện "nâng cấp" |
| 6 | **Khôi phục mượt** | Start lại trên máy đã trial → trả lại đúng hạn cũ + "Chào mừng trở lại, còn 1.8 ngày" | Cảm giác "hệ thống nhớ mình", không phải "bị chặn" |
| 7 | **Watermark rõ ràng** | Đặt console title: `XA NoFog [DÙNG THỬ - 2.4 ngày]`. Không giới hạn chức năng chính | Khách luôn biết mình đang trial → mua trước khi hết |
| 8 | **Mã lỗi thân thiện** | `trial_expired` → "Bản dùng thử 3 ngày của máy này đã kết thúc ngày 07/11. Gói Tuần 70.000đ." thay vì "Mã không tồn tại" | Giảm bỏ cuộc |
| 9 | **Telegram/Zalo 1 click** | Sau khi hết hạn, in link hỗ trợ | Cứu khách đang do dự |

**Điều KHÔNG nên làm (phản tác dụng):**
- ❌ Giới hạn số lần chạy tool trong trial (bóp nghẹt trải nghiệm → khách không thấy giá trị)
- ❌ Chặn tính năng chính (no-fog là toàn bộ giá trị sản phẩm)
- ❌ Hiện popup quảng cáo mỗi lần chạy

### D24. Giới hạn số lần chạy song song?

**Có, nhưng chỉ 1 — và đã có sẵn.**

`acquire_mutex()` với `Global\XArenaNoFogPro` đã chặn 2 instance trên cùng máy. Không cần thêm.

**Có nên giới hạn theo "số phiên/ngày"?** Không. Lý do: tool là chương trình thường trú chạy nền — đếm "số lần chạy" sẽ phạt khách mở/tắt máy nhiều lần, trong khi kẻ gian chỉ cần bật 1 lần rồi để đó. **Đếm phiên là chỉ phạt người dùng thật.**

**Cái nên thêm:** đếm `check_count` **chỉ để chấm điểm thông minh** (gợi ý gói), không để chặn. Ngưỡng: nếu `check_count > 50/ngày` → `suspect=1` (dấu hiệu script tự động, không phải người).

**Chống nhiều máy cùng lúc với cùng token:** trial token gắn với HWID, nên 2 máy dùng chung token → máy thứ 2 có hwid khác → token tra ra record có hwid khác → từ chối `signal_reset`. Đã chặn ở thiết kế.

### D25. Giới hạn theo chức năng?

Đây là câu hỏi cân nhắc kỹ về **kinh doanh**, không chỉ kỹ thuật.

| Phương án | Ưu | Nhược | Khuyến nghị |
|---|---|---|---|
| **A. Trial full 100%** | Khách thấy đúng giá trị → conversion cao nhất | Không có lý do nâng cấp ngoài thời gian | ❌ |
| **B. Trial chỉ cổng cơ bản** (viewport + minimap = `BASE`, không có `--full` legacy) | Vẫn thấy giá trị cốt lõi (full map, bỏ fog); có lý do nâng cấp (7 cổng legacy: F I J K L O T2); cấu trúc code **đã sẵn sàng** (`pick_sites()` chia `DEFAULT` vs `BASE+LEGACY`) | Khách hardcore có thể thấy thiếu | ✅ **CHỌN** |
| **C. Trial giới hạn giờ/ngày** | Chống lạm dụng tốt | Phá trải nghiệm; tool thường trú không hợp mô hình "giờ" | ❌ |

**Thiết kế B, cụ thể:**
- Server trả `features: ["viewport","minimap"]` cho trial, `["viewport","minimap","legacy"]` cho paid.
- Client: `pick_sites()` nhận thêm tham số `entitled`. Nếu `opts['full']` mà không có quyền `legacy` → in "🔒 Cổng legacy (F I J K L O T2) chỉ có ở bản trả phí." và chạy `BASE`.
- **Tuyệt đối không để client tự quyết**: server trả `features`, client chỉ đọc. Nếu client bị vá để bỏ kiểm tra → chỉ ảnh hưởng máy đó, và không làm lộ dữ liệu gì.

Lưu ý: đây là rào cản **mềm** (client-side enforcement, có thể vá). Nhưng nó đủ để khách trung thực thấy "cần mua để mở khoá", mà không cần server chặn từng byte.

---

## E. TƯƠNG TÁC VỚI HỆ THỐNG HIỆN CÓ

### E26. Dùng chung bảng `licenses` hay tách bảng riêng?

**KHÔNG dùng chung bảng `licenses`. Tách bảng riêng.** Đây là kết luận quan trọng nhất của mục E.

Phân tích "dùng chung với prefix TRIAL-xxxx":

| Vấn đề | Chi tiết | Mức độ |
|---|---|---|
| **Làm hỏng stats admin** | `licenseStats()` đếm `SELECT COUNT(*) FROM licenses` → "Tổng license", "Đang hoạt động", "Chưa kích hoạt". Hàng nghìn trial sẽ làm sai toàn bộ số liệu kinh doanh | 🔴 Nghiêm trọng |
| **Làm hỏng dashboard license** | `adminLicenses()` là `SELECT * FROM licenses ORDER BY created_at DESC LIMIT 300` → 300 dòng toàn trial, license thật bị đẩy ra khỏi trang 1 | 🔴 Nghiêm trọng |
| **Làm hỏng `/api/licenses/mine`** | `myLicenses()` JOIN `license_issues` — trial không có trong `license_issues` nên sẽ hiện `status:'unknown'`. | 🟡 TB |
| **`judge()` sai ngữ nghĩa** | `judge()` coi `expires_at=0` là vĩnh viễn. Trial không được có trường hợp đó. Phải thêm nhánh — tức là sửa hàm dùng chung cho key trả tiền | 🟡 Rủi ro regression |
| **Xung đột rebind** | `licenses` có `max_rebind/rebinds` và `/api/rebind` công khai. Trial không được rebind → phải thêm nhánh từ chối | 🟡 |
| **Xung đột hạn** | `bindFirstTime()` tính `days = (expires_at - created_at)/86400`. Trial không đi qua bind → không dùng được hàm này | 🟡 |
| **Bảng `licenses` là dữ liệu TIỀN** | Mỗi dòng = một giao dịch. Trộn trial vào làm mất tính chất "sổ cái" của bảng | 🔴 |
| **Khối lượng** | Trial có thể 10–100× số license thật. Trộn → mọi query `licenses` chậm dần | 🔴 |

**Ưu điểm duy nhất của dùng chung:** tái sử dụng `/api/activate` + `/api/check` không cần dispatch. → Nhưng dispatch bằng prefix chỉ ~10 dòng code. **Không đáng đổi.**

**Kết luận:** tách bảng. Client vẫn dùng chung endpoint (dispatch theo prefix), nhưng dữ liệu tách tuyệt đối.

### E27. Nếu tách bảng, phân biệt trial vs paid thế nào? Ảnh hưởng endpoint admin nào?

Phân biệt ở 3 tầng:

| Tầng | Cách phân biệt | Ai dùng |
|---|---|---|
| **Credential** | Trial: `TR-XXXX-XXXX-XXXX`. Paid: `AOE1-XXXX-XXXX-XXXX` (hoặc prefix sản phẩm) | `apiCheck()` dispatch |
| **Bảng** | `trials` vs `licenses` | Toàn bộ backend |
| **Token** | Trial có `token_hash` bắt buộc. Paid không có token | `trialCheck()` |

**Endpoint admin bị ảnh hưởng (phải kiểm tra nhưng KHÔNG cần sửa):**

| Endpoint | Ảnh hưởng | Cần sửa? |
|---|---|---|
| `GET /api/admin/licenses` | Không — `SELECT * FROM licenses` không chứa trial | ❌ |
| `GET /api/admin/dashboard` | Không | ❌ |
| `POST /api/admin/licenses/:key/:action` | Không | ❌ |
| `GET /api/licenses/mine` | Không (trial không có `license_issues`) | ❌ |
| `POST /api/licenses/:key/rebind` | Không | ❌ |
| `GET /i/<KEY>` (installer) | `requireUsableLicense()` kiểm tra regex `^[A-Z0-9-]{6,64}$` → `TR-XXXX-XXXX-XXXX` **khớp regex**. Nếu ai đó dùng `/i/TR-...` → `readLicense()` trả `null` → 404 "Mã license không hợp lệ". **An toàn** | ❌ |

**Cần THÊM endpoint admin mới:** `GET /api/admin/trials`, `POST /api/admin/trials/:hwid/:action`, `GET /api/admin/trials/stats`.

### E28. Trang `/#/licenses` có hiển thị trial không?

**Vấn đề:** `/#/licenses` gọi `/api/licenses/mine` → JOIN `license_issues` theo `user_id`. Trial **không có user_id** (không cần đăng ký). → Về mặt kỹ thuật, trial **không thể** hiện ở đó trừ khi khách tự link.

**Thiết kế (3 tầng, tăng dần mức độ cam kết):**

| Tầng | Khách phải làm gì | Hiển thị gì |
|---|---|---|
| **T0 — Không đăng nhập** | Không gì | Trang `/#/licenses` redirect login. **Không hiện trial.** Trial hiện trong tool (`--status`) và trong banner của tool |
| **T1 — Đã link bằng code** | Đăng nhập + nhập `link_code` (từ tool) tại `/#/link` | Hiện **card trial riêng**, phía trên danh sách license mua: <br>`🎁 Bản dùng thử — còn 1.8 ngày` <br>`Máy: 7K2M…4WDA (đã liên kết)` <br>`[Nâng cấp ngay → ]` |
| **T2 — Đã mua** | Tự động khi key paid được bind trên hwid có trial | Trial card chuyển thành `✅ Đã nâng cấp ngày 08/11` (dạng thông báo, không phải card license) |

**Quy tắc UI quan trọng:**
- Trial card **không** hiện nút "🔑 Sao chép key" (vì không có key thật).
- Trial card **không** hiện nút "🔄 Đổi máy" (trial không rebind).
- Trial card **không** hiện trong block `data.licenses` — dùng trường riêng `data.trial` để `licenses.js` không phải xử lý `if (l.isTrial)` rải rác.
- Nếu trial đã hết hạn: card màu vàng "Bản dùng thử đã kết thúc — mua gói Tuần để tiếp tục".

Đổi ở `src/routes/license.js::myLicenses()`: thêm 1 query `SELECT ... FROM trials WHERE linked_user_id = ?` và trả `{licenses, trial, available}`.
Đổi ở `public/assets/pages/licenses.js`: thêm block render trial phía trên (khoảng 25 dòng).

### E29. Admin dashboard có cần thống kê trial→paid conversion rate?

**Rất cần — đây là chỉ số duy nhất cho biết trial có hiệu quả hay không.**

Bộ chỉ số đề xuất (thêm tab "🎁 Trial" trong admin):

| Nhóm | Chỉ số | Công thức |
|---|---|---|
| **Khối lượng** | Trial hôm nay | `COUNT(*) WHERE started_at >= today` |
| | Trial đang chạy | `WHERE status='active' AND expires_at > now` |
| | Tổng trial (vĩnh viễn) | `COUNT(*)` |
| **Chuyển đổi** | Đã nâng cấp | `WHERE status='converted'` |
| | **Conversion rate** | `converted / (converted + expired)` ⚠️ **không** chia cho tổng (trial đang active chưa có kết luận) |
| | Doanh thu từ trial | `SUM(orders.total)` của user trong `trial_links` có `converted_at` |
| | Doanh thu / trial | `revenue / COUNT(trials)` |
| **Thời điểm** | TB ngày trial → mua | `AVG(converted_at - started_at)` |
| | Còn hạn khi mua | `% converted WHERE converted_at < expires_at` |
| **Chống lạm dụng** | Bị từ chối do trùng máy | `COUNT(trial_attempts WHERE action='denied_fp')` |
| | Bị từ chối do IP | `action='denied_ip'` |
| | **% trial bị suspect** | `COUNT(trials WHERE suspect=1) / COUNT(*)` |
| | Máy bị chặn | `COUNT(banned_devices)` |
| **Cảnh báo** | BIOS serial dùng cho >5 máy | `GROUP BY fp_bios HAVING COUNT(DISTINCT hwid) > 5` |

**Ngưỡng sức khoẻ (để chủ shop đọc được ngay):**
- `conversion_rate < 3%` → trial không hiệu quả, xem lại giá/nhắc nhở
- `conversion_rate > 15%` → rất tốt
- `suspect_rate > 20%` → đang bị farm, siết giới hạn IP
- `denied_fp / total_start > 10%` → nhiều người đổi HWID → tăng cường fuzzy

---

## F. TRIỂN KHAI

### F30. PSEUDOCODE các endpoint mới

#### F30.1 `GET /api/trial/challenge`

```
FUNCTION apiTrialChallenge(env, request):
    ip = cf-connecting-ip
    IF NOT rateOk(env, ip) THEN RETURN 429 {ok:false, code:'rate_limit'}

    cfg = loadTrialConfig(env)                // cache KV 60s
    IF NOT cfg.enabled THEN RETURN {ok:false, code:'trial_disabled'}

    nonce = randomHex(16)
    KV.put('tn:'+nonce, '1', {expirationTtl: 180})

    RETURN {
      ok: true,
      nonce,
      server_time: nowSec(),
      app: APP_ID,                             // 'xa_nofog'
      trial_days: cfg.days,
      client_min_version: cfg.min_client_ver   // để ép cập nhật
    }
```

#### F30.2 `POST /api/trial/start`

```
FUNCTION apiTrialStart(env, request):
    ip, ua, country, asn = fromCf(request)
    b = readBody(request)
    IF NOT b THEN RETURN 400 bad_request

    // ---------- 1. Xác thực nguồn gốc ----------
    nonce = str(b.nonce)
    IF NOT KV.get('tn:'+nonce) THEN RETURN 403 {code:'bad_nonce'}
    KV.delete('tn:'+nonce)                     // dùng 1 lần, xoá NGAY (chống replay)

    fp = b.fp || {}
    guid = str(fp.guid).trim(); cpu = str(fp.cpu).trim()
    bios = str(fp.bios).trim(); vol = str(fp.vol).trim()
    sig  = str(b.sig)

    want = hmacSha256(TRIAL_HMAC_KEY, nonce+'|'+guid+'|'+cpu+'|'+bios+'|'+vol+'|'+APP_ID)
    IF NOT timingSafeEqual(sig, want) THEN
        logAttempt(hwid='', ip, 'denied_sig', 'bad hmac')
        RETURN 403 {ok:false, code:'bad_signature'}

    // ---------- 2. Kiểm tra hợp lệ giá trị thô (L4) ----------
    IF NOT isValidGuid(guid) THEN RETURN 400 bad_fp 'guid'
    IF NOT isValidCpu(cpu)   THEN RETURN 400 bad_fp 'cpu'
    IF isPlaceholderBios(bios) THEN RETURN 400 bad_fp 'bios'
    IF NOT isValidVol(vol)   THEN RETURN 400 bad_fp 'vol'

    // ---------- 3. Server TỰ tính HWID (L3) ----------
    hwid = sha256hex(guid+'|'+bios+'|'+cpu+'|'+vol)[0:32]
    fp_guid = sha256hex(HWID_SALT + guid)
    fp_cpu  = sha256hex(HWID_SALT + cpu)
    fp_bios = sha256hex(HWID_SALT + bios)
    fp_vol  = sha256hex(HWID_SALT + vol)

    // ---------- 4. Phát hiện VM (server-side, không tin client) ----------
    vm = detectVm(bios, cpu, fp)   // VMware|VBox|QEMU|innotek|Xen|Microsoft Hv|BOCHS

    // ---------- 5. Giới hạn tần suất ----------
    IF NOT rateLimitKV(env, 'tstart:'+ip, cfg.start_per_ip_hour, 3600) THEN
        logAttempt(hwid, ip, 'denied_rate'); RETURN 429 rate_limit

    // ---------- 6. Ban list ----------
    IF EXISTS banned_devices WHERE hwid=hwid THEN
        logAttempt(hwid, ip, 'denied_banned')
        RETURN 403 {ok:false, code:'trial_blocked'}

    // ---------- 7. Đã có trial chưa? ----------
    t = SELECT * FROM trials WHERE app=APP_ID AND hwid=?
    IF t THEN
        SWITCH t.status:
          'banned'   -> RETURN 403 {code:'trial_blocked'}
          'revoked'  -> RETURN 403 {code:'trial_blocked'}
          'converted'-> RETURN 200 {ok:false, code:'trial_converted',
                                   converted_key: maskKey(t.converted_key),
                                   upgrade_url: cfg.upgrade_url}
        IF now > t.expires_at THEN
            UPDATE trials SET status='expired' WHERE hwid=?
            logAttempt(hwid, ip, 'expired_hit')
            RETURN 200 {ok:false, code:'trial_expired',
                        expires_at: t.expires_at,
                        upgrade_url: cfg.upgrade_url,
                        days_used: round((t.expires_at - t.started_at)/86400,1)}
        // còn hạn -> RESUME, trả đúng token cũ
        UPDATE trials SET check_count=check_count+1, last_check_at=now,
                          ip_last=?, ip_set=appendIp(t.ip_set, ip)
        WHERE app=APP_ID AND hwid=?
        logAttempt(hwid, ip, 'resume')
        RETURN 200 {ok:true, resumed:true, credential:t.credential_public,
                    token:NULL,               // KHÔNG trả token lại — xem ghi chú
                    expires_at:t.expires_at, days_left:..., grace_hours:2,
                    features:['viewport','minimap'], upgrade_url, link_code:t.link_code,
                    server_time:now}
        // GHI CHÚ: nếu client mất token thì không resume được.
        //         Giải pháp: resume trả token MỚI (xoá token cũ, ghi token_hash mới).
        //         Chọn: trả token mới -> an toàn hơn, và đếm được số lần resume.

    // ---------- 8. Sàng lọc lạm dụng cho máy MỚI ----------
    IF vm AND NOT cfg.allow_vm THEN
        logAttempt(hwid, ip, 'denied_vm', vm_kind)
        RETURN 200 {ok:false, code:'trial_vm_blocked', reason:'virtual_machine'}

    // 8a. Cụm BIOS serial (bẫy VM template / ghost image)
    n_bios = COUNT(DISTINCT hwid) FROM trials WHERE app=? AND fp_bios=? AND started_at > now-180d
    IF n_bios >= cfg.max_hwid_per_bios THEN
        logAttempt(hwid, ip, 'denied_cluster', 'bios reused x'+n_bios)
        RETURN 200 {ok:false, code:'trial_denied', reason:'device_cluster'}

    // 8b. Chấm điểm fuzzy
    score = 0
    score += 4 IF EXISTS(trials WHERE app=? AND fp_bios=?)
    score += 2 IF EXISTS(trials WHERE app=? AND fp_guid=?)
    score += 2 IF EXISTS(trials WHERE app=? AND fp_vol =?)
    score += 1 IF EXISTS(trials WHERE app=? AND fp_cpu =?)
    hard = (score >= 4 AND EXISTS(fp_bios match) AND EXISTS(fp_guid match))
    soft = (score >= 2)
    IF hard THEN
        logAttempt(hwid, ip, 'denied_fp', 'score='+score)
        RETURN 200 {ok:false, code:'trial_denied', reason:'same_device',
                    support:'Nếu bạn đã đổi linh kiện, liên hệ hỗ trợ.'}

    // 8c. IP / nhóm mạng
    n_ip  = COUNT(*) FROM trials WHERE ip_first=? AND started_at > now-30d
    IF n_ip >= cfg.max_per_ip THEN
        logAttempt(hwid, ip, 'denied_ip', 'ip='+ip)
        RETURN 200 {ok:false, code:'trial_denied', reason:'network_limit'}

    net = ipv4Net24(ip) or ipv6Net64(ip)
    n_net = COUNT(*) FROM trials WHERE ip_net=? AND started_at > now-30d
    IF n_net >= cfg.max_per_net THEN
        logAttempt(hwid, ip, 'denied_net'); RETURN {...reason:'network_limit'}

    // 8d. Trần toàn hệ thống
    n_today = COUNT(*) FROM trials WHERE started_at > startOfDay(now)
    IF n_today >= cfg.max_per_day THEN
        logAttempt(hwid, ip, 'denied_cap')
        RETURN 200 {ok:false, code:'trial_unavailable', 'Hết lượt hôm nay'}

    // ---------- 9. Tạo trial ----------
    token = randomHex(24)
    cpu_public = 'TR-' + shortId(4) + '-' + shortId(4) + '-' + shortId(4)
    link_code  = shortId(8)
    INSERT INTO trials (
      app, hwid, credential_public, token_hash, status, plan, ttl_days,
      started_at, expires_at,
      fp_guid, fp_cpu, fp_bios, fp_vol, fp_json,
      ip_first, ip_net, ip_last, ip_set, ua_first, country_first, asn_first,
      vm_flag, vm_detail, suspect, suspect_reason,
      check_count, last_check_at, link_code, created_at)
    VALUES (APP_ID, hwid, cpu_public, sha256hex(token), 'active', 'trial', cfg.days,
            now, now + cfg.days*86400,
            fp_guid, fp_cpu, fp_bios, fp_vol, json(fp),
            ip, net, ip, json([ip]), ua, country, asn,
            vm?1:0, vm_detail, soft?1:0, soft?'fp_score_'+score:NULL,
            0, now, link_code, now)

    logAttempt(hwid, ip, 'start', 'days='+cfg.days+' vm='+vm)
    RETURN 200 {ok:true, resumed:false,
                credential: cpu_public, token,
                expires_at: now + cfg.days*86400, days_total: cfg.days, days_left: cfg.days,
                grace_hours: 2, plan:'trial', app: APP_ID,
                features: ['viewport','minimap'],
                upgrade_url: cfg.upgrade_url, link_code,
                server_time: now,
                recommend: pickRecommend(cfg)}
```

#### F30.3 `POST /api/check` — nhánh trial

```
FUNCTION apiCheck(env, request):
    ... (validate key/hwid/rate như hiện tại) ...
    cred = normKey(b.key)
    IF cred.startsWith('TR-') THEN
        RETURN await trialCheck(env, request, b, ip)
    ... (đường cũ cho key paid) ...
```

```
FUNCTION trialCheck(env, request, b, ip):
    cred = normKey(b.key)
    token = str(b.token)
    // client KHÔNG gửi hwid nữa — token đã định danh máy
    IF NOT token THEN RETURN 200 {ok:false, code:'need_token'}

    t = SELECT * FROM trials WHERE app=? AND credential_public=? LIMIT 1
    IF NOT t THEN RETURN 200 {ok:false, code:'trial_not_found'}
    IF NOT timingSafeEqual(sha256hex(token), t.token_hash)
        THEN logAttempt(t.hwid, ip, 'denied_token')
             RETURN 200 {ok:false, code:'signal_reset'}   // token sai = đã bị thay/bị copy

    SWITCH t.status:
      'banned','revoked' -> RETURN 200 {ok:false, code:'trial_blocked'}
      'converted'        -> RETURN 200 {ok:false, code:'trial_expired', upgrade_url}

    now = nowSec()

    // ---- Phát hiện lùi đồng hồ (client báo) ----
    IF b.client_time AND t.last_client_time AND b.client_time < t.last_client_time - 600 THEN
        UPDATE trials SET suspect=1, suspect_reason='clock_back'
        logAttempt(t.hwid, ip, 'clock_back', t.last_client_time+'->'+b.client_time)
        RETURN 200 {ok:false, code:'clock_tampered'}

    // ---- Hết hạn? ----
    IF now > t.expires_at THEN
        UPDATE trials SET status='expired'
        RETURN 200 {ok:false, code:'trial_expired', expires_at:t.expires_at, upgrade_url}

    // ---- Phạt offline quá mức (vector hosts) ----
    gap = now - (t.last_check_at || t.started_at)
    IF gap > (GRACE_HOURS*3600 + 6*3600) THEN
        overrun = gap - GRACE_HOURS*3600
        new_exp = t.expires_at - MIN(overrun, t.ttl_days*86400)
        UPDATE trials SET expires_at=new_exp, offline_overrun=offline_overrun+overrun,
                          suspect = suspect + (offline_overrun+overrun > 12*3600)
        IF new_exp <= now THEN
            UPDATE trials SET status='expired'
            RETURN 200 {ok:false, code:'trial_expired'}

    // ---- Ghi nhận ----
    UPDATE trials SET check_count = check_count+1,
                      last_check_at = now, last_client_time = b.client_time,
                      ip_last = ip, ip_set = appendIp(ip_set, ip), last_ip_changed_at=...
    WHERE app=? AND hwid=?

    days_left = (t.expires_at - now) / 86400
    RETURN 200 {
      ok: true,
      expires_at: t.expires_at,
      plan: 'trial',
      forever: false,
      grace_hours: 2,
      server_time: now,
      days_left: round(days_left, 2),
      features: ['viewport','minimap'],
      nudge: kind = days_left <= 1 ? 'expiring' : (t.check_count >= 5 ? 'recommend' : null),
      recommend: kind ? {plan:'thang', price:180000, reason:'tiết kiệm 40%'} : null,
      upgrade_url: cfg.upgrade_url,
      link_code: t.link_code
    }
```

#### F30.4 Hook cộng dồn ngày khi mua — sửa `bindFirstTime()`

```
FUNCTION bindFirstTime(env, lic, key, hwid, ip, now):
    days = lic.expires_at > 0 ? round((lic.expires_at - lic.created_at)/86400) : 0

    // ===== MỚI: cộng dồn trial còn lại =====
    bonus = 0
    IF lic.plan NOT IN ('test','trial') THEN
        t = SELECT * FROM trials WHERE app=APP_ID AND hwid=?
        IF t AND NOT t.converted_key AND t.status='active' AND t.expires_at > now THEN
            bonus = MIN(t.expires_at - now, t.ttl_days * 86400)
            UPDATE trials SET status='converted', converted_key=?, converted_at=?
            WHERE app=? AND hwid=? AND converted_key IS NULL     // atomic guard
            IF changes = 1 THEN logEvent(key, hwid, 'convert',
                                        'trial +' + round(bonus/86400,2) + 'd', ip)
        // Ghi nhận cả khi trial đã hết hạn -> vẫn biết máy này đã từng trial
        IF t AND NOT t.converted_key AND t.status='expired' THEN
            UPDATE trials SET status='converted', converted_key=?, converted_at=?
            WHERE app=? AND hwid=? AND converted_key IS NULL

    exp = days === 0 ? 0 : now + days*86400 + bonus
    UPDATE licenses SET hwid=?, activated_at=?, expires_at=?, last_seen=?, last_ip=? WHERE key=?
    ...
```

#### F30.5 Admin endpoints

```
GET  /api/admin/trials?q=&status=&suspect=  -> {trials[], stats{}, clusters[]}
POST /api/admin/trials/:hwid/revoke         -> status='revoked'
POST /api/admin/trials/:hwid/extend         -> expires_at += days (ghi note 'by admin')
POST /api/admin/trials/:hwid/ban            -> status='banned' + INSERT banned_devices
POST /api/admin/trials/:hwid/unban
POST /api/admin/trials/:hwid/convert        -> đánh dấu converted thủ công (bán ngoài web)
GET  /api/admin/trials/stats                -> conversion rate, suspect rate, clusters
```

#### F30.6 Cron bổ sung (`src/index.js::scheduled`)

```
// Đánh dấu hết hạn hàng loạt (chỉ để dashboard đẹp — logic chính là lazy)
UPDATE trials SET status='expired'
 WHERE status='active' AND expires_at < now

// Dọn nhật ký cũ, GIỮ trials vĩnh viễn
DELETE FROM trial_attempts WHERE at < now - 180*86400

// Dọn nonce hết hạn (nếu KV TTL không đủ)
// (KV tự hết hạn, không cần)
```

### F31. SQL schema đầy đủ

```sql
-- ============================================================
-- TRIAL 3 NGÀY MIỄN PHÍ THEO HWID — schema đầy đủ
-- Thay thế / mở rộng db/schema-trial.sql
-- D1 (SQLite). Mọi mốc thời gian là unix GIÂY.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Bảng trial chính: 1 dòng / (app, máy). KHÔNG BAO GIỜ XOÁ.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trials (
  app              TEXT    NOT NULL DEFAULT 'xa_nofog',
  hwid             TEXT    NOT NULL,              -- SHA256(guid|bios|cpu|vol)[:32], SERVER tính
  credential_public TEXT   NOT NULL,              -- 'TR-7K2M-9PXQ-4WDA' — hiện cho khách
  token_hash       TEXT    NOT NULL,              -- SHA256(token) — bằng chứng sở hữu

  status           TEXT    NOT NULL DEFAULT 'active',
                   -- active | expired | converted | revoked | banned
  plan             TEXT    NOT NULL DEFAULT 'trial',
  ttl_days         INTEGER NOT NULL DEFAULT 3,
  started_at       INTEGER NOT NULL,              -- lúc start, KHÔNG phải lúc chạy
  expires_at       INTEGER NOT NULL,              -- started_at + ttl_days*86400

  -- Định danh mềm: hash riêng từng thành phần (chống đổi 1 linh kiện)
  fp_guid          TEXT,
  fp_cpu           TEXT,
  fp_bios          TEXT,
  fp_vol           TEXT,
  fp_json          TEXT,                          -- JSON gốc client gửi (đã lọc), để debug

  -- Ngữ cảnh mạng
  ip_first         TEXT,
  ip_last          TEXT,
  ip_net           TEXT,                          -- IPv4 /24 hoặc IPv6 /64
  ip_set           TEXT,                          -- JSON array, tối đa 8 IP
  ua_first         TEXT,
  country_first    TEXT,
  asn_first        INTEGER,

  -- Máy ảo
  vm_flag          INTEGER NOT NULL DEFAULT 0,
  vm_detail        TEXT,

  -- Nghi vấn (KHÔNG tự chặn — để admin xem)
  suspect          INTEGER NOT NULL DEFAULT 0,
  suspect_reason   TEXT,

  -- Thống kê
  check_count      INTEGER NOT NULL DEFAULT 0,
  resume_count     INTEGER NOT NULL DEFAULT 0,
  last_check_at    INTEGER,
  last_client_time INTEGER,                       -- giờ máy khách tự báo (để phát hiện lùi)
  offline_overrun  INTEGER NOT NULL DEFAULT 0,    -- tổng giây vượt grace

  -- Chuyển đổi sang trả phí
  converted_key    TEXT,
  converted_at     INTEGER,
  linked_user_id   TEXT,                          -- qua trial_links / link_code
  link_code        TEXT,                          -- 8 ký tự khách nhập trên web

  note             TEXT,
  created_at       INTEGER NOT NULL,

  PRIMARY KEY (app, hwid)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_trials_cred
  ON trials(credential_public);
CREATE UNIQUE INDEX IF NOT EXISTS ux_trials_token
  ON trials(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_trials_linkcode
  ON trials(app, link_code);

CREATE INDEX IF NOT EXISTS idx_trials_expires     ON trials(expires_at);
CREATE INDEX IF NOT EXISTS idx_trials_status_exp  ON trials(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_trials_fp_bios     ON trials(app, fp_bios);
CREATE INDEX IF NOT EXISTS idx_trials_fp_guid     ON trials(app, fp_guid);
CREATE INDEX IF NOT EXISTS idx_trials_fp_vol      ON trials(app, fp_vol);
CREATE INDEX IF NOT EXISTS idx_trials_ip_first    ON trials(ip_first, started_at);
CREATE INDEX IF NOT EXISTS idx_trials_ip_net      ON trials(ip_net, started_at);
CREATE INDEX IF NOT EXISTS idx_trials_link_user   ON trials(linked_user_id);
CREATE INDEX IF NOT EXISTS idx_trials_converted
  ON trials(converted_at) WHERE converted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trials_suspect
  ON trials(created_at DESC) WHERE suspect = 1;

-- ------------------------------------------------------------
-- 2. Nhật ký MỌI lần gọi (kể cả bị từ chối) — dữ liệu tình báo
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trial_attempts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  app      TEXT    NOT NULL DEFAULT 'xa_nofog',
  hwid     TEXT,                                  -- null khi bị chặn trước khi tính được
  ip       TEXT,
  ua       TEXT,
  action   TEXT    NOT NULL,
           -- start | resume | expired_hit
           -- denied_sig | denied_nonce | denied_rate | denied_banned
           -- denied_vm | denied_fp | denied_cluster | denied_ip | denied_net
           -- denied_cap | denied_token | clock_back
  detail   TEXT,
  at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tatt_hwid ON trial_attempts(app, hwid, at DESC);
CREATE INDEX IF NOT EXISTS idx_tatt_ip   ON trial_attempts(ip, at DESC);
CREATE INDEX IF NOT EXISTS idx_tatt_act  ON trial_attempts(action, at DESC);

-- ------------------------------------------------------------
-- 3. Máy bị chặn vĩnh viễn
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS banned_devices (
  app        TEXT    NOT NULL DEFAULT 'xa_nofog',
  hwid       TEXT    NOT NULL,
  reason     TEXT,
  banned_at  INTEGER NOT NULL,
  banned_by  TEXT,
  PRIMARY KEY (app, hwid)
);

-- ------------------------------------------------------------
-- 4. Liên kết trial (theo máy) ↔ tài khoản web — TỰ NGUYỆN
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trial_links (
  app       TEXT    NOT NULL DEFAULT 'xa_nofog',
  hwid      TEXT    NOT NULL,
  user_id   TEXT    NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (app, hwid)
);
CREATE INDEX IF NOT EXISTS idx_tlink_user ON trial_links(user_id, linked_at);

-- ------------------------------------------------------------
-- 5. Cấu hình (đổi không cần deploy) — ghi vào bảng settings có sẵn
-- ------------------------------------------------------------
INSERT INTO settings (key, value, updated_at) VALUES
  ('trial_enabled',        '1',  0),
  ('trial_days',           '3',  0),
  ('trial_allow_vm',       '0',  0),
  ('trial_max_per_ip',     '3',  0),   -- /30 ngày
  ('trial_max_per_net',    '5',  0),   -- /24 (IPv4) hoặc /64 (IPv6) /30 ngày
  ('trial_max_per_day',    '200',0),   -- toàn hệ thống
  ('trial_max_hwid_per_bios','5',0),   -- bẫy VM template / ghost image
  ('trial_start_per_ip_hour','5',0),
  ('trial_min_client_ver', '2',  0)
ON CONFLICT(key) DO NOTHING;
```

**Ghi chú D1/SQLite:**
- Cột `PRIMARY KEY (app, hwid)` — D1 hỗ trợ composite PK trong `CREATE TABLE`.
- `CREATE UNIQUE INDEX ... WHERE` (partial index) — hỗ trợ.
- **Không** dùng `AUTOINCREMENT` cho bảng lớn nếu muốn tránh `sqlite_sequence`; `trial_attempts` dùng OK vì sẽ bị dọn định kỳ.
- Thời gian: **unix giây** (đồng bộ với `licenses`, tránh lỗi ms/giây — hiện `sessions` dùng ms, `licenses` dùng giây; trial theo `licenses`).
- Nếu đã chạy `db/schema-trial.sql` cũ: **drop và tạo lại** (chưa có dữ liệu thật), hoặc viết migration `ALTER TABLE` cho các cột mới. Khuyến nghị drop vì chưa deploy.

### F32. Danh sách file cần sửa

| # | File | Sửa gì | Mức |
|---|---|---|---|
| 1 | `db/schema-trial.sql` | **Thay toàn bộ** bằng schema F31 (thêm cột `app`, `credential_public`, `token_hash`, `fp_*`, `ip_net`, `vm_*`, `suspect`, `offline_overrun`, `link_code`; thêm `trial_links`; thêm `INSERT settings`) | 🔴 Bắt buộc |
| 2 | `src/routes/license-server.js` | `apiCheck()`: thêm dispatch `TR-` → `trialCheck()`. Thêm `apiTrialChallenge()`, `apiTrialStart()`, `trialCheck()`. Thêm `publicTrial()`. Sửa `bindFirstTime()` để cộng dồn trial. Thêm `TRIAL_GRACE_HOURS = 2`. Thêm `GRACE_HOURS_TRIAL` vào response trial | 🔴 Bắt buộc |
| 3 | `src/routes/trial.js` **(mới)** | Tách toàn bộ logic trial: `apiTrialChallenge`, `apiTrialStart`, `trialCheck`, `loadTrialConfig`, `detectVm`, `isPlaceholderBios`, fuzzy scoring, `adminTrialList`, `adminTrialAction`, `trialStats`. → **Tốt hơn là nhét hết vào `license-server.js`** (file đó đã 296 dòng) | 🔴 Bắt buộc |
| 4 | `src/index.js` | Thêm route: `r.get('/api/trial/challenge', trial.apiTrialChallenge)`, `r.post('/api/trial/start', trial.apiTrialStart)`, `r.get('/api/admin/trials', trial.adminTrialList)`, `r.post('/api/admin/trials/:hwid/:action', ...)`, `r.get('/api/admin/trials/stats', ...)`. Thêm vào `scheduled()`: `UPDATE trials SET status='expired' ...`, `DELETE FROM trial_attempts ...` | 🔴 Bắt buộc |
| 5 | `src/routes/license.js` | `myLicenses()`: thêm query `trials` theo `linked_user_id` → trả `{licenses, trial, available}`. Không sửa `licenseStats()` (đã đúng vì trial ở bảng khác) | 🟡 Nên |
| 6 | `src/routes/admin.js` | `saveSettings()`: thêm các key `trial_*` vào mảng `allowed` | 🟡 Nên |
| 7 | `tool/src/xa_config.py` | Thêm: `TRIAL_ENABLED = True`, `TRIAL_GRACE_HOURS = 2`, `TRIAL_HMAC_KEY = '<chuỗi-hex-32-byte, đổi mỗi build nếu muốn>'`, `TRIAL_FEATURES = ('viewport','minimap')`, `UPGRADE_URL = 'https://xienhl.com/#/products?category=license-xarena'` | 🔴 Bắt buộc |
| 8 | `tool/src/xa_nofog_pro.py` | (a) `compute_hwid()` → thêm `compute_fp()` trả `{guid,cpu,bios,vol}` + hwid. (b) Thêm `_hmac()`. (c) Thêm `trial_start()` + `_challenge()`. (d) `check_online()`: gửi `token`, `client_time`, `uptime`; đọc `server_time`, `days_left`, `features`. (e) `ensure_licensed()`: **thêm `'rate_limit'`, `'clock_tampered'`, `'trial_expired'`, `'trial_blocked'`, `'signal_reset'`, `'bad_signature'` vào danh sách từ chối dứt khoát** (vá B1). (f) **Gọi `_time_state()`** trong `check_online()` (vá B2). (g) `require_license()`: nhánh tự động trial khi chưa có state. (h) `pick_sites()`: tôn trọng `features`. (i) `show_status()`: in hạn trial + `link_code`. (j) `parse_args()`: thêm `--trial`, `--link`, `--upgrade` | 🔴 Bắt buộc |
| 9 | `public/assets/pages/licenses.js` | Thêm block render `data.trial` phía trên danh sách license: pill "🎁 Dùng thử", `days_left`, nút "Nâng cấp ngay". Thêm `STATUS.trial`. | 🟡 Nên |
| 10 | `public/assets/pages/link.js` **(mới)** + `public/assets/app.js` | Trang `/#/link`: nhập `link_code` → `POST /api/trial/link` → tạo `trial_links` + `trials.linked_user_id` | 🟡 Nên |
| 11 | `public/assets/pages/admin.js` | Thêm tab "🎁 Trial": stats (trial hôm nay, active, converted, **conversion rate**, suspect rate), bảng trial, nút revoke/extend/ban, cảnh báo cụm BIOS | 🟡 Nên |
| 12 | `src/routes/installer.js` | **Không sửa code**, nhưng **phải cập nhật `EXE_SHA256` + `EXE_SIZE`** sau khi build lại EXE (build.ps1 tự làm nếu trả lời `y`) | 🔴 Bắt buộc sau build |
| 13 | `wrangler.toml` | Không cần (dùng `DB` và `CACHE` có sẵn). Nếu muốn tách secret: thêm `[vars] TRIAL_HMAC_KEY` | ⚪ Tuỳ chọn |
| 14 | `db/index-optimize.sql` | Thêm index trial nếu file này được dùng làm nguồn index tập trung | ⚪ Tuỳ chọn |

**Thứ tự triển khai an toàn (không downtime, không phá khách đang dùng):**

```
Pha 1 (backend, không ảnh hưởng ai):
  1. chạy db/schema-trial.sql             (thêm bảng, không đụng bảng cũ)
  2. deploy src/routes/trial.js + route mới
  3. deploy nhánh dispatch TR- trong apiCheck  (key paid đi đường cũ y nguyên)
  → Trial API sống, client cũ không biết → không ai bị ảnh hưởng

Pha 2 (admin):
  4. trial.js admin endpoints + tab Trial
  → quản trị được trước khi phát hành

Pha 3 (client):
  5. sửa xa_config.py + xa_nofog_pro.py
  6. build.ps1  →  SHA mới
  7. upload R2 + deploy worker (SHA trong installer.js)
  → khách tải EXE mới = có trial

Pha 4 (UX):
  8. licenses.js + link.js + admin.js
```

**Điểm rollback:** xoá 3 dòng route trial trong `src/index.js` → hệ thống về đúng hiện trạng, `licenses` không bị ảnh hưởng (trial ở bảng riêng). Đây là lợi ích lớn của việc tách bảng.

---

## KHUYẾN NGHỊ CUỐI CÙNG

### Thiết kế tốt nhất: **"Bảng riêng + Server là trọng tài + Định danh mềm + Kinh tế học"**

**5 quyết định cốt lõi, theo thứ tự quan trọng:**

**1. Tách bảng `trials`, KHÔNG dùng chung `licenses`.**
Lý do quyết định: `licenses` là **sổ cái tiền** (mỗi dòng = một giao dịch đã bán). Trộn trial vào sẽ phá `licenseStats()`, phá dashboard `LIMIT 300`, phá `myLicenses()`, và quan trọng nhất là làm mất khả năng đọc số liệu kinh doanh. Client vẫn dùng **cùng endpoint** `/api/check` (dispatch theo prefix `TR-`) để không phải nhân đôi logic grace — đây là cách lấy ưu điểm của cả hai phương án.

**2. Server là trọng tài duy nhất về thời gian.**
`expires_at` chỉ server tính. Client không được quyết định bất cứ điều gì về hạn. Điều này làm cho các vector "lùi đồng hồ", "xoá file", "sửa state" trở nên **vô nghĩa** — chúng chỉ có thể ảnh hưởng tới grace offline, mà grace trial bị giới hạn ở 2 giờ.

**3. Định danh mềm (fuzzy fingerprint) — đây là "trí thông minh" thực sự.**
Lưu 4 hash thành phần riêng (`fp_guid`, `fp_cpu`, `fp_bios`, `fp_vol`) + chấm điểm có trọng số. Đây là thứ biến "đổi MachineGuid" từ **miễn phí** thành **bị phát hiện**. Trọng số: BIOS=4, GUID=2, VOL=2, CPU=1 (CPU brand dùng chung cho hàng nghìn máy nên phải nhẹ). Kèm bẫy mạnh nhất: **một BIOS serial xuất hiện với >5 HWID trong 30 ngày → chặn cả cụm** (bắt VM template + ghost image).

**4. Grace 2 giờ cho trial / 24 giờ cho key trả tiền.**
Đây là thay đổi **quan trọng nhất về mặt chống lạm dụng** mà chỉ tốn 1 dòng code, đồng thời là **công cụ bán hàng**: khách trả tiền được ưu ái hơn. Vector "chặn hosts" từ "∞ miễn phí" xuống "2 giờ". Kèm phạt `offline_overrun` để chặn hosts không còn lợi.

**5. Ba giới hạn kinh tế thay vì cố chặn tuyệt đối.**
`3 trial/IP/30 ngày`, `5 trial/nhóm mạng/30 ngày`, `200 trial/ngày toàn hệ thống`. Với giá gói tuần 70.000đ, các giới hạn này làm cho việc farm **đắt hơn mua** — đó là cách duy nhất bền vững, vì "máy thật khác nhau" thì về nguyên tắc không thể chặn.

### Hai việc PHẢI làm trước khi bật trial, nếu không trial vô nghĩa

| # | Việc | File | Vì sao |
|---|---|---|---|
| **B1** | Thêm `'rate_limit'` vào danh sách từ chối dứt khoát trong `ensure_licensed()` | `tool/src/xa_nofog_pro.py:437` | Hiện tại spam sai → 429 → được 24h grace miễn phí |
| **B2** | Gọi `_time_state()` trong `check_online()` (hiện là dead code) | `tool/src/xa_nofog_pro.py:531` | Lùi đồng hồ hiện không bị phát hiện ở bất kỳ đâu |

Và một việc kiến trúc: **server phải tự tính HWID** từ raw parts, không nhận `hwid` từ client. Đây là thay đổi then chốt để chặn vector 21 (Postman) — nếu vẫn nhận `hwid` từ body thì mọi lớp chống lạm dụng khác đều có thể bị vô hiệu bằng 1 dòng curl.

### Điều cần nói thẳng với chủ shop

1. **Không thể chặn 100%.** Vector "nhiều máy thật khác nhau" và "VPN" chỉ giảm thiểu được, vì bản chất "trial không cần đăng ký" nghĩa là không có danh tính. Nếu muốn chặn tuyệt đối thì phải thu SĐT/Gmail — trái yêu cầu ban đầu.

2. **Giới hạn 3 ngày là hợp lý.** Với 70.000đ/tuần, đây là mức giá đủ thấp để "farm trial" không đáng công. Đừng tăng lên 7 ngày — trial dài làm giảm conversion.

3. **Đừng bóp nghẹt trải nghiệm để chống gian.** Giới hạn số lần chạy, giới hạn giờ/ngày, chặn tính năng chính — tất cả đều phạt khách thật nặng hơn kẻ gian. Cách đúng là **giới hạn cổng legacy** (nhẹ nhàng, có lý do nâng cấp) + **watermark** + **nhắc đúng lúc**.

4. **Chỉ số quyết định là conversion rate, không phải số trial.** Nếu `converted/(converted+expired) < 3%` thì trial đang lỗ (tốn băng thông + hỗ trợ) — lúc đó xem lại giá và thông điệp, chứ đừng siết chống gian thêm.
