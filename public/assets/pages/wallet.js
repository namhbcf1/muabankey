/** Trang ví & nạp tiền VietQR. */
import { api, esc, fmtVnd, fmtDate, toast, navigate, loadingBlock, copyText } from '../lib.js';
import { state, refreshBalance } from '../state.js';

const TYPE_MAP = {
  topup: ['💰', 'Nạp tiền', 'text-green'],
  purchase: ['🛍️', 'Mua hàng', 'text-red'],
  refund: ['↩️', 'Hoàn tiền', 'text-green'],
  admin_credit: ['➕', 'Admin cộng', 'text-green'],
  admin_debit: ['➖', 'Admin trừ', 'text-red'],
};

export function renderWallet() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <div class="pd-breadcrumb"><a href="#/">Trang chủ</a><span>/</span><span>Ví & Nạp tiền</span></div>
      <div id="wallet-content">${loadingBlock()}</div>
    </div>
  </section>
  <div id="site-footer"></div>`;
}

export async function mountWallet(root) {
  const host = root.querySelector('#wallet-content');
  if (!state.user) { navigate('/login?redirect=/wallet', { replace: true }); return; }

  let data;
  try {
    data = await api('/api/wallet?perPage=30');
  } catch (e) {
    host.innerHTML = `<div class="empty-state"><div class="ico">⚠️</div><div class="t">${esc(e.message)}</div></div>`;
    return;
  }

  host.innerHTML = `
    <div class="checkout-grid">
      <div>
        <div class="panel" style="background:linear-gradient(135deg,rgba(34,197,94,.13),rgba(34,211,238,.07));border-color:rgba(34,197,94,.28)">
          <div style="font-size:12.5px;color:var(--text-dim);font-weight:700;margin-bottom:6px">SỐ DƯ VÍ</div>
          <div style="font-size:2.4rem;font-weight:800;letter-spacing:-.04em;color:#4ade80;font-variant-numeric:tabular-nums">
            ${fmtVnd(data.balance)}
          </div>
          <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
            <span style="font-size:12.5px;color:var(--text-mute)">💰 Tổng nạp: <strong class="text-green">${fmtVnd(data.summary.income)}</strong></span>
            <span style="font-size:12.5px;color:var(--text-mute)">🛍️ Tổng chi: <strong class="text-red">${fmtVnd(data.summary.expense)}</strong></span>
          </div>
        </div>

        <div class="panel mt-2">
          <div class="panel-title">📜 Lịch sử giao dịch</div>
          ${data.transactions.length === 0
            ? `<div class="empty-state" style="padding:36px 20px"><div class="ico">📭</div><div class="t">Chưa có giao dịch</div></div>`
            : `<div style="display:flex;flex-direction:column;gap:9px">
                ${data.transactions.map((t) => {
                  const [ico, label, cls] = TYPE_MAP[t.type] || ['•', t.type, ''];
                  return `
                  <div class="flex justify-between items-center" style="gap:12px;padding:12px;border-radius:11px;background:rgba(255,255,255,.032);border:1px solid var(--border)">
                    <div class="flex items-center gap-1" style="min-width:0">
                      <div style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.06);font-size:15px;flex-shrink:0">${ico}</div>
                      <div style="min-width:0">
                        <div style="font-size:13.5px;font-weight:700">${esc(t.description || label)}</div>
                        <div style="font-size:11.5px;color:var(--text-mute)">${fmtDate(t.createdAt)}${t.reference ? ' · ' + esc(t.reference) : ''}</div>
                      </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                      <div class="${t.amount > 0 ? 'text-green' : 'text-red'}" style="font-size:14px;font-weight:800;font-variant-numeric:tabular-nums">
                        ${t.amount > 0 ? '+' : ''}${fmtVnd(t.amount)}
                      </div>
                      <div style="font-size:11px;color:var(--text-mute)">Số dư: ${fmtVnd(t.balanceAfter)}</div>
                    </div>
                  </div>`;
                }).join('')}
              </div>`}
        </div>
      </div>

      <div>
        <div class="panel" id="topup-panel">
          <div class="panel-title">💰 Nạp tiền vào ví</div>
          <div id="topup-form-area">
            <div class="field">
              <label class="label" for="topup-amount">Số tiền muốn nạp</label>
              <input class="input" id="topup-amount" type="text" inputmode="numeric" placeholder="Nhập số tiền (VND)" value="200000">
            </div>
            <div class="flex gap-1 mb-2" style="flex-wrap:wrap">
              ${[100000, 200000, 500000, 1000000, 2000000].map((v) => `
                <button class="btn btn-ghost btn-sm" data-quick="${v}">${new Intl.NumberFormat('vi-VN').format(v)}₫</button>`).join('')}
            </div>
            <button class="btn btn-primary btn-block" id="btn-create-topup">Tạo mã QR nạp tiền</button>
            <div class="alert alert-info mt-2" style="margin-bottom:0;font-size:12.5px">
              <span class="ico">ℹ️</span>
              <span>Tiền vào ví tự động trong 1-2 phút sau khi chuyển khoản đúng nội dung.</span>
            </div>
          </div>
          <div id="topup-qr-area" style="display:none"></div>
        </div>
      </div>
    </div>
  `;

  const amountInput = host.querySelector('#topup-amount');
  amountInput.addEventListener('input', () => {
    const digits = amountInput.value.replace(/\D/g, '');
    amountInput.value = digits ? new Intl.NumberFormat('vi-VN').format(Number(digits)) : '';
  });

  host.querySelectorAll('[data-quick]').forEach((b) => {
    b.onclick = () => {
      amountInput.value = new Intl.NumberFormat('vi-VN').format(Number(b.dataset.quick));
    };
  });

  host.querySelector('#btn-create-topup').onclick = async () => {
    const amount = Number(amountInput.value.replace(/\D/g, ''));
    if (!amount || amount < 20000) { toast('Số tiền tối thiểu 20.000₫', 'error'); return; }

    const btn = host.querySelector('#btn-create-topup');
    btn.disabled = true;
    btn.textContent = 'Đang tạo...';
    try {
      const res = await api('/api/wallet/topup', { method: 'POST', body: { amount } });
      showQr(host, res.topup);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Tạo mã QR nạp tiền';
    }
  };
}

function showQr(host, t) {
  const form = host.querySelector('#topup-form-area');
  const qr = host.querySelector('#topup-qr-area');
  form.style.display = 'none';
  qr.style.display = 'block';

  qr.innerHTML = `
    <div style="text-align:center">
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:12px">Quét mã QR bằng app ngân hàng</div>
      <div style="padding:14px;border-radius:16px;background:#fff;display:inline-block;margin-bottom:14px">
        <img src="${esc(t.qrUrl)}" alt="Mã QR nạp tiền" style="width:220px;height:220px;object-fit:contain"
          onerror="this.parentElement.innerHTML='<div style=color:#000;padding:40px>Không tải được QR</div>'">
      </div>
      <div style="font-size:1.5rem;font-weight:800;color:#4ade80;margin-bottom:14px">${fmtVnd(t.amount)}</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:9px;font-size:13.5px">
      <div class="flex justify-between"><span class="text-mute">Ngân hàng</span><strong>${esc(t.bank.name)}</strong></div>
      <div class="flex justify-between items-center">
        <span class="text-mute">Số tài khoản</span>
        <span class="flex items-center gap-1">
          <strong class="mono">${esc(t.bank.account)}</strong>
          <button class="key-copy" style="padding:3px 9px;font-size:11px" data-copy="${esc(t.bank.account)}">📋</button>
        </span>
      </div>
      <div class="flex justify-between"><span class="text-mute">Chủ tài khoản</span><strong>${esc(t.bank.owner)}</strong></div>
      <div class="flex justify-between items-center">
        <span class="text-mute">Nội dung CK</span>
        <span class="flex items-center gap-1">
          <strong class="mono" style="color:#fbbf24">${esc(t.memo)}</strong>
          <button class="key-copy" style="padding:3px 9px;font-size:11px" data-copy="${esc(t.memo)}">📋</button>
        </span>
      </div>
    </div>

    <div class="alert alert-warn mt-2" style="margin-bottom:0;font-size:12.5px">
      <span class="ico">⚠️</span>
      <span>Chuyển <strong>đúng số tiền</strong> và <strong>đúng nội dung</strong> <span class="mono">${esc(t.memo)}</span> để hệ thống tự động cộng tiền.</span>
    </div>

    <div id="topup-status" class="mt-2" style="text-align:center;font-size:13px;color:var(--text-mute)">
      ⏳ Đang chờ thanh toán...
    </div>

    <button class="btn btn-ghost btn-block mt-2" id="btn-cancel-topup" style="font-size:13px">Quay lại</button>
  `;

  qr.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      const ok = await copyText(b.dataset.copy);
      toast(ok ? 'Đã sao chép' : 'Không sao chép được', ok ? 'success' : 'error');
    };
  });

  qr.querySelector('#btn-cancel-topup').onclick = () => {
    qr.style.display = 'none';
    form.style.display = 'block';
    const btn = host.querySelector('#btn-create-topup');
    btn.disabled = false;
    btn.textContent = 'Tạo mã QR nạp tiền';
  };

  // Poll trạng thái
  let polls = 0;
  const timer = setInterval(async () => {
    polls++;
    if (polls > 60 || !document.body.contains(qr)) { clearInterval(timer); return; }
    try {
      const res = await api('/api/wallet/topup/' + t.id);
      const el = document.getElementById('topup-status');
      if (res.topup.status === 'paid') {
        clearInterval(timer);
        if (el) el.innerHTML = '<span class="text-green" style="font-weight:800">✅ Đã nhận được tiền! Số dư đã được cập nhật.</span>';
        toast(`Nạp thành công ${fmtVnd(res.topup.amount)}!`, 'success', 5000);
        await refreshBalance();
        setTimeout(() => mountWallet({ querySelector: () => host.closest('#wallet-content') || document.body }), 1800);
      } else if (res.topup.status === 'expired') {
        clearInterval(timer);
        if (el) el.innerHTML = '<span class="text-red">Mã đã hết hạn. Vui lòng tạo lại.</span>';
      } else if (el) {
        const left = Math.max(0, Math.floor((res.topup.expiresAt - Date.now()) / 1000));
        el.textContent = `⏳ Đang chờ thanh toán... (${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')})`;
      }
    } catch { /* ignore */ }
  }, 4000);
}
