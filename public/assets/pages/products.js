/** Trang danh sách sản phẩm với bộ lọc. */
import { api, esc, fmtVnd, fmtNum, skeletonCards, toast, navigate, debounce } from '../lib.js';
import { state } from '../state.js';
import { productCard, bindProductCards } from './home.js';

export function renderProducts(query) {
  const activeCat = state.categories.find((c) => c.slug === query.category);
  const heading = activeCat ? activeCat.name : 'Tất cả sản phẩm';
  const headingDesc = activeCat && activeCat.description
    ? activeCat.description
    : 'Đang tải...';
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <div class="pd-breadcrumb">
        <a href="#/">Trang chủ</a><span>/</span>
        ${activeCat
          ? `<a href="#/products">Sản phẩm</a><span>/</span><span style="color:var(--text)">${esc(activeCat.name)}</span>`
          : '<span>Sản phẩm</span>'}
      </div>
      <div class="sec-head" style="margin-bottom:20px">
        <div>
          <h1 class="sec-title">${esc(heading)}</h1>
          <p class="sec-desc" id="products-count">${esc(headingDesc)}</p>
        </div>
      </div>

      <div class="cat-scroll" id="cat-filter"></div>

      <div class="filters">
        <div class="filter-group" style="flex:1;min-width:200px">
          <div class="search-mini" style="width:100%;flex:1">
            <span style="color:var(--text-mute)">🔍</span>
            <input type="search" id="product-search" placeholder="Tìm theo tên sản phẩm..."
              value="${esc(query.q || '')}" aria-label="Tìm sản phẩm">
          </div>
        </div>
        <div class="filter-group">
          <span class="filter-label">Sắp xếp</span>
          <select class="select" id="sort-select">
            <option value="featured"${query.sort === 'featured' || !query.sort ? ' selected' : ''}>Nổi bật</option>
            <option value="popular"${query.sort === 'popular' ? ' selected' : ''}>Bán chạy</option>
            <option value="price_asc"${query.sort === 'price_asc' ? ' selected' : ''}>Giá thấp → cao</option>
            <option value="price_desc"${query.sort === 'price_desc' ? ' selected' : ''}>Giá cao → thấp</option>
            <option value="newest"${query.sort === 'newest' ? ' selected' : ''}>Mới nhất</option>
            <option value="rating"${query.sort === 'rating' ? ' selected' : ''}>Đánh giá cao</option>
          </select>
        </div>
        <div class="filter-group">
          <span class="filter-label">Giá</span>
          <select class="select" id="price-select">
            <option value="">Mọi mức giá</option>
            <option value="0-200000"${query.price === '0-200000' ? ' selected' : ''}>Dưới 200.000₫</option>
            <option value="200000-500000"${query.price === '200000-500000' ? ' selected' : ''}>200.000₫ - 500.000₫</option>
            <option value="500000-1000000"${query.price === '500000-1000000' ? ' selected' : ''}>500.000₫ - 1.000.000₫</option>
            <option value="1000000-"${query.price === '1000000-' ? ' selected' : ''}>Trên 1.000.000₫</option>
          </select>
        </div>
      </div>

      <div id="products-grid">${skeletonCards(9)}</div>
      <div id="pagination" class="flex justify-between items-center mt-4" style="gap:12px;flex-wrap:wrap"></div>
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

export async function mountProducts(root, query) {
  let current = { ...query };

  // Category chips
  const catHost = root.querySelector('#cat-filter');
  catHost.innerHTML =
    `<button class="cat-chip ${!current.category ? 'active' : ''}" data-cat="">✨ Tất cả</button>` +
    state.categories.map((c) => `
      <button class="cat-chip ${current.category === c.slug ? 'active' : ''}" data-cat="${esc(c.slug)}">
        <span class="ico">${esc(c.icon || '📦')}</span>${esc(c.name)}
        <span class="cnt">${c.productCount}</span>
      </button>`).join('');

  catHost.querySelectorAll('[data-cat]').forEach((b) => {
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
    current.price = e.target.value;
    if (current.price) {
      const [min, max] = current.price.split('-');
      current.minPrice = min || '';
      current.maxPrice = max || '';
    } else {
      current.minPrice = '';
      current.maxPrice = '';
    }
    current.page = '1';
    navigate(buildQuery(current));
  };

  await loadPage(root, current);
}

async function loadPage(root, current) {
  const host = root.querySelector('#products-grid');
  const countEl = root.querySelector('#products-count');
  host.innerHTML = skeletonCards(9);
  host.className = '';

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
      host.innerHTML = `<div class="empty-state">
        <div class="ico">🔍</div>
        <div class="t">Không tìm thấy sản phẩm</div>
        <div class="d">Thử từ khoá khác hoặc xoá bộ lọc</div>
        <button class="btn btn-primary btn-sm" onclick="location.hash='#/products'">Xem tất cả</button>
      </div>`;
      root.querySelector('#pagination').innerHTML = '';
      return;
    }

    host.className = 'grid-products';
    host.innerHTML = data.products.map(productCard).join('');
    bindProductCards(host, data.products);

    // Pagination
    const pg = root.querySelector('#pagination');
    if (data.totalPages > 1) {
      const pages = [];
      const cur = data.page;
      const total = data.totalPages;
      for (let i = 1; i <= total; i++) {
        if (i === 1 || i === total || Math.abs(i - cur) <= 1) pages.push(i);
        else if (pages[pages.length - 1] !== '...') pages.push('...');
      }
      pg.innerHTML = `
        <div style="font-size:13px;color:var(--text-mute)">
          Trang ${cur} / ${total}
        </div>
        <div class="flex gap-1">
          <button class="btn btn-ghost btn-sm" ${cur <= 1 ? 'disabled' : ''} data-pg="${cur - 1}">← Trước</button>
          ${pages.map((p) => p === '...'
            ? `<span style="padding:8px 6px;color:var(--text-mute)">…</span>`
            : `<button class="btn ${p === cur ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pg="${p}">${p}</button>`).join('')}
          <button class="btn btn-ghost btn-sm" ${cur >= total ? 'disabled' : ''} data-pg="${cur + 1}">Sau →</button>
        </div>`;
      pg.querySelectorAll('[data-pg]').forEach((b) => {
        b.onclick = () => {
          current.page = b.dataset.pg;
          navigate(buildQuery(current));
          window.scrollTo({ top: 0, behavior: 'smooth' });
        };
      });
    } else {
      pg.innerHTML = '';
    }
  } catch (e) {
    host.className = '';
    host.innerHTML = `<div class="empty-state"><div class="ico">⚠️</div><div class="t">${esc(e.message)}</div></div>`;
    toast(e.message, 'error');
  }
}
