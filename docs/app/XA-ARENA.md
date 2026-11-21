# XA ARENA — TÀI LIỆU TỔNG HỢP

> Cập nhật: bản **2.3.9.0**. Đây là tài liệu GỐC. Bốn tài liệu chi tiết đi kèm:
> [`APP-GUI.md`](APP-GUI.md) · [`APP-API.md`](APP-API.md) · [`APP-GRANT.md`](APP-GRANT.md) · [`APP-NOFOG.md`](APP-NOFOG.md)

---

## 1. CÁI GÌ TẠO NÊN `xa_arena.exe`

Một file `.exe` duy nhất, đóng gói bằng **Nuitka** (`--onefile`, PyQt6).

| Vùng | File | Dòng | Vai trò |
|---|---|---|---|
| `tool/app/` | `xa_arena_app.py` | 852 | Điểm vào: `main()`, cờ CLI, cổng update, chống 2 bản chạy |
| | `xa_arena_gui.py` | 3.627 | Toàn bộ giao diện + worker |
| | `xa_arena_api.py` | 2.734 | Client server + trạng thái cục bộ |
| `tool/ui/` | `xa_theme.py` | 582 | Màu, font, nút |
| | `xa_update.py` | 1.031 | Tự cập nhật |
| `tool/src/` | `xa_nofog_pro.py` | 5.169 | Map sáng + vá bộ nhớ + licence cục bộ |
| | `xa_nofog_sec.py` | 684 | Kiểm tra token |
| | `xa_nofog_gui_qt.py` | 919 | GUI cũ (không dùng trong arena) |
| | `xa_config.py`, `xa_nofog_const.py` | 147 | Cấu hình, hằng số |
| `tool/grant/` | `xa_grant.py` | 3.726 | Gọi engine game cộng tài nguyên |
| | `xa_grant_sec.py` | 629 | Token tài nguyên |
| | `xa_grant_guard.py` | 288 | Bảo vệ môi trường |
| | `xa_grant_const.py` | 64 | Hằng số |

**Tổng: ~20.000 dòng, 14 file.**

### ⚠ CÁC FILE TRÙNG LẶP — KHÔNG SỬA NHẦM

| File | Trạng thái |
|---|---|
| `tool/grant/xa_grant.py` | ✅ **BẢN ĐÚNG** — dùng để build |
| `tool/grant/src/xa_grant.py` | ❌ **BẢN CŨ** (3.118 dòng, thiếu `RefundWatcher`) — không dùng |
| `tool/src/xa_nofog_gui_qt.py` | ⚠ GUI của **sản phẩm riêng** `xa_nofog_pro.exe`, **không** thuộc arena |
| `tool/src/xa_nofog_pro.py` | ✅ Dùng chung (arena gọi vào) |

> Trước khi sửa bất kỳ file nào, xác nhận nó có nằm trong lệnh build
> (`tool/build.ps1`, `tool/grant/build-grant.ps1`) hay không.

---

## 2. LUỒNG KHỞI ĐỘNG

```
xa_arena.exe
  └─ main()                       [xa_arena_app.py]
      ├─ 1. đọc cờ --debug-log     → bật/tắt ghi log kỹ thuật
      ├─ 2. startup_hygiene()      → xoá file log cũ, xoá key plaintext cũ
      ├─ 3. --version / --help?    → in rồi THOÁT (không vào module)
      ├─ 4. cờ chẩn đoán?          → CHẶN (in "không dùng được", rc=2)
      ├─ 5. cờ module?             → chuyển cho xa_grant / xa_nofog_pro
      ├─ 6. update_gate()          → có bản mới? thoát để .bat thay file
      ├─ 7. chống 2 bản chạy       → mutex
      └─ 8. run_gui()              → giao diện chính
```

### Cờ bị CHẶN (in "Lệnh này không dùng được ở bản dành cho khách", rc=2)

```
--list  --dump  --status-sites  --sites  --show-sites  --hexdump
/ list  /dump   /sites          /hexdump
--status  --selftest  /status   /selftest
--off  --deactivate  --full  --watch
```

> ⚠ **KHÔNG được thêm các cờ này vào danh sách chặn**: `--grant`, `--stealth`,
> `--check`, `--rebind`, `--hidden`. Đó là cờ **khởi động module tài nguyên**
> (xem `grant_flags`). Đã từng chặn nhầm → tài nguyên không chạy được.

---

## 3. BA TÍNH NĂNG

### 3.1 Map sáng (No Fog)
- Vá bộ nhớ game trong RAM. **Không ghi gì xuống đĩa.**
- Tự khôi phục khi tắt app / tắt vá.
- Chỉ cần quyền `nofog`.

### 3.2 Tài nguyên (XAGrant)
- Gọi hàm engine `Builder_ChangeResource(player, slot, amount)` từ ngoài tiến trình.
- Record được **gửi cho mọi máy** → cả 2 phía cùng cộng → checksum khớp → **không bị kick**.
- Chia bước theo **phút vào trận**:

| Phút | Mỗi bước tối đa |
|---|---|
| 1 | 100 |
| 2–9 | 200 |
| 10 | 300 |
| 11 | 400 |
| 12+ | 500, 600, 700… (+100/phút) |
| chặn trên | 3.000 |

- **Trần mỗi lần bấm: 10.000** (thiếu thì bấm thêm).

### 3.3 Mua 2 tính 1 (chỉ máy chủ shop)
- Bật nút → mỗi lần tiêu tài nguyên, hoàn lại **40–60%** (ngẫu nhiên).
- Trễ **0,5–3 giây** ngẫu nhiên.
- Dùng **cùng đường** với cộng tài nguyên → không desync.
- Cổng bật: `shop.lic` **do server ký ECDSA P-256**.

---

## 4. HẰNG SỐ QUAN TRỌNG

### GUI (`xa_arena_gui.py`)
```python
AMOUNTS            = [1000, 5000, 10000]     # nút cộng
GRANT_CAP          = 10000                   # trần mỗi lần bấm
GRANT_STEP_GAP_MS  = 1500                    # cách nhau mỗi bước
GRANT_STEP_P1      = 100                     # phút 1
GRANT_STEP_EARLY   = 200                     # phút 2..9
GRANT_STEP_M10     = 300                     # phút 10
GRANT_STEP_ADD     = 100                     # +mỗi phút
GRANT_STEP_MAX     = 3000                    # chặn trên
RT_WAIT_MS         = 20000                   # nhịp hỏi lại khi chờ
RT_IDLE_MS         = 60000                   # nhịp khi rảnh
RT_TICK_MS         = 1000                    # đồng hồ 1 giây
RT_KICKED_MS       = 300000                  # nhịp khi bị đá
TOAST_MS           = 8000
```

### Tài nguyên (`xa_grant.py`)
```python
REFUND_RATIO       = 0.5      # trung bình (thực tế 40-60%)
REFUND_RATIO_MIN   = 0.40
REFUND_RATIO_MAX   = 0.60
REFUND_MIN         = 20       # tụt dưới mức này bỏ qua (nhiễu)
REFUND_DELAY_MIN_MS= 500
REFUND_DELAY_MAX_MS= 3000
```

### Địa chỉ bộ nhớ game — **PHẢI KHỚP `EMPIRESX.EXE`**
```
PTR_WORLD       = 0x00585E88   ← địa chỉ của biến con trỏ world
OFF_MANAGER     = 0x3F4        ← [world+0x3F4] = manager
OFF_WRAPARRAY   = 0x40         ← [mgr+0x40]   = mảng wrapper
OFF_SLOTS       = 0x3C         ← số người chơi
OFF_LOCAL_SLOT  = 0x7C         ← slot của máy này
OFF_PLAYER      = 0x50         ← [wrap+0x50] = playerdata
RES_OFF         = {F:0x00, W:0x04, S:0x08, G:0x0C}
mgr + 0x04                     ← đồng hồ trận (mili giây)
```
> ⚠ Game cập nhật → các số này có thể sai. `patch()` tự kiểm tra byte
> trước khi ghi nên **không làm hỏng game**, nhưng tính năng sẽ ngừng chạy.

### Quyền mở tiến trình
```python
_MIN = 0x0002 | 0x0008 | 0x0010 | 0x0020 | 0x0400   # = 0x43A
```
> ⚠ **Bắt buộc có `0x0002` (PROCESS_CREATE_THREAD)**. Đã từng thiếu → mọi
> lần cộng tài nguyên thất bại dù chạy admin.

---

## 5. TRẠNG THÁI CỤC BỘ (file trên máy khách)

| File | Chứa | Mã hoá | Bắt buộc |
|---|---|---|---|
| `%LOCALAPPDATA%\XArenaNoFog\lic.bin` | key, token, session, username | **DPAPI** | ✅ |
| `%LOCALAPPDATA%\XArenaNoFog\entitlement.json` | quyền, license | **DPAPI** (`XAENT1:`) | ✅ |
| `%LOCALAPPDATA%\XArenaNoFog\last_check.json` | chỉ thời điểm | — | ✅ |
| `%LOCALAPPDATA%\XArenaNoFog\shop.lic` | HWID chủ shop + chữ ký | **ECDSA sẵn trong file** | chỉ chủ shop |
| `%LOCALAPPDATA%\XAGrant\token.bin` | token engine | **DPAPI** | ✅ |
| `%TEMP%\arena_detail.log`, `arena_update.log` | log kỹ thuật | **chỉ khi `--debug-log`**, tự xoá | ❌ |

**Không còn** (đã bỏ vì lộ):
- `entitlement_key.txt` — key dạng plaintext
- `shop.hwid` — danh sách HWID đọc từ file khách ghi được
- `XA_SHOP_HWIDS` — biến môi trường khách đặt được

---

## 6. MÃ LỖI SERVER → GIAO DIỆN

| Mã | Trạng thái hiện | Nút chính |
|---|---|---|
| (không) | `● Sẵn sàng` | (không) |
| `session_moved` | `● Tài khoản đang dùng ở máy khác` | `Đăng nhập lại` |
| `no_licence` | `● Tài khoản chưa có gói` | `Mua` |
| `hwid_mismatch` (chỉ trial) | `● Sai máy` | — |
| `revoked` | `● Đã thu hồi` | `Mua` |
| `expired` | `● Đã hết hạn` | `Mua` |
| `trial_exhausted` | `● Máy này đã dùng hết lượt` | `Nhận thêm lượt` + `Mua` |

---

## 7. MÔ HÌNH RÀNG BUỘC

| | Dùng thử | Đã mua |
|---|---|---|
| Ràng buộc | **theo MÁY** (HWID) | **theo TÀI KHOẢN** |
| Giới hạn | 10 lần/máy × 1 giờ | theo hạn |
| Đổi máy | phải đổi máy (có hạn mức) | **đổi thoải mái** |
| Tài khoản khác | **không thêm lượt** | — |
| Số máy cùng lúc | — | **1 máy / 1 thời điểm** |

**Cơ chế 1 máy:** bảng `account_devices` (khoá `user_id + scope`).
- `activate` / đăng nhập → chiếm máy ngay
- `check` → chỉ chiếm khi máy cũ im ≥ 5 phút
- Máy cũ nhận `session_moved` ở lần kiểm kế tiếp

**Key không có chủ** (`bind_hwid = 1`) → khoá theo MÁY, không share được.

---

## 8. QUY TRÌNH PHÁT HÀNH

```powershell
# 1. Tăng version — PHẢI khớp 2 nơi
tool\app\xa_arena_app.py      APP_VERSION  = '2.3.9.0'
src\routes\arena-installer.js EXE_VERSION  = '2.3.9.0'

# 2. Kiểm tra
python scripts\check_versions.py     # phải ra "TAT CA KHOP"

# 3. Build
$env:PYTHONPATH="$PWD\tool\ui;$PWD\tool\src;$PWD\tool\grant;$PWD\tool\app"
python -m nuitka --onefile --windows-console-mode=attach `
  --enable-plugin=pyqt6 --output-filename=xa_arena.exe `
  --include-module=xa_update --include-module=xa_theme `
  tool\app\xa_arena_app.py

# 4. Đưa lên R2
npx wrangler@4 r2 object put "muabankey-assets/files/xa_arena.exe" `
  --file="<exe>" --content-type="application/octet-stream" --remote

# 5. Ghi hash + size THẬT vào code
#    src\routes\arena-installer.js : EXE_SHA256, EXE_SIZE
#    public\assets\pages\download.js : FALLBACK.version, sha256, sizeText

# 6. Deploy
npx wrangler@4 deploy
```

---

## 9. TAI HOẠ ĐÃ TỪNG XẢY RA — ĐỪNG LẶP LẠI

| Triệu chứng | Nguyên nhân thật | Bài học |
|---|---|---|
| Bấm nút tài nguyên không làm gì | `GrantWorker.run` gọi `self._match_minute()` — lớp **không có** hàm này; lỗi bị `except` nuốt | Pylint/flake8 **không** bắt được. Phải test chạy thật. |
| Bật "Mua 2 tính 1" → app treo | `tick()` lấy khoá engine rồi `return` không mở khoá | Mọi `return` sau `acquire` phải nằm trong `try/finally` |
| Cộng tài nguyên luôn thất bại | Quyền handle `0x438` **thiếu `PROCESS_CREATE_THREAD`** | Kiểm bit bằng tay, đừng tin tên hằng số |
| Khách tự bật được tính năng độc quyền | Danh sách HWID đọc từ file/env **khách ghi được** | Cổng phải do **server ký**, không bao giờ tin dữ liệu khách sửa được |
| Server ký đúng mà app vẫn từ chối | WebCrypto trả chữ ký **raw 64 byte**, thư viện cần **DER** | Thử cả 2 dạng |
| Game bị drop khi bật tài nguyên | Chặn nhầm cờ khởi động module | Cờ khởi động ≠ cờ chẩn đoán |
| Cập nhật chạy đi chạy lại | Không đếm số lần thử; `.bat` thiếu BOM UTF-8 | Đếm + cooldown + UTF-8 **có BOM** |
| Key lộ dạng plaintext | `entitlement_key.txt`, `last_check.json`, `entitlement.json` | Mọi file chứa key phải **DPAPI** |
| Máy này dùng được, máy khác không | HWID khác nhau giữa 2 module | Dùng **một** công thức HWID |

---

## 10. NGUYÊN TẮC KHI SỬA

1. **Đọc file trước khi sửa.** Comment trong repo có chỗ sai; code là sự thật.
2. **Sửa xong phải chạy test.** `pyflakes` sạch **không** có nghĩa là chạy được.
3. **Không tin dữ liệu khách sửa được** (file trong `%LOCALAPPDATA%`, biến môi trường).
4. **Mọi `return` sau `acquire()`** phải nằm trong `try/finally`.
5. **Byte ghi vào engine phải giống nhau ở cả 2 máy** → mới không desync.
6. **Không hứa "không ai biết".** Record phải gửi sang máy đối thủ mới không drop; gửi sang thì nằm trong RAM họ. Chỉ hứa được "**không out-of-sync, không bị kick**".
7. **Không chặn cờ khởi động module** khi thêm cờ chẩn đoán.

---

## 11. ĐIỀU KHÔNG THỂ (đừng cố)

| Mong muốn | Thực tế |
|---|---|
| Đối thủ không đọc được RAM | Họ **không** đọc được RAM máy bạn — đúng |
| Đối thủ không biết bạn hack | **Không thể.** State trận được nhân bản sang mọi máy; ASLR tắt nên địa chỉ cố định |
| Bảng điểm không tố cáo | **Không thể.** Cộng thẳng vào mảng float, không qua đường thu thập → `Economy` không tăng trong khi `Combat` tăng |
| Ẩn được tool | **Được.** Nút chỉ hiện trên máy chủ shop |
