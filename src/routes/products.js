/** Nghiệp vụ danh mục & sản phẩm. */
import { ok, json, ApiError, readJson } from '../lib/http.js';
import { int, str, bool, slugify, enum_ok, pageNum } from '../lib/validate.js';
import { uuid, sha256 } from '../lib/crypto.js';
import { requireAdmin, requireAdminStrict, parseCookies, SESSION_COOKIE } from '../lib/auth.js';
import { publicUse, KIND_1H, KIND_3D } from '../lib/trial-quota.js';
import { statsStatements, shapeStatsFromBatch, STATS_CACHE_KEY } from './stats.js';

function shapeProduct(r) {
  let features = [];
  try {
    features = r.features ? JSON.parse(r.features) : [];
  } catch { /* ignore */ }
  return {
    id: r.id,
    slug: r.slug,
    categoryId: r.category_id,
    categoryName: r.category_name || null,
    categorySlug: r.category_slug || null,
    name: r.name,
    shortDesc: r.short_desc,
    description: r.description,
    imageUrl: r.image_url,
    badge: r.badge || null,
    price: r.price,
    comparePrice: r.compare_price,
    discountPercent: r.compare_price && r.compare_price > r.price
      ? Math.round((1 - r.price / r.compare_price) * 100)
      : 0,
    deliveryType: r.delivery_type,
    stock: r.stock_count,
    inStock: r.stock_count > 0 || r.delivery_type === 'manual' || r.delivery_type === 'license',
    sold: r.sold_count,
    rating: r.rating,
    ratingCount: r.rating_count,
    warrantyDays: r.warranty_days,
    durationLabel: r.duration_label,
    licensePrefix: r.license_prefix || null,
    // NULL hoac khong phai so -> null (KHONG phai 0). Truoc day
    // `|| 0` bien NULL thanh 0, ma 0 nghia la VINH VIEN -> sai.
    licenseDays: (r.license_days === null || r.license_days === undefined)
      ? null : (Number.isFinite(Number(r.license_days))
        ? Number(r.license_days) : null),
    features,
    featured: !!r.featured,
    active: !!r.active,
  };
}

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug
  FROM products p LEFT JOIN categories c ON c.id = p.category_id
`;

/* Dùng chung cho /api/categories & /api/home -> hai đường không lệch nhau. */
const CATEGORIES_SQL = `
  SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
  FROM categories c WHERE c.active = 1 ORDER BY c.sort_order, c.name
`;

const FEATURED_SQL = `${PRODUCT_SELECT} WHERE p.active = 1 ORDER BY p.featured DESC, p.sold_count DESC LIMIT 8`;

function shapeCategory(c) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    icon: c.icon,
    productCount: c.product_count,
  };
}

export async function listCategories(env) {
  const { results } = await env.DB.prepare(CATEGORIES_SQL).all();
  return ok({ categories: (results || []).map(shapeCategory) });
}

export async function listProducts(env, request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const category = url.searchParams.get('category') || '';
  const sort = url.searchParams.get('sort') || 'featured';
  const minPrice = url.searchParams.get('minPrice');
  const maxPrice = url.searchParams.get('maxPrice');
  const page = pageNum(url.searchParams.get('page'), 1);
  const perPage = pageNum(url.searchParams.get('perPage'), 12, { max: 60 });

  const where = ['p.active = 1'];
  const binds = [];

  if (q) {
    where.push('(p.name LIKE ? OR p.short_desc LIKE ? OR p.description LIKE ?)');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    binds.push(like, like, like);
  }
  if (category) {
    where.push('c.slug = ?');
    binds.push(category);
  }
  if (minPrice && Number.isFinite(Number(minPrice))) {
    where.push('p.price >= ?');
    binds.push(Number(minPrice));
  }
  if (maxPrice && Number.isFinite(Number(maxPrice))) {
    where.push('p.price <= ?');
    binds.push(Number(maxPrice));
  }

  /*
   * THỨ TỰ SẢN PHẨM — quan trọng, đã gây lỗi thật.
   *
   * Trước đây: 'p.featured DESC, p.sort_order ASC, ...'
   *   `featured DESC` đứng ĐẦU nên nó thắng mọi sort_order. Hễ 2 sản phẩm
   *   cùng featured=1 mà sort_order khác nhau thì chúng chen lên đầu, và vì
   *   mỗi sản phẩm có gói "tháng" featured=1, 2 gói tháng nhảy lên trước còn
   *   các gói khác nằm dưới -> danh sách trộn lẫn hai sản phẩm.
   *
   * Nay: `sort_order` quyết định thứ tự, `featured` chỉ là tiebreaker.
   *   sort_order được đánh theo NHÓM: AOE1 = 100.., XAGR = 200..
   *   nên mỗi sản phẩm đứng thành một khối liền, trong khối xếp theo thời
   *   hạn tăng dần (7 -> 30 -> 90 -> 180 -> 365 -> vĩnh viễn).
   */
  const orderBy = {
    featured: 'p.sort_order ASC, p.featured DESC, p.sold_count DESC',
    price_asc: 'p.price ASC',
    price_desc: 'p.price DESC',
    newest: 'p.created_at DESC',
    popular: 'p.sold_count DESC',
    rating: 'p.rating DESC',
  }[sort] || 'p.sort_order ASC, p.featured DESC';

  const whereSql = where.join(' AND ');
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${whereSql}`
  )
    .bind(...binds)
    .first();
  const total = countRow?.n || 0;

  const { results } = await env.DB.prepare(
    `${PRODUCT_SELECT} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  )
    .bind(...binds, perPage, (page - 1) * perPage)
    .all();

  return ok({
    products: (results || []).map(shapeProduct),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  });
}

export async function getProduct(env, slugOrId) {
  const row = await env.DB.prepare(`${PRODUCT_SELECT} WHERE p.slug = ? OR p.id = ? LIMIT 1`)
    .bind(slugOrId, slugOrId)
    .first();
  if (!row || !row.active) throw new ApiError(404, 'Sản phẩm không tồn tại', 'NOT_FOUND');

  /*
   * ĐÃ BỎ truy vấn bảng `reviews`.
   *
   * Bảng đó luôn rỗng vì KHÔNG có route nào ghi đánh giá (không có
   * POST /api/reviews). Giữ lại chỉ tốn 1 round trip DB cho mọi lần mở
   * trang sản phẩm mà luôn trả về mảng rỗng.
   */

  const { results: related } = await env.DB.prepare(
    `${PRODUCT_SELECT} WHERE p.active = 1 AND p.id != ? AND p.category_id = ?
     ORDER BY p.sold_count DESC LIMIT 4`
  )
    .bind(row.id, row.category_id)
    .all();

  return ok({
    product: shapeProduct(row),
    related: (related || []).map(shapeProduct),
  });
}

export async function getFeatured(env) {
  const { results } = await env.DB.prepare(FEATURED_SQL).all();
  return ok({ products: (results || []).map(shapeProduct) });
}

/* ---------------- Trang chủ: MỘT request, MỘT batch ---------------- */

/**
 * MIRROR của `trialCfg()` trong src/lib/trial-quota.js.
 *
 * Vì sao chép thay vì gọi: trialCfg() tự chạy một câu SQL riêng, gọi nó ở đây
 * là thêm một round-trip D1 nữa và phá mục tiêu "một batch". Hàm này chỉ đọc
 * các dòng `settings` ĐÃ nằm trong batch.
 *
 * RỦI RO: nếu ai đó sửa bảng key/mặc định trong lib/trial-quota.js mà quên
 * sửa ở đây thì /api/home có thể hiện hạn mức lệch với /api/trial/status.
 * Đây CHỈ ảnh hưởng hiển thị; việc TRỪ lượt vẫn do trial-quota.js quyết định.
 * => Giữ đúng thứ tự/cùng mặc định; sửa bên kia thì sửa cả đây.
 */
function trialCfgFromRows(rows) {
  const m = {};
  for (const r of rows || []) m[r.key] = r.value;
  const num = (k, d) => {
    const n = Number(m[k]);
    return Number.isFinite(n) ? n : d;
  };
  const bool = (k, d) => (m[k] === undefined ? d : m[k] !== '0');
  return {
    enabled: bool('trial_enabled', true),
    requireLogin: bool('trial_require_account', true),
    t1h: {
      enabled: bool('trial1h_enabled', true),
      sec: num('trial1h_minutes', 60) * 60,
      quota: num('trial1h_limit', 10),
    },
    t3d: {
      enabled: bool('trial3d_enabled', true),
      sec: num('trial3d_days', 3) * 86400,
      quota: num('trial3d_limit', 10),
    },
    maxPerIp: num('trial_max_per_ip', 10),
    maxPerNet: num('trial_max_per_net', 60),
    maxPerDay: num('trial_max_per_day', 300),
    deviceAccounts1h: num('trial_device_acc_1h', 3),
    deviceAccounts3d: num('trial_device_acc_3d', 2),
    holdSec: num('trial_hold_sec', 7 * 86400),
    recheck1h: num('trial_recheck_1h', 120),
    recheck3d: num('trial_recheck_3d', 900),
  };
}

/** Một kind trial, đúng shape của /api/trial/status. */
function trialKindPayload(kind, kc, quotaRow, useRow, cfg) {
  const defQuota = kc ? kc.quota : 10;
  const quota = (quotaRow && quotaRow.quota) || defQuota;
  const used = quotaRow ? (quotaRow.used || 0) : 0;
  return {
    enabled: kc ? kc.enabled : false,
    used,
    quota,
    left: Math.max(0, quota - used),
    active: useRow ? { ...publicUse(useRow, cfg, kind), hwid: useRow.hwid } : null,
    recheck_sec: kind === KIND_1H ? cfg.recheck1h : cfg.recheck3d,
  };
}

/**
 * GET /api/home — gộp 4 tầng thác nước của trang chủ vào MỘT lượt D1.
 *
 * Trước đây trang chủ gọi tuần tự: /api/auth/me (657ms) -> /api/categories
 * (542ms) -> /api/trial/status (491ms) -> /api/products/featured (448ms)
 * -> /api/stats (397ms) ≈ 1,6s (số đo của người báo lỗi).
 *
 * Ở đây tất cả statements được prepare TRƯỚC rồi chạy trong đúng một
 * env.DB.batch([...]) -> 1 round-trip D1. Phiên đăng nhập không cần tra
 * riêng: các câu trial tự JOIN sessions bằng token_hash, nên KHÔNG có
 * round-trip nào cho /api/auth/me.
 *
 * Trả: { ok, categories[], products[], stats{}, trial|null, now }
 *  - trial = null            -> khách chưa đăng nhập (frontend hiện
 *                               "Không cần đăng ký" như hiện nay)
 *  - trial.ok === false      -> dùng thử đang đóng (code 'trial_disabled')
 */
export async function homeBundle(env, request) {
  const nowMs = Date.now();
  const nowS = Math.floor(nowMs / 1000);

  // Băm token phiên tại chỗ (cùng cách lib/auth.js băm) — rẻ, không I/O.
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  const tokenHash = token && token.length === 64 ? await sha256(token) : '';

  const stmts = [];
  const idx = {};
  const add = (name, stmt) => { idx[name] = stmts.length; stmts.push(stmt); return stmt; };

  add('categories', env.DB.prepare(CATEGORIES_SQL));
  add('featured', env.DB.prepare(FEATURED_SQL));
  idx.stats = stmts.length;
  stmts.push(...statsStatements(env));            // 5 câu liền nhau
  add('settings', env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'trial%'"));

  /*
   * Trial lọc theo PHIÊN ngay trong SQL. tokenHash rỗng (khách chưa đăng
   * nhập) thì JOIN không khớp -> 0 dòng, không tốn thêm gì.
   *
   * Điều kiện phiên CHÉP ĐÚNG lib/auth.js getSessionUser(): phiên còn hạn VÀ
   * users.status = 'active'. Thiếu vế sau thì tài khoản đã bị khoá vẫn xem
   * được hạn mức dùng thử của mình -> lệch với /api/trial/status.
   */
  const QUOTA_SQL = `
    SELECT q.used, q.quota, q.reset_count
    FROM trial_quota q
    JOIN sessions s ON s.user_id = q.user_id
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active' AND q.kind = ?
  `;
  const USE_SQL = `
    SELECT t.*
    FROM trial_uses t
    JOIN sessions s ON s.user_id = t.user_id
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active' AND t.kind = ?
      AND t.ended_at IS NULL AND t.expires_at > ?
    ORDER BY t.created_at DESC LIMIT 1
  `;
  add('q1h', env.DB.prepare(QUOTA_SQL).bind(tokenHash, nowMs, KIND_1H));
  add('q3d', env.DB.prepare(QUOTA_SQL).bind(tokenHash, nowMs, KIND_3D));
  add('u1h', env.DB.prepare(USE_SQL).bind(tokenHash, nowMs, KIND_1H, nowS));
  add('u3d', env.DB.prepare(USE_SQL).bind(tokenHash, nowMs, KIND_3D, nowS));

  /*
   * Cache thống kê 5 phút nằm ở KV: đọc SONG SONG với batch nên không cộng
   * thêm độ trễ. KV lỗi -> vẫn có số vừa đếm trong batch.
   */
  const cachedStats = (async () => {
    try { return await env.CACHE.get(STATS_CACHE_KEY); } catch { return null; }
  })();

  const [cached, batch] = await Promise.all([cachedStats, env.DB.batch(stmts)]);

  const rows = (i) => (batch[i] && batch[i].results) || [];
  const first = (i) => rows(i)[0] || null;

  let stats = null;
  if (cached) {
    try { stats = JSON.parse(cached); } catch { stats = null; }
  }
  if (!stats) stats = shapeStatsFromBatch(batch.slice(idx.stats, idx.stats + 5));

  const cfg = trialCfgFromRows(rows(idx.settings));
  let trial = null;
  if (tokenHash) {
    trial = cfg.enabled
      ? {
        ok: true,
        now: nowS,
        kinds: {
          [KIND_1H]: trialKindPayload(KIND_1H, cfg.t1h, first(idx.q1h), first(idx.u1h), cfg),
          [KIND_3D]: trialKindPayload(KIND_3D, cfg.t3d, first(idx.q3d), first(idx.u3d), cfg),
        },
      }
      : { ok: false, code: 'trial_disabled', msg: 'Dùng thử đang tạm đóng' };
  }

  return ok({
    categories: rows(idx.categories).map(shapeCategory),
    products: rows(idx.featured).map(shapeProduct),
    stats,
    trial,
    now: nowS,
  });
}

/* ---------------- Admin: quản trị sản phẩm ---------------- */

export async function adminListProducts(env, request) {
  await requireAdmin(env, request);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const binds = [];
  let where = '1=1';
  if (q) {
    where += ' AND (p.name LIKE ? OR p.slug LIKE ?)';
    binds.push(`%${q}%`, `%${q}%`);
  }
  const { results } = await env.DB.prepare(
    `${PRODUCT_SELECT} WHERE ${where} ORDER BY p.sort_order ASC, p.created_at DESC LIMIT 200`
  )
    .bind(...binds)
    .all();
  return ok({ products: (results || []).map(shapeProduct) });
}

export async function adminSaveProduct(env, request, productId = null) {
  /* Sua san pham = sua GIA ban cho moi khach. Chi admin that. */
  const admin = await requireAdminStrict(env, request);
  const body = await readJson(request);
  const now = Date.now();

  const name = str(body.name, 'name', { min: 2, max: 200 });
  const slug = body.slug ? slugify(body.slug) : slugify(name);
  const categoryId = body.categoryId ? str(body.categoryId, 'categoryId', { max: 64 }) : null;
  const shortDesc = str(body.shortDesc, 'shortDesc', { required: false, max: 300 }) || '';
  const description = str(body.description, 'description', { required: false, max: 20000 }) || '';
  const imageUrl = str(body.imageUrl, 'imageUrl', { required: false, max: 500 }) || '';
  const badge = body.badge ? str(body.badge, 'badge', { max: 20 }) : null;
  const price = int(body.price, 'price', { min: 0, max: 1_000_000_000 });
  const comparePrice = body.comparePrice ? int(body.comparePrice, 'comparePrice', { min: 0 }) : null;
  /*
   * Chỉ còn 2 kiểu giao hàng. `key` / `account` / `file` đã bỏ cùng bảng
   * `product_keys` — nhận chúng nữa chỉ tạo ra sản phẩm không thể giao.
   */
  const deliveryType = enum_ok(body.deliveryType || 'license',
    ['manual', 'license'], 'deliveryType');
  const warrantyDays = body.warrantyDays ? int(body.warrantyDays, 'warrantyDays', { min: 0, max: 3650 }) : 0;
  const durationLabel = str(body.durationLabel, 'durationLabel', { required: false, max: 60 }) || '';
  const features = Array.isArray(body.features) ? JSON.stringify(body.features.slice(0, 20)) : '[]';
  const active = bool(body.active, true) ? 1 : 0;
  const featured = bool(body.featured, false) ? 1 : 0;
  const sortOrder = body.sortOrder ? int(body.sortOrder, 'sortOrder', { min: 0, max: 100000 }) : 0;
  const licensePrefix = body.licensePrefix
    ? str(body.licensePrefix, 'licensePrefix', { max: 8 }).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'AOE1'
    : (deliveryType === 'license' ? 'AOE1' : null);
  /*
   * ===== license_days: KHÔNG ĐƯỢC MẶC ĐỊNH 0 (P0 — sửa 21/11) =====
   *
   * `0` mang nghĩa VĨNH VIỄN (quy ước giữ từ bảng `licenses`). Bản cũ:
   *     const licenseDays = body.licenseDays !== undefined ? int(...) : 0;
   * nên mọi lần admin LƯU sản phẩm mà không gửi field này đều biến sản phẩm
   * thành bán quyền vĩnh viễn. Form admin còn gửi `Number(...) || 0`
   * (public/assets/pages/admin.js), tức ô "số ngày" để trống = 0 = vĩnh viễn.
   * Hệ quả thật: khách trả tiền một gói 30 ngày và nhận quyền vĩnh viễn.
   *
   * Nay:
   *   - Sản phẩm giao bằng license BẮT BUỘC có số ngày >= 1.
   *   - Khi CẬP NHẬT mà client không gửi `licenseDays`, GIỮ NGUYÊN giá trị
   *     đang có trong CSDL (không ghi đè bằng 0).
   *   - Muốn bán vĩnh viễn thì phải nói rõ bằng `licenseDays: 0` — vẫn được
   *     phép, nhưng là hành động có chủ đích chứ không phải do bỏ trống.
   */
  let licenseDays;
  if (body.licenseDays !== undefined && body.licenseDays !== null && body.licenseDays !== '') {
    licenseDays = int(body.licenseDays, 'licenseDays', { min: 0, max: 3650 });
  } else if (productId) {
    // Cập nhật mà không gửi số ngày -> giữ nguyên giá trị hiện có.
    const cur = await env.DB.prepare(
      'SELECT license_days FROM products WHERE id = ?'
    ).bind(productId).first();
    licenseDays = cur && cur.license_days !== null && cur.license_days !== undefined
      ? Number(cur.license_days)
      : 0;
  } else {
    // Tạo mới mà bỏ trống -> không có giá trị cũ để giữ.
    licenseDays = deliveryType === 'license' ? null : 0;
  }

  if (deliveryType === 'license' && !(Number(licenseDays) >= 1)) {
    throw new ApiError(
      400,
      'Sản phẩm bán theo kỳ hạn phải có số ngày >= 1. ' +
      'Để trống sẽ bị hiểu là vĩnh viễn — hãy nhập số ngày cụ thể.',
      'LICENSE_DAYS_REQUIRED',
      { licenseDays: licenseDays === null ? 'missing' : licenseDays }
    );
  }

  if (productId) {
    const exists = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
    if (!exists) throw new ApiError(404, 'Sản phẩm không tồn tại', 'NOT_FOUND');
    await env.DB.prepare(
      `UPDATE products SET slug=?, category_id=?, name=?, short_desc=?, description=?, image_url=?, badge=?,
       price=?, compare_price=?, delivery_type=?, warranty_days=?, duration_label=?, features=?,
       active=?, featured=?, sort_order=?, license_prefix=?, license_days=?, updated_at=? WHERE id=?`
    )
      .bind(slug, categoryId, name, shortDesc, description, imageUrl, badge, price, comparePrice,
        deliveryType, warrantyDays, durationLabel, features, active, featured, sortOrder,
        licensePrefix, licenseDays, now, productId)
      .run();
    await audit(env, admin.id, 'product.update', productId, { name });
    return ok({ id: productId });
  }

  const dupe = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(slug).first();
  if (dupe) throw new ApiError(409, 'Slug sản phẩm đã tồn tại', 'DUPLICATE');
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO products (id, slug, category_id, name, short_desc, description, image_url, badge,
     price, compare_price, delivery_type, stock_count, sold_count, rating, rating_count, warranty_days,
     duration_label, features, active, featured, sort_order, license_prefix, license_days, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,5,0,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(id, slug, categoryId, name, shortDesc, description, imageUrl, badge, price, comparePrice,
      deliveryType, warrantyDays, durationLabel, features, active, featured, sortOrder,
      licensePrefix, licenseDays, now, now)
    .run();
  await audit(env, admin.id, 'product.create', id, { name });
  return ok({ id }, 201);
}

export async function adminDeleteProduct(env, request, productId) {
  /* Xoa san pham = go hang khoi cua hang. Chi admin that. */
  const admin = await requireAdminStrict(env, request);
  await env.DB.prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?')
    .bind(Date.now(), productId)
    .run();
  await audit(env, admin.id, 'product.disable', productId, {});
  return ok({ id: productId });
}

/*
 * ĐÃ BỎ toàn bộ "kho key" (adminListKeys / adminAddKeys / adminDeleteKey /
 * syncStock) cùng bảng `product_keys`.
 *
 * Shop chỉ bán license sinh động; không còn sản phẩm nào kiểu kho key.
 * Ba route /api/admin/products/:id/keys và /api/admin/keys/:id đã xoá khỏi
 * src/index.js, tab "Kho key" đã xoá khỏi trang quản trị.
 */
export async function audit(env, actorId, action, target, meta) {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_logs (id, actor_id, action, target, meta, ip, created_at) VALUES (?,?,?,?,?,?,?)'
    )
      .bind(uuid(), actorId, action, target, JSON.stringify(meta || {}), '', Date.now())
      .run();
  } catch { /* không chặn luồng chính */ }
}
