# -*- coding: utf-8 -*-
"""Thay khối install UI trong licenses.js sang one-liner PowerShell."""
import re
from pathlib import Path

f = Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'licenses.js'
s = f.read_text(encoding='utf-8')

# Tìm từ "const r = await api(...install-token..." đến hết khối gán copycmd
start = s.find("const r = await api(`/api/licenses/${encodeURIComponent(key)}/install-token`")
if start == -1:
    print('KHONG THAY start')
    raise SystemExit(1)

# Tìm điểm kết thúc: sau khối forEach copycmd
marker = "        });\n      } catch (e) {"
end = s.find(marker, start)
if end == -1:
    print('KHONG THAY end')
    raise SystemExit(1)

NEW = '''const r = await api(`/api/licenses/${encodeURIComponent(key)}/install-token`, { method: 'POST' });
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
'''

s = s[:start] + NEW + s[end:]
f.write_text(s, encoding='utf-8')

print('OK thay khoi install UI')
print('  oneLiner  :', 'r.oneLiner' in s)
print('  copyone   :', 'data-copyone' in s)
print('  Win + R   :', 'Win + R' in s)
print('  Khong con cmd cu:', 'DÁN VÀO CMD' not in s)
