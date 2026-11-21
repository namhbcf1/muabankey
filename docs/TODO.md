# MuaBanKey — TODO / Backlog

## Đã hoàn tất

- F01–F09: entitlement, trial, payment inbox, migration runner, policy thống nhất.
- F10: admin account entitlement/trial/reconcile/refund tabs.
- F11: checkout phân biệt `paid`, `processing`, `delivered`, `refund*`.
- F12: route cleanup, AbortController, header listener disposal, modal cancel paths.
- F16: session inventory/revoke API + UI.
- F17: cart module, dead CSS, duplicate route.
- QA guard, P0 hardening, release manifest pipeline, 17 test suites.

## P0 triển khai còn cần làm

- Rotate webhook/provider secrets đã từng xuất hiện trong lịch sử git.
- Chạy migration trên staging rồi production sau backup.
- Có chứng chỉ Authenticode thật; build không ký chỉ dành cho nội bộ.
- Đặt `RELEASE_MANIFEST` sau khi upload R2 và verify bytes.

## Legacy cần telemetry trước khi xoá

- `/api/activate`, `/api/check`, `/api/rebind` và adapters `/api/xg/*` cho app cũ.
- `/api/trial/start`, `/api/trial/stop`, `/api/trial/left` và trial quota cũ.
- Topup/wallet admin cũ nếu không còn dữ liệu pending.
- Coupon: orders vẫn còn logic coupon; không xoá chỉ vì UI không hiển thị.
- `tool/setup/` và standalone nofog/grant adapters: giữ tới khi telemetry chứng minh không còn client.

Quy trình: đo hit 14 ngày → ẩn UI → trả 410 kèm hướng dẫn → giữ rollback → mới xoá code/bảng.

## Web polish

- Đổi `document.title`/meta theo route.
- Đo Lighthouse staging; mục tiêu LCP ≤2.5s, INP ≤200ms, CLS ≤0.1.
- Tách thêm trang eager thành lazy chunks khi có build pipeline ổn định.
- Giảm inline style sau khi snapshot visual regression.

## App EXE — còn lại có kiểm soát

- Không tách cơ học `xa_nofog_pro.py`/`xa_grant.py`/`xa_arena_gui.py` trong cùng một release: đây là engine native/game, cần branch riêng + golden smoke test trước mỗi module move.
- Tách dần HWID/DPAPI/update client thành implementation dùng chung, mỗi bước giữ API adapter cũ và có test import.
- Gọi integrity/anti-tamper theo policy đã công bố; không fail-open im lặng.
- Ma trận Windows 10/11, DPI, standard user, mạng lỗi, update rollback.
- Chứng chỉ Authenticode thật + build/release manifest là điều kiện bên ngoài code; pipeline hiện đã fail-closed khi thiếu cert.
