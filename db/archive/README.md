# db/archive — MIGRATION NGUY HIỂM

Các file trong thư mục này **XOÁ DỮ LIỆU THẬT** khi chạy. Không chạy trên
production trừ khi bạn thật sự muốn xoá.

| File | Chạy sẽ xoá gì |
|---|---|
| `migrate-licenses.sql` | **TOÀN BỘ `licenses`** (4.572 dòng) |
| `schema-trial-v2.sql` | DROP `trial_uses`, `trial_quota` |
| `fix-trial-hwid-null.sql` | DROP `trial_uses` |
| `seed.sql` | 13 bảng (users, orders, products, ...) |
| `seed-credentials.sql` | `product_keys` của 12 sản phẩm |
| `cleanup-*.sql` | users/orders/licenses test |
| `reconcile-wallet.sql` | product_keys, order_items, products |
| `accounts.sql` | reviews, wallet_transactions, users |

## Quy tắc

1. **Backup trước:** `npx wrangler d1 export muabankey-db --remote --output=backup.sql`
2. **Đọc kỹ `DELETE`/`DROP`** trước khi chạy
3. **Ưu tiên D1 time-travel** (giữ 30 ngày) thay vì chạy file xoá
4. Không bao giờ để file trong `db/` gốc — dễ chạy nhầm khi `npm run db:migrate`

## Deploy từ zero

Dùng `db/schema.sql` + các `db/schema-*.sql` theo thứ tự, KHÔNG dùng file ở đây.
