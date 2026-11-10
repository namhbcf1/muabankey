/** Trang khách quản lý license XArena đã mua. */
import { api, esc, fmtDate, timeAgo, toast, navigate, loadingBlock, copyText } from '../lib.js';
import { state } from '../state.js';

const STATUS = {
  active:   ['pill-green',  '✅ Đang hoạt động'],
  forever:  ['pill-green',  '♾️ Vĩnh viễn'],
  expiring: ['pill-yellow', '⚠️ Sắp hết hạn'],
  unbound:  ['pill-blue',   '🔓 Chưa kích hoạt'],
  expired:  ['pill-red',    '✕ Đã hết hạn'],
  revoked:  ['pill-red',    '🚫 Đã thu hồi'],
  unknown:  ['pill-gray',   'Không rõ'],
};

const BASE = location.origin;

export function renderLicenses() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <div class="pd-breadcrumb"><a href="#/">Trang chủ</a><span>/</span><span>License của tôi</span></div>
      <div class="sec-head" style="margin-bottom:22px">
        <div>
          <h1 class="sec-title">🔑 License của tôi</h1>
          <p class="sec-desc">Lấy lệnh cài đặt tự động, xem hạn dùng và đổi máy khi cần</p>
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
    host.innerHTML = `<div class="empty-state"><div class="ico">⚠️</div><div class="t">${esc(e.message)}</div></div>`;
    return;
  }

  if (!data.licenses.length) {
    host.innerHTML = `
      <div class="empty-state">
        <div class="ico">🔑</div>
        <div class="t">Bạn chưa có license nào</div>
        <div class="d">Mua key XArena để nhận lệnh cài đặt tự động</div>
        <button class="btn btn-primary btn-sm" onclick="location.hash='#/products?category=license-xarena'">Xem gói license</button>
      </div>`;
    return;
  }

  const now = Date.now();
  host.innerHTML = `
    <div class="alert alert-info">
      <span class="ico">⚡</span>
      <span>Bấm <strong>Lấy lệnh cài đặt</strong> để sinh lệnh riêng cho bạn (dùng 1 lần, hết hạn sau 24 giờ).
      Sau đó dán vào <strong>CMD</strong> (Win+R → gõ <code>cmd</code>) và Enter.</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      ${data.licenses.map((l) => {
        const [cls, label] = STATUS[l.status] || STATUS.unknown;
        const daysLeft = l.expiresAt > 0 ? Math.ceil((l.expiresAt * 1000 - now) / 86400000) : null;
        const canRebind = ['active', 'forever', 'expiring', 'unbound'].includes(l.status);
        const usable = !['revoked', 'expired'].includes(l.status);
        return `
        <div class="panel" data-lic="${esc(l.key)}">
          <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:12px">
            <div style="min-width:0">
              <div style="font-size:14px;font-weight:800;margin-bottom:5px">${esc(l.productName || l.plan || 'License XArena')}</div>
              <div class="flex gap-1" style="flex-wrap:wrap">
                <span class="pill ${cls}">${label}</span>
                ${l.forever ? `<span class="pill pill-blue">♾️ Không giới hạn</span>` : daysLeft !== null && daysLeft > 0 ? `<span class="pill pill-gray">Còn ${daysLeft} ngày</span>` : ''}
              </div>
            </div>
            <div style="text-align:right;font-size:12px;color:var(--text-mute)">
              ${l.orderCode ? `Đơn <span class="mono" style="color:#a99cff">${esc(l.orderCode)}</span><br>` : ''}
              ${l.purchasedAt ? timeAgo(l.purchasedAt) : ''}
            </div>
          </div>

          <div class="key-box" style="margin-top:14px">
            <div class="key-value">${esc(l.key)}</div>
            <button class="key-copy" data-copy="${esc(l.key)}">📋 Sao chép key</button>
          </div>

          ${usable ? `
          <div id="zone-${esc(l.key)}" style="margin-top:16px">
            <button class="btn btn-primary btn-block" data-install="${esc(l.key)}">
              ⚡ Lấy lệnh cài đặt tự động
            </button>
          </div>` : `
          <div class="alert alert-error" style="margin-top:14px;margin-bottom:0">
            <span class="ico">⚠️</span>
            <span>License này không còn sử dụng được. Liên hệ hỗ trợ để được xử lý.</span>
          </div>`}

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:14px;font-size:12.5px">
            <div><span class="text-mute">Máy đã gắn</span><br><strong class="mono">${l.bound ? esc(l.hwidMasked) : 'Chưa kích hoạt'}</strong></div>
            <div><span class="text-mute">Kích hoạt lúc</span><br><strong>${l.activatedAt ? fmtDate(l.activatedAt * 1000) : '—'}</strong></div>
            <div><span class="text-mute">Hết hạn</span><br><strong>${l.forever ? 'Vĩnh viễn' : l.expiresAt ? fmtDate(l.expiresAt * 1000) : '—'}</strong></div>
            <div><span class="text-mute">Đổi máy</span><br><strong>${l.rebinds} / ${l.maxRebind}</strong></div>
          </div>

          <div class="flex gap-1 mt-2" style="flex-wrap:wrap">
            ${canRebind && l.rebinds < l.maxRebind
              ? `<button class="btn btn-ghost btn-sm" data-rebind="${esc(l.key)}">🔄 Đổi máy</button>` : ''}
            <a class="btn btn-ghost btn-sm" href="#/support">💬 Cần hỗ trợ</a>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;

  host.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      const ok = await copyText(b.dataset.copy);
      toast(ok ? 'Đã sao chép key' : 'Không sao chép được', ok ? 'success' : 'error');
    };
  });

  // Lấy token rồi hiển thị lệnh
  host.querySelectorAll('[data-install]').forEach((b) => {
    b.onclick = async () => {
      const key = b.dataset.install;
      b.disabled = true;
      b.textContent = 'Đang tạo lệnh...';
      try {
        const r = await api(`/api/licenses/${encodeURIComponent(key)}/install-token`, { method: 'POST' });
        const zone = host.querySelector(`#zone-${CSS.escape(key)}`);
        zone.innerHTML = `
          <div style="padding:16px;border-radius:14px;background:rgba(34,211,238,.06);border:1px solid rgba(34,211,238,.28)">
            <div style="font-size:12.5px;font-weight:800;color:#67e8f9;margin-bottom:9px;letter-spacing:.04em">
              ⚡ LỆNH CÀI ĐẶT — DÁN VÀO CMD
            </div>
            <div class="mono" style="font-size:11.5px;line-height:1.7;color:#a5f3fc;word-break:break-all;background:rgba(0,0,0,.42);padding:12px;border-radius:9px;border:1px solid rgba(255,255,255,.07)">
              ${esc(r.cmd)}
            </div>
            <div class="flex gap-1 mt-2" style="flex-wrap:wrap">
              <button class="btn btn-primary btn-sm" data-copycmd="${esc(r.cmd)}">📋 Copy lệnh CMD</button>
              <a class="btn btn-ghost btn-sm" href="${esc(r.downloadCmd)}" download>⬇️ File .cmd</a>
              <a class="btn btn-ghost btn-sm" href="${esc(r.downloadPs1)}" download>⬇️ PowerShell</a>
            </div>
            <div style="font-size:11.5px;color:var(--text-mute);margin-top:9px">
              Lệnh có hiệu lực 24 giờ. Mỗi lần lấy sẽ tạo lệnh mới.
            </div>
          </div>
          <details style="margin-top:12px;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid var(--border)">
            <summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--text-dim);list-style:none">
              📖 Hướng dẫn từng bước (bấm để mở)
            </summary>
            <ol style="margin:12px 0 0 18px;font-size:12.8px;color:var(--text-mute);line-height:1.95">
              <li>Nhấn <strong>Win + R</strong>, gõ <code class="mono">cmd</code>, Enter</li>
              <li>Dán lệnh vừa copy (chuột phải để dán), Enter</li>
              <li>Windows hỏi quyền → b���m <strong>Yes</strong></li>
              <li>Chờ ~30 giây, thấy "HOÀN TẤT" là xong</li>
              <li>Shortcut <strong>XArena No Fog</strong> xuất hiện ngoài Desktop</li>
            </ol>
          </details>`;

        zone.querySelectorAll('[data-copycmd]').forEach((cb) => {
          cb.onclick = async () => {
            const ok = await copyText(cb.dataset.copycmd);
            toast(ok ? 'Đã copy lệnh! Dán vào CMD và Enter.' : 'Không sao chép được',
              ok ? 'success' : 'error', 5000);
          };
        });
      } catch (e) {
        toast(e.message, 'error', 6000);
        b.disabled = false;
        b.textContent = '⚡ Lấy lệnh cài đặt tự động';
      }
    };
  });

  // Đổi máy
  host.querySelectorAll('[data-rebind]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`Cấp quyền đổi máy cho key ${b.dataset.rebind}?\n\nSau đó chạy lệnh cài đặt trên máy mới.`)) return;
      b.disabled = true;
      try {
        const r = await api(`/api/licenses/${encodeURIComponent(b.dataset.rebind)}/rebind`, { method: 'POST' });
        toast(`Đã cấp quyền đổi máy (còn ${r.rebindsLeft} lần)`, 'success', 6000);
        await mountLicenses(root);
      } catch (e) {
        toast(e.message, 'error', 6000);
        b.disabled = false;
      }
    };
  });
}

