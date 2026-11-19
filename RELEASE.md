# QUY TRÌNH PHÁT HÀNH BẢN MỚI

> **Ghi chú bắt buộc — đọc trước mỗi lần deploy.**

---

## KIẾN TRÚC HIỆN TẠI: MỘT APP DUY NHẤT

Từ bản này khách chỉ tải và cài **MỘT** thứ:

```
xa_setup.exe  ->  cài  ->  tự mở  ->  XA ARENA
```

**XA ARENA** (`xa_arena.exe`) chứa cả hai chức năng. Quyền bật cái nào
do **license** quyết định, không phải do cài bản nào:

| License | Bật map sáng | Cộng tài nguyên |
|---|---|---|
| `AOE1-…` / `TR-…` (pid rỗng/`aoe1`) | ✅ | ❌ ẩn |
| `XAGR-…` (pid `xagrant`) | ❌ ẩn | ✅ |
| Có cả 2 license | ✅ | ✅ |

Nguồn sự thật: `src/routes/entitlement.js` → `featureKeysFor()`.

Phần khách **không** có quyền bị **ẩn hoàn toàn** — không hiện nút xám,
không báo "bạn không có quyền".

Chỉ phát hành **hai file**: `xa_arena.exe` (app) và `xa_setup.exe` (bộ cài).

App giờ **ÉP CẬP NHẬT**: bản cũ hơn server sẽ **KHÔNG CHẠY ĐƯỢC**.
Nó tự tải bản mới, thay file, khởi động lại. Không hỏi khách.

Vì vậy **quên tăng version = không ai nhận được bản mới**.
Và **build lỗi + deploy = mọi khách nhận bản lỗi**.

---

## 2 con số PHẢI tăng cùng lúc

| Bản | File Python | File server | Biến |
|---|---|---|---|
| **Arena** (app gộp) | `tool/app/xa_arena_app.py` | `src/routes/arena-installer.js` | `APP_VERSION` = `EXE_VERSION` |
| **Setup** (bộ cài) | `tool/setup/xa_setup.py` | `src/routes/install-info.js` | `VERSION` = `SETUP_VERSION` |

**Hai file mỗi bản PHẢI bằng nhau.** Lệch → app tưởng có bản mới liên tục
(tải đi tải lại) hoặc không bao giờ cập nhật.

Chỉ còn **hai** thứ phát hành: app gộp và bộ cài.

---

## Các bước

```
1. Sửa code
2. TĂNG VERSION ở CẢ HAI file (python + server) của bản vừa build
      vd: 1.5.0.0 -> 1.6.0.0
3. Build EXE
4. Chạy --selftest, xác nhận PASS
5. python scripts/check_versions.py        <-- PHẢI ra "TAT CA KHOP"
6. Upload R2 + cập nhật EXE_SHA256/EXE_SIZE
7. npx wrangler deploy
8. python scripts/check_versions.py        <-- kiểm lại trên production
9. Test thật trên máy mình trước khi báo khách
```

---

## Kiểm tra version tự động

```powershell
python scripts/check_versions.py
```

Kiểm tra:
- Python ↔ server-code khớp chưa
- Fallback trong `download.js` khớp chưa
- Production đã đúng version chưa
- Hash file local ↔ production khớp chưa

Mã trả: `0` = tất cả khớp, `1` = có chỗ lệch (**sửa trước khi deploy**).

---

## Cơ chế ép cập nhật

Nằm ở `tool/ui/xa_update.py` → `enforce_update()`.

```
Mở app
  → hỏi /api/app/version
  → server mới hơn?
      CÓ  → tải + kiểm SHA-256 + thay file + khởi động lại → THOÁT
      KHÔNG → chạy bình thường
  → không hỏi được server?
      VẪN CHẠY (không chặn khách trả tiền khi mất mạng)
```

**Không có nút "Bỏ qua".** Không có cách tắt. Không hỏi ý kiến.

---

## Lưới an toàn: rollback tự động

Nếu bản mới **crash ngay khi mở** (không sống nổi 60 giây):

```
Lần 1 mở -> đếm = 1
Lần 2 mở -> đếm = 2
Lần 3 mở -> đếm = 3 > 2  -> TỰ QUAY VỀ bản .old rồi khởi động lại
```

Chỉ cứu được lỗi **crash**. Lỗi "chạy được nhưng sai chức năng"
thì rollback KHÔNG kích hoạt.

→ **Vì vậy bước 9 (test thật trên máy mình) là bắt buộc.**

---

## ⚠ CẢNH BÁO

Vì app ép cập nhật và không cho bỏ qua:

- Build lỗi + deploy = **mọi khách nhận bản lỗi ngay**
- Không thể "rút lại" nhanh — phải build bản mới đè lên
- Khách mất mạng thì vẫn dùng được bản cũ (đúng thiết kế)

**Luôn test trước. Luôn chạy `check_versions.py`.**
