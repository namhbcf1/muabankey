/** Trang ví & nạp tiền VietQR. */
import { api, esc, fmtVnd, fmtDate, toast, navigate, loadingBlock, copyText, emptyBlock } from '../lib.js';
import { icon } from '../icons.js';
import { state, refreshBalance } from '../state.js';

// icon + nhãn cho từng loại giao dịch; chiều tiền suy ra từ dấu của amount.
const TYPE_MAP = {
  topup: ['plus', 'Nạp tiền'],
  purchase: ['bag', 'Mua hàng'],
  refund: ['undo', 'Hoàn tiền'],
  admin_credit: ['plus', 'Admin cộng'],
  admin_debit: ['minus', 'Admin trừ'],
};

export function renderWallet() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <nav class="pd-breadcrumb" aria-label="Đường dẫn">
        <a href="#/">Trang chủ</a><span>/</span><span>Ví &amp; Nạp tiền</span>
      </nav>
      <div class="page-head">
        <div>
          <h1 class="page-title">Ví &amp; Nạp tiền</h1>
          <p class="page-desc">Nạp tiền bằng VietQR và theo dõi toàn bộ giao dịch của ví.</p>
        </div>
      </div>
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
    host.innerHTML = emptyBlock({ ico: 'alert', title: e.message || 'Không tải được ví' });
    return;
  }

  host.innerHTML = `
    <div class="checkout-grid">
      <div>
        <div class="panel">
          <div class="bal-label">Số dư ví</div>
          <div class="bal-value">${fmtVnd(data.balance)}</div>
          <div class="def-list mt-3">
            <div class="def-row">
              <span class="k">${icon('download', { size: 13 })} Tổng nạp</span>
              <span class="v"><strong class="text-green">${fmtVnd(data.summary.income)}</strong></span>
            </div>
            <div class="def-row">
              <span class="k">${icon('upload', { size: 13 })} Tổng chi</span>
              <span class="v"><strong class="text-red">${fmtVnd(data.summary.expense)}</strong></span>
            </div>
          </div>
        </div>

        <div class="panel mt-2">
          <h2 class="panel-title">${icon('receipt', { size: 15 })} Lịch sử giao dịch</h2>
          ${data.transactions.length === 0
            ? emptyBlock({ ico: 'inbox', title: 'Chưa có giao dịch', desc: 'Nạp tiền lần đầu để bắt đầu mua key.' })
            : `<div class="tx-list">
                ${data.transactions.map((t) => {
                  const [ico, label] = TYPE_MAP[t.type] || ['activity', t.type];
                  const positive = t.amount > 0;
                  return `
                  <div class="tx-row">
                    <span class="ic-box">${icon(ico, { size: 15 })}</span>
                    <div class="tx-info">
                      <div class="tx-name">${esc(t.description || label)}</div>
                      <div class="tx-meta">${esc(fmtDate(t.createdAt))}${t.reference ? ' · ' + esc(t.reference) : ''}</div>
                    </div>
                    <div class="tx-amt">
                      <div class="v ${positive ? 'text-green' : 'text-red'}">${positive ? '+' : ''}${fmtVnd(t.amount)}</div>
                      <div class="b">Số dư: ${fmtVnd(t.balanceAfter)}</div>
                    </div>
                  </div>`;
                }).join('')}
              </div>`}
        </div>
      </div>

      <div>
        <div class="panel" id="topup-panel">
          <h2 class="panel-title">${icon('wallet', { size: 15 })} Nạp tiền vào ví</h2>
          <div id="topup-form-area">
            <div class="field">
              <label class="label" for="topup-amount">Số tiền muốn nạp</label>
              <input class="input" id="topup-amount" type="text" inputmode="numeric"
                placeholder="Nhập số tiền (VND)" value="200.000"
                aria-describedby="topup-amount-hint">
              <span class="form-hint" id="topup-amount-hint">Tối thiểu 20.000₫.</span>
            </div>
            <div class="chip-row">
              ${[100000, 200000, 500000, 1000000, 2000000].map((v) => `
                <button class="cat-chip" type="button" data-quick="${v}">${new Intl.NumberFormat('vi-VN').format(v)}₫</button>`).join('')}
            </div>
            <button class="btn btn-primary btn-block" id="btn-create-topup">
              ${icon('zap', { size: 14 })} Tạo mã QR nạp tiền
            </button>
            <div class="alert alert-info mt-2">
              <span class="ico">${icon('info', { size: 15 })}</span>
              <span>Tiền vào ví tự động trong 1–2 phút sau khi chuyển khoản đúng nội dung.</span>
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
      btn.innerHTML = `${icon('zap', { size: 14 })} Tạo mã QR nạp tiền`;
    }
  };
}

/* ---------- Khung QR + thông tin chuyển khoản ---------- */
function showQr(host, t) {
  const form = host.querySelector('#topup-form-area');
  const qr = host.querySelector('#topup-qr-area');
  form.style.display = 'none';
  qr.style.display = 'block';

  qr.innerHTML = `
    <div class="qr-wrap">
      <div class="qr-plate">
        <img src="${esc(t.qrUrl)}" alt="Mã QR nạp tiền ${fmtVnd(t.amount)}" width="220" height="220">
        <div class="qr-fail">Không tải được mã QR</div>
      </div>
      <div class="qr-amt">${fmtVnd(t.amount)}</div>
      <div class="qr-hint">Quét mã bằng ứng dụng ngân hàng</div>
    </div>

    <div class="def-list mt-3">
      <div class="def-row">
        <span class="k">Ngân hàng</span>
        <span class="v"><strong>${esc(t.bank.name)}</strong></span>
      </div>
      <div class="def-row">
        <span class="k">Số tài khoản</span>
        <span class="v">
          <strong class="mono">${esc(t.bank.account)}</strong>
          <button class="key-copy" data-copy="${esc(t.bank.account)}" aria-label="Sao chép số tài khoản">
            ${icon('copy', { size: 12 })}
          </button>
        </span>
      </div>
      <div class="def-row">
        <span class="k">Chủ tài khoản</span>
        <span class="v"><strong>${esc(t.bank.owner)}</strong></span>
      </div>
      <div class="def-row">
        <span class="k">Nội dung CK</span>
        <span class="v">
          <strong class="mono text-gold">${esc(t.memo)}</strong>
          <button class="key-copy" data-copy="${esc(t.memo)}" aria-label="Sao chép nội dung chuyển khoản">
            ${icon('copy', { size: 12 })}
          </button>
        </span>
      </div>
    </div>

    <div class="alert alert-warn mt-2">
      <span class="ico">${icon('alert', { size: 15 })}</span>
      <span>Chuyển <strong>đúng số tiền</strong> và <strong>đúng nội dung</strong>
      <span class="mono">${esc(t.memo)}</span> để hệ thống tự động cộng tiền.</span>
    </div>

    <div id="topup-status" class="qr-status" role="status" aria-live="polite">
      ${icon('clock', { size: 14 })}<span>Đang chờ thanh toán…</span>
    </div>

    <button class="btn btn-ghost btn-block mt-2" id="btn-cancel-topup">Quay lại</button>
  `;

  // Ảnh QR hỏng -> đổi sang thông báo chữ, không phá bố cục.
  const plate = qr.querySelector('.qr-plate');
  const img = plate.querySelector('img');
  img.onerror = () => {
    plate.classList.add('is-failed');
    img.removeAttribute('src');
  };

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
    btn.innerHTML = `${icon('zap', { size: 14 })} Tạo mã QR nạp tiền`;
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
        if (el) {
          el.className = 'qr-status ok';
          el.innerHTML = `${icon('checkCircle', { size: 14 })}<span>Đã nhận được tiền. Số dư đã cập nhật.</span>`;
        }
        toast(`Nạp thành công ${fmtVnd(res.topup.amount)}!`, 'success', 5000);
        await refreshBalance();
        setTimeout(() => mountWallet({ querySelector: () => host.closest('#wallet-content') || document.body }), 1800);
      } else if (res.topup.status === 'expired') {
        clearInterval(timer);
        if (el) {
          el.className = 'qr-status expired';
          el.innerHTML = `${icon('alert', { size: 14 })}<span>Mã đã hết hạn. Vui lòng tạo lại.</span>`;
        }
      } else if (el) {
        const left = Math.max(0, Math.floor((res.topup.expiresAt - Date.now()) / 1000));
        el.className = 'qr-status';
        el.innerHTML = `${icon('clock', { size: 14 })}<span>Đang chờ thanh toán… (${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')})</span>`;
      }
    } catch { /* ignore */ }
  }, 4000);
}
