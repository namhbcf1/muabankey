# APP-GRANT — Giao diện engine của XAGrant (tài liệu chống tái phạm lỗi)

Tài liệu này mô tả **chính xác** cách `tool/grant/xa_grant.py` nói chuyện với
tiến trình game `EMPIRESX.EXE`, và ghi lại **mọi lỗi tìm được** kèm số dòng.

Mục đích: người sau không phải đoán lại, và không lặp lại các lỗi đã có.

---

## 0. Phạm vi, phiên bản, cách đọc số dòng

### 0.1 File thuộc phạm vi audit

| File | Dòng | SHA-256 (rút gọn) | Vai trò |
|---|---|---|---|
| `tool/grant/xa_grant.py` | 3747 | `2c97f848…` | Toàn bộ phần chạm tiến trình game + RefundWatcher + CLI/GUI |
| `tool/grant/xa_grant_sec.py` | 630 | `e65bc5a9…` | Xác minh token `xg1.` (ECDSA P-256 tự cài), giải mã khối địa chỉ engine, HWID |
| `tool/grant/xa_grant_guard.py` | 289 | `83f84ad6…` | Chống debugger / máy ảo, vân tay bản build |
| `tool/grant/xa_grant_const.py` | 65 | `fe6873bf…` | Hai blob XOR chứa khoá công khai ECDSA |

### 0.2 ⚠️ File đã bị sửa TRONG LÚC audit — số dòng phải đọc theo mốc

`tool/grant/xa_grant.py` bị **agent khác sửa liên tục** trong lúc tôi đang đọc:

| Mốc | Thời điểm | Bytes | SHA-256 (16 ký tự đầu) | Trạng thái |
|---|---|---|---|---|
| R1 | 05:03:40 | 137229 | `3236624e83fe1683` | Bản tôi đọc đầy đủ đầu tiên. **Có 2 nhánh `return` rò khoá** |
| R2 | 05:23:19 | 138165 | `2c97f8488d6756ff` | **Bản được audit (snapshot)**: đã bọc `try/finally`, nhưng còn **release 2 lần** |
| R3 | 05:26:56 | 138095 | `78d196cfe72e0aec` | Bản live lúc viết tài liệu: còn 1 release, `py_compile` OK |
| — | 05:24 (khoảng) | — | — | Có thời điểm file **không parse được** (`IndentationError` dòng 2025) |

> **Mọi số dòng trong tài liệu này tính theo bản R2** (`2c97f848…`), đã đóng băng
> tại `_scratch/doc-grant/snapshot/`. Ở bản R3 phần refund dịch lên ~4 dòng.
> Trước khi dùng số dòng để sửa code: xác nhận lại SHA-256.

`xa_grant_sec.py`, `xa_grant_guard.py`, `xa_grant_const.py` **không** bị sửa trong
suốt audit (SHA không đổi).

### 0.3 Cách thức kiểm chứng (và giới hạn)

| Cách | Nội dung | Ghi chú |
|---|---|---|
| Đọc toàn bộ 4 file | 3747 + 630 + 289 + 65 dòng | Không đọc mẫu |
| `ast.parse` | 4/4 OK | §E.1 |
| `pyflakes 4.1.0` | 1 cảnh báo | §E.1 |
| **Byte thật trên `EMPIRESX.EXE`** | 20+ vị trí, gồm cả IAT | `_scratch/doc-grant/verify_bytes.py`, `iat_name.py` |
| Test động không cần game | 15 check | `_scratch/doc-grant/test_refund_grant.py`, §E.3 |
| **Chưa làm được** | Ghidra/REA decompile | `open_binary` hết thời gian 2 lần (host MCP deadline); **không** phải lỗi của tool. Vì vậy mọi kết luận disassembly dưới đây là **đọc byte thủ công**, không có pseudocode |

Bằng chứng byte dùng file:
`C:\Program Files\XArena\Game\AoE-HD\EMPIRESX.EXE`
— 1.603.984 bytes, `ImageBase = 0x00400000`,
`DllCharacteristics = 0x0000` (**ASLR OFF, NX/DEP OFF** — điều kiện để mọi địa chỉ
tuyệt đối trong tài liệu này có nghĩa).

### 0.4 Chạy lại kiểm chứng

```powershell
python _scratch\doc-grant\verify_bytes.py       # byte thật của EMPIRESX.EXE
python _scratch\doc-grant\iat_name.py           # tên API sau IAT 0x7DA8CC
python _scratch\doc-grant\check_static.py       # ast + tên chết + bảng hằng số
python _scratch\doc-grant\test_refund_grant.py  # 15 check (chạy trên snapshot)
$env:XG_LIVE=1; python _scratch\doc-grant\test_refund_grant.py   # chạy trên file live
```

---

## 1. Giao diện engine

### 1.1 Chuỗi con trỏ (đã kiểm bằng byte)

```
[u32 PTR_WORLD]                        world        ; PTR_WORLD = ĐỊA CHỈ của biến global
        +0x3F4  (OFF_MANAGER)  -> mgr      (manager object)
mgr     +0x3C   (OFF_SLOTS)     -> u16  số slot người chơi
mgr     +0x40   (OFF_WRAPARRAY) -> mảng con trỏ wrapper (4 byte/ phần tử)
mgr     +0x58   (OFF_SENDER)    -> sender object (bộ gửi/áp dụng record)
mgr     +0x7C   (OFF_LOCAL_SLOT)-> i16  slot của MÁY NÀY
mgr     +0x04                   -> u32  ĐỒNG HỒ TRẬN, đơn vị MILI GIÂY
mảng    +slot*4                 -> wrapper (ctx) của người chơi
wrapper +0x4A   (OFF_PLAYERIDX) -> i16  chỉ số người chơi (cũng là index mảng)
wrapper +0x4C                   -> i16  SỐ TÀI NGUYÊN (engine tự kiểm)
wrapper +0x50   (OFF_PLAYER)    -> playerdata
wrapper +0xD8   (OFF_BITMASK)   -> dword bitmask nhóm (chỉ để hiển thị)
wrapper +0x44   (OFF_NAME_PTR)  -> con trỏ tên người chơi
playerdata +0x00/0x04/0x08/0x0C -> f32  F / W / S / G   (RES_OFF)
sender  +0x14   (OFF_APPLY)     -> apply object
apply   +0x10E4 (OFF_ONLINE)    -> cờ online
```

**Byte chứng minh từng mắt xích**

| Mắt xích | Địa chỉ | Byte | Diễn giải |
|---|---|---|---|
| `PTR_WORLD` là biến global | `0x478AEF` | `8B 0D 88 5E 58 00` | `mov ecx,[0x585E88]` → biến global chứa world |
| `[world+0x3F4]` = mgr | `0x478AF8` | `8B 91 F4 03 00 00` | `mov edx,[ecx+0x3F4]` |
| `[mgr+0x04]` = ms | `0x478B04` | `F7 62 04` | `mul dword [edx+4]` |
| ms → giây | `0x478B09` | `8B CA C1 E9 06` | magic `0x10624DD3` + `shr ecx,6` ⇒ chia 1000 |
| nạp mgr rồi đọc `+4` | `0x429C32`,`0x429C3B` | `8B 80 F4 03 00 00` … `8B 78 04` | `test eax,eax / je` rồi `mov edi,[eax+4]` |
| `[mgr+0x40]` = mảng wrapper | `0x4EB336`, `0x4EB339` | `8B 51 40`, `8B 0C 82` | `mov edx,[ecx+0x40]` rồi `mov ecx,[edx+eax*4]` |
| index người chơi = index mảng | `0x4EB332` | `0F BF 46 02` | `movsx eax,word[esi+2]` → dùng thẳng làm index, **không +1, không bỏ slot 0** |
| `[wrapper+0x50]` = playerdata | `0x45DF20` | `8B 49 50` | `mov ecx,[ecx+0x50]` (ecx = wrapper) |
| tài nguyên nằm ngay trong playerdata | `0x45DF2A` | `D8 04 81` … `D9 18` | `fadd dword [ecx+eax*4]` / `fstp dword [eax]` |
| có kiểm số tài nguyên | `0x45DF1A` | `66 3B 41 4C` | `cmp ax,[ecx+0x4C]` |
| vtable `+0x78` = ChangeResource | `0x4EB347` | `FF 50 78` | `call dword [eax+0x78]` |

Hàm `0x45DF10` (viết lại từ byte, `ret 0xC`):

```asm
0x45DF10  mov  ax, [esp+4]        ; int16 slot
0x45DF15  test ax, ax
0x45DF18  jl   reject             ; slot < 0 -> bỏ
0x45DF1A  cmp  ax, [ecx+0x4C]     ; slot < số tài nguyên
0x45DF1E  jge  reject
0x45DF20  mov  ecx, [ecx+0x50]    ; ecx = playerdata
0x45DF23  fld  dword [esp+8]      ; amount
0x45DF27  movsx eax, ax
0x45DF2A  fadd dword [ecx+eax*4]  ; playerdata[slot] += amount
0x45DF2D  lea  eax, [ecx+eax*4]
0x45DF30  fstp dword [eax]
0x45DF32  ret  0xC
```

⇒ **Kết luận quan trọng**: `RES_OFF = {F:0, W:4, S:8, G:0x0C}` và
`RES_SLOT = {F:0, W:1, S:2, G:3}` là **CÙNG một vùng nhớ** (`slot == offset/4`).
Engine **không** có bảng hoán vị. Đây là lý do `RES_SLOT` phải khớp `RES_OFF/4`.

Chưa xác minh: **việc gán nhãn F/W/S/G vào 4 ô 0x00/0x04/0x08/0x0C**. Bảng
`RES_OFF` hiện tại dựa trên phép đo RAM-vs-HUD ghi ở `L150–L190` (2 trận, 8/8
khớp) — tôi **không** đo lại. Nếu nhãn sai thì tool cộng đúng ô nhưng **gọi tên
sai** (xem mục C.8 về hai comment tự mâu thuẫn trong file).

### 1.2 Ai đọc cái gì

| Dữ liệu | Nơi đọc (R2) | Dùng để |
|---|---|---|
| `PTR_WORLD` | `L1272` `L1327` `L1375` `L1433` `L1951` `L2205` `L2645` `L944` | gốc của mọi chuỗi |
| `[world+0x3F4]` | `L1275` `L1330` `L1378` `L1437` `L1954` `L2208` `L2648` | mgr |
| `[mgr+0x3C]` | `L1281` `L1390` | số slot (kẹp `1..64`, đọc u32 & 0xFFFF) |
| `[mgr+0x40]` | `L1278` `L1387` `L1957` | mảng wrapper |
| `[mgr+0x7C]` | `L1333` `L1450` `L1383` `L1961` `L2719` | "máy này là slot nào" |
| `[wrap+0x4A]` | `L1294` (`idx`) | **chỉ số đưa vào record** (`pindex`) |
| `[wrap+0x50]` | `L1290` `L1397` `L1970` | playerdata để đọc/kiểm tài nguyên |
| `[wrap+0xD8]` | `L1311` | chỉ in ra, **không** dùng làm identity |
| `[wrap+0x44]` | `L1127` | tên người chơi |
| `[sender+0x14]` | `L1445` | apply object |
| `[apply+0x10E4]` | `L1448` | cảnh báo online (không còn chặn) |
| `[mgr+0x04]` | `L2211` | `match_seconds()` |

`OFF_SLOTS (0x3C)` và `OFF_LOCAL_SLOT (0x7C)`: **chưa xác minh bằng disassembly**
— chỉ có comment + hành vi thực đo. Riêng `OFF_MANAGER (0x3F4)`,
`OFF_WRAPARRAY (0x40)`, `OFF_PLAYER (0x50)`, `OFF_SENDER`+`OFF_APPLY` (gián tiếp
qua `0x4EB347 call [eax+0x78]`) và `RES_OFF` đã kiểm bằng byte.

### 1.3 Đồng hồ trận (`mgr + 0x04`)

- Đơn vị **mili giây** — chứng minh: HUD chia cho 1000 (`0x478B04`+`0x478B09`).
- `WORLD_TIME_SRC = ('mgr', 0x04)` (`L2211`), `WORLD_TIME_SCALE = 0.001` (`L2213`).
- `match_seconds()` (`L2194`…) đọc theo nhánh `'mgr'`, kẹp `0 < sec <= 18000`
  (5 giờ) — trả **0 = "chưa biết"** chứ không kẹp giá trị.
- Người dùng duy nhất: GUI `tool/app/xa_arena_gui.py:3220` (`_match_minute()`),
  dùng để chọn mức cộng mỗi bước. Nếu trả 0 → GUI coi là **phút 1** (mức nhỏ
  nhất, an toàn).

### 1.4 Giá trị đến từ token (`xg1.`) — và cái gì thực sự được dùng

Thứ tự cố định `_ENGINE_ORDER` (`L226–L231`) phải khớp `const ENGINE` phía server
`src/routes/xa-grant-server.js`:

```
BUILDER, SENDER, APPLY_GATE, APPLY_IMPL, CHANGE_RES,
VTABLE, WRAP_VTABLE, PTR_WORLD, ALLOC, VT_SLOT_VAL,
WRAP_CR, GAME_PKT, LOCAL_APPLY, BUILDER_SIB, RING_COPY, RESERVED
```

Token còn mang: `o` (offset: `ctx`, `playeridx`, `sender`, `apply`, `online`),
`v` (`vt_off`), `s` (chữ ký byte của 5 hàm). Khối được giải mã bằng
`gate` 16 byte riêng từng license (`_sec.open_engine`, XOR keystream SHA-256).

| Biến | Nơi dùng thật (R2) | Nếu token thiếu/sai |
|---|---|---|
| `BUILDER` | `L1000` (stub `do_grant`) | `_require`-style: mặc định 0 → `build_stub` nhét `mov eax,0 / call eax` ⇒ **game crash**. Hiện chỉ được chặn gián tiếp bởi `ensure_engine()` + `verify_build()` |
| `SENDER` | `L797` → `L811`, `L884`, `L2475` | `build_stub_dispatch*` ném `GrantError` nếu = 0 (`L812–813`, `L885–886`) |
| `APPLY_GATE`, `APPLY_IMPL` | **chỉ in ra** ở dry-run `L1717–1718` | không ảnh hưởng |
| `CHANGE_RES` | **không dùng** | — |
| `VTABLE` + `VT_SLOT_OFF` + `VT_SLOT_VAL` | `verify_build` `L1557–1562` | lệch ⇒ `GrantError`, không chạm game |
| `WRAPPER_VTABLE` | lọc người chơi `L1316–1318`; `verify_build` `L1564` | sai ⇒ `list_players()` rỗng ⇒ mọi lệnh bị từ chối |
| `WRAP_CR` | `verify_build` `L1565–1569` | lệch ⇒ từ chối |
| `PTR_WORLD` | mọi chuỗi (bảng §1.2) | = 0 ⇒ "chưa vào trận" |
| `ALLOC` (`ALLOC_ADDR`) | **KHÔNG DÙNG** — `_call_dispatch` không truyền, `build_stub_dispatch_owned` rơi về hằng số `0x528450` (`L888`) | xem C.4 |
| `RING_COPY`, `GAME_PKT`, `LOCAL_APPLY`, `BUILDER_SIB` | chỉ xuất hiện trong comment/print | không ảnh hưởng |

**Ba trạng thái token** (`_sec.verify_token` + `ensure_engine` `L496–L591`):

| Trạng thái | Điều kiện | Hành vi |
|---|---|---|
| `fresh` | `t <= n + c` | dùng luôn, **không gọi mạng** |
| `stale` | `n+c < t <= n+c+g*3600` | **thử** `/api/xg/check`; thất bại **vẫn chạy** (chỉ log) |
| `token_expired` | `t > n+c+g` | **bắt buộc** làm mới; thất bại ⇒ `return False` (`L578–584`) |
| license hết hạn | trường `e > 0` và `now > e` | `code='token_expired'`, chặn |

Thiếu token hoàn toàn ⇒ `ensure_engine` trả `False` trước khi mở process
(`L507–511`). Sai chữ ký ⇒ `bad_sig`; sai máy ⇒ `token_wrong_machine`
(`L341–348`); gate sai/khối hỏng ⇒ `bad_data`/`no_data` (`_sec.L404–409`).

### 1.5 Ba đường ghi, ba loại record

| Đường | Hàm | Record | Kích thước | Ai gọi |
|---|---|---|---|---|
| Cộng tài nguyên (chuẩn) | `do_grant` `L1605` | `0x05` (type 5) qua **BUILDER** | 8 byte | CLI `--grant` (`L3691`), **GUI GrantWorker** (`xa_arena_gui.py:879,895`), **RefundWatcher** (`L2120`) |
| Cộng tài nguyên (né anti-cheat) | `do_grant_hidden` `L2240` | `0x67` **sub = 2** tự dựng, gửi thẳng **SENDER** | 12 byte | **chỉ CLI** `--stealth` (`L3668`) |
| Ruộng vô hạn thịt | `do_farm` `L2342` | `0x77` (obj + resourceId + delta i16) | 12 byte | CLI `ruong` (`L3198`) |

**Record `0x05` (`build_record` `L699`)** — đã kiểm byte tại `0x42BDE0`:

```
+0  u8  0x05        (0x42BDFE: C6 00 05)
+1  u8  player      (0x42BDF7: 88 48 01)   <- cl = byte thấp của arg1
+2  u8  slot        (0x42BE0A: 88 50 02)   <- dl = byte thấp của arg2
+3  u8  0           (vùng ALLOC đã zero)
+4  f32 amount      (0x42BE01: 89 48 04)
```

`Builder_ChangeResource` = `__thiscall`, `ret 0xC`, `ecx` = ctx:
`push 8 / push 1 → call 0x528450 (ALLOC)` rồi `call 0x42BA60 (SENDER, rec, 8)`.
⇒ **Record do CHÍNH BUILDER cấp phát bằng allocator của game**, tool không cấp.
Đó là lý do `do_grant` an toàn về double-free, còn `_call_dispatch` thì không (C.4).

**Record `0x67/2` (`build_record_res_credit` `L826`)**:

```
+0  u8  0x67
+1  u8  2
+2  i16 player     (handler 0x4EB332: movsx eax, word[esi+2])
+4  u16 slot       (0x4EB340: mov dx, word[esi+4])
+6  u16 0
+8  f32 amount     (0x4EB33C: mov edx,[esi+8])
```

Handler `0x4EB32D` gọi `[vtable+0x78]` ⇒ **cùng hàm ChangeResource** với đường
type-5. Khác biệt duy nhất của `0x67/2` là **đường đi qua anti-cheat**, và điều
đó **chưa xác minh** (xem §5).

**`do_grant` vs `do_grant_hidden` — khác biệt chính xác**

| | `do_grant` | `do_grant_hidden` |
|---|---|---|
| Record | engine tự dựng `0x05` | tool tự dựng `0x67/2` |
| Đích gọi | `BUILDER(ctx, player, slot, amount)` — `build_stub` (`L983`) | `SENDER(sender, rec, 12)` với record do **game** cấp phát (`_call_dispatch`) |
| Cổng `--i-understand-this-may-desync` | **bắt buộc** (`L1607–1612` + `L1624–1631` cho `--for`) | **không có cổng** (`L2250–2258` chỉ kiểm tham số) |
| Cảnh báo online | có (`L1686–1695`) | không |
| Đọc lại/kiểm chứng | có, chờ tới 5 s, in bảng 4 tài nguyên, phát hiện "lệch ánh xạ" (`L1774–1853`) | có, nhưng không in bảng (`L2308–2336`) |
| Trả về | **luôn `0`** (kể cả khi thất bại) | **luôn `0`** |
| GUI dùng | **có** (GrantWorker) | **không** (chỉ CLI) |

Anti-cheat: `do_grant` sinh đúng type `0x05` mà anti-cheat kiểm `amount > 0` ⇒
bị ghi nhận; `do_grant_hidden` cố tình đi đường khác. **Chuỗi "ring 256 slot
0x100061F0" trong comment (`L50–55`, `L754–760`) tôi không kiểm được** — đó là
module anti-cheat, không nằm trong `EMPIRESX.EXE`. Xem §5.

---

## 2. RefundWatcher ("Mua 2 tính 1")

### 2.1 Trường (R2, `L1917–L1930`)

| Trường | Ý nghĩa | Ghi chú |
|---|---|---|
| `h` | handle process game | do caller truyền |
| `base` | module base (0x400000) | chỉ để in/verify |
| `chain` | dict chuỗi đã resolve | **KHÔNG BAO GIỜ ĐƯỢC DÙNG** (`L1920`) — tham số chết |
| `ratio` | fallback 0.5 | chỉ dùng khi `_random.uniform` ném lỗi (`L2115`) |
| `on_event` | callback `done` | GUI nối `_x2_event` |
| `prev` | mốc tài nguyên lần trước | `None` = chưa có mốc |
| `owed` | dict `{F,W,S,G}` phần đã tụt, **chưa** hoàn | bộ đếm "thiếu đâu cộng đấy" |
| `last_refund_ms` | mốc thời gian của **lần tick có hoàn** (giá trị `now_ms` lúc **vào** tick) | xem C.6 |
| `total_refunded` | tổng đã hoàn (chỉ để hiển thị) | cộng dồn, không bao giờ trừ |
| `running` | luôn `False`, `stop()` chỉ set lại `False` | **chết** — không ai đọc |
| `_pd` | playerdata của chính mình | tự tính lại khi đọc hỏng |

### 2.2 Phương thức

| Method | Dòng | Việc |
|---|---|---|
| `__init__` | `L1917` | tính `_pd` ngay khi tạo (nếu chưa vào trận ⇒ `None`) |
| `_playerdata` | `L1932` | world → mgr → arr → slot `[mgr+0x7C]` → wrap → `[wrap+0x50]` |
| `_read` | `L1975` | đọc 4 tài nguyên; `_pd` hỏng thì tính lại; giá trị `<0` hoặc `>1e7` ⇒ coi là đọc nhầm |
| `tick` | `L2001` | lấy khoá (non-blocking) + `try/finally` release, gọi `_tick_locked` |
| `_tick_locked` | `L2026` | thân: cộng nợ → cooldown → hoàn từng loại |
| `stop` | `L2144` | set `running=False` (không có tác dụng) |

### 2.3 Cây quyết định của `tick()` — từng `return`

```
tick(now_ms)
├─ L2012  acquire(blocking=False) thất bại ───────────────► L2013 return []   (không giữ khoá)
└─ try: _tick_locked(now_ms)                     ← finally L2024 release()
   _tick_locked:
   ├─ L2028 cur = _read();  None ──────────────────────────► L2030 return []
   ├─ L2031 prev is None → prev = cur ────────────────────► L2033 return []
   ├─ L2034 cur = _read() **LẦN HAI** (dư, xem C.3); None ─► L2036 return []
   ├─ L2037 prev is None (không thể xảy ra ở đây) ────────► L2039 return []
   ├─ L2053..2057  mọi k: d = prev[k]−cur[k]; d>0 ⇒ owed[k]+=d; prev[k]=cur[k]
   ├─ L2064 last_refund_ms != 0:
   │     _gap = randint(500,3000) [hoặc 500 nếu lỗi]
   │     nếu now_ms − last_refund_ms < max(500, _gap)
   │        ├─ L2071 _ENGINE_LOCK.release()   ← **RELEASE LẦN 2 (C.1)**
   │        └─ L2072 return []
   ├─ L2088..2129 với từng k trong owed:
   │     owe < 20 ⇒ continue (chưa chạm engine, không sleep)
   │     không phải phần tử đầu ⇒ sleep tới đủ **600 ms** (L2092–2095)
   │     r = uniform(0.40, 0.60) [hoặc self.ratio]
   │     give = int(owe × r); give < 1 ⇒ continue
   │     do_grant(h, base, k, give, dry_run=False, gate=True, so=None)   (L2120)
   │        thành công → total_refunded[k]+=give; owed[k]=0.0; done.append
   │        ném lỗi    → GIỮ NGUYÊN owed, chỉ log (L2124–2129)
   ├─ done khác rỗng ⇒ last_refund_ms = now_ms (L2131); gọi on_event; _read() lại
   ├─ L2141 _ENGINE_LOCK.release()            ← **RELEASE LẦN 2 (C.1)**
   └─ L2142 return done
```

### 2.4 Kế toán `owed`

- **Phát hiện tụt**: so `prev[k]` với giá trị đọc được; `d > 0` ⇒ `owed[k] += d`.
  `prev` được cập nhật **mỗi nhịp**, nên một lần tụt chỉ được tính **một lần**.
- **Ghi có**: khi `do_grant` **không ném exception**, `owed[k]` được đặt **về 0**
  và `total_refunded[k] += give`. Phần còn lại (`owe − give`, tức 40–60%) **bị bỏ**,
  đúng chủ đích "hoàn một nửa mỗi lần mua".
- **Khi thất bại**: giữ nguyên `owed` (chứng minh: test (b), `owed F=1000.0` sau
  khi `do_grant` ném lỗi).
- ⚠️ **Nhưng** `do_grant` **không ném lỗi** ở phần lớn thất bại — nó `return 0`
  (§C.2). Khi đó `owed` **vẫn bị xoá** ⇒ mất tiền hoàn. Test (b) tái hiện được:
  `owed F=0.0` dù không có gì được cộng.

### 2.5 `engine_lock` — mọi chỗ lấy/nhả

| Vị trí | Hành vi |
|---|---|
| `L1885` | `_ENGINE_LOCK = threading.RLock()` (module-level) |
| `L1888–1890` | `engine_lock()` trả chính nó (GUI dùng `with XG.engine_lock():`) |
| `L2012` | `tick()` **acquire non-blocking** |
| `L2024` | `finally: release()` — bọc toàn bộ phần thân |
| `L2071` | `release()` **thừa** (nhánh cooldown) |
| `L2141` | `release()` **thừa** (cuối hàm) |
| GUI `xa_arena_gui.py:878`, `:894` | `with XG.engine_lock(): XG.do_grant(...)` — **thread worker** |
| **Không lấy khoá** | CLI `--grant`/`--stealth`, `do_farm`, `do_grant`, `do_grant_hidden`, `_call_dispatch` |

**Chứng minh không có nhánh nào thoát mà quên nhả** — chạy
`test_refund_grant.py`, mục (a). Mỗi ca đo: sau khi `tick()` trả về **hoặc ném**,
một **thread khác** có lấy được khoá hay không (đây mới là định nghĩa "kẹt";
`threading.RLock` là re-entrant nên cùng thread vẫn lấy lại được, che mất lỗi).

Kết quả trên bản R2 (`2c97f848`, output đầy đủ ở `_scratch/doc-grant/test_output.txt`):

| Nhánh thoát | Khoá sau `tick()` | Kết luận |
|---|---|---|
| engine bận (thread khác giữ) | free | ✅ |
| `cur is None` (L2030) | free | ✅ (đã sửa so với R1) |
| `prev is None` (L2033) | free | ✅ (đã sửa so với R1) |
| exception giữa thân | free | ✅ |
| cooldown (L2071) | **RuntimeError** | ❌ release 2 lần |
| không nợ / nợ < 20 / do_grant ném / hoàn thành | **RuntimeError** | ❌ release 2 lần |

Ở bản **R1** (`3236624e`) cùng bộ test cho kết quả khác: hai nhánh
`cur is None` và `prev is None` **giữ khoá vĩnh viễn** (`depth=1`,
other-thread-free = `False`). Đó là lỗi P0 mà bản R2 nhắm sửa; bản R2 sửa đúng
hai nhánh đó nhưng lại nhả hai lần ở các nhánh còn lại (§C.1).

**Hệ quả thực tế của việc nhả 2 lần**: `tick()` **ném** `RuntimeError` thay vì
trả `[]`. GUI bắt exception ở `_x2_tick` (`xa_arena_gui.py:3367–3369`) và gọi
`_x2_off()` ⇒ **tính năng tự tắt** ngay sau nhịp đầu tiên có hoàn hoặc có
cooldown. Ngoài ra nếu người gọi (GUI worker) đang giữ khoá ngoài `tick()` thì
khoá của họ **bị nhả trộm** (test in: `outer holder lost its hold: True`).

### 2.6 Dedup `0x42BA10` và giãn cách 600 ms — **kết luận của code là SAI**

Byte thật của `0x42BA10` (dịch tay):

```asm
0x42BA10  push esi
0x42BA11  mov  esi, ecx            ; esi = session
0x42BA13  push edi
0x42BA14  mov  eax, [esi+8]        ; record lần trước
0x42BA17  test eax, eax
0x42BA19  je   0x42BA4D            ; chưa có -> NHẬN
0x42BA1B  mov  ecx, [esi+0xC]      ; độ dài lần trước
0x42BA1E  mov  edx, [esp+0x10]     ; độ dài MỚI (arg2)
0x42BA22  cmp  ecx, edx
0x42BA24  jne  0x42BA4D            ; khác độ dài -> NHẬN
0x42BA26  mov  edi, [esp+0xC]      ; record MỚI (arg1)
0x42BA2A  mov  dl, [eax]           ; type lần trước
0x42BA2C  cmp  dl, [edi]           ; so type
0x42BA2E  jne  0x42BA4D            ; khác type -> NHẬN
0x42BA30  call [0x7DA8CC]          ; = WINMM!timeGetTime (đã resolve IAT)
0x42BA36  sub  eax, [esi+0x10]     ; trừ mốc thời gian lần trước
0x42BA39  cmp  eax, 0x1F4          ; 500 ms
0x42BA3E  jge  0x42BA4D            ; >= 500 ms -> NHẬN
0x42BA40  push edi / mov ecx,esi / call 0x42B9C0   ; nghi TRÙNG -> xét tiếp
0x42BA48  pop edi / pop esi / ret 8   ; al = kết quả 0x42B9C0
0x42BA4D  ... xor al, al / ret 8       ; NHẬN (al = 0)
```

`0x42B9C0` (xét "trùng" theo type):

```asm
0x42B9C0  mov  eax,[esp+4] ; xor edx,edx ; mov dl,[eax]   ; dl = type
0x42B9C8  cmp  edx, 3
0x42B9CB  ja   0x42B9F2                                   ; type > 3 -> trả 0
0x42B9CD  jmp  [edx*4 + 0x42B9F8]    ; bảng nhảy cho 0,1,2,3
0x42B9F2  xor  al,al ; ret 4                              ; = 0 (KHÔNG trùng)
```

`SENDER 0x42BA60` dùng kết quả đó:

```asm
0x42BA6F  call 0x42BA10          ; al = 1 nếu bị chặn
0x42BA74  test al, al
0x42BA76  jne  0x42BA82          ; BỊ CHẶN -> bỏ qua bước gửi
0x42BA7D  call 0x42F160          ; GỬI/ÁP DỤNG thật
0x42BA82  mov  eax,[esi+8] ; ...  ; free record cũ bằng 0x5284F0
0x42BA92  mov  [esi+8], ebx      ; session nhận quyền sở hữu record MỚI
0x42BA95  mov  [esi+0xC], edi    ; lưu độ dài
0x42BA98  call timeGetTime
0x42BA9E  mov  [esi+0x10], eax   ; lưu mốc thời gian
```

⇒ **Cửa sổ 500 ms chỉ chặn được record type 0..3.** Với type `0x05`, `0x67`,
`0x77` (`> 3`), `0x42B9C0` trả `0` ⇒ `SENDER` **vẫn gửi**.

**Hệ quả**: lý do ghi ở `L2076–2085` ("nghỉ 600 ms giữa các loại vì dedup
500 ms") **không đúng với type 0x05**. Việc chờ 600 ms:
- không cần thiết để tránh dedup (theo byte hiện có),
- nhưng **có hại**: nó `sleep` trên **thread gọi** = thread chính Qt (§C.7).

Vẫn còn hai điều chưa loại trừ: (a) hàm gửi thật `0x42F160` có thể có cơ chế
gộp riêng; (b) anti-cheat có thể có cửa sổ riêng. Cả hai **chưa xác minh**.

### 2.7 Ngẫu nhiên hoá tỷ lệ và độ trễ

| Tham số | Giá trị | Áp dụng ở | Đo được |
|---|---|---|---|
| `REFUND_RATIO_MIN/MAX` | 0.40 / 0.60 | `L2113` `uniform(0.40, 0.60)` mỗi **loại** | 200 lần: min 0.400, max 0.598 |
| làm tròn | `int()` (xuống) | `L2116` | — |
| trung bình | — | — | **0.492–0.505 × đã tiêu** (200 lần, 4 lần chạy khác nhau: 0.499 / 0.504 / 0.505 / 0.500) ⇒ **đạt yêu cầu 0.45–0.55** |
| `REFUND_DELAY_MIN_MS/MAX_MS` | 500 / 3000 | `L2066` `randint` — **mỗi lần tick**, không phải mỗi record | — |
| `REFUND_COOLDOWN_MS` | 500 | `L2070` `max(500, _gap)` | **vô hiệu** trên thực tế: `_gap >= 500` luôn đúng ⇒ chỉ có tác dụng khi `_random` ném lỗi |
| giãn cách trong 1 tick | 600 ms | `L2092–2095` | đo 602–620 ms giữa 2 record ✅ |

Độ lệch chuẩn đo được ≈ 54–57 (trên 1000) ⇒ phân bố đều 0.40–0.60 như thiết kế,
không phải hằng số 0.50.

---

## 3. Lỗi tìm được (xếp theo mức nghiêm trọng)

> Số dòng theo bản **R2** (`2c97f848`). Cột "live" = trạng thái ở `78d196cf`
> (05:26:56) theo kiểm tra nhanh, **chưa audit lại toàn bộ**.

### C.1 — CRITICAL: release khoá 2 lần ⇒ `tick()` ném exception ⇒ tính năng tự tắt

- `L2071` (nhánh cooldown) và `L2141` (cuối `_tick_locked`) release, **rồi**
  `tick()`'s `finally` (`L2024`) release lần nữa ⇒ `RuntimeError: cannot release
  un-acquired lock`.
- Đo: 5/9 nhánh thoát ném lỗi; nhánh "hoàn thành" cũng ném ⇒ **mọi lần hoàn tiền
  đều kéo theo exception**. GUI bắt ở `xa_arena_gui.py:3367` → `_x2_off()`.
- Nếu có ai giữ khoá ngoài `tick()`, khoá của họ bị nhả trộm (đo: `True`).
- **Cách sửa (không thực hiện)**: xoá **cả hai** dòng release bên trong
  `_tick_locked`; chỉ giữ `try/finally` ở `tick()`. Hoặc bỏ hẳn wrapper, dùng
  `with _ENGINE_LOCK:` trong `tick()`.
- Live: đã còn 1 release ⇒ **có vẻ đã sửa**; phải chạy lại test để xác nhận.

### C.2 — HIGH: `do_grant` trả `0` cho cả thành công và thất bại; `owed` bị xoá oan

- `do_grant` `return 0` tại `L1719` (dry-run), `L1805` (không đọc lại được), và
  `L1856` — **kể cả khi** tài nguyên không tăng đủ (`L1850–1853`) hay **sai ánh
  xạ** (`L1843–1846`). `do_grant_hidden` y hệt (`L2299`, `L2327`, `L2337`).
- Người gọi:
  - `RefundWatcher` `L2120` **bỏ qua giá trị trả về** ⇒ `total_refunded[k] += give`
    và `owed[k] = 0.0` **dù không cộng được gì**. Test (b) tái hiện: `owed` từ
    1000 → 0, `total_refunded` = 407, trong khi "engine" không cộng gì.
  - GUI GrantWorker (`xa_arena_gui.py:879`) cũng chỉ coi exception là lỗi.
  - `main()` `L3691` trả luôn giá trị này làm **exit code** ⇒ luôn `0`.
- **Cách sửa**: trả `0` **chỉ** khi đã kiểm chứng delta ≥ 50 % (`L1790`), các
  trường hợp còn lại trả mã lỗi riêng (hoặc ném `GrantError` có mã), và trong
  `tick()` chỉ xoá `owed` khi kết quả = thành công.

### C.3 — HIGH: mask quyền tối thiểu thiếu `PROCESS_CREATE_THREAD`

- `open_game` `L1050` dùng `_MIN = 0x438` (VM_OPERATION|VM_READ|VM_WRITE|
  QUERY_INFORMATION) và **không lùi về ALL_ACCESS** vì `OpenProcess` đã thành
  công.
- `CreateRemoteThread` (`L1737`, `L2486`) theo hợp đồng Windows **cần**
  `PROCESS_CREATE_THREAD (0x0002)` ⇒ handle `0x438` sẽ bị `ERROR_ACCESS_DENIED`
  ở mọi lần cộng tài nguyên, kể cả khi chạy Administrator.
- **Trạng thái**: suy luận từ hợp đồng API, **chưa chạy thử trên máy có game**
  ⇒ mức "gần chắc chắn", không phải "đã đo".
- **Cách sửa**: `_MIN = 0x438 | 0x0002` (= `0x43A`), hoặc thử `0x43A` trước rồi
  mới `ALL_ACCESS`; và nếu `CreateRemoteThread` lỗi 5 thì mở lại handle với
  quyền đầy đủ.

### C.4 — HIGH: `0x528450` hardcode + `ALLOC` từ token bị bỏ qua

- `build_stub_dispatch_owned` `L888`: `alloc = 0x528450` khi `alloc is None`.
- `_call_dispatch` `L2475` **không truyền** `alloc` ⇒ luôn dùng hằng số, còn
  `ALLOC_ADDR` (nạp từ token) **không bao giờ được dùng**.
- Hệ quả: (a) trái chính sách "không để địa chỉ trong source" — địa chỉ này còn
  bị nhét vào stub trong RAM game; (b) game update ⇒ gọi vào giữa hàm khác ⇒
  heap corruption / `0xC0000005`.
- **Cách sửa**: `_call_dispatch` truyền `alloc=ALLOC_ADDR or 0x528450`, và bắt
  buộc `ALLOC_ADDR != 0` trước khi dùng đường `0x67`/`0x77`.

### C.5 — MEDIUM-HIGH: `VirtualFreeEx` khi thread remote có thể còn chạy

- `do_grant` `L1744–1746`: `WaitForSingleObject(th, 5000)` timeout ⇒ ném lỗi ⇒
  `finally` `L1753` **giải phóng trang stub** trong khi thread có thể vẫn đang
  thực thi trong chính trang đó.
- `_call_dispatch` `L2492–2503`: y hệt (3 s).
- Hệ quả: thực thi bộ nhớ đã free ⇒ `0xC0000005` (đúng lớp lỗi mà comment
  `L865–882` cảnh báo).
- **Cách sửa**: khi timeout, **không** free (rò rỉ 4 KB còn hơn crash); hoặc
  `TerminateThread` rồi chờ, rồi mới free.

### C.6 — MEDIUM: cooldown tính từ lúc **vào** tick, không phải lúc **gửi** record

- `last_refund_ms = now_ms` (`L2131`) với `now_ms` lấy ở `L2009–2010`.
- Đo (test (d)): tick #1 kéo dài 1236 ms và gửi record cuối ở mốc +1236 ms; tick
  #2 vào ở +1436 ms ⇒ điều kiện cooldown thấy `1436 ms` (mở cổng), nhưng **thời
  gian thật từ record cuối chỉ 200 ms** (< 500 ms).
- Ở bản R2 điều này chỉ làm nhịp không đều; **nếu** sau này dedup thật sự áp cho
  type 5 thì đây là đường làm mất record.
- **Cách sửa**: đặt `last_refund_ms` bằng thời điểm **gửi record cuối cùng**
  (đo bằng `time.monotonic` ngay sau `do_grant`), không phải `now_ms` đầu tick.

### C.7 — MEDIUM: `sleep` 600 ms trên thread GUI

- `L2092–2095` (`time.sleep(0.02)` trong vòng while) chạy trên **thread gọi**.
  GUI gọi `tick()` từ `QTimer` trên **thread chính** (`xa_arena_gui.py:3308`) ⇒
  treo UI ≥ 600 ms cho mỗi loại tài nguyên thứ 2 trở đi, cộng thêm thời gian
  `do_grant` chờ đọc lại (tới 5 s mỗi lần).
- **Cách sửa**: chuyển watcher sang `QThread`, hoặc bỏ hẳn sleep 600 ms (theo
  §2.6 nó không cần), hoặc hoàn **một loại mỗi tick**.

### C.8 — MEDIUM: hai comment tự mâu thuẫn về nhãn F/W (nguy cơ sửa nhầm)

- `L150–L171` nói: đo 2 trận ⇒ `F→+0x04`, `W→+0x00` (và ghi rõ "Bảng cũ ghi
  F=0x00 W=0x04 -> SAI").
- `L172–L189` nói ngược lại: `F→0x00`, `W→0x04` ("Bản cuối bị đổi chỗ F và W…
  DUNG: F:0x00, W:0x04").
- `RES_OFF` cuối cùng (`L190`) theo bản thứ hai. **Không thể cả hai đúng.**
- Tôi **không** đo lại trên game ⇒ **chưa xác minh** nhãn nào đúng. Điều chắc
  chắn: cộng theo `RES_SLOT` và `RES_OFF` là **cùng ô nhớ** (§1.1), nên grant
  luôn rơi vào một ô xác định; chỉ **tên gọi** có thể sai.
- **Cách sửa**: xoá một trong hai khối comment, giữ lại bằng chứng đã thắng.

### C.9 — LOW-MEDIUM: `except: pass` trên đường khách dùng (27 chỗ)

`L72, 335, 420, 445, 466, 477, 530, 687, 692, 1191, 1238, 1362, 2108, 2115,
2579, 2684, 3176, 3296, 3335, 3353, 3378, 3388, 3472, 3483, 3548, 3717, 3724`
(+ 8 chỗ trong `xa_grant_guard.py`: `L62, 73, 106, 149, 151, 166, 184, 187`).

Đáng chú ý nhất trên đường khách:
- `L530–531`: khi phát hiện debugger/VM, việc **báo server** bị nuốt lỗi ⇒ hạn
  mức vi phạm không được ghi, khách vẫn dùng tiếp mà không ai biết.
- `L1253–1254`: `update_enforce` lỗi ⇒ `return True` (**fail-open** với cập nhật
  bắt buộc).
- `L2108–2109`: lỗi hoàn tiền chỉ được log vào `LOG` (RAM), **không bao giờ hiện
  ra GUI** ⇒ khách thấy "đã bật" nhưng không được hoàn.
- `L2149–2150`: `is_shop_machine` lỗi ⇒ `False` ⇒ tính năng tắt im lặng.
- `L3721–3725`: chờ Enter ở cuối — treo tiến trình khi chạy không tương tác.

### C.10 — LOW: code/hằng chết

| Tên | Dòng | Ghi chú |
|---|---|---|
| `REFUND_POLL_MS` | `L1902` | **không ai dùng**; GUI hardcode `setInterval(200)` (`xa_arena_gui.py:3308`) |
| `VTABLE_SETTINGS` | `L129` | không dùng |
| `OFF_LOCAL_IDX` | `L141` | không dùng |
| `OFF_LOCAL_MARK` | `L149` | không dùng |
| `INFINITE` | `L602` | không dùng |
| `read_player_name` | `L1143` | không dùng (giữ "tương thích") |
| `my_number` | `L1342` | chỉ script ngoài gọi |
| `local_match_seconds` | `L2228` | không dùng |
| `engine_loaded` | `L236` | không dùng |
| `set_shop_hwids` / `is_shop_machine` | `L2155` / `L2162` | không nơi nào gọi; GUI có bản riêng `_is_shop_machine` |
| `RefundWatcher.chain` | `L1920` | tham số chết |
| `RefundWatcher.running` | `L1929`, `L2144` | set mà không đọc |
| `_read()` lần 2 | `L2034` | đọc trùng (thêm 1 lượt syscall/tick) |
| `CHANGE_RES` (token) | — | nạp mà không dùng |

### C.11 — LOW: `global WORLD_TIME_SRC` không cần thiết (pyflakes báo)

- `L2216`: `global WORLD_TIME_SRC` nhưng hàm **không gán** ⇒ vô nghĩa.
  **Cách sửa**: xoá dòng đó.

### C.12 — LOW: kẹp thời gian trận trả "0 = chưa biết" thay vì kẹp

- `L2243`: `if sec <= 0 or sec > 18000: return 0`. Trận > 5 giờ (hoặc lúc đồng
  hồ = 0 ms) ⇒ GUI hiểu là **phút 1** ⇒ mức cộng nhỏ nhất. Hành vi an toàn nhưng
  âm thầm; nên trả giá trị đã kẹp (`min(sec, 18000)`) và tách "không đọc được".
- Nhánh `kind == 'global'` (`L2223–2224`) là cấu hình chết.

### C.13 — MEDIUM: `tool/grant/src/` chứa bản trùng cũ, **có thể lọt vào build**

| File | root (dùng) | `src/` (cũ) | Giống nhau? |
|---|---|---|---|
| `xa_grant.py` | 138165 B (R2) | 115855 B (11-13 18:24) | ❌ **khác** (3118 dòng, không có `RefundWatcher`) |
| `xa_grant_sec.py` | 21944 B (11-14 13:17) | 22328 B (11-13 17:40) | ❌ **khác nội dung**: bản `src` dùng mã lỗi `no_engine`/`bad_engine`, bản root đổi thành `no_data`/`bad_data`; `import subprocess` đã dời lên đầu |
| `xa_grant_const.py` | 1926 B | 1926 B | ✅ giống tuyệt đối |
| `xa_grant_guard.py` | 9926 B | 9926 B | ✅ giống tuyệt đối |

- `build-grant.ps1` biên dịch **`$toolDir\xa_grant.py`** (bản đúng) nhưng chạy với
  `Push-Location $srcDir` (`:88`) và `--include-module=xa_grant_sec/…`
  (`:98–100`). Vì `src/` cũng có `xa_grant_sec.py` **khác nội dung**, thứ tự tìm
  module quyết định bản nào được nhúng. `xa_grant.py` lại `sys.path.insert(0,
  dirname(__file__))` (`L77`) nên ở runtime bản cạnh file chính thắng — nhưng khi
  Nuitka đóng gói, module đã bị **nhúng tĩnh**.
- Không có đường build nào **trực tiếp** dùng `src/xa_grant.py` (không có
  `--include-module=xa_grant`), nên file 3118 dòng chỉ là rác.
- **Cách sửa**: xoá `src/xa_grant.py`, `src/xa_grant_sec.py`,
  `src/xa_grant_const.py`, `src/xa_grant_guard.py` (giữ 1 nguồn), hoặc đổi
  `build-grant.ps1` sang `--include-module` trỏ tuyệt đối vào `$toolDir`.

### C.14 — INFO: `RES_NAME` bị định nghĩa hai lần

- `L208` (tiếng Anh: `'food'`) rồi `L2640` (tiếng Việt: `'thit'`). Bản sau ghi đè
  bản trước ở mọi chỗ dùng ⇒ thực tế **luôn** là tiếng Việt. Không phải lỗi, nhưng
  dễ gây nhầm khi đọc; nên xoá `L208`.

---

## 4. Bảng hằng số

Cột **⚠️ GAME** = phải khớp **byte** của `EMPIRESX.EXE`; game update ⇒ **hỏng
im lặng** (không exception, chỉ cộng sai/không cộng/crash).

### 4.1 Hằng số phụ thuộc game (⚠️)

| Tên | Giá trị | Nghĩa | ⚠️ | Kiểm chứng |
|---|---|---|---|---|
| `PREFERRED_BASE` | `0x400000` | ImageBase | ⚠️ | ✅ PE header |
| `DLLCHAR_OFF` | `0x46` | offset `DllCharacteristics` | ⚠️ | ✅ PE layout |
| `DLLCHAR & 0x40` | bit DYNAMIC_BASE | nếu bật ⇒ **từ chối chạy** | ⚠️ | ✅ = 0 |
| `OFF_MANAGER` | `0x3F4` | `[world+0x3F4]` = mgr | ⚠️ | ✅ `0x429C32`, `0x478AF8` |
| `OFF_SLOTS` | `0x3C` | số slot trong mgr | ⚠️ | ❌ chưa xác minh |
| `OFF_WRAPARRAY` | `0x40` | mảng wrapper | ⚠️ | ✅ `0x4EB336` |
| `OFF_LOCAL_SLOT` | `0x7C` | slot của máy này | ⚠️ | ❌ chưa xác minh |
| `OFF_PLAYER` | `0x50` | `[wrapper+0x50]` = playerdata | ⚠️ | ✅ `0x45DF20` |
| `OFF_PLAYERIDX` | `0x4A` | i16 chỉ số người chơi | ⚠️ | ✅ `0x4EB332` (gián tiếp) |
| `OFF_SENDER` | `0x58` | `[mgr+0x58]` = sender | ⚠️ | ❌ chưa xác minh |
| `OFF_APPLY` | `0x14` | `[sender+0x14]` | ⚠️ | ❌ chưa xác minh |
| `OFF_ONLINE` | `0x10E4` | cờ online | ⚠️ | ❌ chưa xác minh |
| `OFF_NAME_PTR` | `0x44` | `[wrapper+0x44]` → tên | ⚠️ | ❌ chưa xác minh |
| `OFF_BITMASK` | `0xD8` | bitmask nhóm (chỉ hiển thị) | ⚠️ | ❌ chưa xác minh |
| `RES_OFF` | `F:0 W:4 S:8 G:12` | 4 f32 tài nguyên | ⚠️ | ✅ **cấu trúc** (`0x45DF2A`); ❌ **nhãn F/W** (C.8) |
| `RES_SLOT` | `F:0 W:1 S:2 G:3` | index trong record | ⚠️ | ✅ `slot == offset/4` |
| `OFF_OBJ_POS/NEG…` | `0x88/0x90/0x94/0x9C` | mảng object (ruộng) | ⚠️ | ❌ chưa xác minh |
| `OBJ_RES_ARR` / `OBJ_RES_COUNT` | `0x1C0` / `0x1C6` | mảng `{i16 id, i16 amount}` | ⚠️ | ✅ comment `0x4AF6F9`; ❌ độ dài mảng |
| `OBJ_OWNER` | `0x0C` | con trỏ chủ object | ⚠️ | ❌ chưa xác minh |
| `RES_ID_FOOD` | `4` | resourceId "thịt" | ⚠️ | ❌ chưa xác minh |
| `TYPE_OBJ_RESOURCE` | `0x77` | type record cộng tài nguyên object | ⚠️ | ✅ `0x4EB6F8` |
| `TYPE_RES_XFER` | `0x67` | type record chuyển tài nguyên | ⚠️ | ✅ `0x4EB332` |
| `SUBTYPE_RES_CREDIT` | `2` | sub-type "cộng" | ⚠️ | ✅ handler `0x4EB32D` |
| **`0x528450`** | ALLOC của game | **hardcode ở `L888`** | ⚠️⚠️ | ✅ prologue `53 55 56 …` |
| **`0x5284F0`** | FREE của game | chỉ trong comment | ⚠️⚠️ | ✅ `0x42BA8A call → 0x5284F0` |
| **`0x1F4`** | 500 ms | cửa sổ dedup | ⚠️⚠️ | ✅ `0x42BA39 cmp eax,0x1F4` |
| `VT_SLOT_OFF` | `8` | slot vtable phải kiểm | ⚠️ | ❌ (giá trị token) |
| `0x78` (vtable slot) | ChangeResource | kiểm ở `verify_build` | ⚠️ | ✅ `0x4EB347 call [eax+0x78]` |
| `0x1F0FFF` | `PROCESS_ALL_ACCESS` | quyền mở process | — | không phụ thuộc game |
| `0x438` | mask tối thiểu | **thiếu 0x2** (C.3) | — | — |
| `MAX_PATH` | 260 | `PROCESSENTRY32.szExeFile` | ⚠️ (Win32) | — |
| `PROCESS_NAMES` | 3 tên EXE | phải khớp tên tiến trình | ⚠️ | — |

### 4.2 Hằng số đến từ token (không nằm trong source)

`BUILDER`, `SENDER`, `APPLY_GATE`, `APPLY_IMPL`, `CHANGE_RES`, `VTABLE`,
`WRAPPER_VTABLE`, `PTR_WORLD`, `ALLOC`, `VT_SLOT_VAL`, `WRAP_CR`, `GAME_PKT`,
`LOCAL_APPLY`, `BUILDER_SIB`, `RING_COPY` — mặc định **0** (`L113–L129`) và được
`load_engine_from_token` ghi đè (`L271–L299`). `PTR_WORLD` của bản game này là
**`0x585E88`** (✅ `0x478AEF`).

### 4.3 Hằng số hành vi (không phụ thuộc game)

| Tên | Giá trị | Nghĩa |
|---|---|---|
| `APP_VERSION` | `'1.0.3.0'` | phải khớp `EXE_VERSION` trong `src/routes/xa-grant-installer.js` |
| `GATE_FLAG` | `--i-understand-this-may-desync` | cổng xác nhận cho `--grant` |
| `REFUND_RATIO` | `0.5` | fallback |
| `REFUND_RATIO_MIN/MAX` | `0.40` / `0.60` | biên ngẫu nhiên |
| `REFUND_DELAY_MIN_MS/MAX_MS` | `500` / `3000` | độ trễ ngẫu nhiên mỗi tick |
| `REFUND_MIN` | `20` | dưới mức này coi là nhiễu |
| `REFUND_POLL_MS` | `200` | **chết** |
| `REFUND_COOLDOWN_MS` | `500` | sàn cooldown (bị `max()` vô hiệu) |
| `WORLD_TIME_SRC` | `('mgr', 4)` | đồng hồ trận |
| `WORLD_TIME_SCALE` | `0.001` | ms → s |
| `FULL_SET` | `('F','W','G')` | `full` bỏ `S` (lý do: dedup — **nay đã biết là sai**, §2.6) |
| `MIN_PAYLOAD`/`MAX_PAYLOAD` | 32 / 32768 | kẹp payload token |
| `GATE_LEN` | 16 | độ dài gate |
| `MAX_PLAIN` | 16384 | kẹp bản rõ khối engine |
| `TOKEN_PREFIX` | `'xg1.'` | tiền tố token |
| `APP` | `'xagrant'` | phải khớp `const APP` server |
| `API_BASE` | `https://xienhl.com` | một nguồn sự thật (`_sec`) |
| `_P/_A/_B/_N/_GX/_GY` | tham số P-256 | **phải đúng chuẩn**, sai ⇒ mọi token `bad_sig` |
| `K_PUB_X/K_PUB_Y` | 1 / 2 | chỉ số blob XOR khoá công khai |
| `_SALT_A/_SALT_B` | `b'XG|7a2e' / b'4c81|mK'` | sinh keystream XOR cho blob — **không phải bảo mật** |

---

## 5. Những gì CHƯA xác minh (đừng trích dẫn như sự thật)

1. **Decompile bằng Ghidra**: `open_binary` hết thời gian 2 lần ⇒ không có
   pseudocode. Mọi kết luận disassembly ở trên là **dịch byte thủ công**, có thể
   sai ở ranh giới lệnh.
2. **Cơ chế anti-cheat**: "ring 256 slot tại `0x100061F0`", "dịch `0x67/2` sang
   type 5", "thoát tại `test edi,edi/jle`" — nằm trong module anti-cheat, **không
   phải** `EMPIRESX.EXE`. Chưa kiểm.
3. **Hàm gửi thật `0x42F160`**: chưa biết nó có gộp/kiểm riêng hay không ⇒ kết
   luận "600 ms là không cần" chỉ đúng cho tầng `0x42BA10`.
4. **Nhãn F/W/S/G** (C.8) và **`OFF_SLOTS 0x3C`, `OFF_LOCAL_SLOT 0x7C`,
   `OFF_SENDER 0x58`, `OFF_APPLY 0x14`, `OFF_ONLINE 0x10E4`**: chỉ có comment +
   hành vi đo, chưa có byte.
5. **`RES_ID_FOOD = 4`** và layout mảng `obj+0x1C0`: mới đọc phần `sub word
   [edi+edx+2],cx`, chưa xác nhận `resourceId == 4` là thịt.
6. **`PROCESS_CREATE_THREAD`** (C.3): suy luận theo hợp đồng Windows, **chưa**
   chạy thử trên máy có game.
7. **Hành vi server** (`/api/xg/activate`, `/check`, `/violation`): chỉ đọc client.
8. **Guard** (`xa_grant_guard.py`): đọc code, **không** chạy thử — không biết nó
   có bắt nhầm trên máy khách thật hay không.

---

## 6. Kết quả kiểm tra tĩnh & test

### 6.1 `ast.parse` (bản R2)

```
xa_grant.py          AST OK  lines=3747 nodes=18078
xa_grant_const.py    AST OK  lines=65   nodes=230
xa_grant_guard.py    AST OK  lines=289  nodes=1091
xa_grant_sec.py      AST OK  lines=630  nodes=2886
```

### 6.2 `python -m pyflakes` (4.1.0)

```
xa_grant.py:2216:5: `global WORLD_TIME_SRC` is unused: name is never assigned in scope
xa_grant_const.py   : (sạch)
xa_grant_guard.py   : (sạch)
xa_grant_sec.py     : (sạch)
```

Chỉ **một** cảnh báo, và nó là lỗi thật nhưng vô hại (C.11). Không có tên chưa
dùng/import thừa nào khác ⇒ các "hằng số chết" ở C.10 là **hàm/hằng cấp module**,
pyflakes không báo.

### 6.3 Test động (`test_refund_grant.py`, chạy trên snapshot `2c97f848`)

```
== (a) tick(): lock balance on every exit path ==
   invariant: after tick() returns OR raises, engine_lock must be free for another thread
  PASS busy engine -> return [] (no acquire)
  PASS _read() None -> return []
  PASS prev None first tick -> return []
  FAIL cooldown -> release then return []          RuntimeError: cannot release un-acquired lock
  FAIL no debt -> fall through end                 RuntimeError: cannot release un-acquired lock
  FAIL owed < REFUND_MIN -> fall through end       RuntimeError: cannot release un-acquired lock
  FAIL do_grant raises -> except -> end            RuntimeError: cannot release un-acquired lock
  FAIL refund success -> end                       RuntimeError: cannot release un-acquired lock
  PASS exception mid-tick (corrupt prev)

== (b) owed accounting when the engine call fails ==
  owed after failure : F=1000.0 (spent 1000) total_refunded=0.0 returned=[] lock_depth=-1
  PASS owed preserved + counted as 0 when do_grant raises
  owed after "success"=0 : F=0.0 total_refunded=554.0 returned=[]  <-- debt forgotten
  PASS DEFECT reproduced: do_grant returning 0 clears owed

== (c) refund ratio over 200 independent runs (spent = 1000 each) ==
  runs=200  total refunded=99681  mean=498.40 (0.498 x spent)  min=400 max=599 sd=56.52
  PASS mean refund in 0.45..0.55 x spent
  PASS per-run refund respects 0.40..0.60 window   (min 0.400 / max 0.599)

== (d) 600 ms intra-tick spacing vs the 500 ms dedup window ==
  tick #1 issued 3 record(s): F@+0ms, W@+615ms, G@+1227ms
  PASS intra-tick gap >= 500 ms (dedup window)   gap=615 ms
  tick #1 duration 1227 ms; last_refund_ms = 1000000 (entry of tick #1)
  but wall time since the LAST record = 200 ms
  FAIL cross-tick gap also >= 500 ms             gap=200 ms

15 checks, 6 FAIL
```

(`lock_depth=-1` ở mục (b) chính là dấu vết của C.1: khoá bị nhả 2 lần; tiêu chí
PASS của ca đó dùng "thread khác lấy được khoá", đúng bản chất "kẹt".)

6 FAIL **đều là phát hiện thật** (5 ca C.1 + 1 ca C.6), không phải test hỏng.
Mục (c) dùng `random` nên con số trung bình thay đổi nhẹ mỗi lần chạy (các lần
chạy liên tiếp: 0.492 / 0.498 / 0.499 / 0.500 / 0.504 / 0.505 — **luôn** nằm
trong 0.45–0.55); các mục còn lại tất định.

---

## 7. Việc nên làm tiếp (theo thứ tự)

1. Chốt **một** người sửa `xa_grant.py` (đã có 3 bản khác nhau trong 24 phút).
2. Sửa C.1 (bỏ release trong `_tick_locked`), chạy lại `test_refund_grant.py`
   trên file live: kỳ vọng **15/15 PASS** trừ ca (d) nếu vẫn giữ cooldown cũ.
3. Sửa C.2 (mã trả về của `do_grant`) — đây là lỗi **mất tiền hoàn thật**.
4. Kiểm C.3 trên máy có game (chỉ cần chạy `--grant … --dry-run` rồi bỏ dry-run).
5. Dọn `src/` theo C.13 trước lần build kế tiếp.
6. Chỉ khi (1)–(5) xong mới bàn tới việc tối ưu nhịp hoàn (C.6/C.7).
