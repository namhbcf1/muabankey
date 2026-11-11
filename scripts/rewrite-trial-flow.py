# -*- coding: utf-8 -*-
"""Thay startTrialFlow: bỏ đăng nhập, dùng lệnh CMD."""
import pathlib
import re

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'home.js'
s = f.read_text(encoding='utf-8')

# Tìm khối từ comment trước startTrialFlow đến hết hàm (trước export async function mountHome)
m = re.search(r"/\*\*\n \* Bắt đầu dùng thử.*?(?=export async function mountHome)", s, re.S)
if not m:
    m = re.search(r"async function startTrialFlow\(kind, onDone\) \{.*?(?=export async function mountHome)", s, re.S)
if not m:
    print('✗ không tìm thấy khối')
    raise SystemExit(1)

print(f'Tìm thấy khối: {len(m.group(0))} ký tự')

NEW = r'''/**
 * Bắt đầu dùng thử — KHÔNG đăng nhập, KHÔNG nhập gì.
 * Web gọi /api/trial/command, trả 1 dòng lệnh CMD cho khách copy.
 */
async function startTrialFlow(kind, onDone) {
  const label = kind === '1h' ? '1 giờ' : '3 ngày';

  openModal(`
    <div class="modal-title">Đang chuẩn bị dùng thử ${label}...</div>
    <div class="modal-sub">Vui lòng đợi vài giây</div>
  `, { onMount() {} });

  try {
    const data = await api('/api/trial/command', {
      method: 'POST',
      body: { kind },
    });
    showTrialCommand(data, label);
    if (onDone) await onDone();
  } catch (e) {
    showTrialError(e.message || 'Không tạo được lệnh dùng thử');
  }
}

function showTrialCommand(data, label) {
  const cmd = data.command || '';
  const key = data.key || '';

  openModal(`
    <div class="modal-title">Lệnh dùng thử ${label} đã sẵn sàng</div>
    <div class="modal-sub">
      Copy 1 dòng → dán vào CMD → Enter. Không cần nhập gì thêm.
    </div>

    <div class="field">
      <label class="label">Lệnh (copy nguyên dòng)</label>
      <div class="mono" style="font-size:11px;line-height:1.7;word-break:break-all;
        background:rgba(0,0,0,.5);padding:14px;border-radius:9px;
        border:1px solid rgba(74,222,128,.35);color:#4ade80;user-select:all">
        ${esc(cmd)}
      </div>
    </div>

    <button class="btn btn-primary btn-block btn-lg" data-copycmd style="margin-bottom:14px">
      Copy lệnh
    </button>

    <div class="alert alert-info" style="margin-bottom:14px">
      <span class="ico">${icon('info', { size: 15 })}</span>
      <span>
        <strong>Cách chạy:</strong><br>
        1. Bấm <strong>Copy lệnh</strong><br>
        2. Nhấn <kbd>Win</kbd>+<kbd>R</kbd> gõ <code class="mono">cmd</code> rồi Enter<br>
        3. Dán (<kbd>Ctrl</kbd>+<kbd>V</kbd>) rồi Enter<br>
        4. Windows hỏi quyền → bấm <strong>Yes</strong>
      </span>
    </div>

    <div class="alert alert-warn" style="margin-bottom:16px">
      <span class="ico">${icon('clock', { size: 15 })}</span>
      <span>
        Mã: <strong class="mono">${esc(key)}</strong><br>
        Còn <strong>${data.left}/${data.quota}</strong> lượt.
        Giờ bắt đầu tính từ lần chạy tool đầu tiên.
      </span>
    </div>

    <div class="flex gap-1" style="justify-content:space-between;flex-wrap:wrap">
      <button class="btn btn-ghost" data-golink>Mua key</button>
      <button class="btn btn-ghost" data-close>Đóng</button>
    </div>
  `, {
    onMount(overlay, close) {
      overlay.querySelector('[data-close]').onclick = close;
      overlay.querySelector('[data-golink]').onclick = () => {
        close();
        navigate('/products?category=license-xarena');
      };
      overlay.querySelector('[data-copycmd]').onclick = async () => {
        const okc = await copyText(cmd);
        toast(okc ? 'Đã copy — dán vào CMD và Enter'
          : 'Không copy được, chọn tay dòng lệnh',
          okc ? 'success' : 'error', 6000);
      };
    },
  });
}

function showTrialError(msg) {
  const isQuota = /hết.*lượt|hết lượt/i.test(msg);
  const isIp = /kết nối này|mạng này/i.test(msg);
  const isDevice = /máy này|máy ảo/i.test(msg);

  openModal(`
    <div class="modal-title">${isQuota ? 'Đã hết lượt dùng thử' : 'Không bật được dùng thử'}</div>
    <div class="modal-sub">${esc(msg)}</div>
    ${isQuota || isIp ? `
      <div class="alert alert-info" style="margin-bottom:16px">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span>Mua key để dùng không giới hạn — giao tự động 24/7.</span>
      </div>` : ''}
    ${isDevice ? `
      <div class="alert alert-warn" style="margin-bottom:16px">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span>Cần hỗ trợ? Zalo <strong>0836768597</strong></span>
      </div>` : ''}
    <div class="flex gap-1" style="justify-content:flex-end;flex-wrap:wrap">
      <button class="btn btn-ghost" data-close>Đóng</button>
      <button class="btn btn-primary" data-golink>Xem bảng giá</button>
    </div>
  `, {
    onMount(overlay, close) {
      overlay.querySelector('[data-close]').onclick = close;
      overlay.querySelector('[data-golink]').onclick = () => {
        close();
        navigate('/products?category=license-xarena');
      };
    },
  });
}

'''

s = s[:m.start()] + NEW + s[m.end():]
f.write_text(s, encoding='utf-8')
print('✓ đã thay')

# Kiểm tra mojibake
m2 = re.findall(r'[ÃÂÄ][\x80-\xbf]?', s)
print(f'Ký tự mojibake còn: {len(m2)}')
