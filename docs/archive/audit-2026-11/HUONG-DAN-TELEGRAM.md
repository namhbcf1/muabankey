# Telegram Bot — điều khiển shop từ điện thoại

Bot: **@bankeynamhbcf_bot**

Mọi thứ cần admin xử lý đều được đẩy về Telegram, kèm nút bấm — không cần mở web.

## Có gì

| Tình huống | Tin nhắn | Nút bấm |
|---|---|---|
| Tiền vào ví | 💰 TIỀN ĐÃ VÀO | ✅ Duyệt · ❌ Từ chối |
| Khách nạp nhưng chưa chuyển | 💳 LỆNH NẠP MỚI | ✅ Duyệt · ❌ Từ chối |
| Đơn cần giao tay | 📦 ĐƠN CẦN GIAO TAY | 📦 Giao đơn · 💸 Hoàn tiền |
| Sắp hết hàng | ⚠️ SẮP HẾT HÀNG | 🔑 Nhập key · 🛍️ Sản phẩm |
| License sắp hết hạn | ⏰ LICENSE SẮP HẾT HẠN | ⏳ +30 ngày · 🚫 Thu hồi |
| Cuối ngày | 📊 BÁO CÁO HÔM NAY | 📊 Dashboard · 📦 Đơn hàng |

## Bảo mật

**3 lớp:**

1. `X-Telegram-Bot-Api-Secret-Token` — Telegram gửi kèm, phải khớp `TG_WEBHOOK_SECRET`
2. Chỉ `chat_id` trong `TG_CHAT_ID` mới bấm được (người lạ bấm → từ chối)
3. Mọi thao tác ghi `audit_logs` với tên người bấm

**Hoàn tiền cần 2 bước** — bấm lần 1 hiện bảng xác nhận, lần 2 mới thực thi. Tránh bấm nhầm làm mất tiền.

**Chống bấm trùng** — atomic claim trong DB, bấm 10 lần vẫn chỉ xử lý 1.

## Cài đặt (đã xong)

```powershell
npx wrangler secret put TG_BOT_TOKEN      # lấy từ @BotFather
npx wrangler secret put TG_CHAT_ID        # nhắn /id cho bot để lấy
npx wrangler secret put TG_WEBHOOK_SECRET # chuỗi ngẫu nhiên
```

Đăng ký webhook:

```powershell
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://xienhl.com/api/telegram/webhook&secret_token=<SECRET>"
```

Kiểm tra:

```powershell
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## Lệnh bot

| Lệnh | Chức năng |
|---|---|
| `/start` | Bắt đầu, bot trả chat ID |
| `/id` | Lấy chat ID |
| `/help` | Danh sách tính năng |

## Thông báo tự động

| Loại | Tần suất | Điều kiện |
|---|---|---|
| Sắp hết hàng | 6 giờ/lần | SP còn 1-4 key |
| License hết hạn | 1 lần/ngày | Còn ≤ 7 ngày |

Chạy trong cron 10 phút. Nếu Telegram lỗi thì cron vẫn chạy bình thường (bọc try/catch).

## Dùng qua API

```powershell
# Kiểm tra cấu hình
curl https://xienhl.com/api/webhooks/health

# Gửi tin thử
# (đăng nhập admin rồi POST /api/admin/telegram/test)

# Đổi bot/chat id
# POST /api/admin/telegram/config {botToken, chatId}
```

## Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Bot không nhắn gì | Chưa set webhook | Chạy `setWebhook` ở trên |
| `wrong secret token` | Secret không khớp | Đặt lại `TG_WEBHOOK_SECRET` + `setWebhook` lại |
| Bấm nút không phản hồi | Webhook chưa đăng ký | `getWebhookInfo` xem có lỗi |
| `can't parse entities` | Ký tự đặc biệt chưa escape | Đã xử lý bằng `mdEsc()` |
| Bot báo "Bạn không có quyền" | Chat ID khác | `TG_CHAT_ID` phải khớp người bấm |

Xem log:

```powershell
npx wrangler tail muabankey --format pretty
```

## Thêm loại thông báo mới

Sửa `src/lib/telegram-actions.js`:

```js
export async function notifySomething(env, data) {
  return tgCall(env, 'sendMessage', {
    chat_id: env.TG_CHAT_ID,
    text: ['*TIÊU ĐỀ*', '', mdEsc(data.something)].join('\n'),
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Làm gì đó', callback_data: `xx:action:${data.id}` },
      ]],
    },
  });
}
```

Rồi thêm nhánh `if (kind === 'xx')` trong `handleCallback()`.

**Lưu ý:** mọi giá trị động phải qua `mdEsc()` — dấu `.`, `-`, `(`, `)` trong MarkdownV2 đều phải escape.
