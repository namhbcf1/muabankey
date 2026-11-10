# -*- coding: utf-8 -*-
"""Thay telegramWebhook bằng dispatcher mở rộng."""
from pathlib import Path

f = Path(__file__).resolve().parent.parent / 'src' / 'routes' / 'wallet.js'
lines = f.read_text(encoding='utf-8').split('\n')

# Tìm dòng bắt đầu comment của telegramWebhook và dòng trước adminTelegramTest
start = None
end = None
for i, l in enumerate(lines):
    if l.strip() == '/**' and 'POST /api/telegram/webhook' in lines[i + 1]:
        start = i
    if l.startswith('export async function adminTelegramTest'):
        end = i
        break

if start is None or end is None:
    print('KHONG TIM THAY', start, end)
    raise SystemExit(1)

print(f'Thay dong {start + 1} den {end}')

NEW = '''/**
 * POST /api/telegram/webhook
 * Nhận callback từ Telegram khi admin bấm nút.
 *
 * Xử lý mọi loại nút: nạp tiền, đơn hàng, license, điều hướng.
 * Bảo mật: header `X-Telegram-Bot-Api-Secret-Token` + kiểm tra chat_id admin.
 */
export async function telegramWebhook(env, request) {
  const secret = env.TG_WEBHOOK_SECRET || '';
  const got = request.headers.get('x-telegram-bot-api-secret-token') || '';

  const { timingSafeEqual } = await import('../lib/crypto.js');
  if (!secret || !timingSafeEqual(got, secret)) {
    throw new ApiError(401, 'Sai secret token', 'UNAUTHORIZED');
  }

  const body = await readJson(request).catch(() => null);
  if (!body) return ok({ ignored: 'no_body' });

  const { tgAnswerCallback, tgCall } = await import('../lib/telegram.js');
  const { handleCallback } = await import('../lib/telegram-actions.js');

  // ---- Callback từ nút bấm ----
  const cq = body.callback_query;
  if (cq) {
    // Chỉ admin được bấm
    const allowed = String(env.TG_CHAT_ID || '').trim();
    const fromId = String(cq.from?.id || '');
    const msgChat = String(cq.message?.chat?.id || '');
    if (allowed && fromId !== allowed && msgChat !== allowed) {
      await tgAnswerCallback(env, cq.id, 'Bạn không có quyền', true);
      return ok({ denied: 'not_admin' });
    }

    const r = await handleCallback(env, cq, {
      DB: env.DB,
      uuid,
      audit,
      siteUrl: new URL(request.url).origin,
      deliverOrder: async (o) => {
        try {
          const { adminDeliverManual } = await import('./orders.js');
          const fakeReq = new Request(request.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          await adminDeliverManual(env, fakeReq, o.id);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
      refundOrder: async (o) => {
        try {
          const { adminRefund } = await import('./orders.js');
          const fakeReq = new Request(request.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Hoàn tiền qua Telegram' }),
          });
          const res = await adminRefund(env, fakeReq, o.id);
          const d = await res.clone().json().catch(() => ({}));
          return { ok: true, refunded: d.refunded ?? o.total };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
    });

    return ok(r);
  }

  // ---- Lệnh text: /start hoặc /id để lấy chat_id ----
  const msg = body.message;
  if (msg) {
    const text = String(msg.text || '');
    if (text.startsWith('/start') || text.startsWith('/id')) {
      await tgCall(env, 'sendMessage', {
        chat_id: msg.chat.id,
        text: `Chat ID của bạn: \\`${msg.chat.id}\\`\\n\\nDán số này vào Cài đặt → Telegram Chat ID.`,
        parse_mode: 'MarkdownV2',
      });
      return ok({ sentChatId: true });
    }

    // /help — danh sách lệnh
    if (text.startsWith('/help')) {
      await tgCall(env, 'sendMessage', {
        chat_id: msg.chat.id,
        text: [
          '🤖 *MuaBanKey Bot*',
          '',
          'Bot tự động gửi thông báo khi:',
          '• Có tiền vào → nút Duyệt / Từ chối',
          '• Đơn cần giao tay → nút Giao / Hoàn tiền',
          '• Sắp hết hàng → nút Nhập key',
          '• License sắp hết hạn → nút +30 ngày / Thu hồi',
          '• Báo cáo doanh thu mỗi ngày',
          '',
          '/id — lấy chat ID',
          '/help — trợ giúp',
        ].join('\\n'),
        parse_mode: 'MarkdownV2',
      });
      return ok({ sentHelp: true });
    }
  }

  return ok({ ignored: true });
}

'''

new_lines = lines[:start] + NEW.rstrip('\n').split('\n') + [''] + lines[end:]
f.write_text('\n'.join(new_lines), encoding='utf-8')
print('Da thay the')
