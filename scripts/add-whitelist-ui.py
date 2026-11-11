# -*- coding: utf-8 -*-
"""Thêm tab Whitelist vào admin UI."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'admin.js'
s = f.read_text(encoding='utf-8')

if 'renderWhitelist' in s:
    print('· đã có renderWhitelist')
    raise SystemExit(0)

# 1. Thêm vào NAV
old_nav = "  ['trial', '🎁', 'Dùng thử'],"
new_nav = "  ['trial', '🎁', 'Dùng thử'],\n  ['whitelist', '⭐', 'Vô hạn'],"
if old_nav in s:
    s = s.replace(old_nav, new_nav, 1)
    print('✓ NAV')
else:
    print('✗ không thấy NAV trial')

# 2. Thêm dispatch
old_disp = "    else if (tab === 'trial') await renderTrial(host);"
new_disp = ("    else if (tab === 'trial') await renderTrial(host);\n"
            "    else if (tab === 'whitelist') await renderWhitelist(host);")
if old_disp in s:
    s = s.replace(old_disp, new_disp, 1)
    print('✓ dispatch')
else:
    print('✗ không thấy dispatch trial')

# 3. Thêm hàm renderWhitelist trước renderTrial
UI = r'''
/* ---------------- Whitelist: dùng thử vô hạn ---------------- */
async function renderWhitelist(host) {
  const SCOPE_LABEL = {
    weak: 'Weak HWID (máy)',
    hwid: 'HWID đầy đủ',
    device: 'Device ID (browser)',
    user: 'Tài khoản',
    ip: 'Địa chỉ IP',
  };

  const load = async () => {
    const d = await api('/api/admin/trial/whitelist');
    const entries = d.entries || [];

    host.innerHTML = `
      <div class="panel">
        <div class="panel-title">⭐ Dùng thử vô hạn (${entries.length})</div>
        <p class="sec-desc" style="margin-bottom:16px">
          Máy / tài khoản trong danh sách này <strong>không bị giới hạn số lượt</strong>.
          Dùng cho máy lập trình, test nội bộ. Khách thật không ảnh hưởng.
        </p>

        <div class="flex gap-1 mb-2" style="flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" data-add>+ Thêm</button>
          <button class="btn btn-ghost btn-sm" data-thisdev>⭐ Whitelist máy tôi đang dùng</button>
        </div>

        ${entries.length === 0 ? `
          <div style="text-align:center;padding:32px;color:var(--text-mute)">
            Chưa có mục nào
          </div>` : `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Loại</th><th>Giá trị</th><th>Ghi chú</th><th></th></tr>
            </thead>
            <tbody>
              ${entries.map((e) => `
                <tr>
                  <td><span class="pill pill-blue" style="font-size:10.5px">${esc(SCOPE_LABEL[e.scope] || e.scope)}</span></td>
                  <td class="mono" style="font-size:11px;word-break:break-all">${esc(e.value)}</td>
                  <td style="font-size:12px;color:var(--text-mute)">${esc(e.note || '')}</td>
                  <td>
                    <button class="btn btn-danger btn-sm"
                      data-del data-scope="${esc(e.scope)}" data-value="${esc(e.value)}">Xoá</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    `;

    // Thêm
    host.querySelector('[data-add]').onclick = () => {
      openModal(`
        <div class="modal-title">Thêm vào whitelist</div>
        <div class="modal-sub">Máy này sẽ dùng thử vô hạn lần</div>

        <div class="field">
          <label class="label">Loại</label>
          <select class="select" id="wl-scope">
            <option value="weak">Weak HWID (máy — ổn định nhất)</option>
            <option value="hwid">HWID đầy đủ</option>
            <option value="device">Device ID (browser)</option>
            <option value="user">Tài khoản (username hoặc ID)</option>
            <option value="ip">Địa chỉ IP</option>
          </select>
        </div>

        <div class="field">
          <label class="label">Giá trị</label>
          <input class="input mono" id="wl-value" placeholder="Dán giá trị vào đây">
          <div class="form-hint" id="wl-hint">
            Chạy <code>xa_nofog_pro.exe --status</code> để xem HWID máy.
          </div>
        </div>

        <div class="field">
          <label class="label">Ghi chú</label>
          <input class="input" id="wl-note" placeholder="VD: Máy test của tôi">
        </div>

        <div class="flex gap-1" style="justify-content:flex-end">
          <button class="btn btn-ghost" data-cancel>Huỷ</button>
          <button class="btn btn-primary" data-ok>Thêm</button>
        </div>
      `, {
        onMount(overlay, close) {
          const hint = overlay.querySelector('#wl-hint');
          overlay.querySelector('#wl-scope').onchange = (e) => {
            const v = e.target.value;
            hint.innerHTML = v === 'ip'
              ? 'IP công cộng của bạn (xem tại whatismyip.com)'
              : v === 'user'
                ? 'Username hoặc user ID'
                : 'Chạy <code>xa_nofog_pro.exe --status</code> để xem HWID máy';
          };
          overlay.querySelector('[data-cancel]').onclick = close;
          overlay.querySelector('[data-ok]').onclick = async () => {
            const scope = overlay.querySelector('#wl-scope').value;
            const value = overlay.querySelector('#wl-value').value.trim();
            const note = overlay.querySelector('#wl-note').value.trim();
            if (!value) { toast('Nhập giá trị', 'error'); return; }
            try {
              await api('/api/admin/trial/whitelist', {
                method: 'POST',
                body: { scope, value, note },
              });
              toast('Đã thêm vào whitelist', 'success');
              close();
              await load();
            } catch (e) { toast(e.message, 'error', 6000); }
          };
        },
      });
    };

    // Whitelist máy đang dùng (theo IP)
    host.querySelector('[data-thisdev]').onclick = async () => {
      try {
        const r = await api('/api/admin/trial/whitelist/this-device', { method: 'POST' });
        if (r.added) {
          toast(`Đã whitelist IP ${r.value}`, 'success', 6000);
          await load();
        } else {
          toast('Không lấy được IP', 'error');
        }
      } catch (e) { toast(e.message, 'error', 6000); }
    };

    // Xoá
    host.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm(`Xoá "${b.dataset.value}" khỏi whitelist?`)) return;
        try {
          await api(`/api/admin/trial/whitelist?scope=${encodeURIComponent(b.dataset.scope)}&value=${encodeURIComponent(b.dataset.value)}`,
            { method: 'DELETE' });
          toast('Đã xoá', 'success');
          await load();
        } catch (e) { toast(e.message, 'error', 6000); }
      };
    });
  };

  await load();
}

'''
anchor = "/* ---------------- Trial (dùng thử) ---------------- */"
if anchor in s:
    s = s.replace(anchor, UI + anchor, 1)
    print('✓ renderWhitelist')
else:
    print('✗ không thấy anchor Trial')

f.write_text(s, encoding='utf-8')
