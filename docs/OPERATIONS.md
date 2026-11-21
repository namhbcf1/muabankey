# MuaBanKey — Operations Runbook

> Canonical vận hành hiện hành. Không dùng các hướng dẫn legacy về key, ví hoặc `/api/install-info`.

## Môi trường

| Môi trường | Mục đích |
|---|---|
| local | Wrangler dev, D1 local, QA không dữ liệu thật |
| staging | D1/KV/R2/secret riêng, chạy toàn bộ E2E mutation |
| production | `xienhl.com`, chỉ deploy sau staging + backup |

Mọi script ghi dữ liệu phải có `QA_BASE`/target guard. Không chạy QA mutation với domain production.

## Deploy Worker

```powershell
npm run verify
npm run db:export
npm run db:migrate:check
npm run db:migrate
npx wrangler deploy
```

Sau deploy kiểm tra:

```powershell
curl https://xienhl.com/api/health
npx wrangler tail muabankey
```

## Database

- Schema nền: `db/schema.sql`.
- Migration có checksum: `db/migrations/` + `db/migrate.mjs`.
- Không chạy lại `schema.sql` trên production đã có dữ liệu.
- Backup chứa `password_hash`, license và dữ liệu khách phải để ngoài repo, mã hoá, có manifest SHA-256.
- Restore drill tối thiểu mỗi quý trên một D1 staging mới.

## Thanh toán

1. Khách tạo đơn; server lấy giá từ DB.
2. Server tạo QR theo order code + tổng tiền.
3. SePay/PayOS gửi webhook.
4. `payment_inbox` ghi event trước mọi nhánh return.
5. Server đối soát transaction, amount, account, trạng thái provider.
6. Đơn chuyển `processing`, giao entitlement idempotent.
7. Chỉ `delivered` mới được UI nói là đã cấp quyền.

Webhook secret chỉ đặt trong Cloudflare secret/QA environment. Không commit secret.

## Hoàn tiền

- Web và Telegram dùng chung `src/lib/refund-service.js`.
- `refund` thu hồi đúng entitlement của order.
- `refund/complete` bắt buộc mã giao dịch ngân hàng thực tế.
- Không dùng `users.balance` thay cho chứng từ hoàn tiền.
- Đơn `refund_stuck` phải đối soát ledger trước khi thao tác lại.

## Trial và thiết bị

- Trial tài khoản: 1 ngày, cả `nofog` và `grant`, bắt đầu khi app xin session lần đầu.
- `/api/account/token` áp device guard.
- Mỗi tài khoản chỉ có một thiết bị active theo policy hiện hành.
- Không tin HWID tự khai thiếu các phần cấu thành; không dùng IP làm whitelist phần cứng.

## Phát hành EXE

```powershell
powershell -ExecutionPolicy Bypass -File tool/build-arena.ps1
```

Pipeline bắt buộc: build → version resource → Authenticode + timestamp → hash sau ký → `release/manifest.json` → upload R2 → set `RELEASE_MANIFEST` → deploy.

`-SkipSign` chỉ dành cho build nội bộ, không được upload.

## Sự cố

| Triệu chứng | Xử lý đầu tiên |
|---|---|
| Đã thu tiền nhưng chưa cấp | Xem `payment_inbox`, order status, `refund_ledger`; không tạo đơn mới cho khách |
| App không thấy quyền | Kiểm `account_entitlements`, device session, token issue; không xoá entitlement bằng tay |
| Webhook lặp | Kiểm `payment_inbox` unique provider + transaction_id |
| Cron lỗi | Xem Worker tail, chạy job nhỏ lại; không chạy SQL xoá hàng loạt đoán mò |
| EXE hash mismatch | Dừng promote, kiểm bytes sau ký và manifest |

## Tài liệu liên quan

- `docs/RELEASE.md`
- `docs/TODO.md`
- `docs/archive/audit-2026-11/`
- `docs/app/`
