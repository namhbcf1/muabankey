# -*- coding: utf-8 -*-
"""Thêm renderTrial vào admin.js."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'admin.js'
s = f.read_text(encoding='utf-8')

if 'async function renderTrial' in s:
    print('· đã có renderTrial')
    raise SystemExit(0)

TRIAL_UI = r'''
/* ---------------- Trial (dùng thử) ---------------- */
async function renderTrial(host) {
  let filter = '';

  const load = async () => {
    const d = await api('/api/admin/trial/accounts' + (filter ? '?q=' + encodeURIComponent(filter) : ''));
    const cfg = d.cfg || {};
    const accounts = d.accounts || [];

    const quota1h = cfg.t1h?.quota ?? 10;
    const quota3d = cfg.t3d?.quota ?? 10;

    // Thống kê
    const totalAccounts = accounts.length;
    const used1h = accounts.reduce((s, a) => s + (a.t1h?.used || 0), 0);
    const used3d = accounts.reduce((s, a) => s + (a.t3d?.used || 0), 0);

    host.innerHTML = `
      <div class="stat-grid">
        ${[
          ['👥', fmtNum(totalAccounts), 'Tài khoản đã dùng thử'],
          [`⏱️`, fmtNum(used1h), `Lượt 1 giờ đã dùng`],
          [`📅`, fmtNum(used3d), `Lượt 3 ngày đã dùng`],
          [`💰`, `${quota1h} + ${quota3d}`, `Lượt/tài khoản`],
        ].map(([ico, v, l]) => `
          <div class="stat-card">
            <div class="ico">${ico}</div>
            <div class="v">${v}</div>
            <div class="l">${l}</div>
          </div>`).join('')}
      </div>

      <div class="panel">
        <div class="flex justify-between items-center mb-2" style="flex-wrap:wrap;gap:10px">
          <div class="panel-title" style="margin:0">🎁 Dùng thử (${accounts.length})</div>
          <div class="flex gap-1">
            <input class="input" id="tq-search" placeholder="Tìm tài khoản..." style="width:200px"
              value="${esc(filter)}">
            <button class="btn btn-ghost btn-sm" id="tq-reload">↻</button>
          </div>
        </div>

        ${accounts.length === 0 ? `
          <div style="text-align:center;padding:36px;color:var(--text-mute)">
            Chưa có ai dùng thử
          </div>` : `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>⏱️ 1 giờ</th>
                <th>📅 3 ngày</th>
                <th>Tổng lượt</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${accounts.map((a) => `
                <tr>
                  <td>
                    <div style="font-weight:700;font-size:13px">${esc(a.username || a.email || a.userId.slice(0, 8))}</div>
                    <div style="font-size:11px;color:var(--text-mute)">${esc(a.fullName || '')}</div>
                    ${a.status !== 'active' ? `<span class="pill pill-red" style="font-size:10px">${esc(a.status)}</span>` : ''}
                  </td>
                  <td>
                    <div style="font-size:12.5px">
                      <strong>${a.t1h.used}/${a.t1h.quota}</strong>
                      ${a.t1h.left > 0 ? `<span style="color:#4ade80"> (còn ${a.t1h.left})</span>` : `<span style="color:#f87171"> (hết)</span>`}
                    </div>
                    ${a.t1h.banned ? '<span class="pill pill-red" style="font-size:10px">Bị chặn</span>' : ''}
                    ${a.t1h.resets > 0 ? `<div style="font-size:10.5px;color:var(--text-mute)">đã reset ${a.t1h.resets} lần</div>` : ''}
                  </td>
                  <td>
                    <div style="font-size:12.5px">
                      <strong>${a.t3d.used}/${a.t3d.quota}</strong>
                      ${a.t3d.left > 0 ? `<span style="color:#4ade80"> (còn ${a.t3d.left})</span>` : `<span style="color:#f87171"> (hết)</span>`}
                    </div>
                    ${a.t3d.banned ? '<span class="pill pill-red" style="font-size:10px">Bị chặn</span>' : ''}
                    ${a.t3d.resets > 0 ? `<div style="font-size:10.5px;color:var(--text-mute)">đã reset ${a.t3d.resets} lần</div>` : ''}
                  </td>
                  <td style="font-size:12.5px;color:var(--text-mute)">${a.totalUses}</td>
                  <td>
                    <div class="flex gap-1" style="flex-wrap:wrap">
                      ${(a.t1h.used > 0 || a.t3d.used > 0)
                        ? `<button class="btn btn-primary btn-sm" data-reset="${esc(a.userId)}" data-name="${esc(a.username || a.email || '')}">🔄 Reset</button>`
                        : ''}
                      <button class="btn btn-ghost btn-sm" data-uses="${esc(a.userId)}">📜 Lịch sử</button>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    `;

    const searchEl = host.querySelector('#tq-search');
    let timer = null;
    if (searchEl) {
      searchEl.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { filter = searchEl.value.trim(); load(); }, 400);
      };
    }
    host.querySelector('#tq-reload').onclick = load;

    // Reset trial
    host.querySelectorAll('[data-reset]').forEach((b) => {
      b.onclick = () => {
        const uid = b.dataset.reset;
        const name = b.dataset.name;
        openModal(`
          <div class="modal-title">🔄 Reset dùng thử</div>
          <div class="modal-sub">Tài khoản: <strong>${esc(name)}</strong></div>

          <div class="alert alert-warn" style="margin-bottom:14px">
            <span class="ico">⚠️</span>
            <span>Reset sẽ đưa lượt đã dùng về <strong>0</strong> và
            <strong>thu hồi</strong> license dùng thử đang chạy. Lịch sử vẫn được giữ.</span>
          </div>

          <div class="field">
            <label class="label">Reset loại nào?</label>
            <select class="select" id="rs-kinds">
              <option value="all">Cả hai (1 giờ + 3 ngày)</option>
              <option value="1h">Chỉ 1 giờ</option>
              <option value="3d">Chỉ 3 ngày</option>
            </select>
          </div>

          <div class="field">
            <label class="label">Lý do <span class="req">*</span></label>
            <input class="input" id="rs-reason" placeholder="VD: Khách báo lỗi không dùng được, đã xác minh">
            <div class="form-hint">Bắt buộc, lưu vào nhật ký để đối soát sau.</div>
          </div>

          <div class="field">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
              <input type="checkbox" id="rs-revoke" checked>
              <span>Thu hồi license dùng thử đang chạy</span>
            </label>
          </div>

          <div class="flex gap-1" style="justify-content:flex-end">
            <button class="btn btn-ghost" data-cancel>Huỷ</button>
            <button class="btn btn-primary" data-ok>Xác nhận reset</button>
          </div>
        `, {
          onMount(overlay, close) {
            overlay.querySelector('[data-cancel]').onclick = close;
            overlay.querySelector('[data-ok]').onclick = async () => {
              const reason = overlay.querySelector('#rs-reason').value.trim();
              if (reason.length < 10) {
                toast('Nhập lý do ít nhất 10 ký tự', 'error');
                return;
              }
              const kindsVal = overlay.querySelector('#rs-kinds').value;
              try {
                const r = await api('/api/admin/trial/reset', {
                  method: 'POST',
                  body: {
                    userId: uid,
                    kinds: kindsVal === 'all' ? 'all' : [kindsVal],
                    reason,
                    revokeActive: overlay.querySelector('#rs-revoke').checked,
                  },
                });
                toast(`Đã reset. Thu hồi ${(r.revokedKeys || []).length} license.`, 'success', 6000);
                close();
                load();
              } catch (e) { toast(e.message, 'error', 7000); }
            };
          },
        });
      };
    });

    // Lịch sử
    host.querySelectorAll('[data-uses]').forEach((b) => {
      b.onclick = async () => {
        const uid = b.dataset.uses;
        const d2 = await api('/api/admin/trial/uses?userId=' + encodeURIComponent(uid));
        const uses = d2.uses || [];
        const stateCls = { active: 'pill-green', expired: 'pill-gray', ended: 'pill-gray', hold: 'pill-yellow' };

        openModal(`
          <div class="modal-title">📜 Lịch sử dùng thử</div>
          <div class="modal-sub">${uses.length} lần</div>
          <div class="table-wrap" style="max-height:400px;overflow:auto">
            <table>
              <thead><tr><th>Loại</th><th>Mã</th><th>Trạng thái</th><th>Bắt đầu</th></tr></thead>
              <tbody>
                ${uses.length === 0
                  ? '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-mute)">Chưa có</td></tr>'
                  : uses.map((u) => `
                    <tr>
                      <td><strong>${esc(u.kind === '1h' ? '1 giờ' : '3 ngày')}</strong></td>
                      <td class="mono" style="font-size:11px">${esc(u.key)}</td>
                      <td><span class="pill ${stateCls[u.state] || 'pill-gray'}" style="font-size:10px">${esc(u.state)}</span></td>
                      <td style="font-size:11.5px;color:var(--text-mute)">${u.startedAt ? fmtDate(u.startedAt * 1000) : '—'}</td>
                    </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="flex gap-1" style="justify-content:flex-end;margin-top:14px">
            <button class="btn btn-ghost" data-close>Đóng</button>
          </div>
        `, {
          onMount(overlay, close) {
            overlay.querySelector('[data-close]').onclick = close;
          },
        });
      };
    });
  };

  await load();
}

'''

# Chèn trước renderUsers
anchor = '/* ---------------- Users ---------------- */'
if anchor in s:
    s = s.replace(anchor, TRIAL_UI + anchor, 1)
    f.write_text(s, encoding='utf-8')
    print('✓ đã chèn renderTrial trước renderUsers')
else:
    # Thử anchor khác
    for a in ['/* ---------------- Logs ---------------- */', 'async function renderUsers']:
        if a in s:
            s = s.replace(a, TRIAL_UI + a, 1)
            f.write_text(s, encoding='utf-8')
            print(f'✓ đã chèn trước: {a[:40]}')
            break
    else:
        print('✗ không tìm thấy anchor')
