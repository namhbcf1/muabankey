# BÁO CÁO MỔ XẺ APP XA ARENA

> Ngày: 2026-11-20 · Phương pháp: 10 agent đọc song song toàn bộ `tool/` (≈16.000 dòng Python) + đối chiếu với server `src/`
> Đã tự kiểm chứng lại 5 phát hiện nghiêm trọng nhất bằng cách đọc trực tiếp code.

**Không sửa file nào.** Đây là danh sách chờ bạn quyết định.

---

## TÌNH TRẠNG CHUNG

App **không hỏng hoàn toàn** — lõi kỹ thuật (giải mã token ECDSA, bảng địa chỉ engine, patch bộ nhớ game) đã được kiểm tra và **khớp đúng với server**. Vấn đề nằm ở **lớp điều phối**: xử lý lỗi, vòng đời thread, và đồng bộ trạng thái với server.

Ba nhóm lỗi lớn nhất:
1. **Bản đang bán cũ hơn source** — khách không nhận được code mới
2. **Cơ chế chống gian lận bị vô hiệu** — thu hồi key / đá máy đều không có tác dụng
3. **GUI bị treo** ở vài luồng thao tác

---

## A. PHẢI SỬA NGAY

### A1. 🔴 EXE đang bán CŨ HƠN source — không khách nào nhận được bản mới

| | |
|---|---|
| EXE phát hành | `tool/dist-arena/xa_arena.exe` — **18/11 01:53** |
| Source mới hơn | `xa_arena_gui.py` 20/11 · `xa_arena_api.py` 19/11 · `xa_trial_rules.py` 20/11 · `xa_grant_plan.py` 20/11 |
| Version | cả hai đều `3.0.2.0` |

**Đã kiểm chứng:** 4 file source mới hơn EXE. Server trả `3.0.2.0`, app so version thấy bằng nhau nên **không cập nhật**.

Đây đúng là cảnh báo trong RELEASE.md nhưng đang xảy ra thật. `scripts/check_versions.py` vẫn báo "TẤT CẢ KHỚP" vì nó chỉ so chuỗi version, không so thời gian build.

**Sửa:** tăng `APP_VERSION` + `EXE_VERSION` → build lại → cập nhật hash. Thêm bước so mtime vào `check_versions.py`.

---

### A2. 🔴 Thu hồi key bị vô hiệu — cache quyền không có hạn

`tool/app/xa_arena_api.py:917-943`

Khi server trả `revoked` / `expired` / `not_found`, app **chỉ chặn đúng một mã `session_moved`**, mọi mã khác rơi xuống nhánh dùng cache cũ:

```python
if d['code'] == 'session_moved':
    return d                      # ← chỉ mã này được chặn
cached = load_entitlement()       # ← revoked/expired/not_found rơi vào đây
if cached and cached.get('ok'):
    return cached                 # ← trả quyền CŨ, không có TTL
```

`save_entitlement` không ghi mốc thời gian, `load_entitlement` không kiểm tuổi file ⇒ **cache có giá trị vĩnh viễn**.

**Hậu quả:** admin xoá key trên web → app vẫn bật đủ chức năng mãi mãi.

**Sửa:** chỉ dùng cache khi lỗi mạng/5xx; `revoked`/`expired`/`not_found` phải fail-closed.

---

### A3. 🔴 Máy bị đá sang máy khác VẪN chạy được

`tool/app/xa_arena_api.py:1733-1738`

```python
if last_code in ('revoked', 'expired', 'hwid_mismatch', 'not_found',
                 'trial_exhausted', 'account_locked'):
    return False, last_code
# Lỗi lạ: không cắt
return True, ''                   # ← session_moved rơi vào đây
```

Server trả `403 session_moved` khi tài khoản đã bị máy khác chiếm. App coi đó là "lỗi lạ" ⇒ **vẫn vá map sáng**.

Đầu kia của cơ chế cũng chết: `/api/entitlement` **không trả** `isActiveDevice` nên màn hình "Tài khoản đang dùng ở máy khác" không bao giờ bật.

**Hậu quả:** luật "1 nick 1 máy" vô hiệu. Máy cũ dùng hết kỳ hạn.

---

### A4. 🔴 GUI đứng hình tới 12 giây

| Vị trí | Vấn đề |
|---|---|
| `xa_arena_gui.py:3449-3466` | `_stop_patcher_wait()` gọi `wait(8000)` + `wait(4000)` **trên GUI thread**, kích hoạt từ handler mạng |
| `xa_arena_gui.py:3623-3628` | `_grant_amounts()` gọi `_engine()` (quét process + urllib timeout 12s) trực tiếp trên GUI thread |

Khi server trả `session_moved` hoặc khi khách bấm nút cộng tài nguyên → cửa sổ "Not Responding".

**Sửa:** chuyển sang async (`QTimer.singleShot` + poll) như phần còn lại của file đã làm.

---

### A5. 🔴 Lỗ hổng: `--stealth --for N` bỏ qua cổng "chỉ grant cho chính mình"

`tool/grant/xa_grant.py`

- `do_grant()` có cổng cứng (dòng 1690-1697): `if so is not None: raise GrantError('CHI GRANT CHO CHINH MINH')`
- `do_grant_hidden()` **không có cổng này** — đã kiểm chứng bằng cách đọc hàm
- `main()` (dòng 4163-4185) parse `--for N` rồi truyền thẳng `so` vào `do_grant_hidden`

**Đã kiểm chứng:** `--stealth` nằm trong `grant_flags` của app gộp ⇒ đường này chạy được thật, không phải code chết.

**Hậu quả:** `xa_arena.exe --stealth F 5000 --for 3` cộng tài nguyên cho người chơi khác.

---

### A6. 🟠 `/api/entitlement` thiếu khối `trial` → 2 request thừa mỗi 20 giây

Server trả: `ok, now, via, user, licenses, features, hasNofog, hasGrant` — **không có `trial`** (đã kiểm chứng cả 2 nhánh).

`quota_from_entitlement()` luôn trả `None` ⇒ GUI gọi thêm 2× `GET /api/trial/left`. Đúng thứ mà comment trong code nói đã tối ưu được.

---

### A7. 🟠 Token vừa refresh bị ghi đè bằng token CŨ

`tool/grant/xa_grant.py:569-597`

```python
write_token(tokM)          # dòng 576: lưu token MỚI
...
if args_token:
    write_token(tok)       # dòng 596: ghi đè bằng token CŨ
```

Server revoke sid cũ khi cấp sid mới ⇒ lần chạy sau gửi sid đã bị revoke ⇒ `403` ⇒ refresh thất bại vĩnh viễn.

Chỉ xảy ra ở đường `--key <token>` — đúng đường bộ cài `.cmd` dùng.

---

### A8. 🟠 `do_grant_hidden` không bao giờ trả 1

`tool/grant/xa_grant.py:2822-2840` — cả nhánh thành công lẫn thất bại đều `return 0`. Hợp đồng module ghi rõ "TRẢ 1 = ĐÃ GỬI VÀ XÁC MINH THẬT", `RefundWatcher` chỉ xoá nợ khi nhận 1.

**Hậu quả:** `--stealth` luôn exit code 0 kể cả khi thất bại; script kiểm errorlevel tưởng thành công.

---

## B. NÊN SỬA

### B1. HWID không ổn định — khách bị khoá oan

`tool/grant/xa_grant_sec.py:581-629` — spawn PowerShell 2 lần mỗi lần khởi động (timeout 25s), **không cache**. WMI chậm/timeout → BIOS hoặc CPU thành rỗng → HWID đổi → `token_wrong_machine`. Và vì kiểm HWID **trước** khi refresh nên không có đường tự phục hồi.

Thêm nữa: **2 công thức HWID khác nhau** trên cùng máy:
- nhánh bỏ sương mù: SMBIOS mainboard + volume `%08X`
- nhánh tài nguyên: `Win32_BIOS` + volume có gạch

Server chỉ nhận cả hai ở `/api/entitlement`, còn `/api/check` và `/api/xg/*` so đúng 1 giá trị.

### B2. Gói dùng thử TÀI NGUYÊN không bao giờ kích hoạt được

`xa_nofog_pro.py:1567,1584-1591` — khi `product=xagrant` vẫn gửi HWID **công thức nofog** ⇒ `licenses.hwid` bind sai ⇒ `/api/xg/activate` trả `hwid_mismatch` ⇒ khách dùng thử tài nguyên không vào được.

### B3. Đổi máy là ngõ cụt

- App **không có hàm nào** gọi `/api/rebind` (cần token web không cấp nữa, và `_post` không gửi cookie phiên)
- `/api/xg/rebind` là no-op cho bản trả phí
- Cửa sổ "đổi máy" trên web bị **bỏ qua** ở `/api/trial/claim` và `trialCheck`
- `--rebind` lưu HWID mới nhưng **không lưu token mới** ⇒ lần chạy sau báo "Token cấp cho MÁY KHÁC"

### B4. Lỗi server bị báo thành "mất mạng"

`xa_nofog_pro.py:1830-1833` — danh sách `fatal` thiếu `token_invalid`, `wrong_product`, `session_moved`, `reset`. Khách bị đá/dùng sai sản phẩm nhận thông báo "KHÔNG KẾT NỐI ĐƯỢC SERVER, xoá xienhl.com trong hosts".

### B5. `/api/rebind` bị retry dù token dùng-1-lần

`xa_nofog_pro.py:1060-1062` — `retries=1` khiến lần gửi 1 thành công nhưng mất response → retry → `token_used` → khách thấy "Token đã dùng rồi" dù máy **đã đổi xong**.

### B6. Vòng đời QThread — thread mồ côi

`xa_arena_gui.py:2416, 2961, 2430, 3320` — gán lại slot worker (`ent_worker`, `_tok_worker`, `free_worker`, `login_worker`) **không kiểm `isRunning()`**. Thread cũ chạy tiếp nhưng không nằm trong danh sách chờ khi đóng app → có thể crash lúc thoát.

### B7. Tắt "MAP SÁNG" thủ công bị tự bật lại sau ~20 giây

`xa_arena_gui.py:3267-3268` — `_on_tokens_ready()` gọi `_auto_start_patcher()` vô điều kiện. Không có cờ `_nofog_pref_off` như `_x2_pref_off` đã có.

### B8. `acquire_mutex` fail-open

`xa_nofog_pro.py:2319-2320` — không tạo được mutex nào thì `return True` (cho chạy). Hai instance cùng ghi vào 1 process game = hỏng engine.

### B9. `save_state` race giữa các worker

`xa_nofog_pro.py:715-733` — read-modify-write không khoá. Hai worker cùng load rồi save = mất cookie phiên / `xn_token`.

### B10. Đã đăng nhập vẫn hỏi quyền bằng key

`xa_arena_api.py:887-904` — thiếu điều kiện `and not ck`, nên khi đã có session vẫn điền key vào ⇒ server trả `via='key'`, `user=null` ⇒ mất tên tài khoản và mất quyền gộp nhiều license.

### B11. `logout()` không xoá gì

`xa_arena_api.py:1148-1166` — không xoá key trong RAM, không xoá `lic.bin`/`token.bin`. Đăng xuất xong quyền **vẫn bật**.

### B12. Khách chỉ mua tài nguyên không bao giờ được xác thực lại

`server_recheck` chỉ được gọi trong vòng lặp vá map sáng. Khách chỉ có `hasGrant` ⇒ key bị thu hồi vẫn cộng tài nguyên tới khi token hết hạn.

---

## C. DỌN DẸP

### C1. File chết — không nằm trong bản build

| File | Bằng chứng |
|---|---|
| `tool/app/xa_grant_plan.py` | 0 importer trong toàn repo |
| `tool/setup/xa_setup.py` | chỉ import lẫn nhau với `xa_setup_qt.py` |
| `tool/setup/xa_setup_qt.py` | 〃 |
| `tool/setup/build-setup.ps1` | build đúng `xa_setup.exe` đã bỏ |

> ⚠️ `xa_nofog_gui_qt.py` **KHÔNG chết** — vẫn được import trong `xa_nofog_pro.run()` và mở được bằng `xa_arena.exe --once`. Cần chặn cờ này.

### C2. Dead code trong file còn sống

- `check_min_version()` + `EXIT_OUTDATED` — server không bao giờ gửi `min_ver` (0 kết quả grep toàn `src/`)
- `update_enforce()` trong `xa_grant.py` — đọc node `'grant'` đã bị xoá khỏi `/api/app/version`
- `verify_integrity()` / `self_fingerprint()` — lớp chống patch EXE **chưa bao giờ được gọi**
- `update_on_start()` — gọi thiếu `exe_path` nên rollback không bao giờ chạy
- `_x2_tick`, `_x2_timer` — tàn dư chuyển QTimer→RefundWorker

### C3. Hai nguồn sự thật cho cùng một giá trị

- `REFUND_MAX_DROP_PCT` khai 2 lần (`xa_grant.py:2035` và `:2048`)
- `RES_NAME` khai 2 lần với nội dung khác nhau (`:214` food/wood vs `:3157` thit/go)
- Giá bán hardcode `70.000đ/180.000đ/590.000đ/1.290.000đ` (`xa_nofog_pro.py:1484-1489`) — giá thật ở DB
- `TRIAL_LIMIT_DEFAULT = 10` dùng làm mẫu số hiển thị
- `recheck_sec` server trả nhưng client hardcode 300s

### C4. Chuẩn bị build sai

- `README.md:317-319` — recipe build **thiếu `PYTHONPATH`** ⇒ EXE sinh ra không mở được GUI
- `tool/build.ps1` build `xa_nofog_pro.exe` (sản phẩm đã bỏ), không có script nào build `xa_arena.exe`
- `tool/sign/sign-exe.ps1` — **bỏ sót** `xa_arena.exe`, và ghi hash vào 3 file route đã xoá
- EXE **không có chữ ký số** (Certificate Table = 0) ⇒ SmartScreen "Unknown publisher"

### C5. Encoding

Nhiều file trộn tiếng Việt có dấu và không dấu trong cùng file (`xa_nofog_pro.py:5107` "ĐÃ ĐÓNG GAME HÃY MỞ LẠI" vs `:5117` "Khong tim thay game."). Không gây lỗi nhưng khó đọc.

---

## D. CÂU HỎI CẦN BẠN QUYẾT ĐỊNH

1. **Có còn bán gói "dùng thử tài nguyên" không?** Nếu có, B2 là lỗi chặn doanh thu cần sửa trước.
2. **Chính sách đổi máy là gì?** Hiện web cho mở cửa sổ 30 phút nhưng app không có đường nào dùng được (B3).
3. **Có cần giữ "1 nick 1 máy" không?** Nếu có, A3 phải sửa ngay; nếu không thì nên bỏ hẳn cơ chế thay vì để nửa vời.
4. **Cache offline bao lâu là hợp lý?** Hiện là vô hạn (A2). Đề xuất 3 ngày cho khớp `GRACE_SEC` đã có.
5. **Có muốn ký số EXE không?** Cần mua chứng chỉ code signing (~$200-400/năm) để hết cảnh báo SmartScreen.

---

## ĐỀ XUẤT THỨ TỰ LÀM

| Bước | Việc | Thời gian |
|---|---|---|
| 1 | A1 — tăng version + build lại + deploy | 30 phút |
| 2 | A2, A3 — sửa fail-open (thu hồi + đá máy) | 1 giờ |
| 3 | A5 — bịt lỗ hổng `--stealth --for` | 15 phút |
| 4 | A4, B6, B7 — sửa GUI treo + thread | 2 giờ |
| 5 | B1, B2, B3 — HWID + trial tài nguyên + đổi máy | 3 giờ |
| 6 | C1–C5 — dọn dẹp | 2 giờ |

**Trước khi sửa bất cứ gì:** build lại EXE từ source hiện tại (A1) để khách nhận được code mới nhất — kể cả khi chưa kịp sửa các lỗi khác.
