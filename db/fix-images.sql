-- Cập nhật ảnh sản phẩm sang SVG nội bộ (không phụ thuộc Unsplash)
UPDATE products SET image_url = '/img/' || slug || '.svg'
WHERE image_url LIKE '%unsplash%' OR image_url IS NULL OR image_url = '';

-- Đảm bảo sản phẩm license dùng ảnh riêng
UPDATE products SET image_url = '/img/license-xarena.svg' WHERE delivery_type = 'license';
