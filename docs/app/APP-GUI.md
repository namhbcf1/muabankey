# APP-GUI — Ghi chú kỹ thuật cho `xa_arena_gui.py` + `xa_theme.py`

Tài liệu này mô tả **đúng theo mã hiện tại** (không theo lời bình luận) của:

| Tệp | Số dòng thực tế | Vai trò |
|---|---|---|
| `tool/app/xa_arena_gui.py` | **3627** | Toàn bộ GUI PyQt6 của `xa_arena.exe` (2 sản phẩm: **No Fog / Map sáng** và **XAGrant / Tài nguyên**) |
| `tool/ui/xa_theme.py` | **582** | Theme dùng chung: token màu, QSS, hàm dựng widget |

Đối chiếu chéo (chỉ đọc, không sửa): `tool/app/xa_arena_api.py` (2321), `tool/app/xa_arena_app.py` (747), `tool/grant/xa_grant.py` (2754/3301 — có 2 bản sao), `tool/src/xa_nofog_pro.py` (4507).

**Ảnh chụp mã đã kiểm (dùng để đối chiếu nếu tệp bị sửa sau này):**

| Tệp | SHA-256 | Số dòng |
|---|---|---|
| `tool/app/xa_arena_gui.py` | `4a3b7ff2cd08d1c25f810837528ecf73806900724ad4d62d0aa94caea6cd65eb` | 3627 |
| `tool/ui/xa_theme.py` | `2f578ce54cdb266e8ba936403df1f5e5e34dcc2112e7f673f82b65a78a42b63e` | 582 |

> ⚠️ Mọi số dòng trong tài liệu này ứng với đúng hai ảnh chụp trên. Nếu ai sửa hai tệp đó, hãy băm lại (`Get-FileHash … -Algorithm SHA256`) — khác băm thì số dòng có thể đã trôi.

**Cách kiểm chứng (đã chạy thật):**
- `python -m pyflakes` cả 2 tệp → **0 cảnh báo** (xem §F).
- `python -c "import ast; ast.parse(...)"` cả 2 tệp → **OK** (56 và 20 node cấp cao nhất).
- Phân tích AST để tìm `self.X` đọc mà không gán (§D3), đếm `except` (127 trong GUI, 62 cái `pass`).
- Thí nghiệm PyQt6 **offscreen** (không ghi đĩa, không mở cửa sổ) để chứng minh lỗi layout và lỗi khoá chiều cao (§D — P1-4, P1-9).

---

## §0. Bảng đổi tên: tên trong bản giao việc ↔ tên thật trong mã

Bản yêu cầu dùng một số tên **không tồn tại** trong mã hiện tại. Dùng bảng dưới đây khi đọc/tra soát:

| Tên trong yêu cầu | Tên thật trong mã | Ghi chú |
|---|---|---|
| `btn_state` | **`lbl_state`** (dòng 1230) | Là `QLabel`, **không** phải nút |
| `btn_nofog` | **`btn_toggle`** (dòng 1305) | Nút "BẬT/TẮT MAP SÁNG" |
| `btn_grant_*` | **`amount_buttons[i]`** (1330–1343) + `tb_buttons` (1413) | Không có `btn_grant_1000`… |
| `ent_*` | **`ent_custom`** (1352) | Chỉ có 1 ô nhập; `ent_key`/`ent_user` nằm trong dialog |
| `box_*` | `box_toast` (1256), `box_quota` (1264), `box_nofog` (1299), `box_grant` (1321) | Đúng như tên |
| `ent_ok` (cờ trong yêu cầu) | **không tồn tại** | Tương đương: `self.ent.get('ok')`, biến cục bộ `d['ok']`, và `API.entitlement_code(self.ent)` |
| `btn_x2` | `btn_x2` (1378) | Đúng |
| `btn_add`, `btn_custom`, `btn_more`, `btn_buy`, `btn_recheck`, `btn_login`, `btn_logout` | cùng tên | Đúng |
| `_tick`, `_rt`, `_x2_timer` | cùng tên | Đúng |
| `GrantWorker`, `FreeTrialWorker`, `EntitlementWorker`, `LoginWorker` | cùng tên | Đúng |
| "`NoFogWorker`" | **`PatchWorker`** (511) | Không có lớp tên `NoFogWorker` |

---

## §A. Bản kiểm kê đầy đủ mọi điều khiển (control inventory)

### A.1 Thanh trên (header, cao cố định 48px — `hdr`, dòng 1218–1222)

| Thuộc tính | Nhãn khách thấy | Việc nó làm | Hàm xử lý | Hiện/ẩn — ai đặt |
|---|---|---|---|---|
| `lbl_ver` | `v<ver>  ·  đang kiểm tra…` → `· mới nhất` / `· lỗi kiểm tra` / `v2.3.7.0  →  2.4.0` / `· đang tải N%` / `· tải lỗi` | Nhãn phiên bản, **bấm được** để kiểm tra bản mới | `mousePressEvent` gán lambda → `_start_update_check(manual=True)` (1162) | Luôn hiện. Chữ do `_build` 1159, `_on_update_found` 1998/2003/2017, `_on_upd_progress` 2042, `_on_upd_done` 2057 |
| `btn_login` | `Đăng nhập` / `Đã đăng nhập` / `Đăng nhập lại` | Mở hộp đăng nhập | `_do_login` (2985) | Luôn hiện (rộng 116). Bật/tắt: `_on_entitlement` 2372–2373 (`setEnabled(not logged)`), `_sync_primary_action` 1750–1751 (bị đá → "Đăng nhập lại" + enable), 2417–2418 và 2870–2871 (chưa có phiên → enable) |
| `btn_logout` | `Thoát` (tooltip "Đăng xuất tài khoản") | Xoá phiên + quyền + key đã nhớ | `_do_logout` (2951) | Ẩn mặc định (1180). Hiện chỉ khi có `username` (`_on_entitlement` 2374). Ẩn lại ở 2405 (không ok), 2514 (bị đá), 2976 (đăng xuất) |
| `btn_update` | `Cập nhật` / `Cập nhật <ver>` / `Đang tải N%` / `Thử lại` | Tải bản mới rồi thay file, `os._exit(0)` | `_do_update` (2022) | Ẩn mặc định (1187). Chỉ hiện khi server báo có bản mới (`_on_update_found` 2019); ẩn ở 2006 (không có bản mới), 2076/2084 (lỗi) |
| `btn_buy` | `Mua` | Mở trang mua trên xienhl.com | `_do_buy` (3013) | Hiện ⇔ **không** `nofog_ready and grant_ready`. Đặt ở `_apply_feature_visibility` 2749 (và ép `True` ở 2834), `_sync_primary_action` 1763 + đổi role `ghost`/`primary` 1764–1768, `_after_free_trial` 2248. Ẩn khi bị đá (1748, 2516) |
| `btn_key` | `Đăng nhập` (tooltip "Đăng nhập tài khoản để app tự lấy license") | Mở `KeyDialog` để dán key tay | `_ask_key` (3026) | **BỊ ẨN VĨNH VIỄN** — `hide()` ở 1213, **không nơi nào gọi `show()`/`setVisible(True)`**. Xem §D — P2-13 |

### A.2 Thẻ trạng thái (`status_card`, 1225–1251, cao khoá bằng `_fix_height(st,24)`)

| Thuộc tính | Nhãn | Việc | Hàm | Hiện/ẩn |
|---|---|---|---|---|
| `lbl_state` | `● Đang kiểm tra…` (đậm, 11pt) | Dòng trạng thái chính | `_state(text, kind)` (1942) — map `kind`→role: `info`→`neutral`, `ok`→`ok`, `warn`→`warn`, `err`→`err`, khác→`dim`; đồng thời gọi `_sync_toggle` (1951) | Luôn hiện |
| `lbl_right` | `Chưa có quyền` / `Quyền: Map sáng + Tài nguyên  ·  còn 3 ngày  ·  <user>` / `Chưa dùng được chức năng nào` / `Tài khoản đang dùng ở máy khác` | Dòng quyền phụ | Ghi ở **4 nơi**: 2355 & 2404 (`_on_entitlement`), **2799** (`_apply_feature_visibility` — ghi CUỐI nên thắng), 2511 (`_enter_kicked`), 2979 (`_do_logout`) | Luôn hiện |
| `btn_recheck` | `Kiểm tra lại` (cao 26) | Hỏi lại quyền với server | lambda → `_refresh_entitlement()` (1245) | Ẩn mặc định (1247). **9 nơi đặt lại** (ngoài lần ẩn ban đầu): 1749 (ẩn khi bị đá), 2359 (ẩn khi ok), 2423 (ẩn khi `NEED_LOGIN_OR_KEY`), **2440** (hiện chỉ khi mã lỗi = `network`), 2513 (ẩn khi bị đá), **2849** (hiện khi "có quyền nhưng chưa dùng được"), 2864/2867 (ẩn), 2876 (ẩn khi sẵn sàng) |

### A.3 Dải thông báo `box_toast` (1256–1258)

| Thuộc tính | Nội dung | Hàm | Hiện/ẩn |
|---|---|---|---|
| `box_toast` (`T.banner('', 'ok')` → `QFrame[role=bannerOk]`, **luôn xanh**) | Chữ nằm ở `box_toast._body` (thuộc tính do `T.banner` gán, 546) | `_toast(text)` (1775) đặt chữ + `show()` + `_relayout()` + `QTimer.singleShot(TOAST_MS=8000, _hide)`; `_hide_toast()` (1802) tắt ngay | Ẩn mặc định. Người gọi: `_notify_gain` (1824). Tự tắt sau 8 s; nếu có toast mới thì toast cũ không tắt hộ (`_toast_seq`) |

### A.4 Khối DÙNG THỬ `box_quota` (1264–1293)

| Thuộc tính | Nhãn | Việc | Hàm | Hiện/ẩn |
|---|---|---|---|---|
| `box_quota` | — | Khối số lượt | `_render_quota` (1667) + `_apply_quota` (1721) | Hiện ⇔ `not _kicked and not (nofog_ready and grant_ready)` — **chỉ đổi khi giá trị đổi** (1712), có `_relayout()` sau đó |
| `lbl_quota` | `còn L/T lượt · còn 2 ngày 3 giờ` / `chưa bật` / `chưa rõ` (đậm 12pt) | Số lượt + thời gian | `_render_quota` 1698 qua `_set_role_text` (1591); role `ok`/`warn`/`err`/`dim` | Luôn hiện khi khối hiện |
| `lbl_quota_sub` | `Tài nguyên: còn L/T lượt` | Số lượt của sản phẩm Tài nguyên | `_quota_res_text` (1657) → 1702–1703 | Tự ẩn khi chữ rỗng |
| `btn_more` | `Nhận thêm lượt` / tạm thời `Đang xin thêm…` (cao 38) | Xin thêm lượt dùng thử cho máy này | `_do_more` (2199) | Hiện ⇔ `not ready and _free_over` (`_sync_primary_action` 1759). Ẩn khi bị đá (1747, 2515). Disable trong lúc chờ (`_do_more` 2208), enable lại ở `_after_free_trial` 2222 |

### A.5 Khối MAP SÁNG `box_nofog` (1299–1318)

| Thuộc tính | Nhãn | Việc | Hàm | Hiện/ẩn |
|---|---|---|---|---|
| `box_nofog` | tiêu đề `MAP SÁNG` | Khối chức năng 1 | — | Hiện ⇔ **`nofog_ready`** (`_apply_feature_visibility` 2744). Ẩn mặc định (1300), ẩn khi bị đá (2502/2711), ẩn khi không quyền (2393), ẩn khi đăng xuất (2974) |
| `btn_toggle` | `BẬT MAP SÁNG` (primary) / `TẮT MAP SÁNG` (danger) / `Đang tắt…` | Bật/tắt vá map sáng | `_toggle_nofog` (3070) | Hiện/ẩn theo `box_nofog`. `setEnabled(False)` khi đang dừng (3093), enable lại ở 3062/3120/2470. Trạng thái nút do `_set_toggle` (3143) qua `_sync_toggle` (1953) — **chỉ đổi theo chữ trạng thái thật** |

### A.6 Khối TÀI NGUYÊN `box_grant` (1321–1420)

| Thuộc tính | Nhãn | Việc | Hàm | Hiện/ẩn |
|---|---|---|---|---|
| `box_grant` | tiêu đề `TÀI NGUYÊN` | Khối chức năng 2 | — | Hiện ⇔ **`grant_ready`** (2745). Ẩn mặc định / khi bị đá / khi không quyền / khi logout (1322, 2394, 2503, 2712, 2975) |
| `amount_buttons[0..3]` | `+1.000`, `+5.000`, `+10.000`, `+50.000` | Cộng số lượng định sẵn | lambda → `_grant_amount(amt)` (1341) → `_grant_amounts` (3233) | Theo `box_grant`; **disable toàn bộ** trong lúc worker chạy (`_busy_buttons` 3205) |
| `ent_custom` | placeholder `Số khác…` (cao 40) | Ô nhập số tuỳ ý | đọc bởi `_grant_custom` (3389) | Theo `box_grant` |
| `btn_custom` | `Thêm` (rộng 66) | Cộng đúng số vừa nhập | `_grant_custom` (3389) | Theo `box_grant`; disable bởi `_busy_buttons` |
| `btn_x2` | `Mua 2 tính 1` → `Mua 2 tính 1 · ĐANG BẬT…` | Bật/tắt hoàn lại ~50% tài nguyên khi mua quân (chỉ máy chủ shop) | `_toggle_x2` (3288) | Hiện ⇔ `grant_ready and _is_shop_machine()` (`_refresh_x2_button` 3277, gọi từ `_apply_feature_visibility` 2899). Ẩn mặc định (1382) |
| `btn_add` | `Thêm nút` (min 104×34) | Tạo nút cộng riêng | `_add_button` (3447) | Theo `box_grant` |
| `tb_area` / `tb_holder` / `tb_buttons` | (các nút tự tạo) | Cuộn ngang chứa nút tự tạo | mỗi nút: lambda → `_grant_amounts(dict)`; chuột phải → `_button_menu(idx)` (3429) | Theo `box_grant`. Dựng lại bởi `_render_buttons` (3402) |

### A.7 Hàng thông tin + nhật ký + chân (1422–1458)

| Thuộc tính | Nhãn | Việc | Hàm | Hiện/ẩn |
|---|---|---|---|---|
| `lbl_game` | `—` / `Chưa mở` / `Đã kết nối` / `Thiếu quyền` | Trạng thái kết nối game | `_on_game_seen` (3064), `_on_game_text` (3067), `_engine` 3189/3202, `_poll_stop_done` 3121, `_kick_stop_patcher` 2474 | Luôn hiện |
| `lbl_lic` | `—` / `Chưa có` / `Còn N ngày` / `Còn N giờ MM phút` / `Còn N phút` / `Vĩnh viễn` / `Đang dùng` / `Sai máy` / `Đã thu hồi` / `Đã hết hạn` / `Máy khác` / `Dùng thử: còn …` | Hạn license | `_refresh_license_label` (2569) — 6 nhánh theo thứ tự 0→5 | Luôn hiện |
| `log` (`QPlainTextEdit[role=log]`, chỉ đọc, tối đa 3000 block) | (nhật ký) | - | `_say` (1474) | Luôn hiện, **khối duy nhất được giãn** (1447) |
| `btn_close` | `Đóng` (rộng 80) | Đóng cửa sổ | `self.close` → `closeEvent` (3564) | Luôn hiện |

### A.8 Hai hộp thoại

| Lớp | Nhãn | Hàm | Ai mở |
|---|---|---|---|
| `LoginDialog` (931) | `Đăng nhập tài khoản xienhl.com`, `Tên đăng nhập`, `Mật khẩu`, nút `Đăng nhập`/`Huỷ` | `values()` → `(user, pass)` | `_do_login` (2987), modal `exec()` |
| `KeyDialog` (972) | `Nhập key bản quyền`, `Dán key của bạn (AOE1-… / XAGR-… / TR-…).`, nút `Đồng ý`/`Huỷ` | `value()` → str | `_ask_key` (3028) — gọi từ `btn_key` (**không hiện được**) và từ `PatchWorker.need_key` (3055) |

---

## §B. Máy trạng thái (state machine)

### B.1 Sơ đồ tổng quát

```
                    ┌──────────────────────── _refresh_entitlement(key, allow_free, quiet) ───────────────────────┐
                    │  quiet=True  -> nếu _workers_busy(): bỏ qua                                          │
                    │  _allow_free = allow_free and key is None and not _kicked                            │
                    │  need_free   = (not token_ok) and (not session_cookie) and (not key cục bộ)           │
                    └───────────────┬──────────────────────────────────────────────┬──────────────────────────┘
                                    │ need_free                                    │ else
                                    ▼                                              ▼
                        FreeTrialWorker (POST /trial)                    EntitlementWorker(with_quota=True)
                                    │ done(dict)                                   │ done(dict)
                                    ▼                                              ▼
                          _after_free_trial(r)                            _on_entitlement(d)
                                    │                                              │
                                    └──── nếu state=='ok' ──► EntitlementWorker ◄───┘
                                                                                   │
                                        ┌──────────────────────────────────────────┤
                                        │ API.session_moved(d) ?                   │
                                        ├── CÓ ──► _enter_kicked(d) ──► (kết thúc, KHÔNG cấp token)
                                        └── KHÔNG ─► _kicked=False
                                                      _apply_quota(_quota,_quota_res)
                                                      _ent_sig = _ent_sig_of(d)      (ghi, không ai đọc)
                                                      _maybe_free_trial(d) ? ──► FreeTrialWorker (return)
                                                      nếu d.ok:
                                                          has_nofog/has_grant ? _ensure_tokens() ──► TokenWorker
                                                                               : ẩn 2 khối + dừng patcher
                                                      nếu not d.ok: nhánh mã lỗi
                                                      _refresh_license_label / _sync_primary_action
                                                                                   │
                                              TokenWorker.done ─────────────────►  _on_tokens_ready(ok,msg,code)
                                                                                   │
                                                                        _apply_feature_visibility(nofog_ready, grant_ready, …)
                                                                                   │
                                                                     (nếu nofog_ready) _auto_start_patcher()
```

### B.2 `_apply_feature_visibility()` — nguồn sự thật duy nhất (2694)

> **Được gọi từ ĐÚNG MỘT nơi:** `_on_tokens_ready` (2945). Không có đường nào khác tới hàm này. Điều đó có nghĩa: nếu `_ensure_tokens()` không chạy được (hoặc quyền = 0 nên không gọi `_ensure_tokens`), giao diện **không** được đồng bộ qua hàm này — xem §D — P2-19.

Tham số: `nofog_ready, grant_ready, reason_nofog='', reason_grant='', next_step=''`.

| Nhánh | Điều kiện | Tác động lên widget | Dòng |
|---|---|---|---|
| **0. Bị đá** | `self._kicked` | `nofog_ready=grant_ready=False`; ẩn `box_nofog`, `box_grant`, `box_quota`; `_quota_visible=False`; `_sync_primary_action()`; `_refresh_license_label()`; `_relayout()`; **return** | 2707–2720 |
| **1. Chuẩn hoá** | luôn | `nofog_ready = arg AND has_nofog`; `grant_ready = arg AND has_grant` (server nói không có quyền thì "ready" bị hạ xuống) | 2723–2724 |
| **2. Quyền mới** | `gained` khác rỗng và `not _first_apply` | `_notify_gain(gained)` → toast + `_say` + `_state('Sẵn sàng','ok')` | 2734–2741 |
| **3. Hiện khối** | luôn | `box_nofog.setVisible(nofog_ready)`; `box_grant.setVisible(grant_ready)` | 2744–2745 |
| **4. Nút Mua** | luôn | `btn_buy.setVisible(not (nofog_ready or grant_ready))` | 2749 |
| **5. `lbl_right`** | luôn | `Quyền: X + Y` hoặc `Chưa dùng được chức năng nào`; nối `  ·  còn <hạn>`; nối `  ·  <username>` | 2754–2799 |
| **6. Lý do (chỉ ghi log)** | `has_X and not X_ready and reason_X` | `_say('Map sáng: …')` / `_say('Tài nguyên: …')` | 2802–2805 |
| **7a. Có quyền nhưng chưa dùng được** | `not nofog_ready and not grant_ready` **và** (`has_nofog or has_grant`) | `btn_buy` hiện; `detail = reason_nofog | reason_grant | next_step`; `_state(detail,'err')` hoặc câu chung; `_say(step)`/`_say(detail)`/`_say('Bấm "Kiểm tra lại"…')`; **`btn_recheck.setVisible(True)`** | 2810–2849 |
| **7b. Hoàn toàn không có license** | như trên nhưng **không** `has_*` | `API.entitlement_code(ent)`: nếu `no_licence` → `_state(state_text_for('no_licence'),'err')` + `_say(next_step)` + **ẩn** `btn_recheck`; ngược lại → `_state('Cần đăng nhập hoặc dán key','warn')` + ẩn `btn_recheck` + ép `btn_login` về "Đăng nhập"/enabled | 2850–2873 |
| **8. Sẵn sàng** | ít nhất 1 ready | `_state('Sẵn sàng','ok')`; ẩn `btn_recheck` | 2874–2876 |
| **9. Kích thước** | luôn | `n == 2` → `_fit_window(600,820)`; `n == 1` → `(500,680)`; `n == 0` → `(440,620)` | 2879–2885 |
| **10. Hậu xử lý** | luôn | `_relayout()`; `_render_quota()`; `_refresh_license_label()`; `_sync_primary_action()`; `_refresh_x2_button()` (trong try) | 2888–2901 |

### B.3 Cờ trạng thái — ai bật, ai tắt

| Cờ | Ý nghĩa | Bật ở | Tắt/ghi đè ở | Ai đọc |
|---|---|---|---|---|
| `has_nofog` (1018) | Server nói có quyền No Fog | `_on_entitlement` 2273 | 2497 (`_enter_kicked`), 2966 (`_do_logout`) | `_apply_feature_visibility` 2723, 2802, 2811; `_auto_start_patcher` 3040; `_more_product` 2193 |
| `has_grant` (1019) | Server nói có quyền Tài nguyên | 2274 | 2498, 2967 | 2724, 2804, 2811; `_more_product` 2192; `_do_buy` 3017 |
| `nofog_ready` (1021) | **Bấm được** (có quyền **và** token dùng được) | chỉ `_apply_feature_visibility` 2723 | 2391 (không quyền), 2499 (bị đá), 2708 (bị đá), 2968 (logout) | `_rt_retune` 1555, `_render_quota` 1711, `_sync_primary_action` 1756, `_toggle_nofog` 3080 |
| `grant_ready` (1022) | **Bấm được** (có quyền **và** `grant_token_ok`) | 2724 | 2392, 2500, 2709, 2969 | 1756, 1711, `_grant_amounts` 3237, `_refresh_x2_button` 3280 |
| `_kicked` (1060) | Tài khoản đang dùng ở MÁY KHÁC | `_enter_kicked` 2489 | 2287 (server hết moved), 2971 (logout), 3005 (đăng nhập lại) | Chặn ở 1707, 1745, 2122, 2599, 2707 |
| `_free_over` (1046) | Đã hết lượt/giờ dùng thử → hiện nút "Nhận thêm lượt" | `_refresh_free_over` 1638/1651 | 1653/1655 (còn lượt), 2491 (`_enter_kicked` đặt False) | `_sync_primary_action` 1757 |
| `_allow_free` (1061) | **Lần hỏi quyền NÀY** được phép tiêu 1 lượt dùng thử | `_refresh_entitlement` 2122 | 2158 (đã dùng để xin), 2564 (đã xin), 2972 (logout) | `_maybe_free_trial` 2550, 2124 (điều kiện `need_free`) |
| `_free_state` (1045) | `ok`/`exhausted`/`banned`/`error`… | `_after_free_trial` 2218 | 2973 (logout), 3006 (đăng nhập lại) | `_refresh_free_over` 1636–1637, `_maybe_free_trial` 2552 |
| `ent` (1016) | Dict quyền đầy đủ | 2272 | 2965 (logout) | `_until_text` 1831, `_refresh_license_label` 2603, `_ent_sig_of` 2293, `entitlement_code` 2858 |
| `_quota` / `_quota_res` | Ảnh chụp lượt (map sáng / tài nguyên) | `_apply_quota` 1724/1732 | **không bao giờ bị xoá** — `_apply_quota` chỉ nhận dict **khác rỗng** (`if isinstance(q, dict) and q`) | `_render_quota`, `_left_sec_now`, `_quota_res_text` |
| `_quota_exp` (1044) | Mốc hết hạn tuyệt đối → đồng hồ tự đếm | `_apply_quota` 1730 | — (không xoá khi logout) | `_left_sec_now` 1613 |
| `_first_apply` (1051) | Bỏ qua báo "quyền mới" ở lần vẽ đầu | `__init__` True | `_apply_feature_visibility` 2741 → False | 2739 |
| `_ent_sig` (1047) | "Dấu vân tay" để khỏi vẽ lại mỗi 20 s | 2293 | — | **KHÔNG AI ĐỌC** (§D — P2-10) |

### B.4 `_sync_primary_action()` (1736) — quy tắc "một nút chính"

```
if _kicked:                       # 1745
    ẩn btn_more, btn_buy, btn_recheck
    btn_login.setText('Đăng nhập lại'); btn_login.setEnabled(True)
    _rt_retune(); return
ready      = nofog_ready or grant_ready
need_more  = (not ready) and _free_over
btn_more.setVisible(need_more)                      # 1759
btn_buy.setVisible(not ready)                       # 1763
btn_buy.role = 'ghost' if need_more else 'primary'  # 1764–1768 (unpolish/polish)
_rt_retune()                                        # 1771
```
Gọi từ: `_render_quota` 1719, `_after_free_trial` 2251, `_on_entitlement` 2444, `_enter_kicked` 2533, `_apply_feature_visibility` 2717 (nhánh bị đá) và 2896.

### B.5 `_render_quota()` (1667) — quy tắc vẽ khối dùng thử

1. `left = _quota['left']`, `total`, `left_sec = _left_sec_now()` (ưu tiên `_quota_exp - now`, không có thì `left_sec` của server).
2. `bits`: `còn L/T lượt` (nếu `API.fmt_quota` trả khác rỗng) + `API.fmt_left(left_sec)` (nếu > 0).
3. Không có `bits` → chữ `chưa bật` (nếu `not q['has']`) hoặc `chưa rõ`, role `dim`.
4. Có `bits` → role: `err` nếu `left <= 0 and left_sec <= 0`; `warn` nếu `left <= 2` hoặc `left_sec < 600`; còn lại `ok`.
5. `lbl_quota_sub` = `_quota_res_text()`, ẩn nếu rỗng.
6. `box_quota` hiện ⇔ `(not _kicked) and not (nofog_ready and grant_ready)` — **chỉ gọi `_relayout()` khi giá trị `show` đổi**.
7. `_sync_primary_action()`.

### B.6 `_rt_retune()` (1548) — nhịp hỏi server

| Điều kiện | Chu kỳ | Hằng |
|---|---|---|
| `_kicked` | 300 000 ms | `RT_KICKED_MS` |
| chưa dùng được gì (`not (nofog_ready or grant_ready)`) | 20 000 ms | `RT_WAIT_MS` |
| đã dùng được | 60 000 ms | `RT_IDLE_MS` |

Chỉ `setInterval` + `start()` khi giá trị **khác** giá trị hiện tại → không reset pha mỗi giây.

### B.7 Lan truyền thay đổi quyền (entitlement → widget)

```
1. Timer/Focus/Click ──► _refresh_entitlement(key, allow_free, quiet)
2. EntitlementWorker.run (thread nền)
      fetch_entitlement() | fetch_by_key(key)
      + with_quota: quota_from_entitlement(d,'nofog'/'xagrant') -> quota_snapshot(prod) -> d['_quota'], d['_quota_res']
3. _on_entitlement(d)          [GUI thread]
      ent, has_nofog, has_grant
      session_moved(d) ─► _enter_kicked()  (dừng patcher, ẩn hết, 1 nút "Đăng nhập lại")
      _apply_quota()  ─► _refresh_free_over() + _render_quota() + _sync_primary_action()
      _maybe_free_trial() ─► FreeTrialWorker (return sớm)
      has_nofog|has_grant ─► _ensure_tokens()
4. TokenWorker.run             [thread nền]
      API.ensure_tokens(ent, on_step)  ─► step signal ─► _state()
      API.ensure_grant_token(ent)
5. _on_tokens_ready(ok,msg,code)  [GUI thread]
      code = API.error_code_of(code or msg); step = API.next_step_for(code)
      nofog_ready = API.token_ok()        (nếu has_nofog)
      grant_ready = API.grant_token_ok()  (nếu has_grant)
6. _apply_feature_visibility(nofog_ready, grant_ready, why_n, why_g, step)
7.  ─► box_nofog/box_grant/btn_buy/lbl_right/btn_recheck/_state/_render_quota/_sync_primary_action/_refresh_x2_button
8. nếu nofog_ready ─► _auto_start_patcher()  ─► PatchWorker (vá byte)
```

---

## §C. Toàn bộ worker / thread và đồng hồ

### C.1 Bảng worker

| Lớp | Dòng | Chạy ở đâu | Chạm vào đâu | Tín hiệu → slot | Nếu chậm | Chạy chồng được? |
|---|---|---|---|---|---|---|
| `UpdateCheckWorker` | 327 | QThread mới mỗi lần | `xa_arena_app._updater().check('https://xienhl.com','arena')`, `is_newer` | `found(object)` → `_on_update_found` | Không ảnh hưởng GUI; nhưng **không có guard** → bấm nhãn version 5 lần = 5 thread, mỗi thread 1 object cha là window, **không bao giờ được `deleteLater`** | CÓ (tự chồng chính nó) |
| `UpdateDownloadWorker` | 366 | QThread | `U.download()`, `progress` cb | `progress(g,t)` → `_on_upd_progress`; `done(ok,msg)` → `_on_upd_done` | Tải xong → `U.apply_and_restart` + `os._exit(0)` **trên GUI thread** | Không (nút bị disable 2026) |
| `TokenWorker` | 391 | QThread | `API.ensure_tokens` + `ensure_grant_token` (mạng, HWID, DPAPI, ghi token) | `step(str)` → `_state`; `done(ok,msg,code)` → `_on_tokens_ready` | Có thể lâu (mạng) | **CÓ** — `_ensure_tokens` (2687) **không** kiểm `_workers_busy` |
| `FreeTrialWorker` | 418 | QThread | `API.ensure_free_trial(product)` — **tiêu 1 lượt của khách** | `done(dict)` → `_after_free_trial` | — | Bị chặn bởi `_workers_busy` ở `_do_more` 2206 và `_maybe_free_trial` 2562 |
| `EntitlementWorker` | 441 | QThread | `fetch_entitlement`/`fetch_by_key` + `quota_from_entitlement`/`quota_snapshot` | `done(object)` → `_on_entitlement` | — | **CÓ** khi gọi không `quiet` (nút "Kiểm tra lại", sau đăng nhập, sau nhập key) |
| `LoginWorker` | 490 | QThread | `API.login(u,p)` | `done(ok,msg)` → `_on_login` | — | CÓ (không guard) |
| `PatchWorker` | 511 | QThread sống lâu, vòng lặp 2 s | `xa_nofog_pro`: `load_state`, `_load_sites` (90 s), `server_recheck` (**mạng**, 300 s), `find_game`, `attach`, `in_match`, `apply_set` | `log(str)`→`_say`; `state(str,str)`→`_state`; `game_seen(bool)`→`_on_game_seen`; `game_text(str)`→`_on_game_text`; `need_key()`→`_ask_key` | Không ảnh hưởng GUI (trừ `_stop_patcher_wait`) | Không (chặn bởi `isRunning()` 3046) |
| `GrantWorker` | 753 | QThread mỗi lần bấm | `xa_grant.do_grant` trong `with XG.engine_lock()` | `log`→`_say`; `state`→`_state`; `finished_ok(bool)`→`_busy_buttons(False)` | **Rất lâu** — xem C.3 | Không (guard `isRunning()` 3241) |

### C.2 Đồng hồ

| Tên | Chu kỳ | Callback | Việc làm | Dừng ở đâu |
|---|---|---|---|---|
| `_tick` | `RT_TICK_MS` = **1000 ms** | `_on_tick` (1563) | `_refresh_free_over()` + `_render_quota()` — **chỉ đổi chữ, không gọi mạng, không đọc đĩa** | `closeEvent` 3601–3607 (`_w.stop()`) |
| `_rt` | 20 000 / 60 000 / 300 000 ms | `_rt_tick` (1536) | `_refresh_entitlement(allow_free=False, quiet=True)`; bỏ qua nếu `_closing`, `_workers_busy()`, hoặc cửa sổ ẩn | 3601–3607 |
| `_x2_timer` | **200 ms** (hardcode 3308) | `_x2_tick` (3337) | `RefundWatcher.tick()` → đọc/ghi bộ nhớ game, hoàn tài nguyên | `_x2_off` 3323–3325 (gọi từ 3284, 3291, 3369, `closeEvent` 3598) |
| `QTimer.singleShot` | 2500 ms | `_start_update_check` | Kiểm tra bản mới sau khi mở | một lần |
| | 60 000 ms | `_good()` | `APP.update_mark_good()` | một lần |
| | `TOAST_MS` 8000 | `_hide` (closure) | Tắt `box_toast` nếu chưa có toast mới | một lần, có guard `_toast_seq` |
| | 120 ms, tự lặp | `_poll_stop_done` | Chờ `PatchWorker` dừng, hạn 12 s | tự dừng khi xong/hết hạn |
| | 300 ms | `_auto_start_patcher` (3044) | Thử lại khi `_stopping` | một lần |

### C.3 Trả lời 3 câu hỏi bắt buộc

**(1) Hai worker có thể chạm engine cùng lúc không? → CÓ, ở 4 chỗ:**

1. `PatchWorker` (module `xa_nofog_pro`) **ghi bộ nhớ game** (`apply_set`) mà **không hề** lấy `xa_grant.engine_lock()`. Khoá đó chỉ tồn tại trong `xa_grant` (dòng 1885 `_ENGINE_LOCK = RLock`). ⇒ Vá map sáng và cộng tài nguyên là **hai hệ khoá hoàn toàn tách biệt** — không có gì bảo đảm chúng không chạy đồng thời trên cùng tiến trình game.
2. `_engine()` (3155) chạy trên **GUI thread**: `XG.find_game()` 3175, `XG.open_game()` 3181, `XG.module_base()` 3194, `XG.ensure_engine(None)` 3195 — **không** khoá. Được gọi khi bấm nút tài nguyên và khi bấm `btn_x2`.
3. `_toggle_x2` (3288) trên GUI thread: `XG.resolve_chain(eng[0])` 3303 và `XG.RefundWatcher(...)` 3304 (hàm khởi tạo **đọc bộ nhớ** qua `_playerdata()`) — **không** khoá.
4. `API.grant_token_ok()` → `XG.ensure_engine(None)` chạy trên **GUI thread** tại `_on_tokens_ready` 2939 — **không** khoá, và hàm này có thể **gọi mạng** (`_sec.refresh_token`) + đọc HWID.

**(2) `engine_lock()` có được dùng ở mọi nơi cần không? → KHÔNG.** Toàn bộ GUI chỉ có **2** chỗ dùng khoá: dòng **878** và **894** (bọc `XG.do_grant` trong `GrantWorker`).

**(3) `_busy_buttons()` có khoá mọi nút có thể gọi engine không? → KHÔNG.** `_busy_buttons` (3205) chỉ tắt `amount_buttons + [btn_custom]`.

| Nút | Có bị `_busy_buttons` tắt? | Có gọi engine? | Bảo vệ thay thế |
|---|---|---|---|
| `amount_buttons[0..3]` | ✅ | gián tiếp qua `_grant_amounts` | — |
| `btn_custom` | ✅ | gián tiếp | — |
| `tb_buttons` (nút tự tạo) | ❌ | **CÓ** (→ `_grant_amounts`) | guard `grant_worker.isRunning()` 3241 |
| `btn_x2` | ❌ | **CÓ** (`_engine`, `resolve_chain`, `RefundWatcher`) | chỉ `_is_shop_machine()` — **không** kiểm `grant_worker` |
| `btn_toggle` | ❌ | CÓ nhưng qua module khác (`PatchWorker`) | `_stopping` |
| `btn_add` | ❌ | không | — |
| `btn_more`, `btn_recheck`, `btn_login`, `btn_buy` | ❌ | không (chỉ mạng) | `_workers_busy` (không đủ, xem §D — P2-20) |

### C.4 Thời gian chạy thực tế của `GrantWorker` (rất quan trọng cho UX)

Với `GRANT_CAP = 10000` và mức mỗi bước phút 1 = `GRANT_STEP_P1 = 100`:

```
steps  = ceil(10000 / 100) = 100 bước
mỗi bước cách nhau GRANT_STEP_GAP_MS = 1500 ms
→ 99 × 1.5 s ≈ 148 s cho MỘT loại tài nguyên
→ 3 loại (F, W, G) + 2 × GRANT_DELAY(1 s) ≈ 448 s ≈ 7 phút 28 giây
```
Trong suốt thời gian đó **tất cả** nút số lượng bị disable, không có nút Huỷ, không có thanh tiến trình. Khách gần như chắc chắn sẽ tưởng app treo (§D — P1-5).

---

## §D. Danh sách lỗi thật, xếp theo mức nghiêm trọng

> Không có lỗi nào dưới đây được sửa — chỉ báo cáo + đề xuất cách sửa.

### P0 — Sản phẩm Tài nguyên (XAGrant) KHÔNG hoạt động

**P0-1 · `GrantWorker.run` gọi một hàm không tồn tại → mọi lần bấm cộng đều thất bại**
- **Dòng 855**: `mins = self._match_minute()`
- `self` ở đây là **`GrantWorker`**, và lớp này chỉ có `__init__`, `_label`, `run` (đã kiểm bằng AST). `QThread` không có `_match_minute`. ⇒ `AttributeError: 'GrantWorker' object has no attribute '_match_minute'`.
- Ngoại lệ bị `except Exception as e:` ở **dòng 904** bắt, rồi chỉ ghi `_tech_file(...)` (no-op khi tắt debug) + `self.log.emit('Chưa cộng được tài nguyên này. Bấm "Kiểm tra lại".')`; `okn` vẫn 0 → dòng 918 `'Không cộng được'` (err) → `finished_ok.emit(False)`.
- ⇒ **Không một lệnh `do_grant` nào được thực thi.** Toàn bộ 4 nút số lượng, nút "Thêm", và mọi nút tự tạo đều chỉ hiện "Không cộng được".
- **Cách sửa:** chuyển phút vào worker qua `__init__` (ví dụ `GrantWorker(h, base, amounts, minute, parent)`), hoặc tính `cap` ở GUI rồi truyền `step_cap`; trong `run()` dùng `self.minute` thay vì `self._match_minute()`.

**P0-2 · `ArenaWindow._match_minute` đọc thuộc tính không tồn tại**
- **Dòng 3223**: `sec = fn(self.h, self.base)`
- `ArenaWindow` **không** có `self.h`/`self.base` (đã kiểm bằng AST: chỉ `PatchWorker` và `GrantWorker` có 2 thuộc tính này). Handle thật nằm ở `self.grant_engine = (h, base)` (3201).
- ⇒ Luôn `AttributeError` → bị `except Exception: return 1` (3227–3228) nuốt → **luôn trả 1** → mức cộng luôn là `GRANT_STEP_P1 = 100`, cơ chế "tăng dần theo phút" không bao giờ chạy, và lỗi bị che hoàn toàn.
- **Cách sửa:** `if not self.grant_engine: return 1` rồi `fn(*self.grant_engine)`; đồng thời bỏ `except: return 1` hoặc ghi `_tech_file`.
- *Ghi chú:* ngay cả khi sửa xong, `xa_grant.match_seconds` hiện **trả 0 khi chưa đo được offset** (ghi rõ ở `xa_grant.py` 2159–2165) nên vẫn luôn ra phút 1.

**P0-3 · (ngoài phạm vi tệp của tôi — `tool/grant/xa_grant.py` 2012–2019) `RefundWatcher.tick()` rò khoá engine**
- `tick()` lấy `_ENGINE_LOCK` bằng `acquire(blocking=False)` ở 2012, nhưng có **2 lối thoát sớm không nhả khoá**:
  - 2015–2016: `cur = self._read()` → `if cur is None: return []`
  - **2017–2019: `if self.prev is None: self.prev = cur; return []` ← lần gọi ĐẦU TIÊN luôn rơi vào đây**
- Hệ quả dây chuyền sang GUI: sau khi bật "Mua 2 tính 1" ~200 ms, mọi `with XG.engine_lock():` trong `GrantWorker` (dòng 878/894) **treo vĩnh viễn** vì GUI thread đang giữ RLock → `finished_ok` không bao giờ phát → `_busy_buttons(False)` không bao giờ chạy → **các nút cộng bị khoá vĩnh viễn**; `closeEvent` phải chờ `w.wait(4000)`.
- **Cách sửa (thuộc chủ sở hữu `xa_grant.py`):** bọc toàn bộ thân `tick()` trong `try: … finally: _ENGINE_LOCK.release()`.

### P1 — Sai/hỏng nhìn thấy rõ hoặc treo giao diện

**P1-4 · Nút "Nhận thêm lượt" bị cắt vì chiều cao khối khoá cũ**
- `box_quota` được `_fix_height(self.box_quota, 16)` (1292, 1899) — khoá chiều cao theo `sizeHint()` **tại thời điểm đó**; hàm này loại widget **đang ẩn** khỏi `sizeHint`.
- `btn_more` được `_sync_primary_action()` bật hiện (1759) **sau** `_relayout()` và **không** có `_relayout()` tiếp theo sau đó (không có ở 1759, 2444, 2533, 2717, 2896).
- **Đã chứng minh bằng thí nghiệm PyQt6 offscreen:** khoá cao 71 px trong khi `sizeHint` sau khi hiện nút là **96 px** → `btn_more` bị đặt ở y=0 và bị cắt (`CLIPPED? True`).
- **Cách sửa:** gọi `self._relayout()` ở cuối `_sync_primary_action()` khi `btn_more` đổi trạng thái hiện/ẩn.

**P1-5 · Một lần bấm +10.000 mất ~7,5 phút, không huỷ được** — xem §C.4 (855–900 + 76/92/75).
- **Cách sửa:** rút `GRANT_STEP_GAP_MS` theo tổng thời gian mong muốn (ví dụ `steps × gap ≤ 20 s`), hoặc cho phép huỷ (`stop()` + kiểm tra trong vòng lặp).

**P1-6 · Nút "+50.000" nói dối khách**
- `AMOUNTS` (53–56) có `50000`, nhưng dòng 852 `total = min(total, GRANT_CAP)` cắt còn **10.000 mỗi loại**.
- Nhãn báo cáo lại lấy từ `self.amounts` **chưa cắt** (`_label()` 771–773) → dòng 909/910 in `Đã cộng 50.000 thịt + 50.000 gỗ + 50.000 vàng` trong khi chỉ cộng 30.000 tổng.
- **Cách sửa:** hoặc bỏ tile 50.000, hoặc cắt ngay trong `__init__` và báo số **thực đã gửi** (`sent`).

**P1-7 · `_stop_patcher_wait()` chặn GUI tới 12 giây ngay giữa phiên**
- Hàm 3124: `w.wait(8000)` rồi `w.wait(4000)` — chạy trên GUI thread.
- Bị gọi từ `_kick_stop_patcher` 2467 ← `_enter_kicked` 2494 ← `_on_entitlement` (callback của đồng hồ 20 s) ⇒ **mỗi lần bị đá sang máy khác, cửa sổ đứng hình tới 12 s**, đúng lúc khách đang cần đọc thông báo.
- Cũng bị gọi ở `_on_upd_done` 2067 và `closeEvent` 3586 (hai chỗ này chấp nhận được).
- **Cách sửa:** dùng lại cơ chế không chặn `_stop_patcher` + `_poll_stop_done`, chỉ báo "đã tắt map sáng" khi poll xong.

**P1-8 · Gọi mạng/đọc phần cứng trên GUI thread**
- `_on_tokens_ready` 2939 → `API.grant_token_ok()` → `XG.ensure_engine(None)` → có thể `_sec.refresh_token(...)` (mạng) + `_sec.compute_hwid()` + `_guard.scan()`.
- `_engine()` 3195 → `XG.ensure_engine(None)` — trên **mỗi** lần bấm cộng.
- `_is_shop_machine` 3264 → `API.machine_hwid()` → `xa_nofog_pro.compute_hwid()` (đọc GUID/BIOS/CPU/volume) — gọi từ `_refresh_x2_button` mỗi chu kỳ quyền.
- ⇒ Cửa sổ có thể đứng nhiều giây mỗi 20–60 giây khi token cũ.
- **Cách sửa:** đưa `grant_token_ok()` và `machine_hwid()` vào worker/`TokenWorker`, cache kết quả.

**P1-9 · Lưới nút số lượng có 1 ô trống + 1 widget bị đăng ký 2 lần**
- 1331–1345: vòng lặp đặt đủ 4 nút vào (0,0),(0,1),(1,0),(1,1); sau đó dòng **1345** `grid.addWidget(last, 2, 0, 1, 2)` **thêm lại** nút thứ 4 vào ô (2,0) span 2 cột.
- **Đã chứng minh offscreen:** `grid.count() == 5` cho 4 widget; ô (1,1) vẫn giữ một item trỏ vào **cùng** QPushButton; nút +50.000 được vẽ ở hàng 2 → ô (1,1) trống hoác.
- **Cách sửa:** bỏ dòng 1345 (muốn nút cuối rộng thì phải `continue` khi `idx == len(AMOUNTS)-1` trong vòng lặp).

### P2 — Lỗi thật nhưng chưa gây hỏng ngay

| # | Dòng | Lỗi | Cách sửa |
|---|---|---|---|
| P2-10 | 2293 (+1047) | `_ent_sig` được **ghi mà không ai đọc**; cơ chế "đừng vẽ lại mỗi 20 s" mô tả ở 1039–1041 và 1859–1864 **không tồn tại** | Dùng nó: `if sig == self._ent_sig: return` đầu `_on_entitlement`, hoặc xoá hẳn |
| P2-11 | 2362–2368 | Khối hiện key: tính `_k = API.grant_key_of(d) or API.nofog_key_of(d)` rồi `pass` → **mã chết** | Xoá khối, hoặc thực sự dùng `_mask_key` (hiện `_mask_key` cũng là mã chết — 159) |
| P2-12 | 2675–2680 | `if revoked and len(revoked)==len(lics): _set('Đã thu hồi'); return` rồi ngay sau `if revoked: _set('Đã thu hồi'); return` — **hai nhánh y hệt nhau**, nhánh đầu vô nghĩa | Gộp còn `if revoked:` |
| P2-13 | 1209–1214 | `btn_key` tạo, nối `_ask_key`, thêm vào layout, `hide()` — **không bao giờ hiện** → điều khiển không thể bấm. Tệ hơn: 2422 và 2983 bảo khách *"Bấm Đăng nhập hoặc **Nhập key**"* — nút đó **không tồn tại** | Hoặc bỏ `btn_key` + sửa 2 câu hướng dẫn, hoặc cho nó hiện khi cần |
| P2-14 | 33, 159 | `_HERE` và `_mask_key` không dùng ở đâu (đếm: 1 lần xuất hiện = chính dòng định nghĩa) | Xoá |
| P2-15 | 124 & 127 | `RT_TICK_MS = 1000` khai báo **hai lần** | Xoá 1 |
| P2-16 | 825–828 vs 848–851 | Khối `total = int(self.amounts.get(r) or 0)` + `if total <= 0:` lặp y hệt hai lần | Xoá khối đầu |
| P2-17 | 2951–2983 | `_do_logout` **không** gọi `_apply_feature_visibility` (phá "nguồn sự thật duy nhất") và **không** gọi `_x2_off()` → nếu "Mua 2 tính 1" đang BẬT thì đồng hồ 200 ms + `RefundWatcher` **tiếp tục ghi vào game** sau khi đã mất quyền | Thêm `self._x2_off()` và `self._apply_feature_visibility(False, False)` |
| P2-18 | 2951+, 1042–1044 | `_quota`, `_quota_res`, `_quota_exp` **không** bị xoá khi đăng xuất → khối "Dùng thử: còn 3/10" còn nguyên số cũ | Gán `{}`/`0` trong `_do_logout` |
| P2-19 | 609–613, 745–746 | `PatchWorker` phát hiện license hết hạn giữa trận chỉ `state.emit(...)`; **không** ai đặt `nofog_ready=False` → khối vẫn hiện, nút vẫn bấm được, `_apply_feature_visibility` không chạy lại | Nối thêm signal (hoặc kiểm trong `_state`) để hạ `nofog_ready` và gọi lại `_apply_feature_visibility` |
| P2-20 | 2687, 2098 | `_ensure_tokens` không kiểm `_workers_busy`; `_refresh_entitlement(quiet=False)` cũng không → bấm "Kiểm tra lại" liên tục sẽ **xếp chồng** TokenWorker/EntitlementWorker (mỗi cái đều gọi mạng + ghi token) | Thêm `if self._workers_busy(): return` cho cả hai |
| P2-21 | 1518–1534 | `_release_worker` hầu như **không có tác dụng**: `done` được emit **bên trong** `run()` nên khi slot chạy, `isRunning()` thường còn `True` → không `deleteLater` → QThread (có parent là window) **tích tụ** mỗi 20–60 s | Nối `w.finished` → `deleteLater` (hoặc tạo **không** parent) |
| P2-22 | 3352, 3363 | `_x2_tick` đọc **thuộc tính riêng** `w._pd` của `xa_grant.RefundWatcher` → đổi tên bên kia là hỏng âm thầm | Thêm API công khai `watcher.ready()` bên `xa_grant` |
| P2-23 | 1974–1984 | `_start_update_check` tạo worker mới mỗi lần bấm nhãn version, **không** guard, **không** `deleteLater`, `_upd_worker` bị ghi đè → mất tham chiếu | Guard `isRunning()` + `_release_worker('_upd_worker')` |
| P2-24 | 3104–3122 | `_poll_stop_done` gọi `_set_toggle`/`_state` **không** try; nếu cửa sổ đã bị huỷ khi chuỗi 120 ms còn treo → `RuntimeError` ném vào slot Qt | Bọc try hoặc huỷ chain khi `_closing` |
| P2-25 | 301–308, 3454 | `save_buttons` trả `False` khi lỗi nhưng **mọi chỗ gọi đều bỏ qua** → khách tạo nút, khởi động lại thì mất, không một lời nào | Kiểm giá trị trả về, báo `_say('Chưa lưu được nút…')` |
| P2-26 | 3390 | `_grant_custom`: `replace('.','').replace(',','')` → khách gõ `1,5` thành **15**, gõ `1.5` thành **15** (đều hợp lệ `isdigit`) | Chỉ chấp nhận `\d{1,7}` hoặc `\d{1,3}(\.\d{3})*` |
| P2-27 | 3518 | `_confirm`: `except Exception: return True` → lỗi thì **tự đồng ý** cho hành động phá huỷ | Trả `False` khi lỗi |
| P2-28 | 3572–3609 | Worst case đóng cửa sổ: `_stop_patcher_wait` 12 s + `_stop_all_workers` tối đa 7 × 4 s = **40 s** đứng hình | Chỉ `wait` worker đang chạy, tổng hạn 2–3 s |
| P2-29 | 1691, 1693 | `int(left)` **không** nằm trong try trong `_render_quota` → nếu server trả `left` không phải số, `ValueError` ném vào slot `_tick` (PyQt6 sẽ in traceback, có thể abort) | `try: left = int(left) except: left = None` |
| P2-30 | 1071 | `self.setWindowTitle(API and 'XA ARENA')` — biểu thức vô nghĩa (`API` là module nên luôn truthy) | `APP_NAME` hoặc chuỗi thẳng |
| P2-31 | 3317, 3333, 3365 | `_set_role_text(btn_x2, …, 'ok'/'ghost')` — QSS **không** có `QPushButton[role="ok"]` → khi "ĐANG BẬT" nút rơi về style mặc định, không có màu xanh | Thêm `QPushButton[role="ok"]` vào theme hoặc dùng `primary` |
| P2-32 | 59 vs `xa_grant.RES_NAME` | `RES_VN['S'] = 'đá'` không bao giờ dùng (`RES_ORDER` = F,W,G) nhưng `load_buttons` vẫn đọc/ghi `'S'` từ JSON → dữ liệu khách bị bỏ qua âm thầm | Bỏ `'S'` hoặc thêm vào `RES_ORDER` |

### D.5 `except: pass` che lỗi thật trên đường dẫn khách hàng

Tổng: **127** `except` trong GUI, **62** cái chỉ `pass`. Những cái **có hại thật**:

| Dòng | Nuốt cái gì | Hậu quả cho khách |
|---|---|---|
| **739–740** | `NF.apply_set(..., True, ...)` khi worker thoát — **trả byte gốc** | Nếu thất bại: byte đã vá **vẫn nằm trong game** (map vẫn sáng tới khi tắt game) mà **không một dòng log nào** (không cả `_tech_file`) |
| **703–704** | `apply_set(..., True, ...)` khi ra khỏi trận | Như trên, im lặng |
| **607** | `ok2, msg2 = True, ''` khi đọc state lỗi | License **fail-open**: đọc lỗi thì vẫn vá tiếp |
| **628–629** | `okS, whyS = True, ''` khi `server_recheck` lỗi | Key bị thu hồi nhưng mạng lỗi → vẫn chạy (fail-open, có chủ đích nhưng là rủi ro doanh thu) |
| **3227–3228** | `except Exception: return 1` trong `_match_minute` | Che chính lỗi P0-2 |
| **1092–1093** | dọn file tạm | không sao |
| **576–577** | `NF._load_sites(st)` lúc khởi động | về sau `_require_sites()` báo lỗi — chấp nhận |
| **643–644** | cập nhật lại `sites` | giữ bảng cũ — chấp nhận |
| **2367–2368**, 2352, 2623, 2794, 2900, 3285, 3334, 3386, 3424, 3551, 3606, 1903, 1908, 1939, 1969, 1983, 2014, 2043, 2090, 2234, 2249, 2398, 2419, 2471, 2475, 2505, 2519, 2750, 2835, 2872, 2962, 3171, 3329, 3599, 1543, 1560, 1585, 1608, 1704, 1760, 1769, 1782, 1788, 1807, 173, 188, 294, 1514, 1479, 3621, 1103 | thuần UI | chấp nhận được, nhưng làm mờ lỗi thật khi cần debug |

### D.6 Chuỗi lộ chi tiết kỹ thuật cho khách — **KẾT QUẢ: SẠCH**

Đã quét mọi chuỗi đi vào `_say` / `_state` / `setText` / `emit` / `T.label` / `T.btn` / `setToolTip` / `setPlaceholderText`:

- **Không** có `0x`, địa chỉ, HWID, tiền tố `xn1.`/`xg1.`, `.py`, `cmd`, `powershell`, `token` trong bất kỳ chuỗi nào khách thấy. ✅
- Chi tiết kỹ thuật đi đúng đường `_tech_file()` → `API.debug_log()` → **no-op tuyệt đối** khi không có `XA_DEBUG` (đã kiểm `xa_arena_api.debug_log` 644–648).
- Chữ **"key"** xuất hiện (611, 986, 991) nhưng là từ vựng bán hàng ("key bản quyền"), **không** phải token kỹ thuật → chấp nhận.
- ⚠️ Hai chỗ **nói tới một nút không tồn tại**: 2422 `Bấm "Đăng nhập" hoặc "Nhập key" để bắt đầu.` và 2983 `… hoặc "Nhập key" để dùng lại.` — xem P2-13.
- ⚠️ Lỗi chính tả lộ ra cho khách: **716** `'Không va được vào game lần này.'` (phải là "vá"), và **907** `'Chưa cộng được tài nguyên này.'` (dùng đúng) — chỉ 716 sai.

### D.7 Hộp thoại modal chặn GUI thread

| Dòng | Hộp | Đánh giá |
|---|---|---|
| 2988 | `LoginDialog.exec()` | ✅ đúng (khách chủ động) |
| 3029 | `KeyDialog.exec()` | ✅ đúng |
| 3495 | `_button_dialog` `d.exec()` | ✅ đúng |
| 3435 | `m.exec()` (menu chuột phải) | ✅ đúng |
| 3516 | `_confirm` `box.exec()` | ✅ đúng, nhưng xem P2-27 |
| **2467** | `_stop_patcher_wait()` (không phải dialog nhưng **chặn 12 s**) | ❌ **P1-7** |
| **3586** | `_stop_patcher_wait()` trong `closeEvent` | ❌ chấp nhận được về mặt "an toàn dữ liệu", nhưng 12 s là quá lâu — P2-28 |
| **3351** | `w.tick()` trên GUI thread: vòng lặp `time.sleep(0.02)` **600 ms mỗi loại tài nguyên** (xa_grant 2072–2076) | ❌ tối đa ~1,8 s đứng hình mỗi nhịp 200 ms khi có ≥2 loại đang nợ |
| 3195, 3303, 3304, 3264 | `ensure_engine` (có thể gọi mạng), `resolve_chain`, `machine_hwid` | ❌ **P1-8** |

### D.8 Bình luận mâu thuẫn với mã (không được tin bình luận)

| Bình luận | Dòng | Mã thực tế |
|---|---|---|
| Docstring đầu tệp vẽ thanh trên có nút **[Key]** | 7 | `btn_key` **bị ẩn vĩnh viễn** (1213) |
| Docstring: *"Không hiện nút xám, không báo 'bạn không có quyền' — chỉ đơn giản là ẩn"* | 24–26 | Mã **có** báo: `_state('License chưa dùng được trên máy này','err')` (2841), `'Cần đăng nhập hoặc dán key'` (2866), và hiện `btn_buy`/`btn_recheck` |
| Docstring vẽ hộp **[Nhật ký]** ở đáy và dòng `LƯỢT: 9/10` | 19–21 | Không còn thẻ "LƯỢT" riêng — đã chuyển vào `box_quota` (1260–1293) |
| `GRANT_STEP_MIN : mức cộng tối đa ở phút 1 (200)` | 70 | **Không có hằng `GRANT_STEP_MIN`**; thực tế `GRANT_STEP_P1 = 100` (92) |
| `phút 1 -> 200, phút 2 -> 300, phút 3 -> 400` | 841–842 | Cùng tệp, dòng 857 ghi `# phút 1 -> 100` và hằng số là **100** |
| `Cách làm: số bước CỐ ĐỊNH (nhịp game), TRỌNG SỐ bước k = (k+1)`, ví dụ 20 bước ~476…9.524 | 813–821 | **Không hề được cài đặt** — mã dùng bước đều `cap` cố định (865–871); không có trọng số, không có 20 bước |
| `Bước nào lỗi thì CỘNG BÙ ở bước sau` | 845 | Chỉ có "cộng nốt" tối đa 5 lần sau vòng lặp (889–900) |
| `_release_worker … Chỉ xoá khi thread đã dừng -> không bao giờ xoá thread đang chạy` (đúng) + ngụ ý chống phình | 1519–1525 | Trên thực tế gần như luôn no-op (P2-21) |
| `_ent_sig … để không ghi đè loạn xạ mỗi 20 giây` | 1039–1041 | Không ai đọc `_ent_sig` (P2-10) |
| `Đang bật map sáng…` suy ra từ `startswith` chữ trạng thái | 1962–1968 | Đúng, nhưng phụ thuộc chuỗi tiếng Việt: đổi 1 chữ ở `PatchWorker` là nút sai trạng thái |
| `closeEvent … CHỈ MỘT định nghĩa` | 3565 | Đúng (đã kiểm AST: chỉ 1 `closeEvent`) |

---

## §E. Bảng hằng số + mâu thuẫn

### E.1 `tool/app/xa_arena_gui.py`

| Hằng | Dòng | Giá trị | Điều khiển cái gì |
|---|---|---|---|
| `_HERE` | 33 | `dirname(abspath(__file__))` | **KHÔNG DÙNG** (chết) |
| `AMOUNTS` | 53 | `[(1000,'+1.000'),(5000,'+5.000'),(10000,'+10.000'),(50000,'+50.000')]` | 4 nút số lượng |
| `RES_ORDER` | 58 | `['F','W','G']` | Thứ tự cộng + thứ tự ô trong hộp "nút riêng" |
| `RES_VN` | 59 | `F:thịt, W:gỗ, S:đá, G:vàng` | Nhãn tiếng Việt |
| `GRANT_DELAY` | 61 | `1.0` (giây) | Nghỉ giữa 2 **loại** tài nguyên (802) |
| `GRANT_CAP` | 75 | `10000` | Trần **mỗi loại** mỗi lần bấm (852) |
| `GRANT_STEP_GAP_MS` | 76 | `1500` (ms) | Nghỉ giữa 2 **bước** (870) |
| `GRANT_STEP_P1` | 92 | `100` | Mức tối đa mỗi bước ở phút 1 |
| `GRANT_STEP_EARLY` | 93 | `200` | Phút 2..9 |
| `GRANT_STEP_M10` | 94 | `300` | Phút 10 trở đi (nền) |
| `GRANT_STEP_ADD` | 95 | `100` | Cộng thêm mỗi phút sau phút 10 |
| `GRANT_STEP_MAX` | 96 | `3000` | Chặn trên mức mỗi bước |
| `RESIDENT_POLL` | 97 | `2.0` (giây) | Nhịp `PatchWorker` (655, 686, 708, 717, 729) |
| `REVERIFY_SEC` | 100 | `90.0` | Nhịp tự kiểm license cục bộ (601) |
| `RECHECK_SEC` | 104 | `300.0` | Nhịp hỏi server trong `PatchWorker` (623) |
| `RT_WAIT_MS` | 113 | `20000` | Nhịp hỏi server khi đang chờ |
| `RT_IDLE_MS` | 114 | `60000` | Nhịp hỏi server khi đã dùng được |
| `RT_KICKED_MS` | 123 | `300000` | Nhịp hỏi khi bị đá |
| `RT_TICK_MS` | **124 và 127** | `1000` | Đồng hồ đổi chữ — **khai báo 2 lần** |
| `TOAST_MS` | 129 | `8000` | Thời gian tự tắt dải thông báo |
| `FOCUS_MIN_GAP` | 132 | `5.0` (giây) | Khoảng cách tối thiểu giữa 2 lần hỏi server do focus (1574) |

### E.2 `tool/ui/xa_theme.py`

| Hằng | Dòng | Giá trị | Điều khiển cái gì |
|---|---|---|---|
| `COLORS` | 31 | 20 token (`bg #0d1117`, `bg_alt #0a0e14`, `card #161b22`, `card_alt #1c2129`, `border #272d36`, `border_hi #3a4250`, `fg #e6edf3`, `fg_dim #9ba7b4`, `fg_mute #6b7785`, `accent #2f81f7`, `accent_hi #4b93ff`, `accent_lo #1f6feb`, `ok #3fb950`, `ok_bg #12261a`, `warn #d29922`, `warn_bg #2a2113`, `err #f85149`, `err_bg #2d1416`, `info #58a6ff`, `info_bg #10233d`) | Toàn bộ màu QSS + icon app |
| `FONTS` | 61 | `ui='Segoe UI'`, `mono='Consolas'`, size: h1 20, h2 15, h3 13, body 10, small 9, tiny 8, code 9 | Cỡ chữ QSS |
| `RADIUS` | 77 | `10` | Bo góc thẻ trong QSS |
| `CARD_PAD` | 78 | `16` | **KHÔNG DÙNG** trong toàn repo (đã grep `\bCARD_PAD\b`: chỉ có dòng định nghĩa) |
| `GAP` | 79 | `12` | **KHÔNG DÙNG** trong toàn repo |

### E.3 Mâu thuẫn với `xa_grant.py` / `xa_arena_api.py` / `xa_nofog_pro.py`

| # | Hằng/luật ở GUI | Đối tác | Mâu thuẫn |
|---|---|---|---|
| 1 | `AMOUNTS` có **50.000** (53) | `GRANT_CAP = 10000` (75) | Nút mời 50.000 nhưng mã cắt 10.000 → P1-6 |
| 2 | `GRANT_STEP_P1 = 100` (92) | `xa_grant.py` 2156–2157 ghi *"phut 1 cong max 200, phut 2 300, phut 3 400"* | Cùng một luật, hai con số khác nhau ở hai module |
| 3 | `RES_VN` có dấu: `thịt/gỗ/đá/vàng` (59) | `xa_grant.RES_NAME` **không dấu**: `thit/go/da/vang` (dòng **2640**, ghi đè định nghĩa tiếng Anh ở dòng **208**) | Nhật ký trộn 2 kiểu chính tả: `Cộng tài nguyên: +20 thịt` (GUI) rồi `Hoàn: 10 thit` (qua `XG.RES_NAME`, 3384) |
| 4 | `RESIDENT_POLL = 2.0` (97) | `xa_nofog_pro.RESIDENT_POLL = float(_c('RESIDENT_POLL', 2.0))` (173) | Bên kia **đọc từ file cấu hình** → hai nguồn sự thật cho cùng một nhịp; sửa config không ảnh hưởng GUI và ngược lại |
| 5 | `_x2_timer` **200 ms** hardcode (3308) | `xa_grant.REFUND_POLL_MS = 200` | Trùng tri thức; đổi bên kia là lệch |
| 6 | `_ver()` fallback `'1.0.0.0'` (1470) | `xa_arena_app.APP_VERSION = '2.3.7.0'` (50); `xa_grant.APP_VERSION = '1.0.3.0'` (100); docstring GUI vẽ `v1.0.0` (7) | **4 phiên bản khác nhau**. Nếu import lỗi, nhãn hiện `v1.0.0.0` trong khi `_on_update_found` so sánh với `2.3.7.0` → nhãn nói dối |
| 7 | Icon: `T.COLORS.get('accent_hi', '#5b9dff')` (252) | `COLORS['accent_hi'] = '#4b93ff'` | Giá trị dự phòng **khác** giá trị thật → nếu token đổi tên, icon lặng lẽ đổi màu |
| 8 | Màu hardcode trong QSS: `#3a4250` (330 — **trùng `border_hi`**), `#2c333d` (325, 343), `#242a33`, `#1a1f26`, `#1d3355`, `#7d8ea3`, `#0c1219`, `#101a2c`, `#ffffff` | `COLORS` | Sửa token **không** đổi các chỗ này → theme không còn là "nguồn sự thật duy nhất" như docstring tuyên bố (28) |
| 9 | `_is_shop_machine()` → `API.is_shop_hwid()` (3264) dùng **`shop.lic` ký ECDSA** (`xa_arena_api` 2096–2110) | `xa_grant._SHOP_HWIDS` + `set_shop_hwids()`/`is_shop_machine()` (2132–2150) | **Hai danh sách trắng độc lập.** `set_shop_hwids()` **không được gọi ở đâu trong repo** ⇒ `xa_grant.is_shop_machine()` **luôn False**. GUI hiện nút dựa trên danh sách thứ nhất; nếu đường engine lại hỏi danh sách thứ hai thì quyền hiển thị ≠ quyền thực thi |
| 10 | `grants` "trần 10.000 mỗi lần bấm" (comment 69, 840) | Mã cắt **mỗi loại** 10.000 ⇒ 30.000/lần | Bình luận sai đơn vị |

---

## §F. Kiểm tra tĩnh (bắt buộc)

### F.1 `python -m pyflakes` (PyQt6 6.12.0, Python 3.14.6)

```
=== PYFLAKES xa_arena_gui.py ===
[exit=0]

=== PYFLAKES xa_theme.py ===
[exit=0]
```

**0 cảnh báo trên cả hai tệp.** Đã xác nhận pyflakes thực sự hoạt động (thử với tệp mẫu `import os, sys` → báo 2 cảnh báo).

Ghi chú: pyflakes **không** bắt được các lỗi kiểu "phương thức không tồn tại trên lớp khác" (P0-1) hay "thuộc tính chưa gán" (P0-2) — đó là lý do hai lỗi P0 vẫn nằm trong bản build sạch pyflakes.

### F.2 `import ast; ast.parse(...)`

```
AST OK: tool/app/xa_arena_gui.py  top-level nodes: 56
AST OK: tool/ui/xa_theme.py       top-level nodes: 20
[exit=0]
```

Không có lỗi cú pháp. Lưu ý: **cú pháp đúng ≠ chạy đúng** — P0-1/P0-2 đều là mã hợp lệ về cú pháp.

### F.3 Kiểm tra bổ sung của tôi (không được yêu cầu nhưng đã làm)

| Phép kiểm | Kết quả |
|---|---|
| Đếm `except` | GUI: 127 (62 cái `pass`); theme: 4 (4 cái `pass`) |
| `self.X` đọc mà không gán trong `ArenaWindow` | `self.h`, `self.base` (3223) — **2 lỗi**; còn lại đều là phương thức kế thừa hợp lệ |
| Lớp ↔ phương thức (AST) | `GrantWorker` chỉ có `__init__`, `_label`, `run` → khẳng định P0-1 |
| Thí nghiệm lưới nút (offscreen) | `grid.count() == 5` cho 4 widget → khẳng định P1-9 |
| Thí nghiệm khoá chiều cao (offscreen) | `card.height()=71` < `sizeHint=96` → khẳng định P1-4 |

---

## §G. Những gì **chưa** kiểm chứng được (giới hạn của báo cáo này)

1. **Bản `.exe` đang bán** (~21 MB, Nuitka onefile) **chưa** được đối chiếu với mã nguồn này. Toàn bộ kết luận là về **mã hiện tại trong repo**. Nếu bản build lấy từ commit khác thì P0-1 có thể không có trong exe. → *Cần: build lại hoặc so `APP_VERSION` trong exe với `2.3.7.0`.*
2. **Chưa chạy app thật** (cần Windows GUI + game AoE + quyền Administrator + license thật). Mọi kết luận về hành vi động đều suy ra từ mã + thí nghiệm offscreen.
3. **Chưa kiểm** `xa_nofog_pro`/`xa_grant` về mặt hành vi engine (byte vá, offset). Chỉ đọc phần giao diện với GUI.
4. **Chưa xác minh** danh sách `SHOP_HWIDS` nào thực sự chặn tính năng "Mua 2 tính 1" ở tầng engine (§E.3 #9) — cần đọc sâu `xa_grant`/`xff` phía server.
5. **Chưa kiểm** hành vi `_fit_window` trên màn hình thật (chỉ suy luận từ `_clamp_h`; đa màn hình / DPI scaling chưa thử).
6. **Chưa xác định** `_month`… các hàm `API` nào thực sự gọi mạng (chỉ đọc docstring + một phần thân) — mục P1-8 dựa trên việc `ensure_engine` **có nhánh** gọi mạng, chưa đo thời gian thật.
7. **Chưa rà** toàn bộ 4507 dòng `xa_nofog_pro.py`; các nhận định về nó chỉ giới hạn ở các hàm GUI gọi.
8. **Chưa kiểm** phiên bản PyQt6 mà exe đóng gói (máy này là 6.12.0).

---

## §H. Danh sách kiểm tra trước khi sửa GUI (để không phá)

1. **Bất kỳ thay đổi hiển thị nào cũng phải đi qua `_apply_feature_visibility()`** — nhưng nhớ nó chỉ được gọi từ `_on_tokens_ready`; nếu thêm nguồn mới, phải giữ nguyên bất biến: `X_ready ⇒ has_X`.
2. **Đừng đặt `setVisible` cho `box_nofog`/`box_grant` ở nơi khác** — đã kiểm: có đúng **3** nơi vi phạm ngoài nguồn sự thật (`_on_entitlement` 2393–2394, `_enter_kicked` 2502–2503, `_do_logout` 2974–2975), cộng nhánh bị đá bên trong `_apply_feature_visibility` (2711–2712) và nhánh chính (2744–2745). Thêm nữa là mất khả năng suy luận.
3. **`btn_recheck` có 9 nơi đặt hiện/ẩn** — sửa 1 nơi là đủ để nút hiện sai lúc.
4. **Mọi lệnh engine phải nằm trong `with XG.engine_lock()`** và **phải nhả khoá trong `finally`** (xem P0-3).
5. **Không gọi `XG.ensure_engine` / `machine_hwid` / `grant_token_ok` trên GUI thread** (P1-8).
6. **Không dùng `w.wait()` trên GUI thread** trừ `closeEvent` (P1-7).
7. **Sau khi đổi hiện/ẩn widget, gọi `_relayout()`** nếu widget đó nằm trong khối đã `_fix_height` (P1-4).
8. **Chữ trạng thái là giao diện lập trình**: `_sync_toggle` so `startswith` với 7 tiền tố tiếng Việt (1962–1968) — đổi câu trong `PatchWorker` là nút map sáng sai trạng thái.
9. **Bất biến tài chính:** một lần bấm không được tiêu quá `GRANT_CAP` **và** không được **báo** nhiều hơn số đã gửi (P1-6).
10. **Worker mới phải**: (a) có guard chống chồng, (b) được `deleteLater()` khi xong, (c) thêm vào `_stop_all_workers`, (d) thêm vào `_workers_busy` nếu nó tiêu lượt/ghi token.
