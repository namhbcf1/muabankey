/**
 * Mở rộng Telegram: nút bấm cho MỌI thao tác admin.
 *
 * Các loại nút:
 *   tp:ok:<id>       duyệt nạp tiền
 *   tp:no:<id>       từ chối nạp tiền
 *   od:deliver:<id>  giao tay đơn hàng
 *   od:refund:<id>   hoàn tiền đơn (2 bước xác nhận)
 *   ls:revoke:<key>  thu hồi license
 *   ls:ext30:<key>   gia hạn +30 ngày
 *   nav:<tab>        mở link web tương ứng
 *   noop             không làm gì (nút thông tin)
 *
 * Bảo mật: chỉ chat_id trong TG_CHAT_ID mới bấm được.
 * Nút hoàn tiền yêu cầu xác nhận 2 bước.
 */
import { mdEsc, hEsc, vnd, tgConfig, tgAnswerCallback,
         tgUpdateMessage, tgCall, tgBroadcast } from './telegram.js';

/**
 * Kiểm tra người bấm nút có phải admin không.
 *
 * LỖI ĐÃ SỬA: bản trước dùng
 *     return fromId === allowed || msgChat === allowed;
 * Vế thứ hai (`msgChat`) so CHAT CHỨA TIN với admin id. Hễ tin được gửi vào
 * group có id trùng (hoặc khi chính admin id là group), MỌI thành viên group
 * đều qua cổng -> ai trong group cũng bấm "Duyệt & giao key" được.
 *
 * Nay: CHỈ so danh tính NGƯỜI BẤM (`from.id`) với danh sách admin.
 * Chat chứa tin không có ý nghĩa gì về quyền.
 *
 * Hàm này hiện không được gọi (cổng thật nằm ở wallet.js), giữ lại đã sửa
 * để không ai dùng nhầm bản sai về sau.
 */
function isAdminChat(env, cq, cfgChatId) {
  const ids = new Set();
  const push = (v) => {
    for (const p of String(v || '').split(',')) {
      const s = p.trim();
      if (s) ids.add(s);
    }
  };
  push(cfgChatId);
  push(env.TG_CHAT_ID);
  push(env.TG_ADMIN_IDS);

  if (ids.size === 0) return false;           // chưa cấu hình -> đóng
  const fromId = String(cq.from?.id || '').trim();
  return !!fromId && ids.has(fromId);
}

/**
 * Xử lý callback query từ Telegram.
 * Trả {handled: true, ...} hoặc {handled: false}.
 */
export async function handleCallback(env, cq, deps) {
  const { DB, uuid, audit, unlock, remaining } = deps;
  const data = String(cq.data || '');
  const parts = data.split(':');
  const kind = parts[0];
  const action = parts[1];
  const target = parts.slice(2).join(':');
  const now = Date.now();
  const adminName = cq.from?.username || cq.from?.first_name || 'Telegram';

  /* ================= NẠP TIỀN ================= */
  if (kind === 'tp') {
    const t = await DB.prepare('SELECT * FROM topups WHERE id = ?').bind(target).first();
    if (!t) {
      await tgAnswerCallback(env, cq.id, 'Không tìm thấy lệnh nạp', true);
      return { handled: true, ignored: 'not_found' };
    }
    if (t.status === 'paid') {
      await tgAnswerCallback(env, cq.id, '✅ Đã duyệt rồi', true);
      return { handled: true, duplicated: true };
    }

    if (action === 'ok') {
      const claim = await DB.prepare(
        `UPDATE topups SET status='paid', paid_at=?, txn_ref=COALESCE(txn_ref, ?)
         WHERE id = ? AND status != 'paid'`
      ).bind(now, 'TG-' + String(adminName).slice(0, 12), target).run();
      if (!claim.meta || claim.meta.changes !== 1) {
        await tgAnswerCallback(env, cq.id, 'Đã có người duyệt trước', true);
        return { handled: true, duplicated: true };
      }

      const credited = t.amount;
      await DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
        .bind(credited, now, t.user_id).run();
      const bal = await DB.prepare('SELECT balance FROM users WHERE id = ?').bind(t.user_id).first();
      await DB.prepare(
        `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
         VALUES (?,?,'topup',?,?,'success',?,?,?)`
      ).bind(uuid(), t.user_id, credited, bal.balance, t.code,
        `Nạp tiền duyệt qua Telegram (${t.code}) — ${adminName}`, now).run();

      await audit(env, null, 'topup.approve', target, { credited, via: 'telegram', by: adminName });
      await tgAnswerCallback(env, cq.id, `✅ Đã cộng ${vnd(credited)}`);
      if (cq.message) {
        await tgUpdateMessage(env, cq.message.chat.id, cq.message.message_id,
          `✅ *ĐÃ DUYỆT*\n\nMã: \`NAP${mdEsc(t.code)}\`\nSố tiền: *${mdEsc(vnd(credited))}*\n` +
          `Người duyệt: ${mdEsc(adminName)}\nSố dư mới: ${mdEsc(vnd(bal.balance))}`);
      }
      return { handled: true, approved: true, credited, balance: bal.balance };
    }

    // Từ chối
    const claim = await DB.prepare(
      "UPDATE topups SET status='cancelled' WHERE id = ? AND status != 'paid'"
    ).bind(target).run();
    if (!claim.meta || claim.meta.changes !== 1) {
      await tgAnswerCallback(env, cq.id, 'Đã thanh toán, không huỷ được', true);
      return { handled: true, duplicated: true };
    }
    await audit(env, null, 'topup.reject', target, { via: 'telegram', by: adminName });
    await tgAnswerCallback(env, cq.id, '❌ Đã từ chối');
    if (cq.message) {
      await tgUpdateMessage(env, cq.message.chat.id, cq.message.message_id,
        `❌ *ĐÃ TỪ CHỐI*\n\nMã: \`NAP${mdEsc(t.code)}\`\nSố tiền: *${mdEsc(vnd(t.amount))}*\n` +
        `Người xử lý: ${mdEsc(adminName)}`);
    }
    return { handled: true, rejected: true };
  }

  /* ================= THANH TOÁN QR ================= */
  // Nút từ telegram-pay.js: py:ok:<orderId> / py:no:<orderId>
  // Admin xác nhận đã thấy tiền -> giao key. Đây là đường CỨU khi webhook
  // trượt (SePay chết, khách ghi sai nội dung, chuyển tay).
  if (kind === 'py') {
    const o = await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(target).first();
    if (!o) {
      await tgAnswerCallback(env, cq.id, 'Không tìm thấy đơn', true);
      return { handled: true, ignored: 'not_found' };
    }

    if (action === 'no') {
      await tgAnswerCallback(env, cq.id, 'Đã ghi nhận: chưa thấy tiền');
      if (cq.message) {
        await tgUpdateMessage(env, cq.message.chat.id, cq.message.message_id,
          `❌ *CHƯA THẤY TIỀN*\n\nMã: \`${mdEsc(o.code)}\`\n` +
          `_Kiểm tra lại sao kê. Đơn vẫn chờ tại trang khách._`);
      }
      return { handled: true, rejected: true };
    }

    if (action === 'ok') {
      if (o.status === 'delivered') {
        await tgAnswerCallback(env, cq.id, '✅ Đơn đã giao rồi', true);
        return { handled: true, duplicated: true };
      }
      // Đi qua confirmOrderPaid() — cửa duy nhất, có chống trùng.
      //
      // ratify: true — nút "✅ Duyệt & giao key" nghĩa là admin ĐÃ THẤY tiền
      // trong sao kê, không phải khách vừa chuyển thêm một khoản mới. Thiếu cờ
      // này thì đơn đã được webhook ghi sổ ngoài cửa sổ giờ sẽ bị cộng tiền
      // lần hai (sổ 360.000đ cho đơn 180.000đ) và Telegram báo "thừa" sai.
      const { confirmOrderPaid } = await import('../routes/payments.js');
      const r = await confirmOrderPaid(env, {
        orderId: target,
        amount: o.total,
        source: 'telegram',
        adminId: adminName || 'telegram',
        ratify: true,
      });

      if (r.duplicated) {
        await tgAnswerCallback(env, cq.id, 'Đã xác nhận trước đó rồi', true);
        return { handled: true, duplicated: true };
      }
      if (!r.ok) {
        await tgAnswerCallback(env, cq.id,
          `❌ ${r.reason || r.error || 'Không giao được'}`, true);
        return { handled: true, error: r.reason };
      }

      await audit(env, null, 'order.pay_confirm', target, {
        via: 'telegram', by: adminName, amount: o.total,
      });
      await tgAnswerCallback(env, cq.id, '✅ Đã xác nhận & giao key');
      if (cq.message) {
        await tgUpdateMessage(env, cq.message.chat.id, cq.message.message_id,
          `✅ *ĐÃ XÁC NHẬN THANH TOÁN*\n\n` +
          `Mã: \`${mdEsc(o.code)}\`\n` +
          `Tổng: *${mdEsc(vnd(o.total))}*\n` +
          `Người duyệt: ${mdEsc(adminName)}\n` +
          `_Key đã giao cho khách._`);
      }
      return { handled: true, delivered: !!r.delivered };
    }
  }

  /* ================= ĐƠN HÀNG ================= */
  if (kind === 'od') {
    const o = await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(target).first();
    if (!o) {
      await tgAnswerCallback(env, cq.id, 'Không tìm thấy đơn', true);
      return { handled: true, ignored: 'not_found' };
    }

    if (action === 'deliver') {
      if (o.status === 'delivered') {
        await tgAnswerCallback(env, cq.id, '✅ Đơn đã giao rồi', true);
        return { handled: true, duplicated: true };
      }
      const r = await deps.deliverOrder(o);
      if (!r.ok) {
        await tgAnswerCallback(env, cq.id, `❌ ${r.error || 'Không giao được'}`, true);
        return { handled: true, error: r.error };
      }
      await audit(env, null, 'order.deliver', target, { via: 'telegram', by: adminName });
      await tgAnswerCallback(env, cq.id, '✅ Đã giao đơn');
      if (cq.message) {
        await tgUpdateMessage(env, cq.message.chat.id, cq.message.message_id,
          `✅ *ĐÃ GIAO ĐƠN*\n\nMã: \`${mdEsc(o.code)}\`\n` +
          `Tổng: *${mdEsc(vnd(o.total))}*\nNgười giao: ${mdEsc(adminName)}`);
      }
      return { handled: true, delivered: true };
    }

    if (action === 'refundreq') {
      // Bước 1: hỏi xác nhận
      await tgAnswerCallback(env, cq.id, 'Bấm xác nhận lần 2 để hoàn tiền');
      if (cq.message) {
        await tgUpdateMessage(env, cq.message.chat.id, cq.message.message_id,
          `⚠️ *XÁC NHẬN HOÀN TIỀN*\n\nMã: \`${mdEsc(o.code)}\`\n` +
          `Số tiền: *${mdEsc(vnd(o.total))}*\n\n` +
          `_Sẽ thu hồi license/key đã giao và KHÔNG thể hoàn tác._`,
          {
            reply_markup: { inline_keyboard: [[
              { text: '✅ XÁC NHẬN HOÀN TIỀN', callback_data: `od:refund:${target}` },
              { text: '↩️ Huỷ', callback_data: `od:cancel:${target}` },
            ]] },
          });
      }
      return { handled: true, confirmRequested: true };
    }

    if (action === 'cancel') {
      await tgAnswerCallback(env, cq.id, 'Đã huỷ');
      if (cq.message) {
        await tgUpdateMessage(env, cq.message.chat.id, cq.message.message_id,
          `↩️ *ĐÃ HUỶ* hoàn tiền đơn \`${mdEsc(o.code)}\``);
      }
      return { handled: true, cancelled: true };
    }

    if (action === 'refund') {
      const r = await deps.refundOrder(o);
      if (!r.ok) {
        await tgAnswerCallback(env, cq.id, `❌ ${r.error || 'Không hoàn được'}`, true);
        return { handled: true, error: r.error };
      }
      await audit(env, null, 'order.refund', target, {
        amount: r.refunded, via: 'telegram', by: adminName,
      });
      await tgAnswerCallback(env, cq.id, `✅ Đã hoàn ${vnd(r.refunded)}`);
      if (cq.message) {
        await tgUpdateMessage(env, cq.message.chat.id, cq.message.message_id,
          `💸 *ĐÃ HOÀN TIỀN*\n\nMã: \`${mdEsc(o.code)}\`\n` +
          `Số tiền: *${mdEsc(vnd(r.refunded))}*\nNgười xử lý: ${mdEsc(adminName)}\n` +
          `_License/key đã thu hồi._`);
      }
      return { handled: true, refunded: r.refunded };
    }
  }

  /* ================= LICENSE ================= */
  if (kind === 'ls') {
    const lic = await DB.prepare('SELECT * FROM licenses WHERE key = ?').bind(target).first();
    if (!lic) {
      await tgAnswerCallback(env, cq.id, 'Không tìm thấy license', true);
      return { handled: true, ignored: 'not_found' };
    }

    if (action === 'revoke') {
      if (lic.revoked) {
        await tgAnswerCallback(env, cq.id, 'Đã thu hồi rồi', true);
        return { handled: true, duplicated: true };
      }
      await DB.prepare('UPDATE licenses SET revoked = 1 WHERE key = ?').bind(target).run();
      await audit(env, null, 'license.revoke', target, { via: 'telegram', by: adminName });
      await tgAnswerCallback(env, cq.id, '🚫 Đã thu hồi');
      if (cq.message) {
        await tgUpdateMessage(env, cq.message.chat.id, cq.message.message_id,
          `🚫 *ĐÃ THU HỒI*\n\nKey: \`${mdEsc(target)}\`\nNgười xử lý: ${mdEsc(adminName)}`);
      }
      return { handled: true, revoked: true };
    }

    if (action === 'ext30') {
      /*
       * CẨN THẬN: expires_at = 0 nghĩa là VĨNH VIỄN, null là CHƯA KÍCH HOẠT.
       *
       * Bản trước: const base = Math.max(now/1000, lic.expires_at || 0);
       * Với key vĩnh viễn (expires_at = 0), `0 || 0` = 0 -> base = now ->
       * newExp = now + 30 ngày. Một cú bấm "+30 ngày" biến license VĨNH VIỄN
       * (gói 1.290.000đ) thành license 30 ngày và KHÔNG hoàn tác được.
       */
      if (lic.expires_at === 0) {
        await tgAnswerCallback(env, cq.id, 'Key vĩnh viễn, không cần gia hạn', true);
        return { handled: true, forever: true, noop: true };
      }
      const base = Math.max(now / 1000, lic.expires_at || now / 1000);
      const newExp = Math.floor(base + 30 * 86400);
      await DB.prepare('UPDATE licenses SET expires_at = ? WHERE key = ?')
        .bind(newExp, target).run();
      await audit(env, null, 'license.extend', target, {
        days: 30, newExp, via: 'telegram', by: adminName,
      });
      await tgAnswerCallback(env, cq.id, '✅ Đã gia hạn +30 ngày');
      if (cq.message) {
        await tgUpdateMessage(env, cq.message.chat.id, cq.message.message_id,
          `✅ *ĐÃ GIA HẠN +30 NGÀY*\n\nKey: \`${mdEsc(target)}\`\n` +
          `Hết hạn mới: ${mdEsc(new Date(newExp * 1000).toLocaleDateString('vi-VN'))}`);
      }
      return { handled: true, extended: true, expiresAt: newExp };
    }
  }

  /* ================= ĐIỀU HƯỚNG ================= */
  // nav:<tab> chỉ có 2 phần -> target phải lấy từ parts[1], không phải slice(2)
  if (kind === 'nav') {
    const site = deps.siteUrl || 'https://xienhl.com';
    const tab = action || 'dashboard';
    await tgAnswerCallback(env, cq.id, 'Mở web...');
    return { handled: true, url: `${site}/#/admin?tab=${tab}` };
  }

  await tgAnswerCallback(env, cq.id, 'Nút không hợp lệ', true);
  return { handled: false };
}

/**
 * Bắn thông báo đơn hàng cần giao tay.
 */
export async function notifyOrderPending(env, opts) {
  const { order, email, items } = opts;
  const lines = [
    '📦 <b>ĐƠN CẦN GIAO TAY</b>',
    '',
    `Mã đơn: <code>${hEsc(order.code)}</code>`,
    `Khách: ${hEsc(email || 'không rõ')}`,
    `Tổng: <b>${hEsc(vnd(order.total))}</b>`,
  ];
  if (items?.length) {
    lines.push('');
    for (const it of items.slice(0, 6)) {
      lines.push(`• ${hEsc(it.name)} × ${it.quantity}`);
    }
  }
  lines.push('');
  lines.push('<i>Bấm Giao đơn sau khi đã gửi key cho khách</i>');

  return tgBroadcast(env, lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '📦 Giao đơn', callback_data: `od:deliver:${order.id}` },
        { text: '💸 Hoàn tiền', callback_data: `od:refundreq:${order.id}` },
      ]],
    },
  });
}

/**
 * Cảnh báo sắp hết hàng.
 */
export async function notifyLowStock(env, products) {
  if (!products?.length) return { ok: true, skipped: true };
  const lines = ['⚠️ <b>SẮP HẾT HÀNG</b>', ''];
  for (const p of products.slice(0, 10)) {
    lines.push(`• ${hEsc(p.name)}: <b>${p.stock_count}</b> còn lại`);
  }
  lines.push('');
  lines.push('<i>Nhập thêm key để không gián đoạn bán hàng</i>');

  return tgBroadcast(env, lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '🔑 Nhập key', callback_data: 'nav:keys' },
        { text: '🛍️ Xem sản phẩm', callback_data: 'nav:products' },
      ]],
    },
  });
}

/**
 * License sắp hết hạn.
 */
export async function notifyExpiring(env, rows) {
  if (!rows?.length) return { ok: true, skipped: true };
  // ------------------------------------------------------------------
  // KHÔNG in key đầy đủ ra Telegram.
  //
  // LỖI ĐÃ SỬA: tin này (và 2 nút bên dưới) in nguyên key của từng khách.
  // Nhóm Telegram có nhiều người — ai vào cũng đọc được key người khác và
  // dùng miễn phí. Chủ shop yêu cầu "mọi thứ khép kín", "không còn key".
  //
  // Nay chỉ hiện 4 ký tự cuối + tên khách. `callback_data` vẫn mang key
  // nhưng đó là dữ liệu ẩn của nút, khách không đọc được.
  // ------------------------------------------------------------------
  const tail = (k) => {
    const t = String(k || '').replace(/[^A-Za-z0-9]/g, '');
    return t.length >= 5 ? '••••' + t.slice(-4).toUpperCase() : '••••';
  };
  const lines = ['⏰ <b>SẮP HẾT HẠN</b>', ''];
  for (const r of rows.slice(0, 10)) {
    const d = Math.max(0, Math.ceil((r.expires_at - Date.now() / 1000) / 86400));
    const who = r.username || r.user_name || '';
    lines.push(`• <code>${hEsc(tail(r.key))}</code>`
               + (who ? ` · ${hEsc(who)}` : '')
               + ` — còn <b>${d}</b> ngày`);
  }
  lines.push('');
  lines.push('<i>Khách có thể gia hạn để không mất quyền dùng</i>');

  return tgBroadcast(env, lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: rows.slice(0, 3).map((r) => ([
        { text: `⏳ +30 ngày ${tail(r.key)}`,
          callback_data: `ls:ext30:${r.key}` },
        { text: `🚫 Thu hồi ${tail(r.key)}`,
          callback_data: `ls:revoke:${r.key}` },
      ])),
    },
  });
}

/**
 * Báo cáo doanh thu hằng ngày.
 */
export async function notifyDailyReport(env, stats) {
  const lines = [
    '📊 <b>BÁO CÁO HÔM NAY</b>',
    '',
    `Đơn hàng: <b>${stats.orders}</b>`,
    `Doanh thu: <b>${hEsc(vnd(stats.revenue))}</b>`,
    `Khách mới: <b>${stats.newUsers}</b>`,
    `Key đã giao: <b>${stats.keysDelivered}</b>`,
  ];
  if (stats.trialStarted) lines.push(`Dùng thử: <b>${stats.trialStarted}</b>`);
  if (stats.trialConverted) lines.push(`Chuyển đổi: <b>${stats.trialConverted}</b>`);
  lines.push('');
  lines.push('<i>Báo cáo tự động hằng ngày</i>');

  return tgBroadcast(env, lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '📊 Dashboard', callback_data: 'nav:dashboard' },
        { text: '📦 Đơn hàng', callback_data: 'nav:orders' },
      ]],
    },
  });
}
