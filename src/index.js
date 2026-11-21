/**
 * MuaBanKey — Cloudflare Worker entry point.
 * Phục vụ SPA tĩnh qua ASSETS binding và toàn bộ API dưới /api/*.
 */
import { Router } from './lib/router.js';
import { ApiError, fail } from './lib/http.js';
import { getSessionUser } from './lib/auth.js';
import { rateLimit, clientIp } from './lib/ratelimit.js';

import * as auth from './routes/auth.js';
import * as products from './routes/products.js';
import * as orders from './routes/orders.js';
import * as wallet from './routes/wallet.js';
import * as payments from './routes/payments.js';
import * as sepayRc from './routes/sepay-reconcile.js';
import * as admin from './routes/admin.js';
import * as ai from './routes/ai.js';
import * as license from './routes/license.js';
import { postShopLic, getShopLicStatus } from './routes/shop-lic.js';
import * as entitlement from './routes/entitlement.js';
import * as arenaInstaller from './routes/arena-installer.js';
import * as licenseServer from './routes/license-server.js';
import * as trial from './routes/trial.js';
import * as trialAccount from './routes/trial-account.js';
import * as accountAdmin from './routes/account-admin.js';
import * as trialAdmin from './routes/trial-admin.js';
import * as trialCmd from './routes/trial-command.js';
import * as twl from './routes/trial-whitelist-admin.js';
import * as stats from './routes/stats.js';
import * as appInfo from './routes/app-info.js';
import * as xgServer from './routes/xa-grant-server.js';

const r = new Router();

/* ---------- Health ---------- */
r.get('/api/health', async (env) => {
  const db = await env.DB.prepare('SELECT 1 AS ok').first();
  return new Response(
    JSON.stringify({ ok: true, db: !!db, ts: Date.now(), env: env.ENV || 'unknown' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});

/* ---------- Auth ---------- */
r.post('/api/auth/register', auth.register);
r.post('/api/auth/login', auth.login);
r.post('/api/auth/logout', auth.logout);
r.get('/api/auth/me', auth.me);
r.patch('/api/auth/profile', auth.updateProfile);
r.post('/api/auth/change-password', auth.changePassword);
/*
 * QUẢN LÝ PHIÊN (F16).
 *
 * Trước đây khách không thấy mình đang đăng nhập ở đâu và không đá được máy
 * lạ ra. Bảng `sessions` vốn đã lưu ip/ua/thời gian — chỉ thiếu phần đọc ra.
 */
r.get('/api/auth/sessions', auth.listSessions);
r.post('/api/auth/sessions/revoke-others', auth.revokeOtherSessionsRoute);
r.delete('/api/auth/sessions/:id', (env, req, p) => auth.revokeSession(env, req, p.id));

/* ---------- Catalog ---------- */
r.get('/api/stats', (env) => stats.publicStats(env));
/*
 * /api/home — GOM moi thu trang chu can vao MOT round trip.
 *
 * Truoc day trang chu goi noi tiep: auth/me 657ms -> categories 542ms ->
 * trial/status 491ms -> featured 448ms -> stats 397ms = ~1,6 giay.
 *
 * Nay: mot env.DB.batch() chay 12 cau lenh trong MOT lan round trip, tra
 * {categories, products, stats, trial}. Session duoc join thang trong SQL
 * nen khong can them /api/auth/me.
 *
 * Router la bang chinh xac tung duong (src/lib/router.js) — khong co
 * catch-all, nen phai dang ky o day thi duong moi ton tai.
 */
r.get('/api/home', (env, req) => products.homeBundle(env, req));
/*
 * Thong tin bo cai cho trang /tai-ve. PUBLIC co y: khach con dang phan
 * van phai xem duoc version + hash de quyet dinh tai. Chi tra ten file,
 * hash, dung luong — khong lo gi ve license hay nguoi dung.
 */
r.get('/api/app/version', (env, req) => appInfo.appVersion(env, req));
r.get('/api/categories', products.listCategories);
r.get('/api/products', products.listProducts);
r.get('/api/products/featured', products.getFeatured);
r.get('/api/products/:id', (env, req, p) => products.getProduct(env, p.id));

/* ---------- Orders ---------- */
r.post('/api/coupons/check', orders.checkCoupon);
r.post('/api/orders', orders.createOrder);
r.get('/api/orders', orders.listOrders);
r.get('/api/orders/:id', (env, req, p) => orders.getOrder(env, req, p.id));
r.post('/api/orders/:id/qr', (env, req, p) => payments.createOrderQr(env, req, p.id));
r.post('/api/orders/:id/claimed', (env, req, p) => payments.claimOrderPaid(env, req, p.id));

/* ---------- Wallet ---------- */
r.post('/api/webhooks/sepay', payments.sepayWebhook);
r.post('/api/webhooks/payos', payments.payosWebhook);
r.post('/api/telegram/webhook', wallet.telegramWebhook);
r.get('/api/webhooks/health', (env) => wallet.webhookHealth(env));

/* ---------- License client API (cho tool XArena) ---------- */
r.post('/api/activate', licenseServer.apiActivate);
r.post('/api/check', licenseServer.apiCheck);
r.post('/api/rebind', licenseServer.apiRebind);
r.get('/api/license/health', (env) => licenseServer.apiHealth(env));

/* ---------- XAGrant: tool tăng tài nguyên (sản phẩm riêng) ---------- */
r.post('/api/xg/activate', xgServer.xgActivate);
r.post('/api/xg/check', xgServer.xgCheck);
r.post('/api/xg/heartbeat', xgServer.xgHeartbeat);
r.post('/api/xg/rebind', xgServer.xgRebind);
r.post('/api/xg/violation', xgServer.xgViolation);
r.get('/api/xg/health', (env) => xgServer.xgHealth(env));

/* ---------- Dùng thử 3 ngày ---------- */
/*
 * DÙNG THỬ THEO TÀI KHOẢN — mô hình hiện hành.
 *
 *   POST /api/trial/session  -> bắt đầu/tiếp tục, trả token cả 2 tính năng
 *   GET  /api/trial/session  -> xem trạng thái, KHÔNG chạy đồng hồ
 *
 * Khách KHÔNG phải nhập mã. Mỗi tài khoản mới được 1 ngày, bật cả map sáng
 * và tài nguyên, đồng hồ chạy từ lần đầu mở app.
 */
r.post('/api/trial/session', (env, req) => trialAccount.startSession(env, req));
r.get('/api/trial/session', (env, req) => trialAccount.sessionStatus(env, req));
/* Cấp token theo QUYỀN TÀI KHOẢN (đã mua hoặc đang dùng thử). */
r.post('/api/account/token', (env, req) => trialAccount.issueAccountToken(env, req));
r.get('/api/admin/trial/account-trials', (env, req) => trialAccount.adminListAccountTrials(env, req));
r.post('/api/admin/trial/account-reset', (env, req) => trialAccount.adminResetAccountTrial(env, req));

/* ---------- Admin: QUYỀN THEO TÀI KHOẢN (thay tab License cũ) ---------- */
r.get('/api/admin/accounts', (env, req) => accountAdmin.listAccounts(env, req));
r.post('/api/admin/accounts/:id/grant', (env, req, p) => accountAdmin.grantAccount(env, req, p.id));
r.post('/api/admin/accounts/:id/revoke', (env, req, p) => accountAdmin.revokeAccount(env, req, p.id));

/*
 * ĐƯỜNG CŨ (mã TR-) — GIỮ LẠI CHO BẢN EXE ĐÃ PHÁT HÀNH.
 *
 * Không xoá ngay: khách còn dùng bản cũ sẽ gọi các route này. Chỉ cần xoá
 * khi đã chắc mọi máy đã cập nhật lên bản dùng thử theo tài khoản.
 */
r.post('/api/trial/start', trial.apiTrialStart);
r.get('/api/trial/status', trial.apiTrialStatus);
/* So luot dung thu con lai THEO PHAN CUNG (tool hien trong app). */
r.get('/api/trial/left', trial.apiTrialLeft);
r.post('/api/trial/stop', trial.apiTrialStop);
r.post('/api/trial/claim', trial.apiTrialClaim);
r.post('/api/trial/command', trialCmd.apiTrialCommand);

/* ---------- License quản lý ---------- */
r.get('/api/licenses/mine', license.myLicenses);
/*
 * QUYEN DUNG CHUC NANG — app goi de biet hien/chi hien phan nao.
 * ?key=... -> chi 1 key (khong can dang nhap)
 * khong tham so -> tat ca key cua tai khoan dang dang nhap
 */
r.get('/api/entitlement', (env, req) => entitlement.buildEntitlement(env, req));
r.post('/api/licenses/:key/rebind', (env, req, p) => license.rebindMyLicense(env, req, p.key));

/* ---------- AI ---------- */
r.post('/api/ai/chat', ai.aiChat);

/* ---------- Admin ---------- */
r.get('/api/admin/dashboard', admin.dashboard);
r.get('/api/admin/users', admin.listUsers);
r.patch('/api/admin/users/:id', (env, req, p) => admin.updateUser(env, req, p.id));
r.get('/api/admin/coupons', admin.listCoupons);
r.post('/api/admin/coupons', admin.saveCoupon);
r.delete('/api/admin/coupons/:id', (env, req, p) => admin.deleteCoupon(env, req, p.id));
r.get('/api/admin/logs', admin.listAuditLogs);
r.get('/api/admin/settings', admin.getSettings);
r.post('/api/admin/settings', admin.saveSettings);

r.get('/api/admin/products', products.adminListProducts);
r.post('/api/admin/products', (env, req) => products.adminSaveProduct(env, req, null));
r.patch('/api/admin/products/:id', (env, req, p) => products.adminSaveProduct(env, req, p.id));
r.delete('/api/admin/products/:id', (env, req, p) => products.adminDeleteProduct(env, req, p.id));
/* ĐÃ BỎ 3 route kho key — shop chỉ bán license sinh động. */

r.get('/api/admin/orders', orders.adminListOrders);
r.post('/api/admin/orders/:id/deliver', (env, req, p) => orders.adminDeliverManual(env, req, p.id));
/*
 * HOÀN TIỀN — HAI BƯỚC, KHÔNG PHẢI MỘT.
 *
 *   POST /refund           -> quyết định hoàn + thu hồi quyền/license.
 *                             Tiền CHƯA chuyển; đơn sang 'refund_pending_transfer'.
 *   POST /refund/complete  -> chốt đã chuyển tiền thật, BẮT BUỘC mã giao dịch
 *                             ngân hàng; đơn sang 'refunded'.
 *
 * Vì sao tách: trước đây bấm "Hoàn" là đơn thành 'refunded' ngay, dù tiền
 * chưa rời tài khoản shop. Dashboard báo "đã hoàn" trong khi khách chưa nhận
 * đồng nào, và đơn đã 'refunded' thì không còn đường quay lại.
 */
r.post('/api/admin/orders/:id/refund', (env, req, p) => orders.adminRefund(env, req, p.id));
r.post('/api/admin/orders/:id/refund/complete', (env, req, p) => orders.adminCompleteRefund(env, req, p.id));
/* Các khoản đã hứa hoàn nhưng CHƯA chuyển tiền — dashboard đối soát. */
r.get('/api/admin/refunds/pending', async (env, req) => {
  const { requireAdmin } = await import('./lib/auth.js');
  await requireAdmin(env, req);
  const { listPendingRefunds } = await import('./lib/refund-service.js');
  const rows = await listPendingRefunds(env, 200);
  return Response.json({ ok: true, count: rows.length, refunds: rows });
});
/* Hộp thư tiền vào chưa xử lý xong — tiền vào mà chưa thành hàng. */
r.get('/api/admin/payments/unresolved', async (env, req) => {
  const { requireAdmin } = await import('./lib/auth.js');
  await requireAdmin(env, req);
  const { listUnresolved } = await import('./lib/payment-inbox.js');
  const rows = await listUnresolved(env, 200);
  return Response.json({ ok: true, count: rows.length, payments: rows });
});
  // Xác nhận đã thấy tiền -> giao key. Đường CỨU khi webhook trượt.
  r.post('/api/admin/orders/:id/confirm-payment', (env, req, p) => payments.adminConfirmPayment(env, req, p.id));
  // Sổ tiền vào: matched / unmatched / wrong_amount / claimed
  r.get('/api/admin/payments', payments.adminListPayments);
  // Đối soát SePay: tìm tiền vào webhook bỏ lỡ
  r.get('/api/admin/sepay/reconcile', sepayRc.reconcileSePay);
  r.post('/api/admin/sepay/sync', sepayRc.syncSePayTxn);
  // Hạn mức 50 GD/tháng + cửa sổ giờ tự động
  r.get('/api/admin/sepay/quota', sepayRc.sepayQuota);
r.post('/api/admin/settings/payos', wallet.adminSetPayosKey);
r.get('/api/admin/trial/accounts', trialAdmin.adminTrialAccounts);
r.get('/api/admin/trial/uses', trialAdmin.adminTrialUses);
r.get('/api/admin/trial/resets', trialAdmin.adminTrialResets);
r.post('/api/admin/trial/reset', trialAdmin.adminTrialReset);
r.post('/api/admin/trial/grant', trialAdmin.adminTrialGrant);
r.post('/api/admin/trial/ban', trialAdmin.adminTrialBan);
r.get('/api/admin/trial/whitelist', twl.adminWhitelistList);
r.post('/api/admin/trial/whitelist', twl.adminWhitelistAdd);
r.delete('/api/admin/trial/whitelist', twl.adminWhitelistRemove);
r.post('/api/admin/trial/whitelist/this-device', twl.adminWhitelistThisDevice);
r.get('/api/admin/telegram/status', wallet.adminTelegramStatus);
r.post('/api/admin/telegram/config', wallet.adminTelegramConfig);
r.post('/api/admin/telegram/test', wallet.adminTelegramTest);
r.get('/api/admin/topups', wallet.adminListTopups);
r.post('/api/admin/topups/:id/approve', (env, req, p) => wallet.adminApproveTopup(env, req, p.id));
r.post('/api/admin/topups/:id/reject', (env, req, p) => wallet.adminRejectTopup(env, req, p.id));

/*
 * Điều chỉnh số dư là đường DUY NHẤT để admin hoàn tiền tay sau khi bỏ ví:
 * `adminRefund` cộng vào `users.balance` mà khách không còn chỗ tiêu, nên khi
 * cần trả tiền thật cho khách, admin dùng route này để ghi nhận và đối soát.
 * Trước đây route bị xoá cùng đợt bỏ ví nhưng frontend vẫn gọi → nút trong
 * trang Người dùng luôn trả 404.
 */
r.post('/api/admin/wallet/adjust', wallet.adminAdjustBalance);


/* Mã hoá key đã giao còn plaintext — chạy một lần sau khi bật KEY_ENC. */
r.post('/api/admin/migrate-delivered-keys', orders.adminMigrateDeliveredKeys);

r.get('/api/admin/licenses', license.adminLicenses);
r.post('/api/admin/licenses', license.adminIssueLicenses);

// Ký danh sách máy chủ shop (shop.lic) — chỉ admin.
// Lý do: app chỉ tin danh sách do server ký; khách tạo file
// shop.hwid tự ý sẽ không bật được tính năng.
r.get('/api/shop/lic', getShopLicStatus);
r.post('/api/shop/lic', postShopLic);
r.post('/api/admin/licenses/:key/:action', (env, req, p) =>
  license.adminLicenseAction(env, req, p.key, p.action));

/* ---------- Cấu hình CORS chặt (chỉ same-origin + webhook) ---------- */
function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  const sameOrigin = origin === url.origin;
  return {
    'Access-Control-Allow-Origin': sameOrigin ? origin : url.origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

export default {
  /**
   * Cron: dọn dữ liệu hết hạn + đơn treo.
   * Chạy mỗi 10 phút (cấu hình trong wrangler.toml [triggers]).
   */
  async scheduled(event, env, ctx) {
    const now = Date.now();
    const nowS = Math.floor(now / 1000);
    ctx.waitUntil((async () => {
      try {
        // 1. Lệnh nạp tiền quá hạn -> expired
        await env.DB.prepare(
          "UPDATE topups SET status='expired' WHERE status='pending' AND expires_at < ?"
        ).bind(now).run();

        // 2. Đơn pending quá 45 phút -> cancelled, trả lại coupon
        // Dùng coupon_released để KHÔNG trả 2 lần: payOrder có thể đã
        // releaseCoupon khi hết hàng, rồi cron lại trả lần nữa -> used_count
        // thấp hơn thực tế -> coupon bị dùng vượt hạn mức.
        const stale = await env.DB.prepare(
          `SELECT id, coupon_code, coupon_released FROM orders
           WHERE status='pending' AND created_at < ?`
        ).bind(now - 45 * 60 * 1000).all();
        for (const o of stale.results || []) {
          // 'expired' KHÔNG phải 'cancelled': đơn còn nhận được tiền về muộn.
          // 'cancelled' = huỷ hẳn, confirmOrderPaid sẽ từ chối -> tiền khách
          // vào mà không ghi sổ, không giao key (mất tiền thật).
          const c = await env.DB.prepare(
            "UPDATE orders SET status='expired' WHERE id = ? AND status='pending'"
          ).bind(o.id).run();
          if (!c.meta || c.meta.changes !== 1) continue;
          if (o.coupon_code && !o.coupon_released) {
            await env.DB.prepare(
              'UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?'
            ).bind(o.coupon_code).run();
            await env.DB.prepare(
              'UPDATE orders SET coupon_released = 1 WHERE id = ?'
            ).bind(o.id).run();
          }
        }

        // 3. Đơn kẹt 'processing'/'refunding' quá 10 phút (worker chết giữa chừng)
        //
        // QUAN TRỌNG: dùng cột mốc RIÊNG, KHÔNG dùng created_at.
        // Trước đây dùng created_at -> đơn tạo >10 phút trước bị "hồi sinh":
        //   refunding -> delivered -> admin refund lại -> hoàn tiền nhiều lần.
        // Đã xảy ra thật: MBK-L5W87H hoàn 70.000đ hai lần.
        // 'processing' = TIỀN ĐÃ VÀO, đang giao. Trước đây đưa về 'pending'
        // + paid_at=NULL -> khách thấy QR lần 2 và TRẢ TIỀN LẦN 2.
        // Nay về 'paid' (đã có tiền, chờ admin giao tay).
        await env.DB.prepare(
          `UPDATE orders SET status = 'paid', processing_started_at = NULL
           WHERE status = 'processing'
             AND processing_started_at IS NOT NULL
             AND processing_started_at < ?`
        ).bind(now - 10 * 60 * 1000).run();

        /*
         * ===== ĐƠN 'refunding' KẸT -> 'refund_stuck', TUYỆT ĐỐI KHÔNG về 'paid' =====
         *
         * 'refunding' là trạng thái đã GIÀNH ĐƯỢC đơn và ĐANG cộng tiền cho
         * khách. Worker chết giữa chừng (CPU limit 30s, nhiều await thu hồi
         * license/key) sẽ để đơn kẹt ở đây.
         *
         * Trước đây cron đưa về 'paid' -> admin thấy lại nút "Hoàn" -> bấm
         * lần 2 -> hoàn tiền lần 2. ĐÃ XẢY RA THẬT: MBK-L5W87H hoàn
         * 70.000đ hai lần. Đây là mất tiền thật, không phải rủi ro lý thuyết.
         *
         * Nay đưa sang 'refund_stuck' — trạng thái KHÔNG có nút Hoàn trong
         * UI (public/assets/pages/admin.js chỉ hiện nút khi 'paid'/'delivered').
         * Admin phải đối soát sổ (refund_ledger + wallet_transactions) rồi
         * quyết định tay. Máy không được tự đoán "đã cộng tiền hay chưa".
         *
         * Vì sao KHÔNG tự kiểm refund_ledger ở đây: nếu ledger ghi
         * state='done' thì tiền đã cộng (chốt 'refunded'); nếu 'pending' thì
         * CHƯA cộng (an toàn để hoàn tiếp). Cron xử lý 2 nhánh này tách bạch
         * bên dưới thay vì đoán.
         */
        // Nhánh A: sổ đã chốt 'done' -> tiền đã cộng xong, chỉ còn thiếu
        // bước đặt trạng thái đơn. Chốt luôn, KHÔNG để admin bấm lại.
        try {
          await env.DB.prepare(
            `UPDATE orders SET status = 'refunded'
             WHERE status = 'refunding'
               AND refund_started_at IS NOT NULL
               AND refund_started_at < ?
               AND id IN (SELECT order_id FROM refund_ledger WHERE state = 'done')`
          ).bind(now - 10 * 60 * 1000).run();
        } catch { /* chưa chạy migration refund_ledger */ }

        // Nhánh B: sổ chưa chốt (hoặc không có sổ) -> KHÔNG tự cộng, KHÔNG
        // hồi sinh về 'paid'. Đẩy sang 'refund_stuck' chờ admin đối soát.
        await env.DB.prepare(
          `UPDATE orders SET status = 'refund_stuck'
           WHERE status = 'refunding'
             AND refund_started_at IS NOT NULL
             AND refund_started_at < ?`
        ).bind(now - 10 * 60 * 1000).run();

        // Đơn 'processing' cũ chưa có mốc (dữ liệu cũ) -> giữ nguyên, chỉ log
        const orphan = await env.DB.prepare(
          "SELECT COUNT(*) n FROM orders WHERE status='processing' AND processing_started_at IS NULL"
        ).first();
        if ((orphan?.n || 0) > 0) {
          console.warn(`Có ${orphan.n} đơn processing thiếu mốc processing_started_at`);
        }

        // 4. Dọn token hết hạn
        await env.DB.prepare('DELETE FROM rebind_tokens WHERE expires_at < ?').bind(nowS).run();
        await env.DB.prepare('DELETE FROM install_tokens WHERE expires_at < ?').bind(nowS).run();
        await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
        await env.DB.prepare('DELETE FROM lic_attempts WHERE at < ?').bind(nowS - 7 * 86400).run();
        // Nonce XAGrant chỉ sống 90 giây; xoá sau 1 giờ là quá đủ.
        try {
          await env.DB.prepare('DELETE FROM xg_nonce WHERE at < ?').bind(nowS - 3600).run();
        } catch { /* chưa migrate CSDL */ }

        // ===== XAGrant: dọn định kỳ =====
        // Không dọn thì ba bảng này phình vô hạn: mỗi client gọi /api/xg/check
        // 120 giây/lần và ghi 1 dòng xg_events -> 720 dòng/ngày/máy.
        try {
          // Phiên đã huỷ hoặc quá cũ (client không quay lại).
          await env.DB.prepare(
            'DELETE FROM xg_session WHERE revoked = 1 OR last_at < ?'
          ).bind(nowS - 30 * 86400).run();
          // Nhật ký XAGrant: giữ 90 ngày.
          await env.DB.prepare('DELETE FROM xg_events WHERE at < ?')
            .bind(nowS - 90 * 86400).run();
          // Đếm vi phạm: reset sau 30 ngày không vi phạm, để khách quay lại
          // không bị thu hồi oan vì lỗi cũ.
          await env.DB.prepare('DELETE FROM xg_viol WHERE last_at < ?')
            .bind(nowS - 30 * 86400).run();
        } catch { /* chưa migrate CSDL */ }

        // ===== Dọn bảng APPEND-ONLY (trước đây tăng vô hạn) =====
        // lic_events: ghi 1 dòng/lần client check license (+ cron xoá sau 90 ngày).
        // audit_logs: nhật ký thao tác admin/user — giữ 180 ngày.
        // trial_attempts: nhật ký xin trial — giữ 30 ngày.
        // rate_limits: bảng fallback của rate limiter — dọn theo window_at.
        // license_issues: KHÔNG dọn (là bằng chứng mua bán).
        try {
          await env.DB.prepare('DELETE FROM lic_events WHERE at < ?')
            .bind(nowS - 90 * 86400).run();
        } catch { /* bảng chưa có */ }
        try {
          await env.DB.prepare('DELETE FROM audit_logs WHERE created_at < ?')
            .bind(now - 180 * 86400).run();
        } catch { /* dùng ms */ }
        try {
          await env.DB.prepare('DELETE FROM trial_attempts WHERE at < ?')
            .bind(nowS - 30 * 86400).run();
        } catch { /* chưa migrate */ }
        try {
          /*
           * ===== DỌN BỘ ĐẾM RATE LIMIT (P0 — đã sửa 21/11) =====
           *
           * LỖI CŨ (rất nặng, kéo dài âm thầm): câu lệnh cũ là
           *     DELETE FROM rate_limits WHERE window_at < floor((now-86400)/60)
           *
           * `window_at` = floor(unix_giây / windowSec) là CHỈ SỐ KHUNG, không
           * phải mốc thời gian. Với window 60s nó ~29.907.000; nhưng với
           * window 900s (đăng nhập) nó chỉ ~1.994.000 và với 3600s ~498.000.
           * Ngưỡng xoá tính theo 60s là ~2.987.000 — LỚN HƠN mọi chỉ số khung
           * của window dài. Hệ quả: mỗi lần cron chạy (10 phút) xoá SẠCH bộ
           * đếm của:
           *   - login:<ip>       500 req / 900s  (auth.js)
           *   - lf:<username>    10 lần sai / 900s — bộ đếm chống dò mật khẩu
           *   - reg:<ip>         300 req / 3600s
           * tức là kẻ tấn công được cấp lại hạn mức mới mỗi 10 phút.
           *
           * Nay bảng có cột `expires_at` = mốc hết hạn TUYỆT ĐỐI của khung
           * (xem db/migrations/0004-rate-limit-expiry.sql), nên so sánh trực
           * tiếp với thời điểm hiện tại là đúng cho MỌI window.
           *
           * Dòng cũ chưa có expires_at (NULL) được dọn luôn: bảng này chỉ là
           * bộ đếm tạm, xoá sớm không mất dữ liệu nghiệp vụ nào.
           */
          await env.DB.prepare(
            'DELETE FROM rate_limits WHERE expires_at IS NULL OR expires_at < ?'
          ).bind(nowS).run();
        } catch { /* chưa chạy migration 0004 -> giữ bảng, không chặn cron */ }
        // trial_quota mồ côi: user_id không còn trong users (user test đã xoá)
        try {
          await env.DB.prepare(
            `DELETE FROM trial_quota
             WHERE user_id NOT LIKE 'dev:%'
               AND user_id NOT IN (SELECT id FROM users)`
          ).run();
        } catch { /* chưa migrate */ }

        /*
         * ===== DỌN LICENSE DÙNG THỬ MỒ CÔI (audit #7) =====
         *
         * Trước đây cron chỉ dọn `trial_quota` / `trial_attempts`, KHÔNG đụng
         * tới `licenses(plan='trial')` và `trial_uses`. Hai bảng đó chỉ tăng:
         * mỗi lượt bấm dùng thử sinh 1 dòng licenses + 1 dòng trial_uses, kể
         * cả khi khách không bao giờ cài. Trên production đã có ~326 license
         * trial mồ côi — làm nhiễu mọi thống kê và làm trang quản trị license
         * phải phân trang vô ích.
         *
         * RANH GIỚI AN TOÀN (rất quan trọng — không được xoá trial của khách
         * đã dùng thật, họ có thể còn khiếu nại):
         *   - `activated_at` PHẢI trống  -> chưa từng kích hoạt trên máy nào
         *   - `trial_uses.started_at` PHẢI trống -> đồng hồ chưa chạy
         *   - hạn GIỮ đã hết quá 30 ngày -> không còn cửa sổ cài nào
         *   - KHÔNG đụng license đã bị thu hồi (revoked=1): giữ làm bằng chứng
         *     khi admin đã kết luận gian lận.
         * Trial ĐÃ kích hoạt thì giữ nguyên vĩnh viễn (chỉ `lic_events` bị dọn
         * theo hạn 90 ngày như cũ).
         */
        try {
          const cutoff = nowS - 30 * 86400;
          // B1: xoá trial_uses của các license chưa từng kích hoạt
          const delUses = await env.DB.prepare(
            `DELETE FROM trial_uses
              WHERE COALESCE(started_at, 0) = 0
                AND lic_key IN (
                  SELECT key FROM licenses
                   WHERE plan = 'trial'
                     AND COALESCE(activated_at, 0) = 0
                     AND COALESCE(revoked, 0) = 0
                     AND COALESCE(expires_at, 0) > 0
                     AND expires_at < ?
                )`
          ).bind(cutoff).run();
          // B2: xoá license trial (chỉ khi không còn trial_uses tham chiếu)
          const delLic = await env.DB.prepare(
            `DELETE FROM licenses
              WHERE plan = 'trial'
                AND COALESCE(activated_at, 0) = 0
                AND COALESCE(revoked, 0) = 0
                AND COALESCE(expires_at, 0) > 0
                AND expires_at < ?
                AND key NOT IN (SELECT lic_key FROM trial_uses WHERE lic_key IS NOT NULL)`
          ).bind(cutoff).run();
          const nUses = delUses?.meta?.changes || 0;
          const nLic = delLic?.meta?.changes || 0;
          if (nUses || nLic) {
            console.log(`Dọn trial mồ côi: ${nLic} license, ${nUses} trial_uses`);
          }
        } catch { /* chưa migrate bảng trial -> bỏ qua, không chặn cron */ }

        // 5. Thông báo Telegram (chỉ chạy khi đã cấu hình, không chặn cron nếu lỗi)
        if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
          try {
            const { notifyLowStock, notifyExpiring } = await import('./lib/telegram-actions.js');

            // 5a. Sắp hết hàng — cảnh báo 1 lần/6 giờ
            const lastLowKey = 'tg:last_low_stock';
            const lastLow = await env.CACHE.get(lastLowKey);
            if (!lastLow) {
              const { results: low } = await env.DB.prepare(
                `SELECT name, stock_count FROM products
                 WHERE delivery_type='key' AND stock_count > 0 AND stock_count < 5
                 ORDER BY stock_count ASC LIMIT 10`
              ).all();
              if (low && low.length) {
                await notifyLowStock(env, low);
                await env.CACHE.put(lastLowKey, String(now), { expirationTtl: 21600 });
              }
            }

            // 5b. License sắp hết hạn — 1 lần/ngày
            const today = new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
            const expKey = `tg:expiring:${today}`;
            const sentToday = await env.CACHE.get(expKey);
            if (!sentToday) {
              const { results: exp } = await env.DB.prepare(
                `SELECT key, expires_at FROM licenses
                 WHERE revoked = 0 AND expires_at > 0
                   AND expires_at BETWEEN ? AND ?
                 ORDER BY expires_at ASC LIMIT 10`
              ).bind(nowS, nowS + 7 * 86400).all();
              if (exp && exp.length) {
                await notifyExpiring(env, exp);
                await env.CACHE.put(expKey, '1', { expirationTtl: 90000 });
              }
            }
          } catch (e) {
            console.error('TG cron:', e && e.message);
          }
        }
      } catch (e) {
        console.error('Cron error:', e && e.message ? e.message : e);
      }
    })());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* ---------- Tuyến cài đặt tự động (ngoài /api/) ---------- */
    try {
      /*
       * ĐÃ BỎ 2 BỘ CÀI CŨ (/i/... và /xg/...) — chỉ còn MỘT app: xa_arena.exe.
       *
       * Link .cmd/.ps1 cũ có thể còn nằm trong tin nhắn/đơn hàng của khách.
       * Trả 410 kèm hướng dẫn thay vì 404 câm, để khách biết phải làm gì.
       */
      if (/^\/(i|xg)\/[A-Za-z0-9-]{6,64}(\.cmd|\.ps1)?$/.test(url.pathname)) {
        const u = new URL(request.url);
        return new Response(
          `BAN CAI CU DA NGUNG SU DUNG\n\n` +
          `Vui long tai ban moi tai: ${u.protocol}//${u.host}/#/download\n` +
          `Chi con MOT file duy nhat: xa_arena.exe\n`,
          {
            status: 410,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }
        );
      }

      // /download/xa_arena.exe — EXE GỘP (map sáng + tài nguyên)
      if (url.pathname === `/download/xa_arena.exe`) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return fail(405, 'Phương thức không được hỗ trợ', 'METHOD_NOT_ALLOWED');
        }
        return await arenaInstaller.downloadArenaExe(env, request);
      }

      // /download/xa_setup.exe — đường dẫn CŨ, nay trỏ về xa_arena.exe
      if (url.pathname === `/download/xa_setup.exe`) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return fail(405, 'Phuong thuc khong duoc ho tro', 'METHOD_NOT_ALLOWED');
        }
        // ĐÃ BỎ bộ cài. Chỉ còn MỘT file: xa_arena.exe.
      // Giữ đường dẫn cũ trỏ về cùng file để link cũ không 404.
      return await arenaInstaller.downloadArenaExe(env, request);
      }

      /*
       * Mọi đường dẫn /download/* khác -> 404 RÕ RÀNG.
       *
       * Nếu để rơi xuống assets, SPA fallback (not_found_handling =
       * single-page-application) sẽ trả index.html với status 200 và
       * Content-Type text/html cho một URL .exe — khách tải về được một file
       * HTML đội lốt .exe, không hiểu vì sao không chạy.
       */
      if (url.pathname.startsWith('/download/')) {
        return new Response(
          'Khong tim thay file. Chi con MOT ban duy nhat:\n' +
          `${url.protocol}//${url.host}/download/xa_arena.exe\n`,
          {
            status: 404,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }
        );
      }
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err.status, err.message, err.code, err.details);
      }
      console.error('Installer error:', err && err.stack ? err.stack : err);
      return fail(500, 'Không tạo được bộ cài. Vui lòng thử lại.', 'INTERNAL');
    }

    // Security headers cho HTML do public/_headers đảm nhiệm
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    // Chặn nhanh payload quá lớn
    const cl = Number(request.headers.get('content-length') || 0);
    if (cl > 2_000_000) {
      return fail(413, 'Dữ liệu gửi lên quá lớn', 'PAYLOAD_TOO_LARGE');
    }

    const match = r.match(request.method, url.pathname);
    if (!match) return fail(404, 'Không tìm thấy API', 'NOT_FOUND');
    if (match.methodNotAllowed) {
      return fail(405, 'Phương thức không được hỗ trợ', 'METHOD_NOT_ALLOWED', {
        allowed: match.methodNotAllowed,
      });
    }

    try {
      // Giới hạn toàn cục theo IP cho mọi endpoint (chống lạm dụng thô)
      if (!url.pathname.startsWith('/api/webhooks/')) {
        await rateLimit(env, `g:${clientIp(request)}`, 3000, 60, { failClosed: true });
      }
      const res = await match.handler(env, request, match.params);
      // Gắn CORS + security headers cho mọi phản hồi API
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      if (err instanceof ApiError) {
        return addCors(fail(err.status, err.message, err.code, err.details), request, env);
      }
      console.error('Unhandled error:', err && err.stack ? err.stack : err);
      return addCors(fail(500, 'Đã có lỗi xảy ra, vui lòng thử lại sau', 'INTERNAL'), request, env);
    }
  },
};

function addCors(res, request, env) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}