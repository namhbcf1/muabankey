/** Trang khách quản lý license XArena đã mua. */
import { api, esc, fmtDate, timeAgo, toast, navigate, loadingBlock, copyText, openModal } from '../lib.js';
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
      <span>Bấm <strong>Lấy lệnh cài đặt</strong> để sinh lệnh riêng (dùng 1 lần, hết hạn sau 24 giờ).
      Rồi bấm <strong>Win + R</strong>, dán lệnh, Enter — xong.</span>
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
        const one = r.oneLiner || r.cmd;
        zone.innerHTML = `
          <div style="padding:16px;border-radius:14px;background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.3)">
            <div style="font-size:12.5px;font-weight:800;color:#86efac;margin-bottom:9px;letter-spacing:.04em">
              ⚡ CÀI ĐẶT MỘT LỆNH — XONG
            </div>
            <div class="mono" style="font-size:11.5px;line-height:1.7;color:#bbf7d0;word-break:break-all;background:rgba(0,0,0,.42);padding:12px;border-radius:9px;border:1px solid rgba(255,255,255,.07)">
              ${esc(one)}
            </div>
            <div class="flex gap-1 mt-2" style="flex-wrap:wrap">
              <button class="btn btn-primary btn-sm" data-copyone="${esc(one)}">📋 Copy lệnh</button>
              <a class="btn btn-ghost btn-sm" href="${esc(r.downloadPs1)}" download>⬇️ Tải .ps1</a>
              <a class="btn btn-ghost btn-sm" href="${esc(r.exeUrl)}" download>⬇️ File .exe</a>
            </div>
            <div style="font-size:11.5px;color:var(--text-mute);margin-top:9px;line-height:1.7">
              Lệnh có hiệu lực <strong>24 giờ</strong>. Mỗi lần lấy sẽ tạo lệnh mới.<br>
              Tự tải, tự cài, tự kích hoạt, tự tạo shortcut ngoài Desktop.
            </div>
          </div>
          <details style="margin-top:12px;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid var(--border)">
            <summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--text-dim);list-style:none">
              📖 Hướng dẫn 3 bước (bấm để mở)
            </summary>
            <ol style="margin:12px 0 0 18px;font-size:12.8px;color:var(--text-mute);line-height:1.95">
              <li>Bấm <strong>Win + R</strong> (phím Windows + phím R)</li>
              <li>Dán lệnh vào ô vừa hiện ra → <strong>Enter</strong></li>
              <li>Windows hỏi quyền → bấm <strong>Yes</strong></li>
            </ol>
            <div style="margin-top:10px;font-size:12px;color:var(--text-mute);line-height:1.7">
              Chờ ~20 giây. Thấy <strong>"HOÀN TẤT"</strong> là xong —
              shortcut <strong>XArena No Fog</strong> đã có ngoài Desktop.
            </div>
          </details>`;

        zone.querySelectorAll('[data-copyone]').forEach((cb) => {
          cb.onclick = async () => {
            const ok = await copyText(cb.dataset.copyone);
            toast(ok ? 'Đã copy! Bấm Win+R, dán vào, Enter.' : 'Không sao chép được',
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
      const key = b.dataset.rebind;
      if (!confirm(`Đổi máy cho key ${key}?\n\nMã đổi máy chỉ dùng được 1 lần, hết hạn sau 30 phút.`)) return;
      b.disabled = true;
      try {
        const r = await api(`/api/licenses/${encodeURIComponent(key)}/rebind`, { method: 'POST' });

        // TRƯỚC ĐÂY chỉ hiện toast "Đã cấp quyền" -> token sinh ra rồi mất.
        // Khách không có cách nào dùng được token => đổi máy không bao giờ xong.
        const token = r.token || '';
        const cmd = `xa_nofog_pro.exe --rebind ${key} ${token}`;

        openModal(`
          <div class="modal-title">✅ Mã đổi máy đã tạo</div>
          <div class="modal-sub">
            Chạy lệnh dưới đây <strong>trên MÁY MỚI</strong> (máy bạn muốn chuyển sang).
          </div>

          <div class="field">
            <label class="label">Lệnh đổi máy</label>
            <div class="mono" id="rb-cmd" style="font-size:11.5px;line-height:1.7;word-break:break-all;
              background:rgba(0,0,0,.42);padding:12px;border-radius:9px;border:1px solid rgba(255,255,255,.07)">
              ${esc(cmd)}
            </div>
          </div>

          <div class="alert alert-warn" style="margin-bottom:14px">
            <span class="ico">⏳</span>
            <span>Mã chỉ dùng được <strong>1 lần</strong>, hết hạn sau <strong>30 phút</strong>.
            Không chia sẻ mã này cho ai.</span>
          </div>

          <div class="alert alert-info" style="margin-bottom:16px">
            <span class="ico">💡</span>
            <span>Chưa cài tool trên máy mới? Tải file cài rồi chạy lệnh trên ở thư mục cài đặt,
            hoặc dùng <code class="mono">👤 Đổi máy</code> trong menu tool.</span>
          </div>

          <div class="flex gap-1" style="justify-content:flex-end;flex-wrap:wrap">
            <button class="btn btn-ghost" data-close>Đóng</button>
            <button class="btn btn-primary" data-copycmd>📋 Copy lệnh</button>
          </div>
        `, {
          onMount(overlay, close) {
            overlay.querySelector('[data-close]').onclick = close;
            overlay.querySelector('[data-copycmd]').onclick = async () => {
              const okc = await copyText(cmd);
              toast(okc ? 'Đã copy lệnh đổi máy' : 'Không copy được',
                okc ? 'success' : 'error');
            };
          },
        });

        toast(`Đã tạo mã đổi máy (còn ${r.rebindsLeft} lượt)`, 'success', 5000);
      } catch (e) {
        toast(e.message, 'error', 7000);
        b.disabled = false;
      }
    };
  });
}

