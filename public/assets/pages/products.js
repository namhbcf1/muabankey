/** Trang danh sách sản phẩm: bộ lọc, lưới sản phẩm, phân trang. */
import { api, esc, fmtNum, skeletonCards, toast, navigate, debounce, emptyBlock } from '../lib.js';
import { icon } from '../icons.js';
import { state, loadCategories } from '../state.js';
import { productCard } from './home.js';
import { bindBuyNowCards } from './checkout.js';

/*
 * MUA NGAY TỪ DANH SÁCH: nút mua trên mỗi thẻ đi thẳng tới mã QR, không qua
 * trang chi tiết và không qua giỏ hàng. Trang chi tiết vẫn còn (bấm ảnh/tên).
 */

/**
 * Danh mục trong DB lưu icon dạng emoji; giao diện dùng bộ SVG dùng chung.
 * Ánh xạ theo slug để icon luôn ăn theo màu theme và không phụ thuộc font hệ thống.
 */
const CAT_ICON = {
  'windows-office': 'grid',
  'ai-tools': 'bot',
  'thiet-ke': 'gem',
  'giai-tri': 'star',
  'lap-trinh': 'file',
  'bao-mat': 'shield',
  'license-xarena': 'key',
};

const catIcon = (slug) => CAT_ICON[slug] || 'tag';

/** Giá trị gửi lên API giữ nguyên như trước — chỉ đổi nhãn hiển thị. */
const SORTS = [
  ['featured', 'Nổi bật'],
  ['popular', 'Bán chạy'],
  ['price_asc', 'Giá tăng dần'],
  ['price_desc', 'Giá giảm dần'],
  ['newest', 'Mới nhất'],
  ['rating', 'Đánh giá cao'],
];

/*
 * Chỉ những khoảng giá THẬT SỰ có sản phẩm.
 *
 * LỖI ĐÃ SỬA: bản cũ có thêm mốc "500.000₫ – 1.000.000₫" nhưng shop không bán
 * món nào trong khoảng đó — chọn vào là ra trang trống.
 */
const PRICE_RANGES = [
  ['', 'Mọi mức giá'],
  ['0-200000', 'Dưới 200.000₫'],
  ['200000-500000', '200.000₫ – 500.000₫'],
  ['1000000-', 'Trên 1.000.000₫'],
];

export function renderProducts(query) {
  const activeCat = state.categories.find((c) => c.slug === query.category);
  const heading = activeCat ? activeCat.name : 'Tất cả sản phẩm';
  const headingDesc = activeCat && activeCat.description
    ? activeCat.description
    : 'Đang tải...';

  const crumb = activeCat
    ? `<a href="#/products">Sản phẩm</a>${icon('chevronRight', { size: 12, cls: 'crumb-sep' })}<span class="text-dim">${esc(activeCat.name)}</span>`
    : '<span class="text-dim">Sản phẩm</span>';

  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <nav class="pd-breadcrumb" aria-label="Đường dẫn">
        <a href="#/">Trang chủ</a>${icon('chevronRight', { size: 12, cls: 'crumb-sep' })}${crumb}
      </nav>

      <div class="sec-head prod-head">
        <div>
          <h1 class="sec-title">${esc(heading)}</h1>
          <p class="sec-desc" id="products-count">${esc(headingDesc)}</p>
        </div>
      </div>

      <div class="cat-scroll" id="cat-filter" role="group" aria-label="Lọc theo danh mục"></div>

      <div class="filters">
        <div class="filter-group prod-search">
          <span class="search-mini prod-search-field">
            ${icon('search', { size: 14 })}
            <input type="search" id="product-search" placeholder="Tìm theo tên sản phẩm"
              value="${esc(query.q || '')}" aria-label="Tìm sản phẩm">
          </span>
        </div>
        <div class="filter-group">
          <label class="filter-label" for="sort-select">Sắp xếp</label>
          <select class="select" id="sort-select">
            ${SORTS.map(([value, label]) => `<option value="${value}"${
              (query.sort || 'featured') === value ? ' selected' : ''
            }>${label}</option>`).join('')}
          </select>
        </div>
        <div class="filter-group">
          <label class="filter-label" for="price-select">Giá</label>
          <select class="select" id="price-select">
            ${PRICE_RANGES.map(([value, label]) => `<option value="${value}"${
              (query.price || '') === value ? ' selected' : ''
            }>${label}</option>`).join('')}
          </select>
        </div>
      </div>

      <div id="products-grid">${skeletonCards(9)}</div>
      <div id="pagination" class="pg-bar"></div>
    </div>
  </section>
  <div id="site-footer"></div>`;
}

function buildQuery(query) {
  const q = new URLSearchParams();
  if (query.q) q.set('q', query.q);
  if (query.category) q.set('category', query.category);
  if (query.sort && query.sort !== 'featured') q.set('sort', query.sort);
  if (query.price) q.set('price', query.price);
  if (query.page && query.page !== '1') q.set('page', query.page);
  const s = q.toString();
  return '/products' + (s ? '?' + s : '');
}

/**
 * Vá lại <h1> + breadcrumb theo danh mục THẬT.
 *
 * renderProducts() chạy ngay khi router vẽ shell — trước khi /api/categories
 * trả lời. Vào thẳng một link sâu (#/products?category=…) lúc nguội thì
 * state.categories còn rỗng, nên tiêu đề hiện sai ("Tất cả sản phẩm") và
 * breadcrumb mất tên danh mục. Hàm này gọi lại sau khi đã có danh mục.
 */
function applyCategoryHeading(root, slug) {
  const cat = slug ? state.categories.find((c) => c.slug === slug) : null;
  const titleEl = root.querySelector('.sec-head .sec-title');
  if (titleEl) titleEl.textContent = cat ? cat.name : 'Tất cả sản phẩm';
  const crumbHost = root.querySelector('.pd-breadcrumb');
  if (crumbHost) {
    crumbHost.innerHTML = `<a href="#/">Trang chủ</a>${icon('chevronRight', { size: 12, cls: 'crumb-sep' })}`
      + `<a href="#/products">Sản phẩm</a>${icon('chevronRight', { size: 12, cls: 'crumb-sep' })}`
      + (cat
        ? `<span class="text-dim">${esc(cat.name)}</span>`
        : '<span class="text-dim">Tất cả</span>');
  }
  // Mô tả danh mục (chỉ khi còn là chỗ giữ chỗ "Đang tải...")
  const descEl = root.querySelector('#products-count');
  if (descEl && cat && cat.description) descEl.textContent = cat.description;
  void slug;
}

export async function mountProducts(root, query) {
  let current = { ...query };

  // Danh mục: nếu lần nạp đầu thất bại thì thử lại một lần trước khi vẽ chip.
  if (!state.categories.length) {
    try { await loadCategories(); } catch { /* giữ tiêu đề mặc định */ }
  }
  applyCategoryHeading(root, current.category);

  // Category chips — CHỈ danh mục có sản phẩm (không dẫn khách vào trang rỗng)
  const catHost = root.querySelector('#cat-filter');
  const live = (state.categories || []).filter((c) => Number(c.productCount) > 0);
  if (catHost) {
    if (live.length === 0) {
      // Không có danh mục nào có hàng -> ẩn cả dải chip thay vì hiện link chết
      catHost.hidden = true;
      catHost.innerHTML = '';
    } else {
      catHost.hidden = false;
      catHost.innerHTML =
        `<button type="button" class="cat-chip ${!current.category ? 'active' : ''}" data-cat=""
           aria-pressed="${!current.category}">
           <span class="ico">${icon('package', { size: 14 })}</span>Tất cả
         </button>` +
        live.map((c) => `
          <button type="button" class="cat-chip ${current.category === c.slug ? 'active' : ''}"
            data-cat="${esc(c.slug)}" aria-pressed="${current.category === c.slug}">
            <span class="ico">${icon(catIcon(c.slug), { size: 14 })}</span>${esc(c.name)}
            <span class="cnt">${fmtNum(c.productCount)}</span>
          </button>`).join('');
    }
  }

  catHost?.querySelectorAll('[data-cat]').forEach((b) => {
    b.onclick = () => {
      current.category = b.dataset.cat;
      current.page = '1';
      navigate(buildQuery(current));
    };
  });

  // Search
  const searchInput = root.querySelector('#product-search');
  searchInput.addEventListener('input', debounce((e) => {
    current.q = e.target.value.trim();
    current.page = '1';
    navigate(buildQuery(current), { replace: true });
  }, 450));

  root.querySelector('#sort-select').onchange = (e) => {
    current.sort = e.target.value;
    current.page = '1';
    navigate(buildQuery(current));
  };
  root.querySelector('#price-select').onchange = (e) => {
    // Không lưu minPrice/maxPrice ở đây: buildQuery chỉ dựa vào current.price,
    // còn loadPage tự tách lại chuỗi "min-max" khi gọi API.
    current.price = e.target.value;
    current.page = '1';
    navigate(buildQuery(current));
  };

  await loadPage(root, current);
}

async function loadPage(root, current) {
  const host = root.querySelector('#products-grid');
  const countEl = root.querySelector('#products-count');
  const pg = root.querySelector('#pagination');
  host.innerHTML = skeletonCards(9);
  host.className = '';
  pg.innerHTML = '';

  const params = new URLSearchParams();
  if (current.q) params.set('q', current.q);
  if (current.category) params.set('category', current.category);
  if (current.sort) params.set('sort', current.sort);
  if (current.price) {
    const [min, max] = current.price.split('-');
    if (min) params.set('minPrice', min);
    if (max) params.set('maxPrice', max);
  }
  params.set('page', current.page || '1');
  params.set('perPage', '12');

  try {
    const data = await api('/api/products?' + params.toString());
    if (countEl) {
      countEl.textContent = data.total > 0
        ? `Tìm thấy ${fmtNum(data.total)} sản phẩm${current.q ? ` cho "${current.q}"` : ''}`
        : 'Không tìm thấy sản phẩm nào';
    }

    if (data.products.length === 0) {
      host.className = '';
      host.innerHTML = emptyBlock({
        ico: 'search',
        title: 'Không tìm thấy sản phẩm',
        desc: 'Thử từ khoá khác hoặc xoá bớt bộ lọc đang áp dụng.',
        action: '<a class="btn btn-primary btn-sm" href="#/products">Xem tất cả sản phẩm</a>',
      });
      return;
    }

    /*
     * NHÓM THEO SẢN PHẨM.
     *
     * Lưới 4 cột với 10 thẻ thì khối 6 gói AOE1 + 4 gói XAGR bị cắt ngang
     * ranh giới hàng -> hai sản phẩm nằm chung một hàng, trông lộn xộn.
     *
     * Ở chế độ sắp xếp mặc định (và không lọc/tìm), gom thành 2 section có
     * tiêu đề riêng. Các chế độ sắp xếp khác (giá, bán chạy, mới nhất) vẫn
     * trả lưới phẳng vì lúc đó khách muốn so sánh toàn bộ.
     */
    const canGroup = (!current.sort || current.sort === 'featured')
      && !current.q && !current.category && data.products.length > 0;

    if (canGroup) {
      // Giữ đúng thứ tự xuất hiện của từng nhóm trong dữ liệu server trả về.
      const order = [];
      const groups = new Map();
      for (const p of data.products) {
        const key = p.licensePrefix || 'other';
        if (!groups.has(key)) {
          groups.set(key, []);
          order.push(key);
        }
        groups.get(key).push(p);
      }

      const TITLES = {
        AOE1: {
          name: 'XA ARENA',
          desc: 'Bỏ sương mù toàn map + minimap. Một key dùng cho cả hai.',
          ico: 'eye',
        },
        XAGR: {
          name: 'XA ARENA — Thêm tài nguyên',
          desc: 'Bơm thịt / gỗ / vàng ngay trong trận đang chơi.',
          ico: 'zap',
        },
      };

      if (order.length > 1) {
        // Nhiều sản phẩm -> render từng section
        host.className = 'prod-groups';
        host.innerHTML = order.map((key) => {
          const items = groups.get(key);
          const meta = TITLES[key] || {
            name: 'Sản phẩm khác', desc: '', ico: 'package',
          };
          return `
            <section class="prod-group" data-count="${items.length}" data-key="${esc(key)}">
              <header class="prod-group-head">
                <h2 class="prod-group-title">
                  <span class="prod-group-ico">${icon(meta.ico, { size: 16 })}</span>
                  ${esc(meta.name)}
                  <span class="prod-group-count">${items.length} gói</span>
                </h2>
                ${meta.desc ? `<p class="prod-group-desc">${esc(meta.desc)}</p>` : ''}
              </header>
              <div class="grid-products">${items.map(productCard).join('')}</div>
            </section>`;
        }).join('');
        // Mỗi section có host thẻ riêng -> gắn "Mua ngay" cho từng host
        host.querySelectorAll('.grid-products').forEach((g) => {
          bindBuyNowCards(g, data.products);
        });
      } else {
        host.className = 'grid-products';
        host.innerHTML = data.products.map(productCard).join('');
        bindBuyNowCards(host, data.products);
      }
    } else {
      host.className = 'grid-products';
      host.innerHTML = data.products.map(productCard).join('');
      bindBuyNowCards(host, data.products);
    }

    // Pagination
    if (data.totalPages > 1) {
      const pages = [];
      const cur = data.page;
      const total = data.totalPages;
      for (let i = 1; i <= total; i++) {
        if (i === 1 || i === total || Math.abs(i - cur) <= 1) pages.push(i);
        else if (pages[pages.length - 1] !== '...') pages.push('...');
      }
      pg.innerHTML = `
        <div class="pg-info">Trang <strong>${cur}</strong> / ${total}</div>
        <div class="pg-list">
          <button type="button" class="btn btn-ghost btn-sm" data-pg="${cur - 1}"
            ${cur <= 1 ? 'disabled' : ''} aria-label="Trang trước">
            ${icon('arrowLeft', { size: 13 })}Trước
          </button>
          ${pages.map((p) => p === '...'
            ? '<span class="pg-gap" aria-hidden="true">…</span>'
            : `<button type="button" class="btn ${p === cur ? 'btn-primary' : 'btn-ghost'} btn-sm"
                 data-pg="${p}" aria-label="Trang ${p}" aria-current="${p === cur ? 'page' : 'false'}">${p}</button>`).join('')}
          <button type="button" class="btn btn-ghost btn-sm" data-pg="${cur + 1}"
            ${cur >= total ? 'disabled' : ''} aria-label="Trang sau">
            Sau${icon('arrowRight', { size: 13 })}
          </button>
        </div>`;
      pg.querySelectorAll('[data-pg]').forEach((b) => {
        b.onclick = () => {
          current.page = b.dataset.pg;
          navigate(buildQuery(current));
          window.scrollTo({ top: 0, behavior: 'smooth' });
        };
      });
    }
  } catch (e) {
    host.className = '';
    host.innerHTML = emptyBlock({
      ico: 'alert',
      title: 'Không tải được danh sách sản phẩm',
      desc: e.message,
    });
    toast(e.message, 'error');
  }
}
