# XArena Grant — Tool tăng tài nguyên (sản phẩm riêng)

Sản phẩm **hoàn toàn tách biệt** với XArena No Fog: category riêng, prefix key
riêng (`XAGR-`), endpoint riêng, thư mục cài riêng, EXE riêng.
Tool **chạy 100% bằng CMD**, không có tài khoản, không có app, không có GUI.

---

## 1. Kiến trúc

```
Khách mua gói (web)
   ↓
Worker sinh key XAGR-XXXX-XXXX-XXXX vào D1  (pid='xagrant')
   ↓
Khách bấm "Lấy lệnh cài đặt" → nhận MỘT lệnh CMD
   ↓
CMD: xin admin → tải xa_grant.exe → kiểm SHA-256 → ép RUNASADMIN
     → kích hoạt license → tạo shortcut CMD ngoài Desktop
   ↓
Mở shortcut (cửa sổ cmd.exe) → gõ lệnh bơm tài nguyên
```

### Bảng / file

| Thành phần | File |
|---|---|
| Schema | [`db/schema-xagrant.sql`](../db/schema-xagrant.sql) |
| Sản phẩm 4 gói | [`db/seed-xagrant-products.sql`](../db/seed-xagrant-products.sql) |
| License API | [`src/routes/xa-grant-server.js`](../src/routes/xa-grant-server.js) |
| Installer CMD/PS1 | [`src/routes/xa-grant-installer.js`](../src/routes/xa-grant-installer.js) |
| Tool chính | [`tool/grant/xa_grant.py`](../tool/grant/xa_grant.py) |
| Tầng bảo mật | [`tool/grant/src/xa_sec.py`](../tool/grant/src/xa_sec.py) |
| Tầng license client | [`tool/grant/src/xa_grant_lic.py`](../tool/grant/src/xa_grant_lic.py) |
| Sinh hằng số mã hoá | [`tool/grant/src/gen_const.py`](../tool/grant/src/gen_const.py) |
| Build EXE | [`tool/grant/build-grant.ps1`](../tool/grant/build-grant.ps1) |
| Test E2E | [`scripts/e2e-xagrant.mjs`](../scripts/e2e-xagrant.mjs) |

---

## 2. Cài đặt (một lần)

```powershell
cd C:\Users\ADMIN\Desktop\muabankey

# 1. Schema (THÊM cột vào bảng licenses dùng chung)
npx wrangler@4 d1 execute muabankey-db --remote --file=./db/schema-xagrant.sql --yes

# 2. Sản phẩm
npx wrangler@4 d1 execute muabankey-db --remote --file=./db/seed-xagrant-products.sql --yes

# 3. (khuyến nghị) Chuyển khoá ký sang Worker secret
npx wrangler@4 secret put XG_SIGN_JWK
#   dán nguyên dòng JSON của SIGN_JWK_DEFAULT trong xa-grant-server.js

# 4. Build + upload EXE
cd tool\grant
powershell -File build-grant.ps1
#   script tự cập nhật EXE_SHA256 + EXE_SIZE vào xa-grant-installer.js
#   rồi trả lời "y" để upload lên R2

# 5. Deploy
cd ..\..
npx wrangler@4 deploy
```

**Thứ tự bắt buộc:** schema → seed → build → upload R2 → deploy.
Nếu deploy trước khi upload R2, khách tải EXE sẽ nhận 404.

---

## 3. Lệnh khách dùng

### Cài đặt
```cmd
curl -L -o "%TEMP%\xg.cmd" "https://xienhl.com/xg/XAGR-XXXX-XXXX-XXXX.cmd?t=<TOKEN>" && "%TEMP%\xg.cmd"
```

### Sử dụng (trong cửa sổ CMD)
```
who                 xem bạn là ai trong trận
check               xem tài nguyên hiện tại
t 500               +500 thịt
v 1000              +1000 vàng
g 1000 d 200        +1000 gỗ, +200 đá
full 5000           +5000 cả bốn loại
v 1.5k              hỗ trợ 1.5k / 2tr / 3m
quit                thoát
```

### Quản lý license
```cmd
xa_grant.exe --key XAGR-XXXX-XXXX-XXXX     kích hoạt
xa_grant.exe --status                      xem hạn dùng
xa_grant.exe --rebind KEY TOKEN            đổi máy
xa_grant.exe --deactivate                  xoá license máy này
xa_grant.exe --selftest                    kiểm tra nội bộ
```

### Mã thoát
| Mã | Nghĩa |
|---|---|
| 0 | OK |
| 2 | Dùng sai cú pháp |
| 3 | License không hợp lệ / hết hạn / sai máy |
| 4 | Thiếu quyền Administrator |
| 5 | Không đọc được HWID |
| 6 | Phát hiện môi trường phân tích |
| 7 | Lỗi mạng |

---

## 4. Kiến trúc bảo mật

Đây là phần quan trọng nhất. Thiết kế theo nguyên tắc: **giả định kẻ tấn công
có toàn bộ source code, có binary, và chạy trên máy của họ.**

### 4.1 Địa chỉ engine KHÔNG tồn tại trong binary

Toàn bộ tri thức reverse-engineering (địa chỉ `Builder_42BDE0`,
`Sender_42BA60`, 5 chữ ký byte, giá trị vtable, offset cấu trúc) được gom
thành **một khối JSON, mã hoá bằng stream cipher dựng trên SHA-256**:

```
ks(i)  = SHA-256("xg-ks" || gate || u32be(i))
cipher = plaintext XOR ks
```

* `gate` là 16 byte ngẫu nhiên **sinh riêng cho từng license**, nằm trong
  bảng `licenses.gate`, và **chỉ được gửi cho client trong token đã ký**.
* Không có token hợp lệ → không có `gate` → không giải mã được khối.
* Đã kiểm chứng: quét toàn bộ 7.5 MB của `xa_grant.exe`, **0 hit** cho cả
  5 địa chỉ engine và 5 chữ ký byte.

**Hệ quả thực tế:** keygen vô nghĩa (không biết gọi vào đâu), patch "bỏ kiểm
tra license" cũng vô nghĩa (không có bảng địa chỉ thì tool không làm được gì).

### 4.2 Token ký ECDSA P-256

```
token = "xg1." + base64url(payload) + "." + base64url(signature)
```

* Client **chỉ giữ public key**. Khoá riêng nằm ở Worker secret
  (`XG_SIGN_JWK`), không bao giờ rời server.
* Lộ toàn bộ source client → vẫn không tạo được token hợp lệ.
* Dựng license server giả (hosts file + proxy) → chữ ký không khớp → chặn.

Đã kiểm chứng chống được: giả mạo payload, lật 1 bit chữ ký, ghép payload
lạ với chữ ký thật, ký bằng khoá của kẻ tấn công, `r=s=0`, điểm cong không
hợp lệ, base64 rác.

### 4.3 Chống replay

* Mỗi lần `/api/xg/check` trả `sid` **mới** và huỷ toàn bộ `sid` cũ của key.
* `sid` cũ dùng lại → `session_invalid`, kể cả với `/api/xg/heartbeat`.
* Gói tin bắt được trên đường truyền không phát lại được.

### 4.4 Chống đọc binary

| Lớp | Cơ chế |
|---|---|
| Biên dịch | **Nuitka** — Python → C → mã máy. Không còn bytecode, `uncompyle6`/`pycdc` không dùng được |
| Hằng số | XOR với khoá sinh tại runtime từ `SHA-256(salt‖i‖salt)`; không có bảng khoá trong file |
| Public key | Nằm dạng mã hoá, tách 2 nửa |
| State | DPAPI (CurrentUser) + HMAC-SHA256 + thuộc tính Hidden |
| Gỡ docstring/annotation/assert | `--python-flag=no_docstrings,no_annotations,no_asserts` |

### 4.5 Chống môi trường phân tích

| Kiểm tra | Cách làm |
|---|---|
| Debugger | `IsDebuggerPresent`, `CheckRemoteDebuggerPresent`, đọc `PEB.BeingDebugged` |
| Máy ảo | Service/driver đặc trưng (VBox, VMware, Xen, QEMU…), BIOS manufacturer |
| Frida | Quét process `frida*`, `gum-js-loop` |
| Single-step / breakpoint | Đo thời gian một vòng tính toán cố định |
| Toàn vẹn | Public key phải đọc được; `verify_sig` phải **từ chối** chữ ký giả (bắt được patch "luôn trả True"); khối engine phải có trong token |

Vi phạm được báo về `/api/xg/violation`. **Quá 8 lần → server tự thu hồi
license** (`revoked=1`), khách phải liên hệ hỗ trợ.

### 4.6 Ràng buộc vận hành

* **Chỉ chạy từ CMD**: chặn khi tiến trình cha là `explorer.exe` (double-click
  hoặc shortcut trỏ thẳng vào EXE). Shortcut do bộ cài tạo mở
  `cmd.exe /k xa.cmd` nên vẫn hợp lệ.
* **1 key = 1 máy**: HWID = SHA-256(`MachineGuid | BIOS serial | CPU brand |
  volume serial`), prefix `xg1|` để tách khỏi HWID No Fog.
* **Bắt buộc online** khi hết hạn grace: mỗi 120 giây gọi lại server.
  Grace 6 giờ cho quán net đứt mạng tạm thời.
* **Đồng hồ neo server**: hạn dùng tính bằng `server_now()`, không dùng
  `time.time()`. Chỉnh lùi đồng hồ quá 2 giờ → `clock_tampered`, từ chối.
* **Sửa `lic.bin`**: HMAC sai → coi như chưa kích hoạt (đã kiểm chứng).

### 4.7 Ranh giới trung thực

Không có cơ chế client-side nào "không thể bẻ". Kẻ tấn công chạy trên máy
của họ luôn có thể patch code, dump bộ nhớ, hoặc hook API.

Điều thiết kế này **thực sự** bảo đảm:

1. Sau khi patch, họ **không có bảng địa chỉ** → tool không hoạt động.
2. Họ **không tạo được token** cho license khác/kéo dài hạn.
3. Server **ghi nhận** và tự thu hồi khi phát hiện bất thường.

Cái không chặn được: một người đã có license hợp lệ, dump bộ nhớ lúc tool
đang chạy để lấy bảng địa chỉ đã giải mã. Phòng vệ duy nhất cho trường hợp
này là server-side revocation + đổi build định kỳ.

---

## 5. Kiểm chứng

### E2E tự động — 63/63 PASS
```powershell
# Cần worker local đang chạy: npx wrangler@4 dev --port 8787 --local
node scripts/e2e-xagrant.mjs
```

Phủ: health, 4 sản phẩm, mua → sinh key → giao, installer CMD/PS1 (CRLF,
không lẫn No Fog, dùng COMSPEC), 9 đường từ chối, xoay phiên, chống replay,
vi phạm → tự thu hồi, tách biệt No Fog hai chiều.

### Kiểm chứng bảo mật thủ công

| Phép thử | Kết quả |
|---|---|
| Quét EXE tìm 5 địa chỉ engine | 0 hit |
| Quét EXE tìm 5 chữ ký byte | 0 hit |
| `strings` tìm tên hàm / địa chỉ | không có |
| Giả mạo token (4 kiểu) | đều bị từ chối |
| Ký bằng khoá kẻ tấn công | bị từ chối |
| Sửa 1 byte `lic.bin` | bị từ chối, coi như chưa kích hoạt |
| Replay `sid` cũ | `session_invalid` |
| 9 lần báo vi phạm | tự thu hồi license |
| Key No Fog gọi XAGrant | `wrong_product` |
| Key XAGrant gọi No Fog | bị từ chối |

### Self-test không cần game
```powershell
tool\grant\dist\xa_grant.exe --selftest
```

---

## 6. Vòng 2 — kiểm toán đa agent và các lỗi đã sửa

Sau khi bản đầu bàn giao, một vòng audit đa agent (mật mã / backend / tool /
frontend) đã được chạy. Dưới đây là mọi lỗi **đã xác nhận bằng đọc code hoặc
chạy thử**, và trạng thái sửa.

### 8.1 Server — lỗ hổng bảo mật

| # | Lỗi | Mức | Trạng thái |
|---|---|---|---|
| S1 | `/api/xg/violation` **không xác thực gì**: ai biết mã license cũng gửi 8 lần báo vi phạm để server **tự thu hồi license người khác** — phá hoại không cần đăng nhập | **CRITICAL** | **ĐÃ SỬA** — nay bắt buộc `hwid` khớp máy đã bind hoặc `sid`+`hwid` khớp phiên sống; key lạ trả `not_found` (không lộ) |
| S2 | Bộ cài No Fog (`/i/<KEY>`) **không kiểm `pid`**: khách mua key XAGR vẫn tải/cài No Fog và bind mất lượt HWID của key XAGR → nhận sai sản phẩm | **HIGH** | **ĐÃ SỬA** — `isOtherProduct()` chặn `pid != 'nofog'`, kể cả khi cột `pid` chưa migrate (chặn theo tiền tố `XAGR-`) |
| S3 | `ssec` sinh ra, lưu băm nhưng **không bao giờ đối chiếu** → ai bắt được `sid` là giữ được phiên (secret chết) | HIGH | **ĐÃ SỬA** — `/api/xg/heartbeat` bắt buộc `ssec`, so sánh timing-safe |
| S4 | Cron **không dọn** `xg_session`, `xg_events`, `xg_viol` → phình vô hạn (720 dòng/ngày/máy) | MEDIUM | **ĐÃ SỬA** — dọn phiên >30 ngày, event >90 ngày, đếm vi phạm cũ >30 ngày |
| S5 | `xgRebind` trả code `rate_limit` khi không sở hữu → khách tưởng bị chặn tạm, thử lại mãi | LOW | **ĐÃ SỬA** — trả `forbidden` |
| S6 | Admin tặng key hardcode `product_id='p-lic-month'` → key XAGR hiện tên sản phẩm No Fog | MEDIUM | **ĐÃ SỬA** — map `XAGR → p-xg-month`, nhận `body.productId`, validate tồn tại |
| S7 | `downloadXgExe` trả 206 cho GET thường (Miniflare luôn điền `obj.range`) | LOW | **ĐÃ SỬA** — chỉ 206 khi client thực sự gửi `Range` |

### 8.2 Client — lỗi mật mã

| # | Lỗi | Mức | Trạng thái |
|---|---|---|---|
| C1 | ECDSA tự cài **không kiểm điểm nằm trên đường cong** → lỗ hổng *invalid curve attack* (kẻ tấn công gửi điểm trên đường cong khác có cấp nhỏ) | **HIGH** | **ĐÃ SỬA** — `_on_curve()` kiểm public key + mọi điểm trung gian |
| C2 | `_inv` có thể ném khi `s=0` | LOW | **ĐÃ SỬA** — bắt `ValueError`/`ZeroDivisionError` |

Đã kiểm chứng toán học: điểm sinh G nằm trên đường cong, `N·G = ∞`,
`(N-1)·G = -G`, `_add(G,G) == _mul(2,G)`, điểm bậc 2 và điểm khác dấu đều
trả `None`.

### 8.3 Client — lỗi nghiệp vụ (nguyên nhân "không nhận đúng người chơi")

| # | Lỗi | Mức | Trạng thái |
|---|---|---|---|
| T1 | `VTABLE_PLAYER = 0x54EE68` **hardcode**: vtable của một build cụ thể. Build khác (HD/HDR/patch khác) → danh sách rỗng hoặc **sót người chơi** | **HIGH** | **ĐÃ SỬA** — nhận diện bằng **cấu trúc** (`_plausible_player`, `_wrapper_kind`), không dùng số tiền định |
| T2 | `OFF_NAME_PTR` **chưa bao giờ được định nghĩa** → `NameError` bị `except` nuốt → **tên luôn rỗng**, không thể đối chiếu "máy mình là ai" | **HIGH** | **ĐÃ SỬA** — hằng số + dò nhiều offset + `_looks_like_name()` kiểm nội dung |
| T3 | Chỉ có MỘT đường xác định "máy mình": `[mgr+0x7C]`. Không khớp → ném lỗi | **HIGH** | **ĐÃ SỬA** — 3 đường dự phòng, đường "1 người chơi" chỉ dùng khi `cnt == 2` (chống grant sai người khi danh sách bị lọc sót) |
| T4 | Stub là **mã máy 32-bit** nhưng không kiểm kiến trúc process đích → chạy trên process 64-bit chết im lặng = "chạy mà không tăng" | **HIGH** | **ĐÃ SỬA** — `require_target_is_32bit()` fail-closed |
| T5 | `--for N` được CLI nhận, quảng cáo trong usage và thông báo lỗi, nhưng `do_grant` **luôn từ chối** → tính năng chết | **HIGH** | **ĐÃ SỬA** — truyền `so` xuống `resolve_chain`; `pN`/`@N` trong chế độ tương tác cũng hoạt động |
| T6 | `next_check` lưu `time.monotonic()` xuống đĩa → **sau reboot server không bao giờ được gọi lại** | **HIGH** | **ĐÃ SỬA** — dùng wall-clock |
| T7 | `Clock.now()` dùng `mono_at` đã lưu → sau reboot **đồng hồ đóng băng**, license không bao giờ hết hạn | **HIGH** | **ĐÃ SỬA** — trôi theo wall-clock, monotonic chỉ để phát hiện chỉnh đồng hồ |
| T8 | `_LIC_CACHE` không hết hạn → chế độ tương tác chỉ kiểm license **một lần** lúc khởi động | MEDIUM | **ĐÃ SỬA** — TTL 60 giây |
| T9 | `_grace_ok` không có cận dưới → `last_ok` ở tương lai cho grace vô hạn | MEDIUM | **ĐÃ SỬA** — `delta < 0` coi là bất thường |
| T10 | `snap_before` chụp **sau** khi thread chạy → delta luôn ~0, luôn báo "không tài nguyên nào đổi" | **HIGH** | **ĐÃ SỬA** — dời lên trước `CreateRemoteThread` |
| T11 | `RES_NAME` định nghĩa **hai lần** (Anh rồi Việt) → mọi nhãn tiếng Anh bị ghi đè | MEDIUM | **ĐÃ SỬA** — một `RES_NAME` + `_VI_NAME` riêng |
| T12 | Comment `RES_SLOT` ghi `W=0 F=1` **mâu thuẫn** với dict `F=0 W=1` | MEDIUM | **ĐÃ SỬA** — comment khớp bảng, kèm selftest bất biến |
| T13 | `rd` và `u32` **định nghĩa 2 lần** | LOW | **ĐÃ SỬA** — xoá bản trùng |
| T14 | `IsWow64Process` lỗi → **fail-open** (vẫn ghi stub 32-bit vào process 64-bit) | LOW | **ĐÃ SỬA** — fail-closed trên Python 64-bit |
| T15 | `/i/*` cài đặt No Fog nhận cả key XAGR | HIGH | xem S2 |

### 8.4 Kiểm chứng sau khi sửa

| Phép thử | Kết quả |
|---|---|
| `--selftest` (33 phép thử, mỗi cái nhắm 1 lỗi thật) | **PASS** |
| E2E server (`scripts/e2e-xagrant.mjs`) | **69/69 PASS** |
| Quét EXE tìm địa chỉ engine | **0 hit** |
| ECDSA: G trên đường cong, `N·G = ∞`, `_add == _mul`, điểm bịa bị loại | **PASS** |
| Parser: 15/15 dạng lệnh, gồm `p2 v 500`, `v 500 p2`, `p2v500` | **PASS** |
| Giả mạo token (4 kiểu), ký bằng khoá lạ, `r=s=0`, base64 rác | **đều bị từ chối** |
| Sửa 1 byte `lic.bin` | **bị từ chối** |
| Replay `sid` cũ; `ssec` sai; vi phạm từ máy khác | **đều bị chặn** |

### 8.5 Điều chưa kiểm chứng được

Triệu chứng "không nhận đúng người chơi / tài nguyên không tăng" phụ thuộc vào
**build EMPIRESX.EXE thật** và **trạng thái trận đang chơi**. Máy này không có
game đang chạy nên **chưa thể xác minh trực tiếp**. Những gì đã làm được là
loại bỏ các nguyên nhân chắc chắn sai (T1, T2, T4) và thêm đường dự phòng
(T3, T5). Khi có game, chạy theo thứ tự sau để khoanh vùng:

```cmd
xa_grant.exe --status            :: license OK?
xa_grant.exe --check             :: đọc được người chơi? in bảng slot/so/ten
```

Nếu `--check` in bảng có tên người chơi → T1/T2 đã hết. Nếu bảng đúng nhưng
grant không tăng → xem dòng `[arch]` và `[exec] thread ket thuc, exit code`.
Nếu tool báo "không xác định được máy mình là ai" → chạy `--for N` với số
trong cột `so`.

---

## 7. Vận hành & sự cố

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `not_found` khi kích hoạt | Key chưa có `pid='xagrant'` | Kiểm tra `SELECT pid FROM licenses WHERE key=?` |
| `schema_missing` | Chưa chạy `schema-xagrant.sql` | Chạy migration |
| 404 khi tải EXE | Chưa upload R2 | `wrangler r2 object put` |
| "FILE TAI VE KHONG DUNG CHU KY" | `EXE_SHA256` lệch bản R2 | Chạy lại `build-grant.ps1` |
| `hwid_mismatch` | Đổi phần cứng / máy mới | Khách bấm "Đổi máy" trên web |
| `clock_tampered` | Đồng hồ máy lùi | Sửa giờ hệ thống |
| Tool báo "CHỈ CHẠY BẰNG CMD" | Double-click EXE | Dùng shortcut hoặc `Win+R → cmd` |
| License bị `revoked` tự động | Quá 8 lần vi phạm anti-debug | Admin `unrevoke` sau khi xác minh |

### Kiểm tra nhanh
```powershell
curl https://xienhl.com/api/xg/health
# {"ok":true,"app":"xagrant","licenses":N,"schema_ok":true,...}
```

---

## 8. Đổi khoá ký (khi khoá bị lộ)

```powershell
cd tool\grant\src
python -c "import base64,json;from cryptography.hazmat.primitives.asymmetric import ec;from cryptography.hazmat.primitives import serialization as s;p=ec.generate_private_key(ec.SECP256R1());n=p.private_numbers();q=p.public_key().public_numbers();g=lambda b:base64.urlsafe_b64encode(b).decode().rstrip('=');i=lambda v:v.to_bytes(32,'big');print(json.dumps({'kty':'EC','crv':'P-256','x':g(i(q.x)),'y':g(i(q.y)),'d':g(i(n.private_value))}))"
```

1. Thay `SIGN_JWK_DEFAULT` trong `xa-grant-server.js` bằng JSON mới
2. `npx wrangler@4 secret put XG_SIGN_JWK` (dán cùng JSON)
3. `cd tool\grant; powershell -File build-grant.ps1` — `gen_const.py` tự đọc
   public key mới từ server, nên hai bên không bao giờ lệch
4. Upload + deploy

**Lưu ý:** đổi khoá làm **mọi license cũ mất hiệu lực** cho đến khi khách
chạy lại tool (client tự gọi `/api/xg/check` lấy token mới bằng khoá mới).
Vì `gate` lưu theo license chứ không theo khoá, không cần reset dữ liệu.

