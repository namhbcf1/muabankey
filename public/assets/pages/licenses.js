/** Trang khách quản lý license XArena đã mua. */
import {
  api, esc, fmtDate, timeAgo, toast, navigate, loadingBlock,
  copyText, openModal, emptyBlock,
} from '../lib.js';
import { icon } from '../icons.js';
import { state } from '../state.js';

// tone + nhãn + icon cho từng trạng thái license.
const STATUS = {
  active:   ['pill-green',  'Đang hoạt động', 'checkCircle'],
  forever:  ['pill-green',  'Vĩnh viễn', 'infinity'],
  expiring: ['pill-yellow', 'Sắp hết hạn', 'alert'],
  unbound:  ['pill-blue',   'Chưa kích hoạt', 'unlock'],
  expired:  ['pill-red',    'Đã hết hạn', 'x'],
  revoked:  ['pill-red',    'Đã thu hồi', 'ban'],
  unknown:  ['pill-gray',   'Không rõ', 'help'],
};

export function renderLicenses() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <nav class="pd-breadcrumb" aria-label="Đường dẫn">
        <a href="#/">Trang chủ</a><span>/</span><span>License của tôi</span>
      </nav>
      <div class="page-head">
        <div>
          <h1 class="page-title">License của tôi</h1>
          <p class="page-desc">Lấy lệnh cài đặt tự động, xem hạn dùng và đổi máy khi cần.</p>
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
    host.innerHTML = emptyBlock({ ico: 'alert', title: e.message || 'Không tải được license' });
    return;
  }

  if (!data.licenses.length) {
    host.innerHTML = emptyBlock({
      ico: 'key',
      title: 'Bạn chưa có license nào',
      desc: 'Mua key XArena để nhận lệnh cài đặt tự động.',
      action: `<button class="btn btn-primary btn-sm" data-empty-go="/products?category=license-xarena">Xem gói license</button>`,
    });
    host.querySelector('[data-empty-go]').onclick = () => navigate('/products?category=license-xarena');
    return;
  }

  const now = Date.now();
  host.innerHTML = `
    <div class="alert alert-info">
      <span class="ico">${icon('info', { size: 15 })}</span>
      <span>Bấm <strong>Lấy lệnh cài đặt</strong> để sinh lệnh riêng (hiệu lực 24 giờ, bấm lại để tạo lệnh mới).
      Sau đó bấm <strong>Win + R</strong>, dán lệnh và nhấn Enter.</span>
    </div>
    <div class="stack">
      ${data.licenses.map((l) => {
        const [cls, label, ico] = STATUS[l.status] || STATUS.unknown;
        const daysLeft = l.expiresAt > 0 ? Math.ceil((l.expiresAt * 1000 - now) / 86400000) : null;
        const canRebind = ['active', 'forever', 'expiring', 'unbound'].includes(l.status);
        const usable = !['revoked', 'expired'].includes(l.status);
        return `
        <article class="panel" data-lic="${esc(l.key)}">
          <div class="lic-head">
            <div class="lic-main">
              <h2 class="lic-name">${esc(l.productName || l.plan || 'License XArena')}</h2>
              <div class="pill-row mt-1">
                <span class="pill ${cls}">${icon(ico, { size: 11 })} ${esc(label)}</span>
                ${l.forever
                  ? `<span class="pill pill-blue">${icon('infinity', { size: 11 })} Không giới hạn</span>`
                  : daysLeft !== null && daysLeft > 0
                    ? `<span class="pill pill-gray">Còn ${daysLeft} ngày</span>`
                    : ''}
              </div>
            </div>
            <div class="lic-src">
              ${l.orderCode ? `Đơn <span class="mono">${esc(l.orderCode)}</span><br>` : ''}
              ${l.purchasedAt ? esc(timeAgo(l.purchasedAt)) : ''}
            </div>
          </div>

          <div class="key-box">
            <div class="key-value">${esc(l.key)}</div>
            <button class="key-copy" data-copy="${esc(l.key)}">
              ${icon('copy', { size: 12 })} Sao chép key
            </button>
          </div>

          ${usable ? `
          <div id="zone-${esc(l.key)}" class="mt-2">
            <button class="btn btn-primary btn-block" data-install="${esc(l.key)}" data-tool="${esc(l.tool || 'nofog')}">
              ${icon('zap', { size: 14 })} Lấy lệnh cài đặt tự động
            </button>
          </div>` : `
          <div class="alert alert-error mt-2">
            <span class="ico">${icon('alert', { size: 15 })}</span>
            <span>License này không còn sử dụng được. Liên hệ hỗ trợ để được xử lý.</span>
          </div>`}

          <div class="meta-grid">
            <div class="meta-cell">
              <div class="k">Máy đã gắn</div>
              <div class="v mono">${l.bound ? esc(l.hwidMasked) : 'Chưa kích hoạt'}</div>
            </div>
            <div class="meta-cell">
              <div class="k">Kích hoạt lúc</div>
              <div class="v">${l.activatedAt ? esc(fmtDate(l.activatedAt * 1000)) : '—'}</div>
            </div>
            <div class="meta-cell">
              <div class="k">Hết hạn</div>
              <div class="v">${l.forever ? 'Vĩnh viễn' : l.expiresAt ? esc(fmtDate(l.expiresAt * 1000)) : '—'}</div>
            </div>
            <div class="meta-cell">
              <div class="k">Đổi máy</div>
              <div class="v">${fmtCount(l.rebinds)} / ${fmtCount(l.maxRebind)}</div>
            </div>
          </div>

          <div class="btn-row mt-2">
            ${canRebind && l.rebinds < l.maxRebind
              ? `<button class="btn btn-ghost btn-sm" data-rebind="${esc(l.key)}">
                   ${icon('refresh', { size: 13 })} Đổi máy
                 </button>` : ''}
            <a class="btn btn-ghost btn-sm" href="#/support">
              ${icon('messageCircle', { size: 13 })} Cần hỗ trợ
            </a>
          </div>
        </article>`;
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
      const tool = b.dataset.tool || 'nofog';
      b.disabled = true;
      b.textContent = 'Đang tạo lệnh...';
      try {
        // XAGrant có endpoint + bộ cài riêng (thư mục, EXE, shortcut khác hẳn)
        const endpoint = tool === 'xagrant'
          ? `/api/licenses/${encodeURIComponent(key)}/xg-install-token`
          : `/api/licenses/${encodeURIComponent(key)}/install-token`;
        const r = await api(endpoint, { method: 'POST' });
        const zone = host.querySelector(`#zone-${CSS.escape(key)}`);
        const one = r.oneLiner || r.cmd;
        const isCmdOnly = tool === 'xagrant';
        zone.innerHTML = `
          <div class="install-box">
            <div class="install-eyebrow">${icon('zap', { size: 13 })} Cài đặt một lệnh — xong</div>
            <div class="cmd-block">${esc(one)}</div>
            <div class="btn-row mt-2">
              <button class="btn btn-primary btn-sm" data-copyone="${esc(one)}">
                ${icon('copy', { size: 13 })} Sao chép lệnh
              </button>
              <a class="btn btn-ghost btn-sm" href="${esc(r.downloadPs1)}" download>
                ${icon('download', { size: 13 })} Tải .ps1
              </a>
              <a class="btn btn-ghost btn-sm" href="${esc(r.exeUrl)}" download>
                ${icon('download', { size: 13 })} File .exe
              </a>
            </div>
            <p class="note mt-1">
              Lệnh có hiệu lực <strong>24 giờ</strong>. Mỗi lần lấy sẽ tạo lệnh mới.
              ${isCmdOnly
                ? 'Tool tự tải, tự cài, tự kích hoạt và tạo shortcut CMD ngoài Desktop.'
                : 'Tool tự tải, tự cài, tự kích hoạt và tạo shortcut ngoài Desktop.'}
            </p>
          </div>
          <details class="guide">
            <summary>
              ${icon('book', { size: 13 })} Hướng dẫn 3 bước
              ${icon('chevronDown', { size: 13, cls: 'chev' })}
            </summary>
            <div class="guide-body">
              <ol>
                <li>Bấm <strong>Win + R</strong> (phím Windows + phím R).</li>
                <li>Dán lệnh vào ô vừa hiện ra rồi nhấn <strong>Enter</strong>.</li>
                <li>Windows hỏi quyền — bấm <strong>Yes</strong>.</li>
              </ol>
              <p>
                Chờ khoảng 20 giây. Khi thấy <strong>“HOÀN TẤT”</strong> là xong —
                shortcut <strong>${isCmdOnly ? 'XArena Grant' : 'XARENA MAP SÁNG'}</strong>
                đã có ngoài Desktop.
              </p>
              ${isCmdOnly ? `<p>
                Tool này chạy <strong>bằng cửa sổ CMD</strong> — mở shortcut là có sẵn
                dòng lệnh, gõ <span class="mono">t 500</span> để thêm thịt,
                <span class="mono">help</span> để xem mọi lệnh.
              </p>` : ''}
            </div>
          </details>`;

        zone.querySelectorAll('[data-copyone]').forEach((cb) => {
          cb.onclick = async () => {
            const ok = await copyText(cb.dataset.copyone);
            toast(ok ? 'Đã sao chép. Bấm Win+R, dán vào, Enter.' : 'Không sao chép được',
              ok ? 'success' : 'error', 5000);
          };
        });
      } catch (e) {
        toast(e.message, 'error', 6000);
        b.disabled = false;
        b.innerHTML = `${icon('zap', { size: 14 })} Lấy lệnh cài đặt tự động`;
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

        // Server trả sẵn câu lệnh đúng với từng tool (No Fog / XAGrant).
        // Trước đây frontend tự dựng chuỗi và hardcode tên EXE No Fog.
        const token = r.token || '';
        const cmd = r.command
          || `xa_nofog_pro.exe --rebind ${key} ${token}`;
        const isCmdTool = r.tool === 'xagrant';

        openModal(`
          <div class="modal-title">Mã đổi máy đã tạo</div>
          <div class="modal-sub">
            Chạy lệnh dưới đây <strong>trên máy mới</strong> — máy bạn muốn chuyển sang.
          </div>

          <div class="field">
            <div class="label" id="rb-cmd-label">Lệnh đổi máy</div>
            <div class="cmd-block" id="rb-cmd" role="group" aria-labelledby="rb-cmd-label">
              ${esc(cmd)}
            </div>
          </div>

          <div class="alert alert-warn">
            <span class="ico">${icon('clock', { size: 15 })}</span>
            <span>Mã chỉ dùng được <strong>1 lần</strong>, hết hạn sau <strong>30 phút</strong>.
            Không chia sẻ mã này cho ai.</span>
          </div>

          <div class="alert alert-info">
            <span class="ico">${icon('info', { size: 15 })}</span>
            <span>${isCmdTool
              ? 'Chưa cài tool trên máy mới? Chạy lệnh trên trong cửa sổ <strong>CMD</strong> (Win+R → cmd).'
              : 'Chưa cài tool trên máy mới? Tải file cài rồi chạy lệnh trên trong thư mục cài đặt, hoặc dùng <strong>Đổi máy</strong> trong menu tool.'}</span>
          </div>

          <div class="btn-row end">
            <button class="btn btn-ghost" data-close>Đóng</button>
            <button class="btn btn-primary" data-copycmd>
              ${icon('copy', { size: 14 })} Sao chép lệnh
            </button>
          </div>
        `, {
          onMount(overlay, close) {
            overlay.querySelector('[data-close]').onclick = close;
            overlay.querySelector('[data-copycmd]').onclick = async () => {
              const okc = await copyText(cmd);
              toast(okc ? 'Đã sao chép lệnh đổi máy' : 'Không sao chép được',
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

/** Số đếm nhỏ (rebinds) — giữ dạng số, không dùng định dạng tiền. */
function fmtCount(n) {
  return new Intl.NumberFormat('vi-VN').format(Number(n) || 0);
}
