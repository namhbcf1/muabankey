# -*- coding: utf-8 -*-
"""Thay showTrialModal bằng startTrialFlow (gọi API thật)."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'home.js'
lines = f.read_text(encoding='utf-8').split('\n')

# Tìm từ comment bắt đầu showTrialModal đến hết hàm
start = None
end = None
for i, l in enumerate(lines):
    if l.strip().startswith('/**') and i + 2 < len(lines) and 'Modal hướng dẫn dùng thử' in lines[i + 1]:
        start = i
    if start is not None and l.startswith('export async function mountHome'):
        end = i
        break

if start is None or end is None:
    print('KHONG TIM THAY', start, end)
    raise SystemExit(1)

print(f'Thay dong {start + 1} den {end}')

NEW = r'''/**
 * Bắt đầu dùng thử: gọi API thật, rồi hướng dẫn tải tool.
 *
 * kind: '1h' | '3d'
 * onDone: callback reload quota sau khi xong
 */
async function startTrialFlow(kind, onDone) {
  const label = kind === '1h' ? '1 giờ' : '3 ngày';

  // Chưa đăng nhập -> chuyển sang đăng nhập rồi quay lại
  if (!state.user) {
    openModal(`
      <div class="modal-title">Cần tài khoản để dùng thử</div>
      <div class="modal-sub">
        Miễn phí, chỉ cần tài khoản + mật khẩu. Không cần email, không cần thẻ.
      </div>
      <div class="alert alert-info" style="margin-bottom:18px">
        <span class="ico">💡</span>
        <span>Mỗi tài khoản được <strong>10 lượt dùng thử ${label}</strong>.</span>
      </div>
      <div class="flex gap-1" style="justify-content:space-between;flex-wrap:wrap">
        <button class="btn btn-ghost" data-close>Để sau</button>
        <button class="btn btn-primary" data-reg>Đăng ký ngay</button>
      </div>
    `, {
      onMount(overlay, close) {
        overlay.querySelector('[data-close]').onclick = close;
        overlay.querySelector('[data-reg]').onclick = () => {
          close();
          navigate('/register?redirect=/');
        };
      },
    });
    return;
  }

  // Đã đăng nhập -> gọi API
  try {
    const data = await api('/api/trial/start', {
      method: 'POST',
      body: { kind, app: 'XArena No Fog', ver: '1.3.0' },
    });

    const key = data.key;
    const left = data.left;
    const quota = data.quota;

    openModal(`
      <div class="modal-title">✅ Đã bật dùng thử ${label}</div>
      <div class="modal-sub">
        Còn <strong>${left}/${quota}</strong> lượt dùng thử ${label}.
      </div>

      <div class="field">
        <label class="label">Mã dùng thử của bạn</label>
        <div class="mono" style="font-size:14px;letter-spacing:.06em;background:rgba(34,197,94,.08);
          padding:12px;border-radius:9px;border:1px solid rgba(34,197,94,.3);text-align:center;font-weight:700">
          ${esc(key)}
        </div>
      </div>

      <div style="font-size:13px;color:var(--text-dim);line-height:1.9;margin-bottom:14px">
        <strong>Bước tiếp theo:</strong><br>
        1. Tải tool bên dưới<br>
        2. Chạy tool — nó tự nhận mã này<br>
        3. Mở game AoE là dùng được
      </div>

      <div class="flex gap-1" style="flex-wrap:wrap;margin-bottom:14px">
        <a class="btn btn-primary btn-sm" href="${esc(location.origin)}/download/xa_nofog_pro.exe" download>
          ⬇️ Tải tool (12 MB)
        </a>
        <button class="btn btn-ghost btn-sm" data-copykey>📋 Copy mã</button>
      </div>

      <div class="alert alert-warn" style="margin-bottom:16px">
        <span class="ico">⏳</span>
        <span>Thời gian bắt đầu tính <strong>từ lần đầu chạy tool</strong>, không phải bây giờ.
        Mã này gắn với máy đầu tiên kích hoạt.</span>
      </div>

      <div class="flex gap-1" style="justify-content:flex-end">
        <button class="btn btn-ghost" data-close>Đóng</button>
        <button class="btn btn-primary" data-golink>Xem bảng giá →</button>
      </div>
    `, {
      onMount(overlay, close) {
        overlay.querySelector('[data-close]').onclick = close;
        overlay.querySelector('[data-golink]').onclick = () => {
          close();
          navigate('/products?category=license-xarena');
        };
        overlay.querySelector('[data-copykey]').onclick = async () => {
          const okc = await copyText(key);
          toast(okc ? 'Đã copy mã dùng thử' : 'Không copy được',
            okc ? 'success' : 'error');
        };
      },
    });

    if (onDone) await onDone();
  } catch (e) {
    const msg = e.message || 'Không bật được dùng thử';
    const isQuota = /hết.*lượt|quota/i.test(msg);
    openModal(`
      <div class="modal-title">${isQuota ? 'Đã hết lượt dùng thử' : 'Không bật được dùng thử'}</div>
      <div class="modal-sub">${esc(msg)}</div>
      ${isQuota ? `
        <div class="alert alert-info" style="margin-bottom:16px">
          <span class="ico">💡</span>
          <span>Mua key để tiếp tục dùng không giới hạn.</span>
        </div>` : ''}
      <div class="flex gap-1" style="justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-ghost" data-close>Đóng</button>
        ${isQuota ? '<button class="btn btn-primary" data-golink>Mua key →</button>' : ''}
      </div>
    `, {
      onMount(overlay, close) {
        overlay.querySelector('[data-close]').onclick = close;
        const g = overlay.querySelector('[data-golink]');
        if (g) g.onclick = () => { close(); navigate('/products?category=license-xarena'); };
      },
    });
  }
}

'''

new_lines = lines[:start] + NEW.split('\n') + lines[end:]
f.write_text('\n'.join(new_lines), encoding='utf-8')
print('Da thay the')
