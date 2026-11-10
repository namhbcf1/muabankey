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
import * as admin from './routes/admin.js';
import * as ai from './routes/ai.js';
import * as license from './routes/license.js';
import * as licenseServer from './routes/license-server.js';
import * as trial from './routes/trial.js';
import * as installer from './routes/installer.js';

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

/* ---------- Catalog ---------- */
r.get('/api/categories', products.listCategories);
r.get('/api/products', products.listProducts);
r.get('/api/products/featured', products.getFeatured);
r.get('/api/products/:id', (env, req, p) => products.getProduct(env, p.id));

/* ---------- Orders ---------- */
r.post('/api/coupons/check', orders.checkCoupon);
r.post('/api/orders', orders.createOrder);
r.get('/api/orders', orders.listOrders);
r.get('/api/orders/:id', (env, req, p) => orders.getOrder(env, req, p.id));
r.post('/api/orders/:id/pay', (env, req, p) => orders.payOrder(env, req, p.id));

/* ---------- Wallet ---------- */
r.get('/api/wallet', wallet.getWallet);
r.post('/api/wallet/topup', wallet.createTopup);
r.get('/api/wallet/topup/:id', (env, req, p) => wallet.getTopup(env, req, p.id));
r.post('/api/webhooks/sepay', wallet.sepayWebhook);
r.post('/api/webhooks/payos', wallet.payosWebhook);
r.post('/api/telegram/webhook', wallet.telegramWebhook);
r.get('/api/webhooks/health', (env) => wallet.webhookHealth(env));

/* ---------- License client API (cho tool XArena) ---------- */
r.post('/api/activate', licenseServer.apiActivate);
r.post('/api/check', licenseServer.apiCheck);
r.post('/api/rebind', licenseServer.apiRebind);
r.get('/api/license/health', (env) => licenseServer.apiHealth(env));

/* ---------- Dùng thử 3 ngày ---------- */
r.post('/api/trial/start', trial.apiTrialStart);
r.get('/api/trial/status', trial.apiTrialStatus);

/* ---------- License quản lý ---------- */
r.get('/api/licenses/mine', license.myLicenses);
r.post('/api/licenses/:key/rebind', (env, req, p) => license.rebindMyLicense(env, req, p.key));
r.post('/api/licenses/:key/install-token', (env, req, p) => installer.issueInstallToken(env, req, p.key));

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
r.get('/api/admin/products/:id/keys', (env, req, p) => products.adminListKeys(env, req, p.id));
r.post('/api/admin/products/:id/keys', (env, req, p) => products.adminAddKeys(env, req, p.id));
r.delete('/api/admin/keys/:id', (env, req, p) => products.adminDeleteKey(env, req, p.id));

r.get('/api/admin/orders', orders.adminListOrders);
r.post('/api/admin/orders/:id/deliver', (env, req, p) => orders.adminDeliverManual(env, req, p.id));
r.post('/api/admin/orders/:id/refund', (env, req, p) => orders.adminRefund(env, req, p.id));
r.post('/api/admin/wallet/adjust', wallet.adminAdjustBalance);
r.post('/api/admin/settings/payos', wallet.adminSetPayosKey);
r.get('/api/admin/telegram/status', wallet.adminTelegramStatus);
r.post('/api/admin/telegram/config', wallet.adminTelegramConfig);
r.post('/api/admin/telegram/test', wallet.adminTelegramTest);
r.get('/api/admin/topups', wallet.adminListTopups);
r.post('/api/admin/topups/:id/approve', (env, req, p) => wallet.adminApproveTopup(env, req, p.id));
r.post('/api/admin/topups/:id/reject', (env, req, p) => wallet.adminRejectTopup(env, req, p.id));

r.get('/api/admin/licenses', license.adminLicenses);
r.post('/api/admin/licenses', license.adminIssueLicenses);
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
        const stale = await env.DB.prepare(
          "SELECT id, coupon_code FROM orders WHERE status='pending' AND created_at < ?"
        ).bind(now - 45 * 60 * 1000).all();
        for (const o of stale.results || []) {
          await env.DB.prepare("UPDATE orders SET status='cancelled' WHERE id = ? AND status='pending'")
            .bind(o.id).run();
          if (o.coupon_code) {
            await env.DB.prepare(
              'UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?'
            ).bind(o.coupon_code).run();
          }
        }

        // 3. Đơn kẹt 'processing'/'refunding' quá 10 phút (worker chết giữa chừng)
        await env.DB.prepare(
          "UPDATE orders SET status='pending', paid_at=NULL WHERE status='processing' AND paid_at < ?"
        ).bind(now - 10 * 60 * 1000).run();
        await env.DB.prepare(
          "UPDATE orders SET status='delivered' WHERE status='refunding' AND created_at < ?"
        ).bind(now - 10 * 60 * 1000).run();

        // 4. Dọn token hết hạn
        await env.DB.prepare('DELETE FROM rebind_tokens WHERE expires_at < ?').bind(nowS).run();
        await env.DB.prepare('DELETE FROM install_tokens WHERE expires_at < ?').bind(nowS).run();
        await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
        await env.DB.prepare('DELETE FROM lic_attempts WHERE at < ?').bind(nowS - 7 * 86400).run();

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
      // /i/<KEY>.cmd  |  /i/<KEY>.ps1  |  /i/<KEY>  (JSON lệnh)
      const mInstaller = url.pathname.match(/^\/i\/([A-Za-z0-9-]{6,64})(\.cmd|\.ps1)?$/);
      if (mInstaller) {
        const rawKey = mInstaller[1];
        const ext = mInstaller[2] || '';
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return fail(405, 'Phương thức không được hỗ trợ', 'METHOD_NOT_ALLOWED');
        }
        // PHẢI await: nếu không, promise reject sẽ thoát khỏi try/catch
        // và Worker ném exception -> Cloudflare 1101 thay vì 404 sạch.
        if (ext === '.cmd') return await installer.serveInstaller(env, request, rawKey);
        if (ext === '.ps1') return await installer.servePs1(env, request, rawKey);
        return await installer.installerCommand(env, request, rawKey);
      }

      // /download/xa_nofog_pro.exe
      if (url.pathname === `/download/xa_nofog_pro.exe`) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return fail(405, 'Phương thức không được hỗ trợ', 'METHOD_NOT_ALLOWED');
        }
        return await installer.downloadExe(env, request);
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
        await rateLimit(env, `g:${clientIp(request)}`, 300, 60);
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
