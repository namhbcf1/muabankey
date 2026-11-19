/**
 * Trang "Bản quyền của tôi" — dạng THẺ, KHÔNG BAO GIỜ in key.
 *
 * Mô hình: khách đăng nhập bằng tài khoản web, app gắn licence vào TÀI KHOẢN.
 *   - ĐÃ MUA: bản quyền theo TÀI KHOẢN -> đổi máy nào cũng được, mỗi lúc chỉ
 *     1 máy đăng nhập. Trang KHÔNG hiện mã máy (với khách nó vô nghĩa).
 *   - DÙNG THỬ: gắn với MÁY (server chặn theo máy) -> vẫn hiện "dùng thử gắn
 *     với máy này" + số lượt đổi máy còn lại.
 * Muốn nhận diện licence thì dùng 4 ký tự cuối của `key` (xem keyTail()).
 */
import {
  api, esc, fmtDate, timeAgo, toast, navigate, loadingBlock,
  openModal, emptyBlock,
} from '../lib.js';
import { icon } from '../icons.js';
import { state } from '../state.js';

/**
 * App ghi `licenses.last_seen` mỗi lần chạy (đơn vị GIÂY — xem
 * src/routes/license-server.js: `last_seen = ?, rebind_until = NULL`).
 * Quá mốc này thì coi như licence đang nằm ở máy khác.
 */
const RECENT_MS = 7 * 86400000;

/**
 * 4 ký tự cuối của key — đủ để khách nhận ra licence, KHÔNG đủ để dùng.
 * Không bao giờ trả cả key về DOM.
 */
function keyTail(key) {
  const s = String(key || '').replace(/[^A-Za-z0-9]/g, '');
  if (s.length < 5) return '••••';
  return '••••' + s.slice(-4).toUpperCase();
}

/** Số ngày còn lại; null khi vĩnh viễn hoặc không rõ hạn. */
function daysLeftOf(expiresAt, nowMs) {
  const at = Number(expiresAt || 0);
  if (!at) return null;
  return Math.ceil((at * 1000 - nowMs) / 86400000);
}

/**
 * Tên sản phẩm: `productName` do server JOIN từ products; thiếu thì suy ra từ
 * quyền dùng chức năng (`hasNofog` = map sáng, `hasGrant` = tài nguyên).
 */
function productOf(l) {
  const named = String(l.productName || '').trim();
  if (named) return named;
  if (l.hasNofog && l.hasGrant) return 'Map sáng + Tài nguyên';
  if (l.hasNofog) return 'Map sáng';
  if (l.hasGrant) return 'Tài nguyên';
  return 'XA ARENA';
}

/** Nhãn + màu + icon cho trạng thái licence. */
function statusOf(l, days) {
  if (l.status === 'revoked') return ['pill-red', 'Đã thu hồi', 'ban'];
  if (l.status === 'expired') return ['pill-red', 'Đã hết hạn', 'x'];
  if (l.trialPending) return ['pill-blue', 'Chờ kích hoạt', 'clock'];
  if (l.forever) return ['pill-green', 'Không giới hạn', 'infinity'];
  if (days === null) return ['pill-gray', 'Không rõ hạn', 'help'];
  if (days <= 0) return ['pill-red', 'Đã hết hạn', 'x'];
  if (days <= 7) return ['pill-yellow', `Sắp hết hạn · còn ${days} ngày`, 'alert'];
  return ['pill-green', `Còn ${days} ngày`, 'checkCircle'];
}

/**
 * Máy đang gắn — CHỈ dùng cho bản DÙNG THỬ (bản đã mua đi theo tài khoản).
 *
 * Web không biết mã máy của máy đang duyệt (không API nào trả về), nên đây là
 * suy luận từ dấu vết thật trên server: `bound` (đã gắn máy) + `lastSeen`
 * (lần cuối app chạy).
 */
function machineOf(l, nowMs) {
  if (!l.bound) return ['pill-gray', 'Chưa gắn máy', 'unlock'];
  const raw = Number(l.lastSeen || 0);
  const seenMs = raw > 1e12 ? raw : raw * 1000;
  if (!seenMs || nowMs - seenMs < RECENT_MS) return ['pill-blue', 'Gắn máy này', 'checkCircle'];
  return ['pill-yellow', 'Gắn máy khác', 'refresh'];
}

/** Lượt đổi máy còn lại. `maxRebind = 0` = không hỗ trợ đổi (server chặn). */
function rebindLeftOf(l) {
  const max = Number(l.maxRebind || 0);
  const used = Number(l.rebinds || 0);
  if (max <= 0) return 0;
  return Math.max(0, max - used);
}

/**
 * Tên máy đang dùng, NẾU server có trả về. Thiếu thì trả '' — không bịa tên.
 * Server hiện CHƯA trả field này (xem myLicenses trong src/routes/license.js),
 * nên mặc định là câu "dùng được trên mọi máy".
 */
function activeDeviceOf(l) {
  const a = l.activeDevice;
  if (typeof a === 'string' && a.trim()) return a.trim();
  if (a && typeof a === 'object') {
    const n = String(a.name || a.deviceName || '').trim();
    if (n) return n;
  }
  return String(l.deviceName || '').trim();
}

/** Lượt dùng thử còn lại — chỉ hiện khi server thật sự trả về. */
function trialUsesText(l) {
  const n = Number(l.trialUsesLeft);
  if (!Number.isFinite(n)) return '';
  const max = Number(l.trialUsesMax) > 0 ? Number(l.trialUsesMax) : 10;
  return ` · còn ${fmtCount(Math.max(0, n))}/${fmtCount(max)} lượt`;
}

/**
 * Một thẻ licence. Chỉ số `i` để tra key trong mảng — key không vào DOM.
 *
 * ĐÃ MUA  : theo TÀI KHOẢN -> không hiện mã máy, không có nút đổi máy.
 * DÙNG THỬ: gắn với MÁY -> hiện pill máy + lượt đổi máy còn lại.
 */
function licenceCard(l, i, nowMs) {
  const days = daysLeftOf(l.expiresAt, nowMs);
  const [sCls, sLabel, sIco] = statusOf(l, days);
  const isTrial = !!l.isTrial;
  const [mCls, mLabel, mIco] = machineOf(l, nowMs);
  const left = rebindLeftOf(l);
  const maxRebind = Number(l.maxRebind || 0);
  const usable = !['revoked', 'expired'].includes(l.status);
  const canRebind = isTrial && usable && left > 0;

  const expireText = l.forever
    ? 'Không giới hạn'
    : days === null
      ? '—'
      : `${days > 0 ? `Còn ${fmtCount(days)} ngày` : 'Đã hết hạn'}`
        + `<br><span class="text-dim">${esc(fmtDate(Number(l.expiresAt) * 1000))}</span>`;

  const rebindText = maxRebind > 0
    ? (left > 0 ? `Còn ${fmtCount(left)}/${fmtCount(maxRebind)} lượt` : 'Đã hết lượt')
    : 'Không hỗ trợ';

  // Pill máy + ô "Máy"/"Đổi máy" CHỈ dành cho bản dùng thử.
  const machinePill = isTrial
    ? `<span class="pill ${mCls}">${icon(mIco, { size: 11 })} ${esc(mLabel)}</span>`
    : '';

  const trialCells = isTrial
    ? `
            <div class="meta-cell">
              <div class="k">Máy</div>
              <div class="v">Dùng thử gắn với máy này${trialUsesText(l)}</div>
            </div>
            <div class="meta-cell">
              <div class="k">Đổi máy</div>
              <div class="v">${esc(rebindText)}</div>
            </div>`
    : '';

  // Bản ĐÃ MUA: 1 tài khoản = 1 máy tại một thời điểm, đổi máy nào cũng được.
  const dev = activeDeviceOf(l);
  const paidWhere = dev
    ? `Đang dùng trên: <strong>${esc(dev)}</strong>`
    : 'Dùng được trên mọi máy — đăng nhập là dùng. Mỗi lúc chỉ 1 máy.';

  return `
        <article class="panel" data-lic-i="${i}">
          <div class="lic-head">
            <div class="lic-main">
              <h2 class="lic-name">${esc(productOf(l))}</h2>
              <div class="pill-row mt-1">
                <span class="pill ${sCls}">${icon(sIco, { size: 11 })} ${esc(sLabel)}</span>
                ${machinePill}
              </div>
            </div>
            <div class="lic-src">
              <span class="mono">${esc(keyTail(l.key))}</span>
              ${l.orderCode ? `<br>Đơn <span class="mono">${esc(l.orderCode)}</span>` : ''}
              ${l.purchasedAt ? `<br>${esc(timeAgo(l.purchasedAt))}` : ''}
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-cell">
              <div class="k">Hạn dùng</div>
              <div class="v">${expireText}</div>
            </div>${trialCells}
          </div>

          ${isTrial ? '' : `
          <p class="note mt-1">${paidWhere}</p>
          <p class="note text-dim">Đăng nhập ở máy khác thì máy này tự thoát.</p>`}

          ${usable ? '' : `
          <div class="alert alert-error mt-2">
            <span class="ico">${icon('alert', { size: 15 })}</span>
            <span>Bản quyền này không dùng được nữa. Bấm <strong>Hỗ trợ</strong> để được xử lý.</span>
          </div>`}

          <div class="btn-row mt-2">
            ${canRebind ? `<button class="btn btn-ghost btn-sm" data-rebind-i="${i}">
              ${icon('refresh', { size: 13 })} Đổi máy
            </button>` : ''}
            <a class="btn btn-ghost btn-sm" href="#/support">
              ${icon('messageCircle', { size: 13 })} Hỗ trợ
            </a>
          </div>
        </article>`;
}

export function renderLicenses() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <nav class="pd-breadcrumb" aria-label="Đường dẫn">
        <a href="#/">Trang chủ</a><span>/</span><span>Bản quyền của tôi</span>
      </nav>
      <div class="page-head">
        <div>
          <h1 class="page-title">Bản quyền của tôi</h1>
          <p class="page-desc">Hạn dùng và trạng thái bản quyền.</p>
        </div>
      </div>
      <div id="lic-content">${loadingBlock()}</div>
    </div>
  </section>
  <div id="site-footer"></div>`;
}

export async function mountLicenses(root) {
  const host = root.querySelector('#lic-content');
  if (!state.user) { navigate('/login?redirect=/licenses', { replace: true }); return; }

  let data;
  try {
    data = await api('/api/licenses/mine');
  } catch (e) {
    host.innerHTML = emptyBlock({ ico: 'alert', title: e.message || 'Không tải được licence' });
    return;
  }

  const list = Array.isArray(data.licenses) ? data.licenses : [];

  if (!list.length) {
    host.innerHTML = emptyBlock({
      ico: 'key',
      title: 'Bạn chưa có bản quyền nào',
      desc: 'Mua gói XA ARENA — tự gắn vào tài khoản, không cần nhập gì.',
      action: `<button class="btn btn-primary btn-sm" data-empty-go="/products?category=license-xarena">Xem gói licence</button>`,
    });
    host.querySelector('[data-empty-go]').onclick = () => navigate('/products?category=license-xarena');
    return;
  }

  const now = Date.now();
  host.innerHTML = `
    <div class="install-box">
      <div class="install-eyebrow">${icon('login', { size: 13 })} Dùng app</div>
      <p class="note">Mở <strong>XA ARENA</strong>, bấm <strong>Đăng nhập</strong> — bản quyền tự gắn.</p>
      <div class="btn-row mt-2">
        <a class="btn btn-primary btn-sm" href="#/tai-ve">
          ${icon('download', { size: 13 })} Tải app
        </a>
      </div>
    </div>

    <div class="stack mt-2">
      ${list.map((l, i) => licenceCard(l, i, now)).join('')}
    </div>
  `;

  /*
   * Đổi máy: CHỈ bản DÙNG THỬ mới có nút này (bản đã mua đi theo tài khoản).
   * Mở "cửa sổ 30 phút" trên licence (rebind_until): không in key, không in
   * mã hex, không đưa dòng lệnh — máy mới chỉ cần mở XA ARENA và đăng nhập.
   */
  host.querySelectorAll('[data-rebind-i]').forEach((b) => {
    b.onclick = async () => {
      const lic = list[Number(b.dataset.rebindI)];
      if (!lic || !lic.key) return;
      const sure = confirm(
        'Mở cửa sổ đổi máy dùng thử trong 30 phút?\n\n'
        + 'Sang máy mới, mở XA ARENA và bấm Đăng nhập là xong.',
      );
      if (!sure) return;

      b.disabled = true;
      try {
        const r = await api(`/api/licenses/${encodeURIComponent(lic.key)}/rebind`, { method: 'POST' });
        const leftNow = Math.max(0, Number(r.rebindsLeft) || 0);

        openModal(`
          <div class="modal-title">Đã mở cửa sổ đổi máy</div>
          <div class="modal-sub">
            Cửa sổ mở trong <strong>30 phút</strong>. Sang <strong>máy mới</strong>,
            mở <strong>XA ARENA</strong> rồi bấm <strong>Đăng nhập</strong> — bản quyền tự gắn.
          </div>

          <div class="alert alert-warn">
            <span class="ico">${icon('clock', { size: 15 })}</span>
            <span>Hết 30 phút thì bấm <strong>Đổi máy</strong> lại. Còn
            <strong>${esc(fmtCount(leftNow))}</strong> lượt.</span>
          </div>

          <div class="alert alert-info">
            <span class="ico">${icon('info', { size: 15 })}</span>
            <span>Máy mới chưa có app? Bấm <strong>Tải app</strong>, mở lên rồi đăng nhập.</span>
          </div>

          <div class="btn-row end">
            <button class="btn btn-ghost" data-close>Đóng</button>
            <button class="btn btn-primary" data-go-app>
              ${icon('download', { size: 14 })} Tải app
            </button>
          </div>
        `, {
          onMount(overlay, close) {
            overlay.querySelector('[data-close]').onclick = close;
            // Đóng modal TRƯỚC khi chuyển trang, tránh overlay nằm lại trên trang mới.
            overlay.querySelector('[data-go-app]').onclick = () => {
              close();
              navigate('/tai-ve');
            };
          },
        });

        toast(`Đã mở cửa sổ đổi máy — còn ${fmtCount(leftNow)} lượt`, 'success', 5000);
      } catch (e) {
        toast(e.message, 'error', 7000);
      } finally {
        b.disabled = false;
      }
    };
  });
}

/** Số đếm nhỏ (ngày / lượt) — giữ dạng số, không dùng định dạng tiền. */
function fmtCount(n) {
  return new Intl.NumberFormat('vi-VN').format(Number(n) || 0);
}
