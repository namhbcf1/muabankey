/** Nghiệp vụ danh mục & sản phẩm. */
import { ok, json, ApiError, readJson } from '../lib/http.js';
import { int, str, bool, slugify, enum_ok } from '../lib/validate.js';
import { uuid } from '../lib/crypto.js';
import { requireAdmin } from '../lib/auth.js';

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
    licenseDays: r.license_days || 0,
    features,
    featured: !!r.featured,
    active: !!r.active,
  };
}

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug
  FROM products p LEFT JOIN categories c ON c.id = p.category_id
`;

export async function listCategories(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
     FROM categories c WHERE c.active = 1 ORDER BY c.sort_order, c.name`
  ).all();
  return ok({
    categories: (results || []).map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      icon: c.icon,
      productCount: c.product_count,
    })),
  });
}

export async function listProducts(env, request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const category = url.searchParams.get('category') || '';
  const sort = url.searchParams.get('sort') || 'featured';
  const minPrice = url.searchParams.get('minPrice');
  const maxPrice = url.searchParams.get('maxPrice');
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const perPage = Math.min(60, Math.max(1, Number(url.searchParams.get('perPage') || 12)));

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

  const orderBy = {
    featured: 'p.featured DESC, p.sort_order ASC, p.sold_count DESC',
    price_asc: 'p.price ASC',
    price_desc: 'p.price DESC',
    newest: 'p.created_at DESC',
    popular: 'p.sold_count DESC',
    rating: 'p.rating DESC',
  }[sort] || 'p.featured DESC, p.sort_order ASC';

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

  const { results: reviews } = await env.DB.prepare(
    `SELECT r.rating, r.comment, r.created_at, u.full_name
     FROM reviews r JOIN users u ON u.id = r.user_id
     WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 20`
  )
    .bind(row.id)
    .all();

  const { results: related } = await env.DB.prepare(
    `${PRODUCT_SELECT} WHERE p.active = 1 AND p.id != ? AND p.category_id = ?
     ORDER BY p.sold_count DESC LIMIT 4`
  )
    .bind(row.id, row.category_id)
    .all();

  return ok({
    product: shapeProduct(row),
    reviews: (reviews || []).map((r) => ({
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
      author: maskName(r.full_name || 'Khách hàng'),
    })),
    related: (related || []).map(shapeProduct),
  });
}

function maskName(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0] + '***';
  return parts[0][0] + '*** ' + parts[parts.length - 1][0] + '***';
}

export async function getFeatured(env) {
  const { results } = await env.DB.prepare(
    `${PRODUCT_SELECT} WHERE p.active = 1 ORDER BY p.featured DESC, p.sold_count DESC LIMIT 8`
  ).all();
  return ok({ products: (results || []).map(shapeProduct) });
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
  const admin = await requireAdmin(env, request);
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
  const deliveryType = enum_ok(body.deliveryType || 'key',
    ['key', 'account', 'file', 'manual', 'license'], 'deliveryType');
  const warrantyDays = body.warrantyDays ? int(body.warrantyDays, 'warrantyDays', { min: 0, max: 3650 }) : 0;
  const durationLabel = str(body.durationLabel, 'durationLabel', { required: false, max: 60 }) || '';
  const features = Array.isArray(body.features) ? JSON.stringify(body.features.slice(0, 20)) : '[]';
  const active = bool(body.active, true) ? 1 : 0;
  const featured = bool(body.featured, false) ? 1 : 0;
  const sortOrder = body.sortOrder ? int(body.sortOrder, 'sortOrder', { min: 0, max: 100000 }) : 0;
  const licensePrefix = body.licensePrefix
    ? str(body.licensePrefix, 'licensePrefix', { max: 8 }).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'AOE1'
    : (deliveryType === 'license' ? 'AOE1' : null);
  const licenseDays = body.licenseDays !== undefined
    ? int(body.licenseDays, 'licenseDays', { min: 0, max: 3650 })
    : 0;

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
  const admin = await requireAdmin(env, request);
  await env.DB.prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?')
    .bind(Date.now(), productId)
    .run();
  await audit(env, admin.id, 'product.disable', productId, {});
  return ok({ id: productId });
}

/* ---------------- Admin: kho key ---------------- */

export async function adminListKeys(env, request, productId) {
  await requireAdmin(env, request);
  const { results } = await env.DB.prepare(
    `SELECT id, product_id, note, status, delivered_at, created_at,
       CASE WHEN status='available' THEN substr(secret,1,6) || '••••••' || substr(secret,-4) ELSE '***' END AS masked,
       length(secret) AS secret_len
     FROM product_keys WHERE product_id = ? ORDER BY created_at DESC LIMIT 500`
  )
    .bind(productId)
    .all();
  return ok({ keys: results || [] });
}

export async function adminAddKeys(env, request, productId) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request);
  const raw = str(body.keys, 'keys', { min: 1, max: 200000, trim: false });
  const note = str(body.note, 'note', { required: false, max: 200 }) || '';

  const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
  if (!product) throw new ApiError(404, 'Sản phẩm không tồn tại', 'NOT_FOUND');

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new ApiError(400, 'Không có key hợp lệ', 'VALIDATION');
  if (lines.length > 3000) throw new ApiError(400, 'Tối đa 3000 key mỗi lần', 'VALIDATION');

  const now = Date.now();
  const stmts = lines.map((secret) =>
    env.DB.prepare(
      'INSERT INTO product_keys (id, product_id, secret, note, status, created_at) VALUES (?,?,?,?,?,?)'
    ).bind(uuid(), productId, secret, note, 'available', now)
  );
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }
  await syncStock(env, productId);
  await audit(env, admin.id, 'keys.add', productId, { count: lines.length });
  return ok({ added: lines.length });
}

export async function adminDeleteKey(env, request, keyId) {
  const admin = await requireAdmin(env, request);
  const row = await env.DB.prepare('SELECT product_id, status FROM product_keys WHERE id = ?').bind(keyId).first();
  if (!row) throw new ApiError(404, 'Key không tồn tại', 'NOT_FOUND');
  await env.DB.prepare("UPDATE product_keys SET status='disabled' WHERE id = ?").bind(keyId).run();
  await syncStock(env, row.product_id);
  await audit(env, admin.id, 'key.disable', keyId, {});
  return ok({ id: keyId });
}

export async function syncStock(env, productId) {
  await env.DB.prepare(
    `UPDATE products SET stock_count = (
       SELECT COUNT(*) FROM product_keys WHERE product_id = ? AND status = 'available'
     ) WHERE id = ?`
  )
    .bind(productId, productId)
    .run();
}

export async function audit(env, actorId, action, target, meta) {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_logs (id, actor_id, action, target, meta, ip, created_at) VALUES (?,?,?,?,?,?,?)'
    )
      .bind(uuid(), actorId, action, target, JSON.stringify(meta || {}), '', Date.now())
      .run();
  } catch { /* không chặn luồng chính */ }
}
