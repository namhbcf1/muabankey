/** Trang hướng dẫn vượt SmartScreen / Windows Defender khi cài tool. */
import { esc } from '../lib.js';
import { icon } from '../icons.js';

export function renderGuide() {
  return `
  <div id="site-header"></div>
  <div class="container" style="max-width:860px;padding:38px 20px 60px">

    <div style="margin-bottom:26px">
      <div class="nf-eyebrow">${icon('info', { size: 13 })}<span>Hướng dẫn cài đặt</span></div>
      <h1 style="font-size:clamp(1.5rem,3.2vw,2.1rem);font-weight:800;letter-spacing:-.035em;margin:10px 0 8px">
        Windows cảnh báo khi cài tool — bình thường
      </h1>
      <p style="color:var(--text-dim);font-size:14.5px;line-height:1.7;margin:0">
        Tool chưa mua chứng chỉ số (giá ~$300/năm) nên Windows luôn cảnh báo với
        mọi phần mềm không rõ nguồn gốc. Không phải virus. Dưới đây là cách bỏ qua.
      </p>
    </div>

    <div class="alert alert-warn" style="margin-bottom:22px">
      <span class="ico">${icon('info', { size: 15 })}</span>
      <span>
        <strong>Chỉ làm theo hướng dẫn này nếu bạn tải tool từ xienhl.com.</strong>
        Không tải từ nguồn khác.
      </span>
    </div>

    <!-- ===== 1. SmartScreen ===== -->
    <div class="panel" style="margin-bottom:18px">
      <div class="panel-title">1. "Windows protected your PC" (SmartScreen)</div>

      <p style="font-size:13.5px;line-height:1.8;color:var(--text-dim);margin-bottom:14px">
        Hộp thoại xanh hiện khi bạn chạy file tải về lần đầu:
      </p>

      <div class="card" style="padding:16px 18px;background:rgba(59,130,246,.08);border-color:rgba(59,130,246,.3);margin-bottom:16px">
        <div style="font-size:12.5px;line-height:2;color:var(--text-dim)">
          <div style="font-weight:800;color:#60a5fa;margin-bottom:8px">
            Windows protected your PC
          </div>
          <div>Microsoft Defender SmartScreen prevented an unrecognized app from starting.</div>
          <div style="margin-top:10px">
            <span style="background:#1e3a5f;padding:3px 10px;border-radius:4px;font-size:11px">More info</span>
            <span style="margin-left:8px;background:#2563eb;color:#fff;padding:3px 10px;border-radius:4px;font-size:11px">Don't run</span>
          </div>
        </div>
      </div>

      <div style="font-size:13.5px;line-height:2;color:var(--text-dim)">
        <strong style="color:#4ade80">Cách xử lý:</strong><br>
        1. Bấm chữ <strong>"More info"</strong> (Chạy vẫn)<br>
        2. Hiện thêm dòng tên file — bấm nút <strong>"Run anyway"</strong><br>
        3. Windows hỏi quyền Admin → bấm <strong>Yes</strong>
      </div>
    </div>

    <!-- ===== 2. Defender ===== -->
    <div class="panel" style="margin-bottom:18px">
      <div class="panel-title">2. Windows Defender xoá file</div>

      <p style="font-size:13.5px;line-height:1.8;color:var(--text-dim);margin-bottom:14px">
        Nếu Defender tự xoá hoặc cách ly file <code class="mono">xa_nofog_pro.exe</code>:
      </p>

      <div style="font-size:13.5px;line-height:2;color:var(--text-dim)">
        <strong style="color:#4ade80">Cách 1 — Khôi phục file:</strong><br>
        1. Mở <strong>Windows Security</strong> (tìm ở Start)<br>
        2. <strong>Virus &amp; threat protection</strong><br>
        3. <strong>Protection history</strong><br>
        4. Tìm mục vừa chặn → bấm <strong>Actions</strong> → <strong>Allow on device</strong>
      </div>

      <div style="font-size:13.5px;line-height:2;color:var(--text-dim);margin-top:16px">
        <strong style="color:#4ade80">Cách 2 — Thêm vào loại trừ (nếu bị xoá lại):</strong><br>
        1. Windows Security → <strong>Virus &amp; threat protection</strong><br>
        2. <strong>Manage settings</strong><br>
        3. Kéo xuống <strong>Exclusions</strong> → <strong>Add or remove exclusions</strong><br>
        4. Bấm <strong>Add an exclusion</strong> → <strong>Folder</strong><br>
        5. Chọn thư mục <code class="mono">C:\\Program Files\\XArena</code>
      </div>
    </div>

    <!-- ===== 3. Không phải virus ===== -->
    <div class="panel" style="margin-bottom:18px">
      <div class="panel-title">3. Vì sao bị cảnh báo?</div>
      <ul class="feature-list" style="font-size:13.5px">
        <li><span class="tick">✓</span><span>File <strong>chưa ký số</strong> — mọi tool miễn phí đều bị vậy</span></li>
        <li><span class="tick">✓</span><span>Tool cần quyền <strong>Admin</strong> để vá bộ nhớ game (đúng thiết kế)</span></li>
        <li><span class="tick">✓</span><span>File được kiểm tra <strong>mã SHA-256</strong> khớp server trước khi cài</span></li>
        <li><span class="tick">✓</span><span>Có thể quét tại <a href="https://www.virustotal.com" target="_blank" rel="noopener" style="color:#60a5fa">virustotal.com</a> — vài cảnh báo generic là bình thường với tool can thiệp bộ nhớ</span></li>
      </ul>
    </div>

    <!-- ===== 4. Vẫn không được ===== -->
    <div class="panel">
      <div class="panel-title">4. Vẫn không cài được?</div>
      <p style="font-size:13.5px;line-height:1.8;color:var(--text-dim);margin-bottom:14px">
        Liên hệ shop, gửi kèm ảnh chụp màn hình lỗi:
      </p>
      <div class="flex gap-1" style="flex-wrap:wrap">
        <a class="btn btn-primary btn-sm" href="https://zalo.me/0836768597" target="_blank" rel="noopener">
          Zalo 0836768597
        </a>
        <a class="btn btn-ghost btn-sm" href="https://t.me/muabankey" target="_blank" rel="noopener">
          Telegram
        </a>
        <a class="btn btn-ghost btn-sm" href="#/support">Trang hỗ trợ</a>
      </div>
    </div>

    <div style="margin-top:26px;text-align:center">
      <a class="btn btn-ghost" href="#/">${icon('arrowLeft', { size: 14 })} Về trang chủ</a>
    </div>
  </div>`;
}

export function mountGuide() {
  /* Trang tĩnh, không cần JS */
}
