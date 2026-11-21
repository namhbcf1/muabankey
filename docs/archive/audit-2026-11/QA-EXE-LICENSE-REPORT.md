# BÁO CÁO QA — EXE & HỆ THỐNG LICENSE (PRODUCTION)

**Ngày:** 2026-11-12 · **Môi trường:** production `https://xienhl.com` + D1 `81f478c9-5627-458a-a35f-d483e69d400b`
**Đối tượng:** `xa_nofog_pro.exe` v1.4.1.0 (9.101.312 bytes) + `/api/activate`, `/api/check`, `/api/trial/command`
**Nguyên tắc:** test thật trên hạ tầng thật · dọn sạch key/license test · chạy `--install`/`--uninstall` chỉ đọc code

---

## KẾT LUẬN NGẮN

**EXE và license server hoạt động đúng về mặt kỹ thuật — 100% test chức năng PASS.** Kiến trúc "bảng offset nằm trong token ký ECDSA" đã được xác minh end-to-end: EXE sạch 0 vết bảng cổng, token verify được 17 cổng/3 nhóm, mọi đường giả mạo đều bị chặn.

**Nhưng KHÔNG hoàn hảo.** Có **2 lỗi P1 phải sửa trước khi bán tiếp**, và 1 trong số đó **đã xảy ra thật trên máy này**:

| # | Mức | Vấn đề | Trạng thái |
|---|-----|--------|-----------|
| P1-a | 🔴 **P1** | **Bộ cài trên web ghi EXE vào `C:\Program Files\XArena\_re\chayduoc`** — chính là thư mục game Arena.vn của khách. Đã xác nhận có thật trên máy này. | ✅ **ĐÃ SỬA** `installer.js:36` — **cần deploy worker** |
| P1-b | 🔴 **P1** | `--deactivate` **không xoá được** bản sao license ở `%PROGRAMDATA%\XArenaNoFog\license.dat` (ACL chỉ Admin/SYSTEM). Đã test: xoá thất bại, key vẫn còn. | **Chưa sửa** — cần quyết định thiết kế |
| P2-a | 🟠 P2 | `run_uninstall()` thiếu `return` cuối → exit code luôn 0 dù có lỗi; 10 dòng code sau `return False` trong `_remove_install_dir()` là **dead code** | ✅ **ĐÃ SỬA** |
| P2-b | 🟠 P2 | `--uninstall` khi **không có TTY** (pipe/script) **tự động YES** → xoá luôn không hỏi | ✅ **ĐÃ SỬA** |
| P2-c | 🟠 P2 | `STATE_DIR` thành **đường dẫn tương đối** khi `LOCALAPPDATA` rỗng → `lic.bin` ghi vào CWD. Đã test: tạo `XArenaNoFog\lic.bin` trong CWD. | ✅ **ĐÃ SỬA** |
| P2-d | 🟠 P2 | Không có `min_ver` phía server → cơ chế chặn bản cũ **chết** (client có code, server không bao giờ gửi) | **Chưa sửa** — cần quyết định |
| P3 | 🟡 P3 | `%PROGRAMDATA%\Microsoft\Crypto\RSA\upd.dat` **vẫn còn sót** từ bản cũ (12/11 00:30) — code mới không ghi nữa nhưng không dọn | Cần dọn tay |

**Trả lời câu hỏi chủ shop (F35):** `REQUIRE_ONLINE=1`, grace=0 → **mất mạng là tool dừng ngay**, kể cả key vĩnh viễn còn 10 năm. Đây là lựa chọn có chủ ý (chống hosts-file/rút mạng), nhưng khách quán net mất wifi sẽ không dùng được.

---

## A. EXE TRÊN R2 — 8/8 PASS

| # | Test | Kết quả | Bằng chứng |
|---|------|---------|-----------|
| A1 | Hash khớp `EXE_SHA256` | ✅ PASS | `053A6C494AE3EEE22BCD9044D495CC026C880EC22AC5E4B8FC3BF7B166DEEB75` — khớp cả `installer.js:26` và response live |
| A2 | Kích thước | ✅ PASS | 9.101.312 bytes = `EXE_SIZE` |
| A3 | Version info | ✅ PASS | CompanyName `XArena` · ProductName `XArena No Fog` · FileVersion `1.4.1.0` · ProductVersion `1.4.1.0` · OriginalFilename `xa_nofog_pro.exe` |
| A4 | `GET /api/app/version` | ✅ PASS | Live trả đúng `version 1.4.1.0`, `sha256`, `size 9101312`, `sizeText 8.7 MB`, `urlAbsolute` |
| A5 | Không còn `8a83b88d` | ✅ PASS | 0 hit (ASCII + UTF-16LE) |
| A6 | Không còn `0x514E0F` | ✅ PASS | 0 hit. Cũng 0 hit cho 4-byte LE `0f4e5100`, `21d54200`, `f83d5100` |
| A7 | Không còn `open_addr_table` | ✅ PASS | 0 hit |
| A8 | Không còn `MINIMAP = [` | ✅ PASS | 0 hit. `MINIMAP`/`CORE = [`/`LEGACY = [` cũng 0 hit |
| A9 | Bonus: hằng số nhạy cảm đã XOR | ✅ PASS | `empiresx`, `EMPIRESX.EXE`, `xienhl.com`, `XArenaNoFog`, `xanf-anchor-v1`, `Crypto\RSA`, `upd.dat` — **tất cả 0 hit** (giải mã runtime từ `xa_nofog_const.py`) |
| A10 | `--status` | ✅ PASS | Exit 0, in đầy đủ; chưa kích hoạt → `CHUA KICH HOAT` + link mua |
| A11 | `--help` không có `None` | ✅ PASS | Exit 0, 1.435 ký tự, **0 occurrence của `None`**; fallback `_HELP_FALLBACK` hoạt động |
| A12 | `--list` → 17 cổng | ✅ PASS | Sau khi kích hoạt: `bang cong: 17 cong, 3 nhom` — viewport 3, minimap 7, legacy 7 |
| A13 | `--list` + `LOCALAPPDATA` rỗng | ✅ PASS (exit 3, không crash) | Nhưng **ghi file vào CWD** — xem P2-c |
| A14 | Public key khớp JWK server | ✅ PASS | Điểm nằm trên đường cong P-256; `x`/`y` khớp chính xác `secrets/xn-sign-jwk.json` |

### Chi tiết `--list` (token thật, 17 cổng)

```
bang cong: 17 cong, 3 nhom
[viewport]  T1 0x00514E0F 85d17407 -> 90909090
            V3 0x00514F58 7404     -> eb43
            V6 0x00516590 518b442408 -> 33c0c21400
[minimap]   A B C D E M N   (7 cổng)
[legacy]    F I J K L O T2  (7 cổng)
```

---

## B. LICENSE END-TO-END — 14/14 PASS

| # | Test | Kết quả | Bằng chứng |
|---|------|---------|-----------|
| B9 | Tạo key test DB (`hwid=NULL`, `source='test'`) | ✅ PASS | Insert thành công, đọc lại đúng |
| B10 | `/api/activate` hwid giả | ✅ PASS | HTTP 200, `ok=true`, `plan=aoe1`, **token 1.897 ký tự** (>1000), `first_bind=true` |
| B11 | Verify token bằng `xa_nofog_sec.py` | ✅ PASS | `ok=True`, **17 cổng**, **3 nhóm** `[(viewport,3),(minimap,7),(legacy,7)]` |
| B12 | Cổng T1 | ✅ PASS | `0x514E0F, 85d17407 -> 90909090` ✔ đúng yêu cầu |
| B13 | `/api/check` → token mới | ✅ PASS | Token **khác** token cũ, vẫn verify OK, vẫn 17 cổng |
| B14 | Sửa 1 ký tự (payload **và** signature) | ✅ PASS | Cả hai → `bad_sig` |
| B15 | Đổi `gate` | ✅ PASS | `bad_sig` — chữ ký phủ cả payload nên đổi gate = sai chữ ký ngay từ bước verify |
| B16 | `revoked=1` | ✅ PASS | HTTP 403 `revoked` — "Mã đã bị thu hồi" |
| B17 | Hết hạn | ✅ PASS | HTTP 403 `expired` |
| B18 | HWID khác qua `/api/check` | ✅ PASS | HTTP 403 `hwid_mismatch` |
| B18b | HWID khác qua `/api/activate` | ✅ PASS | HTTP 403 `hwid_mismatch` |
| B18c | Key không tồn tại | ✅ PASS | `not_found` (không lộ oracle) |
| B18d | Body rỗng | ✅ PASS | HTTP 400 `bad_request` |
| B19 | **Xoá key test** | ✅ PASS | `licenses` + `lic_events` + `lic_tokens` đã xoá, `remaining=0` |

### Kiểm tra thêm trên EXE thật (license thật)

| Test | Kết quả |
|------|---------|
| `--key` kích hoạt → `--status` | ✅ `BAN QUYEN` · `HOAT DONG` · `HWID khop: CO` · `Dong ho: dung` |
| `--list` sau kích hoạt | ✅ 17 cổng từ token trong `lic.bin` |
| Key bị revoke → `--status` | ✅ `Trang thai: KHONG (Mã đã bị thu hồi)` |
| Key bị revoke → `--once` | ✅ Exit 3, fail-closed, **không vá gì** |
| Key bị revoke → `--list` (offline) | ⚠️ **Vẫn in 17 cổng** — dùng token cache, không gọi server. Xem Ghi chú G1 |

---

## C. TRIAL — 11/11 PASS

| # | Test | Kết quả | Bằng chứng |
|---|------|---------|-----------|
| C20 | `/api/trial/command` không cần login | ✅ PASS | HTTP 200, key `TR-2TFX-LFGZ-YR39`, `left=9`, `quota=10` |
| C21 | Token trial có bảng 17 cổng | ✅ PASS | Qua `/api/check` với HWID đúng: verify OK, **17 cổng / 3 nhóm**, `payload.p='trial'` |
| C22 | Trial hết hạn → từ chối | ✅ PASS | HTTP 403 `trial_expired` — "Lượt dùng thử đã hết hạn" |
| C23 | Body rỗng thật (0 byte) | ✅ PASS | HTTP 400 `bad_request` |
| C23b | Body `null` | ✅ PASS | HTTP 400 |
| C23c | Body `[]` | ✅ PASS | HTTP 400 |
| C23d | JSON hỏng | ✅ PASS | HTTP 400 |
| C24 | `kind` sai (`30d`) | ✅ PASS | HTTP 400 `trial_kind_invalid` |
| C24b | `kind=""` | ✅ PASS | HTTP 400 |
| C25 | 4 parts toàn rỗng | ✅ PASS | HTTP 400 `bad_request` |
| C26 | Chỉ có `vol` (thiếu guid/bios/cpu) | ✅ PASS | HTTP 400 — chặn identity collision |
| C27 | Máy ảo (VirtualBox) | ✅ PASS | HTTP 403 `trial_denied_device` |
| C28 | Key trial qua `/api/activate` | ✅ PASS | HTTP 403 `trial_only` |
| C29 | `cmdUrl` tải được `.cmd` | ✅ PASS | HTTP 200, 11.550 bytes |
| C30 | `.ps1` tải được | ✅ PASS | HTTP 200, 9.761 bytes |
| C31 | `/i/<KEY>.cmd` không token | ✅ PASS | HTTP 401 `UNAUTHORIZED` |
| C32 | `/i/<KEY>.cmd?t=<sai>` | ✅ PASS | HTTP 401 — "Token không hợp lệ hoặc đã hết hạn" |

**Quan sát `body "{}"`** (không phải lỗi chặn, nhưng đáng biết): body `{}` hợp lệ JSON → **HTTP 200, cấp key**, `user_id = dev:ip:1.55.142.161`, `hwid=NULL`. Web luôn gửi `{kind, device_id}` nên khách thật không gặp; nhưng gọi API tay bằng `{}` vẫn nhận mã, chỉ bị chặn bởi quota IP/ngày. Xem Ghi chú G2.

---

## D. INSTALL MODE (đọc code, KHÔNG chạy thật) — 6/6 PASS trên EXE

| # | Test | Kết quả | Chi tiết |
|---|------|---------|---------|
| D25 | Đọc `run_install`/`run_uninstall`/`_looks_like_game_client`/`_assert_safe_target` | ✅ | Đã đọc toàn bộ (dòng 2984–3532) |
| D26 | Không có đường nào xoá `C:\Program Files\XArena` | ✅ PASS | `INSTALL_ROOT` = `C:\Program Files\XArenaNoFog`; guard chặn cả trường hợp bị đặt `XA_INSTALL_ROOT_NAME=XArena` |
| D27 | `INSTALL_ROOT` = `XArenaNoFog` | ✅ PASS | Xác nhận runtime: `_INSTALL_VENDOR = 'XArenaNoFog'` |
| D28 | Guard chặn `Arena.exe`, `SoftEther`, `Game\`, `StartAoE` | ✅ PASS | `GAME_CLIENT_MARKERS` có `Arena.exe/Arena.exp/Arena.lib/Uninstall.exe/Uninstall.dat/UpdateService.vbs/Exclusive_XArena.bat/StartAoE.zip/underworld.dll/spine_flutter.dll`; `GAME_CLIENT_DIRS` = `SoftEther, StartAoE, Game, update, logs, .sentry-native, data` |
| D29 | `--uninstall` hỏi xác nhận | ✅ PASS* | `_ask_yes_no('Xac nhan go cai dat?', default=True)` · license hỏi riêng `default=False`. *Nhưng xem P2-b |
| D30 | `is_admin()` dùng TokenElevation + argtypes | ✅ PASS | `TokenElevation = 20`; `GetCurrentProcess.restype = wt.HANDLE` + `argtypes = []`; `OpenProcessToken`/`GetTokenInformation` đều khai báo đủ. `IsUserAnAdmin` chỉ là fallback |

### Bằng chứng guard hoạt động (test thật, không chạy `--install`)

```
_looks_like_game_client('C:\Program Files\XArena') = (True, 'Arena.exe')

# Ép INSTALL_ROOT = C:\Program Files\XArena (trường hợp xấu nhất):
_assert_safe_target() = False
why = Thu muc dich "XArena" co ten chua "Arena" nhung khong phai "XArenaNoFog"
      -- co the la game Arena.vn. Khong ghi vao.

# Ép cả XA_INSTALL_ROOT_NAME='XArena' (kẻ xấu cố tình):
_assert_safe_target() = False
why = Thu muc "C:\Program Files\XArena" thuoc game Arena.vn (thay Arena.exe) -- KHONG ghi vao.
_root_owned_by_us() = False
```

**→ EXE tự nó an toàn tuyệt đối với thư mục game. Vấn đề nằm ở bộ cài trên web (P1-a).**

---

## E. TỰ LƯU KEY — 4/4 PASS

| # | Test | Kết quả | Chi tiết |
|---|------|---------|---------|
| E31 | `lic.bin` ở `%LOCALAPPDATA%\XArenaNoFog\` | ✅ PASS | `C:\Users\ADMIN\AppData\Local\XArenaNoFog\lic.bin`, 2.410 bytes, magic `XANF`, thuộc tính **Hidden** |
| E32 | Dùng DPAPI | ✅ PASS | `CryptProtectData`/`CryptUnprotectData`; giải mã ra JSON 2.186 bytes với 13 khoá: `activated_at, expires_at, grace_hours, hwid, key, last_ok, mode, mono_at, mono_high, mono_last_ok, plan, srv_ts, xn_token` |
| E33 | Flags 0x04 hay 0x01? | ✅ **Chỉ 0x01** | `0x01 = CRYPTPROTECT_UI_FORBIDDEN` (không phải scope) → **scope = CurrentUser**. Hệ quả đúng như bạn lo: **nhiều user cùng máy KHÔNG dùng chung được license**. |
| E34 | Có ghi `%PROGRAMDATA%\Microsoft\Crypto\RSA`? | ✅ PASS (code mới) | `_anchor_paths()` **chỉ trả 1 mục**: `%LOCALAPPDATA%\XArenaNoFog\ts`. Trong source `upd.dat` chỉ xuất hiện trong **comment lịch sử** (dòng 1837). Chạy `--key` thật: `upd.dat` **LastWriteTime KHÔNG đổi**. |

### ⚠️ Nhưng: `upd.dat` cũ vẫn còn trên máy này

```
C:\ProgramData\Microsoft\Crypto\RSA\upd.dat
  Length 56 · Created 2026-11-12 00:30:46 · SHA256 B7975A05...
  Nội dung: salt 'xanf-anchor-v1' + mốc thời gian 794418246
```

Đây là di chứng của bản cũ (trước khi bỏ hành vi này). **Code mới không tạo mới, nhưng cũng không dọn.** Trên máy khách đã từng chạy bản cũ, file này vẫn nằm trong thư mục khoá RSA của Windows — đúng thứ mà AV hay để ý. Cần dọn tay hoặc thêm bước migrate.

### Hệ quả của E33 (CurrentUser scope) — đã xác minh

- `--deactivate` chạy dưới user A → xoá `lic.bin` của A ✅
- Bản sao `%PROGRAMDATA%\XArenaNoFog\license.dat` do `--install` tạo ra được ACL **chỉ Administrators + SYSTEM** → user thường **không xoá được, không đọc được**. Đã test: xoá thất bại `Access to the path is denied`; `Get-FileHash` cũng bị từ chối.
- Nhưng bản sao đó cũng **vô dụng** để khôi phục: DPAPI CurrentUser của user A không giải mã được bởi user B, và ngay cả user A cũng không đọc được file (ACL chặn). → **`license.dat` hiện là file chết: không backup được, không xoá được** (P1-b).

---

## F. THIẾU SÓT CẦN BIẾT — 1/4 đạt

| # | Câu hỏi | Trả lời |
|---|---------|---------|
| F35 | Grace offline = 0, mất mạng là dừng? | ⚠️ **ĐÚNG — và đã test thật.** Trỏ `XA_API_BASE` sang host không tồn tại → `--status` báo `Trang thai: KHONG (khong ket noi duoc server (bat buoc online))`, `Offline: het (can mang)`. Key còn **30 ngày** vẫn không chạy được. **Đúng ý chủ shop?** Đây là đánh đổi có chủ ý (chặn hosts/rút mạng). Nhưng khách quán net / mạng chập chờn sẽ mất tiền oan — nên cân nhắc grace 2–4h cho key trả phí. |
| F36 | `min_ver` có hoạt động? | ❌ **KHÔNG.** Client có code đầy đủ (`check_min_version`, `warn_outdated`, `EXIT_OUTDATED=8`) và hoạt động đúng khi test giả lập (`{"min_ver":"1.5.0"}` → `(False, '1.5.0')`). Nhưng **server KHÔNG BAO GIỜ trả `min_ver`** — `grep min_ver src/` = **0 match**. → Cơ chế chặn bản cũ **chết hoàn toàn**: phát hành 1.5.0 mà đổi format API thì mọi bản 1.4.1 vẫn chạy và lỗi khó hiểu. |
| F37 | Lock file machine-wide? | ✅ **CÓ.** `%PROGRAMDATA%\XArenaNoFog\run.lock` (đã xác nhận tồn tại, chứa PID). ACL `BUILTIN\Users:(OI)(CI)(M)` → mọi user ghi được. Kèm mutex `Global\XArenaNoFogPro`. Có fallback per-user `%LOCALAPPDATA%` nếu PROGRAMDATA không ghi được. |
| F38 | Cảnh báo license sắp hết hạn? | ⚠️ **CHỈ CHO TRIAL.** `_warn_trial()` nhắc trial 1h (còn ≤10 phút) và 3 ngày (còn ≤1 ngày). Với **key trả phí: KHÔNG có cảnh báo nào** dù còn 1 giờ. Test thật: set `expires_at` = còn 2 giờ → `--status` in `Con lai: 0.1 ngay`, **không có dòng cảnh báo**, không đổi màu, không nhắc mua. Khách hết hạn giữa trận sẽ bị dừng tool đột ngột. |

---

## LỖI PHẢI SỬA

### 🔴 P1-a — Bộ cài web ghi EXE vào thư mục game Arena.vn — ✅ ĐÃ SỬA

**Đây là lỗi nghiêm trọng nhất, và đã xảy ra thật.**

`src/routes/installer.js:15`
```js
const INSTALL_DIR = 'C:\\Program Files\\XArena\\_re\\chayduoc';   // ← SAI
```

Nhưng `tool/src/xa_nofog_pro.py` (dòng 235–246) **cố tình** tránh thư mục đó:
```python
# "C:\Program Files\XArena" la BAN CAI GAME Arena.vn cua nguoi dung (co
# Arena.exe, SoftEther, Uninstall.exe...). Neu cai vao do thi --uninstall
# se xoa mat game cua khach. Dung thu muc vendor rieng.
_INSTALL_VENDOR = str(_c('INSTALL_ROOT_NAME', 'XArenaNoFog'))
```

**Xác nhận trên máy này:**
```
C:\Program Files\XArena\            ← game Arena.vn thật (Arena.exe, SoftEther, StartAoE, Game\, underworld.dll...)
C:\Program Files\XArena\_re\chayduoc\xa_nofog_pro.exe   ← 13.220.310 bytes, cùng các file dev (.py, .png, .pkl)
C:\Program Files\XArenaNoFog\       ← KHÔNG TỒN TẠI
```

Hệ quả dây chuyền:
1. `.cmd`/`.ps1` ghi EXE vào `XArena\_re\chayduoc` → `is_installed()` trả **False** (nó kiểm `XArenaNoFog\_re\chayduoc`).
2. Mỗi lần chạy, `offer_install_if_needed()` lại hỏi *"Cài đặt vào Program Files?"* → nếu khách bấm Yes, EXE **tự cài sang `XArenaNoFog`** → có **2 bản**.
3. Khách chạy `--uninstall` trên `XArena\_re\chayduoc` → `INSTALL_ROOT` trỏ `XArenaNoFog` → **không xoá được bản trong thư mục game**. Hoặc tệ hơn: nếu ai đó đặt `XA_INSTALL_ROOT_NAME=XArena`, guard vẫn chặn (đã test) nên **không** xoá nhầm game — nhưng EXE mồ côi nằm lại trong thư mục game.
4. File dev rác (`.py`, `.png`, `.pkl`, `build/`, `dist/`, `ident.pkl` 16MB) bị đẩy lên máy khách — lộ toàn bộ waypoint nghiên cứu, kế hoạch patch, và cả `xa_license/worker/src/index.js` (server license cũ).

**Sửa (đã áp dụng):** `src/routes/installer.js:36`
```js
const INSTALL_DIR = 'C:\\Program Files\\XArenaNoFog\\_re\\chayduoc';
```
Đã đối chiếu: khớp **chính xác** `INSTALL_EXE_DIR` của `xa_nofog_pro.py`. Module load OK, `EXE_VERSION` không đổi.
**→ Còn phải deploy worker** (`node scripts/upload-worker.mjs`).

**Sau khi deploy, cần dọn máy đã cài:** xoá `C:\Program Files\XArena\_re\chayduoc\` (khoảng 130 file dev: `*.py`, `*.pkl`, `build/`, `dist/`, `xa_license/worker/src/index.js`) — **chỉ xoá thư mục `chayduoc`**, tuyệt đối không đụng phần còn lại của `C:\Program Files\XArena`.

### 🔴 P1-b — `--deactivate` không xoá được bản sao license

`run_install` → `_copy_license_to_programdata()` sao `lic.bin` sang `%PROGRAMDATA%\XArenaNoFog\license.dat` rồi siết ACL:
```python
subprocess.run(['icacls', dst, '/inheritance:r',
                '/grant', '*S-1-5-32-544:F',   # Administrators
                '/grant', '*S-1-5-18:F'])      # SYSTEM
```

Nhưng `--deactivate` (dòng 4346–4352) chạy **không cần admin** (đúng thiết kế: `--deactivate` nằm trong nhóm "KHÔNG cần admin"), rồi cố xoá file đó:
```python
pd = _pd_path('license.dat')
if pd and os.path.exists(pd):
    kernel32.SetFileAttributesW(pd, 0x80)
    os.remove(pd)
```
→ **`os.remove` ném PermissionError, bị `except Exception: pass` nuốt im lặng.**

**Đã test thật** (không elevated):
```
license.dat CON: len=2538
XOA DUOC? KHONG (Access to the path is denied)
```

Hệ quả: khách bấm "Xoá key khỏi máy này" → tool báo **"Da xoa key khoi may nay"** nhưng **key vẫn còn** trong `%PROGRAMDATA%`. Khách bán máy/cho mượn máy tưởng đã sạch. (Bản sao này không dùng được để chạy — DPAPI CurrentUser + ACL — nhưng key *plaintext* vẫn nằm trong đó khi giải mã bởi đúng user + admin.)

**Sửa:** hoặc thêm bước elevate có thông báo rõ khi phát hiện `license.dat`, hoặc đừng tạo bản sao này nữa (nó vô dụng vì DPAPI CurrentUser không khôi phục được cho user khác), hoặc dùng `CRYPTPROTECT_LOCAL_MACHINE` cho riêng bản sao.

### 🟠 P2-a — `run_uninstall` thiếu `return`; dead code — ✅ ĐÃ SỬA

AST xác nhận trước khi sửa: `run_uninstall` chỉ có `return` tại dòng **3336, 3342, 3365** — **không có `return` ở cuối** → rơi khỏi hàm trả `None` → `sys.exit(None)` = **exit 0 dù có lỗi**.

Và 10 dòng sau `return False` trong `_remove_install_dir()` là **dead code không bao giờ chạy**. Chính khối code báo lỗi + trả exit 1 bị chôn sau `return False`.

**Sửa (đã áp dụng):** chuyển khối `print`/`return` đó từ `_remove_install_dir` sang cuối `run_uninstall`.
Xác minh lại bằng AST:
```
run_uninstall        lines 3327-3476 returns=[3476, 3345, 3351, 3473, 3374]  cau lenh cuoi=Return
_remove_install_dir  lines 3517-3547 returns=[3547, 3521, 3525, 3535]        cau lenh cuoi=Return
_remove_install_dir: khong con dead code sau return
```
Ngoài ra dòng 3459 `_remove_install_dir()` → `_remove_install_dir(errors)` để lỗi xoá thư mục được báo lên exit code.

### 🟠 P2-b — `--uninstall` tự đồng ý khi không có TTY — ✅ ĐÃ SỬA

Trước khi sửa:
```python
def _ask_yes_no(prompt, default=False):
    if not sys.stdin or not sys.stdin.isatty():
        return default      # ← trả default ngay
```
Test thật (`isatty()=False`): `_ask_yes_no(..., default=True)` → **True** → chạy `--uninstall` trong script/CI/piped **xoá Program Files + shortcut + Scheduled Task ngay, không hỏi**.

**Sửa (đã áp dụng):** thêm tham số `on_no_tty`, mặc định **False = TỪ CHỐI** khi không có TTY.
```python
def _ask_yes_no(prompt, default=False, on_no_tty=None):
    ...
    if not sys.stdin or not sys.stdin.isatty():
        return False if on_no_tty is None else bool(on_no_tty)
```
Xác minh:
```
_ask_yes_no("Xac nhan go cai dat?", default=True)      -> False   (an toàn)
_ask_yes_no("Xoa license?", default=False)             -> False
_ask_yes_no("Cai dat?", default=True, on_no_tty=True)  -> True    (không phá huỷ)
```
`offer_install_if_needed()` được đánh dấu `on_no_tty=True` vì cài đặt **không phá huỷ dữ liệu** và bộ cài `.cmd`/`.ps1` gọi EXE mà không có TTY nên vẫn phải cài được.

### 🟠 P2-c — `STATE_DIR` thành đường dẫn tương đối khi `LOCALAPPDATA` rỗng — ✅ ĐÃ SỬA

Trước khi sửa:
```python
STATE_DIR = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), ...)
```
`os.environ.get` trả `''` (không phải `None`) khi biến tồn tại nhưng rỗng → fallback `~` **không kích hoạt** → `STATE_DIR = 'XArenaNoFog'` (tương đối).

Test thật (`LOCALAPPDATA=''`, CWD riêng):
```
--key  → exit 0, "kich hoat thanh cong"
CWD tree sau khi chạy:
    XArenaNoFog\lic.bin  2410
    XArenaNoFog\ts       56
```

**Sửa (đã áp dụng):** dùng `or` + ép tuyệt đối, thêm fallback `USERPROFILE`:
```python
_STATE_BASE = (os.environ.get('LOCALAPPDATA') or ''
               or os.environ.get('USERPROFILE') or ''
               or os.path.expanduser('~') or '')
if not _STATE_BASE or not os.path.isabs(_STATE_BASE):
    _STATE_BASE = os.path.abspath(_STATE_BASE or '.')
STATE_DIR = os.path.join(_STATE_BASE, str(_c('STATE_SUBDIR', 'XArenaNoFog')))
```
Xác minh với `LOCALAPPDATA=''`: `STATE_DIR = C:\Users\ADMIN\AppData\Local\XArenaNoFog`, `isabs = True`.

### 🟠 P2-d — `min_ver` chết vì server không gửi (CHƯA SỬA)

`grep min_ver src/` = **0 match**. Client có đủ logic nhưng server không bao giờ trả field này, nên `check_min_version()` luôn `(True, '')`. Không thể cưỡng chế nâng cấp.

**Sửa đề xuất:** thêm `min_ver` vào `publicLic()`/`okWithToken()` trong `src/routes/license-server.js`, đọc từ `settings` (ví dụ `settings.min_client_ver`).
**Không tự sửa** vì đây là quyết định vận hành: đặt `min_ver` sai một lần là **khoá toàn bộ khách đang dùng bản cũ** — chủ shop phải chọn giá trị.

### 🔴 P1-b — `--deactivate` không xoá được bản sao license (CHƯA SỬA)

Cần chủ shop quyết định thiết kế, không tự sửa:

- `run_install` → `_copy_license_to_programdata()` sao `lic.bin` sang `%PROGRAMDATA%\XArenaNoFog\license.dat` rồi siết ACL chỉ Administrators + SYSTEM.
- `--deactivate` chạy **không cần admin** (đúng thiết kế), rồi cố `os.remove(pd)` → **PermissionError bị `except Exception: pass` nuốt im lặng**.
- Test thật (không elevated): `XOA DUOC? KHONG (Access to the path is denied)`.

**Ba hướng, chọn một:**
1. **Bỏ hẳn bản sao** — nó vô dụng: DPAPI scope CurrentUser nên user khác không giải mã được, mà ACL lại chặn cả chính user đó đọc. Đơn giản nhất.
2. **Elevate có thông báo** khi phát hiện `license.dat` — `--deactivate` sẽ xin UAC, hơi phiền.
3. **Dùng `CRYPTPROTECT_LOCAL_MACHINE` cho riêng bản sao** — đúng mục đích backup (máy dùng chung được), nhưng giảm bảo mật vì mọi user trên máy giải mã được.

### 🟡 P3 — `upd.dat` cũ còn sót, và file dev trong thư mục cài (CHƯA SỬA)

1. `C:\ProgramData\Microsoft\Crypto\RSA\upd.dat` (56 bytes, 12/11 00:30) vẫn nằm đó. Code mới không tạo nhưng không dọn. Nên thêm bước migrate xoá nếu tồn tại.
2. `C:\Program Files\XArena\_re\chayduoc\` trên máy này có ~130 file dev: `*.py`, `*.png`, `*.pkl` (`ident.pkl` 16 MB), `build/`, `dist/`, `xa_grant.py` (81 KB), và `xa_license/worker/src/index.js`. Nếu build EXE từ thư mục này thì **toàn bộ tài liệu RE bị đóng gói vào EXE** — cần kiểm tra lại quy trình build.

---

## GHI CHÚ THÊM

**G1 — `--list` vẫn chạy khi key đã bị revoke.** `--list` chỉ đọc token trong `lic.bin`, không gọi server. Key bị revoke vẫn in đủ 17 cổng. Đây là *by design* (`--list` là lệnh xem, không cần admin, không cần mạng), nhưng nghĩa là **token đã cấp không bao giờ bị thu hồi** — nó sống tới hết hạn (`e` trong payload) hoặc khi server từ chối gia hạn. Đường *vá* vẫn an toàn vì `--once`/chế độ thường trú đều gọi `ensure_licensed()` trước. Chấp nhận được, nhưng nên biết.

**G2 — `/api/trial/command` với body `{}` vẫn cấp mã.** Không có `guid`/`bios`/`cpu`/`device_id` → `user_id = dev:ip:<IP>`, `hwid=NULL`. Chỉ còn quota IP/subnet/ngày chặn. Web không bao giờ gửi body này, nhưng gọi API tay thì được. Nếu muốn siết: yêu cầu ít nhất 1 trong `guid|device_id`.

**G3 — `--status` đọc `expires_at` từ state cũ ở lần chạy đầu.** Lần `--status` đầu tiên sau khi server đổi `expires_at` trong DB vẫn in giá trị cũ (30 ngày) vì `show_status()` đọc `st` đã load trước `ensure_licensed()`. Lần thứ hai mới đúng (`Con lai: 0.1 ngay`). Cosmetic, nhưng gây nhầm khi debug.

**G4 — `--list` với `LOCALAPPDATA` rỗng: exit 3, không crash** ✅ đúng yêu cầu. Kèm theo là bug P2-c (ghi vào CWD) nhưng bản thân lệnh xử lý đúng.

---

## KIỂM CHỨNG SAU KHI SỬA (REGRESSION)

Chạy lại toàn bộ đường dẫn bị ảnh hưởng bằng **source đã patch**, trên server production, với key thật:

| Test | Kết quả |
|------|---------|
| `python -X utf8 -c "ast.parse(...)"` | ✅ AST OK — không lỗi cú pháp |
| `--status` (chưa kích hoạt) | ✅ Exit 0, `CHUA KICH HOAT` |
| `--key <key thật>` | ✅ Exit 0, `kich hoat thanh cong` |
| `--list` | ✅ Exit 0, **17 cổng / 3 nhóm** |
| `--help` | ✅ Exit 0, **0 occurrence `None`** |
| `--status` (đã kích hoạt) | ✅ `BAN QUYEN` · `HOAT DONG` · `HWID khop: CO` · `Dong ho: dung` |
| `--deactivate` | ✅ Exit 0, `Da xoa key khoi may nay.` |
| `STATE_DIR` với `LOCALAPPDATA=''` | ✅ Tuyệt đối: `C:\Users\ADMIN\AppData\Local\XArenaNoFog` |
| `_ask_yes_no` không TTY (uninstall) | ✅ **False** (không tự xoá) |
| `_ask_yes_no` không TTY (install) | ✅ **True** (vẫn cài được) |
| `run_uninstall` có final return | ✅ Có (dòng 3476) |
| `_remove_install_dir` không còn dead code | ✅ Không |
| `installer.js` load được | ✅ OK, `EXE_VERSION = 1.4.1.0` |
| `INSTALL_DIR` khớp `INSTALL_EXE_DIR` | ✅ `C:\Program Files\XArenaNoFog\_re\chayduoc` |

**Không thay đổi hành vi bảo vệ bản quyền:** token vẫn verify 17 cổng, ECDSA vẫn chặt, mọi test giả mạo ở mục B vẫn fail như cũ.

---

## VIỆC CẦN LÀM TIẾP

| # | Việc | Ai làm |
|---|------|--------|
| 1 | **Deploy worker** để `INSTALL_DIR` mới có hiệu lực | ops |
| 2 | Dọn `C:\Program Files\XArena\_re\chayduoc\` trên máy đã cài (chỉ thư mục `chayduoc`) | ops |
| 3 | Quyết định P1-b (`--deactivate` + `license.dat`) | chủ shop |
| 4 | Quyết định P2-d (`min_ver` — đặt giá trị nào) | chủ shop |
| 5 | Dọn `%PROGRAMDATA%\Microsoft\Crypto\RSA\upd.dat` trên máy khách cũ | ops |
| 6 | Cân nhắc grace 2–4h cho key trả phí (F35) | chủ shop |
| 7 | Thêm cảnh báo hết hạn cho key trả phí (F38) | dev |
| 8 | **Build lại EXE** để đóng gói 3 fix client (P2-a/b/c) — EXE hiện tại **chưa có** các fix này | dev |

> ⚠️ **Quan trọng:** 3 fix client (P2-a, P2-b, P2-c) đã sửa trong **source** (`tool/src/xa_nofog_pro.py`) nhưng **EXE 1.4.1.0 trên R2 vẫn là bản cũ chưa có fix**. Cần build lại + upload + cập nhật `EXE_SHA256`/`EXE_SIZE`/`EXE_VERSION` trong `installer.js`.

---

## ĐÃ DỌN SẠCH

| Hạng mục | Trạng thái |
|----------|-----------|
| Key test `XAQATEST-*` (B) | ✅ Xoá khỏi `licenses` + `lic_events` |
| Key test `XAQALIVE-*` (EXE live) | ✅ Xoá + `--deactivate` |
| Key test `XAQAENV-*` (env rỗng) | ✅ Xoá |
| Key test `XAQAREG-*` (regression sau patch) | ✅ Xoá + `--deactivate` |
| Key trial `TR-*` (C) | ✅ Xoá cả 4 key + `trial_uses` + `install_tokens` |
| `trial_quota` dev rows | ✅ Xoá |
| `lic_events` liên quan | ✅ Xoá |
| `trial_uses` mồ côi toàn DB | ✅ **0** |
| `lic.bin` / `ts` test | ✅ Xoá (chỉ còn `ts` gốc từ trước phiên QA) |
| `C:\Users\ADMIN\XArenaNoFog` (do P2-c tạo) | ✅ Xoá |
| `_qa_exe\emptyenv*` | ✅ Xoá |
| **Key khách thật** | ✅ **KHÔNG ĐỤNG VÀO** — xem ghi chú dưới |
| Tổng DB sau QA | 4.523 license — tăng 2 so với đầu phiên, **cả 2 là đơn hàng thật của khách** (`MBK-KQVQQK`, `MBK-V4KSHT`) phát sinh trong lúc QA, không phải của tôi |

### Ghi chú về key khách hàng

Hai lần query dọn dẹp của tôi **suýt chạm vào dữ liệu khách thật** vì dùng `note LIKE '%QA%'`:

- `AOE1-H4M4-59GP-Y8ST` — đơn `MBK-UD2QA2` (chữ "QA" nằm trong **mã đơn**, không phải test)
- Đã kiểm tra từng key trước khi xoá, xác nhận `source=null`, `note` là đơn hàng thật → **giữ nguyên cả 3**
- Kiểm tra lại cuối phiên: `AOE1-H4M4-59GP-Y8ST` còn nguyên, `revoked=0`

**Bài học:** không bao giờ dọn dẹp production bằng `LIKE '%QA%'` trên cột `note`. Chỉ dùng tiền tố key (`XAQATEST-%`) hoặc `source='test'`.

**Không chạy** `--install` / `--uninstall` thật (theo yêu cầu mục D). Không thay đổi file nào trong `C:\Program Files\XArena`.

---

## TRẢ LỜI: EXE VÀ LICENSE CÓ HOÀN HẢO KHÔNG?

**Về mặt bảo vệ bản quyền: CÓ, rất tốt.** Kiến trúc mới đã được chứng minh chạy đúng:
- Bảng 17 cổng **không còn một byte nào** trong EXE — đã quét toàn bộ, 0 hit cả ASCII lẫn UTF-16, cả địa chỉ dạng số.
- Token ECDSA P-256 verify đúng, low-S chuẩn hoá, chống malleability, chống invalid-curve attack (`_on_curve` kiểm trước mọi phép toán).
- Mọi đường giả mạo đều đóng: sửa 1 ký tự → fail, đổi gate → fail, key revoke → fail, HWID khác → fail, key trial qua activate → fail, body rỗng/sai kind → 400.
- Server fail-closed khi thiếu `XN_SIGN_JWK` (không dùng khoá dự phòng hardcode).
- Client fail-closed khi không đọc đủ phần cứng (chặn HWID hằng số `bea408e2…`).

**Về mặt vận hành/khách hàng: CHƯA hoàn hảo.** Còn 2 lỗi P1 ảnh hưởng trực tiếp:
1. **Bộ cài đặt EXE vào thư mục game** — lỗi server, đã xảy ra thật, gây 2 bản cài + rác dev trên máy khách + nguy cơ mất game nếu ai đó sửa `INSTALL_ROOT`.
2. **`--deactivate` không xoá sạch license** — báo thành công nhưng key vẫn còn, ảnh hưởng quyền riêng tư khi bán/cho mượn máy.

**Ưu tiên sửa:** ~~P1-a~~ (đã sửa) → P1-b → P2-d → ~~P2-a/b/c~~ (đã sửa) → build lại EXE.

### Tóm tắt trạng thái sau phiên QA

| Hạng mục | Trước QA | Sau QA |
|----------|----------|--------|
| Bảo vệ bản quyền (token/ECDSA/bảng offset) | tốt | **tốt** — không đổi |
| 8 test EXE (mục A) | — | **8/8 PASS** |
| 14 test license (mục B) | — | **14/14 PASS** |
| 11 test trial (mục C) | — | **11/11 PASS** |
| 6 test install guards (mục D) | — | **6/6 PASS** |
| 4 test tự lưu key (mục E) | — | **4/4 PASS** |
| Lỗi P1 | 2 | **1 còn lại** (P1-b) |
| Lỗi P2 | 4 | **1 còn lại** (P2-d) |
| Fix đã áp dụng vào source | 0 | **4** (P1-a, P2-a, P2-b, P2-c) |
| Fix đã có trong EXE trên R2 | — | **0** — phải build lại |

**Chưa hoàn hảo, nhưng đã tốt hơn đáng kể.** Phần *bảo vệ* đã hoàn hảo; phần *vận hành* còn 2 việc chủ shop phải quyết (P1-b, P2-d) và 1 việc ops phải làm (deploy + build lại EXE + dọn máy khách cũ).
