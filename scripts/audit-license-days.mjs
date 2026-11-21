/**
 * audit-license-days.mjs — Đối soát sản phẩm có `license_days = 0`.
 *
 * BỐI CẢNH (P0-2):
 *   Bản cũ: `const licenseDays = body.licenseDays !== undefined ? int(...) : 0;`
 *   => bất kỳ lần LƯU sản phẩm nào mà không gửi field đều ghi 0.
 *   `0` mang nghĩa VĨNH VIỄN, nên sản phẩm định bán 30 ngày bị bán thành
 *   vĩnh viễn.
 *
 * GIỚI HẠN QUAN TRỌNG — KHÔNG ĐOÁN:
 *   `0` hiện tại có thể là HAI thứ khác nhau:
 *     (a) vĩnh viễn CÓ CHỦ ĐÍCH (chủ shop chọn bán vĩnh viễn), hoặc
 *     (b) vĩnh viễn OAN (do bug ở trên).
 *   Script này KHÔNG tự sửa. Nó chỉ đọc dữ liệu thật rồi phân loại theo
 *   bằng chứng: giá bán, số ngày các sản phẩm anh em, và số đơn đã bán — để
 *   người quyết định có dữ liệu mà chọn, thay vì máy đoán.
 *
 * Cách dùng (chỉ ĐỌC — không ghi gì):
 *   node scripts/audit-license-days.mjs <đường-dẫn-file-sql-dump>
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';

const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error('Dùng: node scripts/audit-license-days.mjs <file.sql>');
  process.exit(1);
}
if (!existsSync(dumpPath)) {
  console.error(`Không thấy file: ${dumpPath}`);
  process.exit(1);
}

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(dumpPath, 'utf8'));

const products = db.prepare(`
  SELECT id, name, slug, price, delivery_type, license_prefix, license_days, active, sold_count
    FROM products
   ORDER BY delivery_type, license_prefix, license_days, price
`).all();

console.log('=== TẤT CẢ SẢN PHẨM ===');
console.log(
  ['delivery', 'prefix', 'days', 'price', 'sold', 'active', 'name'].join('\t')
);
for (const p of products) {
  console.log([
    p.delivery_type,
    p.license_prefix ?? '',
    p.license_days,
    p.price,
    p.sold_count,
    p.active,
    p.name,
  ].join('\t'));
}

const zero = products.filter((p) => p.delivery_type === 'license' && Number(p.license_days) === 0);
console.log(`\n=== CẦN ĐỐI SOÁT: ${zero.length} sản phẩm license có license_days = 0 ===`);
if (!zero.length) {
  console.log('Không có — không cần làm gì.');
  process.exit(0);
}

/*
 * Bằng chứng để phân loại (KHÔNG tự quyết):
 *   - có bán thật không (sold_count)  -> nếu có, đã có khách nhận quyền vĩnh viễn
 *   - giá cao hay thấp                 -> gói vĩnh viễn thường đắt hơn nhiều
 *   - các sản phẩm cùng prefix có bao nhiêu ngày -> suy ra "chuẩn" của nhóm
 */
const byPrefix = new Map();
for (const p of products) {
  if (p.delivery_type !== 'license') continue;
  const k = p.license_prefix || '(none)';
  if (!byPrefix.has(k)) byPrefix.set(k, []);
  byPrefix.get(k).push(p);
}

console.log('');
for (const p of zero) {
  const sibs = (byPrefix.get(p.license_prefix || '(none)') || [])
    .filter((s) => s.id !== p.id && Number(s.license_days) > 0);
  const siblingDays = [...new Set(sibs.map((s) => Number(s.license_days)))].sort((a, b) => a - b);
  const siblingPrices = sibs.map((s) => s.price);
  const maxSibPrice = siblingPrices.length ? Math.max(...siblingPrices) : 0;

  console.log(`- ${p.name}`);
  console.log(`    id=${p.id}  slug=${p.slug}  price=${p.price}  sold=${p.sold_count}  active=${p.active}`);
  if (siblingDays.length) {
    console.log(`    cùng prefix "${p.license_prefix}": ${siblingDays.join('/')} ngày, giá cao nhất ${maxSibPrice}`);
  } else {
    console.log(`    không có sản phẩm anh em cùng prefix để so sánh`);
  }
  // Gợi ý chỉ dựa trên số đo, không phải phán đoán về ý định kinh doanh.
  let hint = 'cần người xem';
  if (Number(p.sold_count) > 0) {
    hint = `ĐÃ BÁN ${p.sold_count} — khách đang có quyền vĩnh viễn; sửa sẽ ảnh hưởng khách này`;
  } else if (siblingDays.length && p.price <= maxSibPrice) {
    hint = 'chưa bán, giá không cao hơn gói có hạn -> nhiều khả năng là 0 OAN';
  } else if (siblingDays.length) {
    hint = 'chưa bán, giá cao hơn gói có hạn -> có thể là vĩnh viễn CÓ CHỦ ĐÍCH';
  }
  console.log(`    => ${hint}`);
}

console.log('\n=== KHÔNG TỰ SỬA. Chọn tay rồi cập nhật: ===');
console.log('  UPDATE products SET license_days = <số ngày> WHERE id = \'<id>\';');
