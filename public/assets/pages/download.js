/**
 * Trang tải app /tai-ve  (hash route: #/tai-ve).
 *
 * MÔ HÌNH MỚI: MỘT FILE — KHÔNG KEY, KHÔNG CÀI ĐẶT.
 *
 *   1. Nút tải lớn -> /download/xa_arena.exe (route Worker, R2)
 *   2. Cảnh báo SmartScreen NGAY dưới nút + 3 bước bỏ qua
 *      (link #/huong-dan chỉ để xem bản đầy đủ, không phải bắt buộc)
 *   3. SHA-256 đầy đủ + nút Copy để khách tự đối chiếu
 *   4. Disclaimer: chỉ tải từ xienhl.com; shop không bao giờ gửi file qua
 *      Zalo/Messenger/Drive; hash khác thì XOÁ NGAY
 *   5. Ba bước sử dụng: tải -> bấm đúp -> dùng thử tự bật, hết giờ bấm "Mua"
 *      ngay trong app
 *
 * KHÔNG có key, KHÔNG có mã nhập tay, KHÔNG CMD/PowerShell: app tự nhận
 * quyền theo máy (HWID) khi mở lần đầu. Khách không phải dán gì cả.
 *
 * Dữ liệu phiên bản (version / sha256 / size / url) lấy từ
 * GET /api/app/version. Hằng FALLBACK dưới đây CHỈ là giá trị hiển thị tạm
 * trong lúc chờ mạng — chúng bị ghi đè ngay khi API trả về, nên không thành
 * nguồn sự thật thứ hai. Trước đây phải chép tay hash vào 2 nơi và rất dễ
 * lệch: lệch hash làm khách tải ĐÚNG file mà vẫn tưởng file bị chèn.
 *
 * Trang KHÔNG cần đăng nhập: khách còn do dự vẫn phải xem được version, hash.
 */
import { api, esc, copyText, toast } from '../lib.js';
import { icon } from '../icons.js';

const EXE_URL = '/download/xa_arena.exe';
const EXE_FILE = 'xa_arena.exe';
const GUIDE_URL = '#/huong-dan';
const BUY_URL = '#/products?category=license-xarena';

/* Giá trị hiển thị tạm trong lúc chờ /api/app/version (bị ghi đè sau). */
const FALLBACK = {
  version: '3.0.2.0',
  sizeText: '22.2 MB',
  sha256: 'D74DC26EB2C19E10FEA191D6A266EC3D778ED3DACA1C8112505AFD864E7E5584',
  filename: EXE_FILE,
};

/** Ba bước bỏ qua SmartScreen — dùng lại ở cả khối cảnh báo và trang hướng dẫn. */
const SMARTSCREEN_STEPS = `
  <li class="dl-step">
    <span class="n" aria-hidden="true">1</span>
    <span>Bấm chữ <strong>"More info"</strong> (dòng "Windows protected your PC").</span>
  </li>
  <li class="dl-step">
    <span class="n" aria-hidden="true">2</span>
    <span>Hiện thêm tên file — bấm nút <strong>"Run anyway"</strong>.</span>
  </li>
  <li class="dl-step">
    <span class="n" aria-hidden="true">3</span>
    <span>Windows hỏi quyền Admin (tool cần quyền này để vá bộ nhớ game) → bấm <strong>Yes</strong>.</span>
  </li>`;

export function renderDownload() {
  return `
  <div id="site-header"></div>
  <div class="container dl-wrap">

    <!-- ===== MỘT FILE DUY NHẤT — TẢI VỀ LÀ CHẠY ===== -->
    <section class="dl-hero" aria-labelledby="dl-app-title" style="margin-bottom:18px">
      <div class="dl-eyebrow">${icon('zap', { size: 15 })}<span>Tải về là chạy — không cần cài</span></div>
      <h1 class="dl-title" id="dl-app-title" style="font-size:26px">Tải XA ARENA</h1>
      <p class="dl-sub">
        Một file <strong>.exe</strong> duy nhất. Bấm đúp là dùng được ngay —
        <strong>không cần cài</strong>, <strong>không cần key</strong>.
        Lần đầu mở, app tự bật dùng thử cho máy bạn.
      </p>

      <div class="dl-meta">
        <span class="pill pill-gray">${icon('tag', { size: 15 })}<span data-dl-version>v${esc(FALLBACK.version)}</span></span>
        <span class="pill pill-gray">${icon('package', { size: 15 })}<span data-dl-size>${esc(FALLBACK.sizeText)}</span></span>
        <span class="pill pill-gray">${icon('shieldCheck', { size: 15 })}SHA-256 có sẵn</span>
        <span class="pill pill-green">${icon('checkCircle', { size: 15 })}Miễn phí tải</span>
      </div>

      <div class="dl-cta">
        <a class="btn btn-primary btn-lg btn-block dl-dl"
           href="${EXE_URL}" download="${EXE_FILE}" data-dl-url rel="noopener">
          ${icon('download', { size: 15 })} Tải XA ARENA (.exe)
        </a>
        <div class="dl-hint">
          File <code class="mono">${esc(EXE_FILE)}</code> ·
          <span data-dl-size2>${esc(FALLBACK.sizeText)}</span> ·
          Windows 10 / 11 64-bit · không cần key
        </div>
      </div>
    </section>

    <!-- ===== CẢNH BÁO SMARTSGREEN: ngay dưới nút tải ===== -->
    <div class="alert alert-warn" role="note">
      <span class="ico">${icon('alert', { size: 15 })}</span>
      <span>
        <strong>Windows sẽ cảnh báo khi bạn chạy file — đây là bình thường.</strong>
        Tool chưa mua chứng chỉ ký số (≈ $300/năm), nên SmartScreen cảnh báo với
        mọi phần mềm chưa ký. Không phải virus. Cách bỏ qua:
      </span>
    </div>

    <div class="panel" style="margin-bottom:16px">
      <div class="panel-title">${icon('shield', { size: 15 })} Ba bước bỏ qua cảnh báo</div>
      <ol class="dl-steps">${SMARTSCREEN_STEPS}</ol>
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:16px">
        <a class="btn btn-ghost btn-sm" href="${GUIDE_URL}">
          ${icon('book', { size: 15 })} Hướng dẫn chi tiết (kèm ảnh)
        </a>
      </div>
    </div>

    <!-- ===== 3 BƯỚC SỬ DỤNG ===== -->
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-title">${icon('bolt', { size: 15 })} Dùng trong 3 bước</div>
      <ol class="dl-steps">
        <li class="dl-step">
          <span class="n" aria-hidden="true">1</span>
          <span><strong>Tải về</strong> — file nằm trong thư mục <code class="mono">Downloads</code>.</span>
        </li>
        <li class="dl-step">
          <span class="n" aria-hidden="true">2</span>
          <span><strong>Bấm đúp</strong> file <code class="mono">${esc(EXE_FILE)}</code> → bỏ qua SmartScreen theo 3 bước ở trên.</span>
        </li>
        <li class="dl-step">
          <span class="n" aria-hidden="true">3</span>
          <span><strong>Dùng thử tự bật</strong> — app ghi quyền cho đúng máy bạn.
            Hết giờ thì bấm <strong>Mua</strong> ngay trong app.</span>
        </li>
      </ol>
    </div>

    <!-- ===== SHA-256 ===== -->
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-title">${icon('shieldCheck', { size: 15 })} Mã SHA-256 của file</div>
      <p style="font-size:13px;line-height:1.7;color:var(--text-dim);margin-bottom:4px">
        Đối chiếu sau khi tải: <strong>khớp</strong> là file nguyên vẹn;
        <strong>khác</strong> là file đã bị can thiệp — xoá ngay.
      </p>

      <div class="dl-hash">
        <code class="dl-hash-val" data-dl-hash>${esc(FALLBACK.sha256)}</code>
        <button class="btn btn-ghost btn-sm" data-dl-copy-hash
                data-value="${esc(FALLBACK.sha256)}">
          ${icon('copy', { size: 13 })} Copy mã
        </button>
        <p class="dl-hash-note">
          Chuột phải file vừa tải &rarr; <strong>Properties</strong> (hoặc dùng
          7-Zip &rarr; CRC SHA) để xem mã, rồi đối chiếu với mã trên.
        </p>
      </div>
    </div>

    <!-- ===== DISCLAIMER BẢO MẬT ===== -->
    <div class="alert alert-error" role="note" style="margin-bottom:16px">
      <span class="ico">${icon('ban', { size: 15 })}</span>
      <span>
        <strong>Chỉ tải file từ xienhl.com.</strong>
        Shop <strong>KHÔNG BAO GIỜ</strong> gửi file qua Zalo, Messenger, Telegram
        hay Google Drive. Mọi file nhận từ kênh khác đều không phải của shop.
      </span>
    </div>

    <div class="panel" style="margin-bottom:16px">
      <div class="panel-title">${icon('lock', { size: 15 })} Ba quy tắc an toàn</div>
      <ul class="feature-list" style="margin-top:0">
        <li><span class="tick">${icon('check', { size: 15, stroke: 2.6 })}</span><span>Chỉ tải từ <strong>xienhl.com</strong> — đúng địa chỉ, không có tên miền na ná.</span></li>
        <li><span class="tick">${icon('check', { size: 15, stroke: 2.6 })}</span><span>Shop không bao giờ gửi file qua <strong>Zalo / Messenger / Google Drive</strong>. Ai gửi là giả.</span></li>
        <li><span class="tick">${icon('check', { size: 15, stroke: 2.6 })}</span><span>Nếu <strong>mã SHA-256 khác</strong> mã trên trang này → <strong>XOÁ NGAY</strong>, rồi báo shop.</span></li>
      </ul>
    </div>

    <!-- ===== YÊU CẦU HỆ THỐNG + HẾT GIỜ DÙNG THỬ ===== -->
    <div class="dl-grid">
      <div class="panel">
        <div class="panel-title">${icon('package', { size: 15 })} Yêu cầu hệ thống</div>
        <div class="def-list dl-spec">
          <div class="def-row">
            <span class="k">Hệ điều hành</span>
            <span class="v">Windows 10 / 11 (64-bit)</span>
          </div>
          <div class="def-row">
            <span class="k">Windows 7 / 8</span>
            <span class="v" style="color:var(--danger)">Không hỗ trợ — yêu cầu Windows 10 / 11 (64-bit), đã bỏ Win7</span>
          </div>
          <div class="def-row">
            <span class="k">RAM</span>
            <span class="v">Tối thiểu 4 GB (khuyến nghị 8 GB)</span>
          </div>
          <div class="def-row">
            <span class="k">Dung lượng trống</span>
            <span class="v">≥ 100 MB</span>
          </div>
          <div class="def-row">
            <span class="k">Dung lượng file</span>
            <span class="v"><span data-dl-size3>${esc(FALLBACK.sizeText)}</span></span>
          </div>
          <div class="def-row">
            <span class="k">Quyền</span>
            <span class="v">Administrator (bắt buộc)</span>
          </div>
          <div class="def-row">
            <span class="k">Kết nối</span>
            <span class="v">Internet — bắt buộc mỗi lần mở app</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">${icon('gem', { size: 15 })} Hết giờ dùng thử?</div>
        <p style="font-size:13px;line-height:1.7;color:var(--text-dim);margin-bottom:14px">
          Trong app bấm <strong>Mua</strong>. Mua xong đăng nhập trong app là
          app tự nhận bản quyền — <strong>không nhập key</strong>.
        </p>
        <div class="flex gap-1" style="flex-wrap:wrap">
          <a class="btn btn-primary btn-sm" href="${BUY_URL}">
            ${icon('cart', { size: 15 })} Bảng giá
          </a>
          <a class="btn btn-ghost btn-sm" href="#/support">
            ${icon('help', { size: 15 })} Cần hỗ trợ
          </a>
        </div>
        <p class="note" style="margin-top:14px">
          Bản quyền gắn với máy (HWID), thay máy được.
        </p>
      </div>
    </div>

    <div style="margin-top:24px;text-align:center">
      <a class="btn btn-ghost" href="#/">${icon('arrowLeft', { size: 15 })} Về trang chủ</a>
    </div>
  </div>

<div id="site-footer"></div>`;
}

export async function mountDownload(root) {
  const hashEl = root.querySelector('[data-dl-hash]');
  const copyHashBtn = root.querySelector('[data-dl-copy-hash]');
  const dlLink = root.querySelector('[data-dl-url]');

  /* --- Lấy thông tin phiên bản thật từ máy chủ --- */
  let info = null;
  try {
    info = await api('/api/app/version');
  } catch {
    /*
     * Mạng lỗi hoặc endpoint chưa có: giữ nguyên giá trị tạm. Nút tải KHÔNG
     * bị vô hiệu hoá — file vẫn nằm ở /download/... và khách vẫn cần tải được
     * ngay, đó là mục đích chính của trang.
     */
    info = null;
  }

  /*
   * Mỗi trường áp RIÊNG. Trước đây tất cả nằm trong `if (info.sha256)`, nên
   * server thiếu hash là version + dung lượng đứng nguyên ở FALLBACK dù API
   * có trả về. `info.arena` là object lồng của app gộp — nhận cả hai cấp.
   */
  const src = info ? (info.arena || info) : null;

  if (src) {
    if (src.version) {
      const v = String(src.version);
      root.querySelectorAll('[data-dl-version]').forEach((el) => {
        el.textContent = 'v' + v;
      });
    }
    if (src.sizeText) {
      const s = String(src.sizeText);
      root.querySelectorAll('[data-dl-size], [data-dl-size2], [data-dl-size3]').forEach((el) => {
        el.textContent = s;
      });
    }
    if (src.sha256) {
      // Ghi vào textContent, KHÔNG innerHTML: hash đến từ mạng, phải coi là dữ liệu.
      const sha = String(src.sha256);
      if (hashEl) hashEl.textContent = sha;
      if (copyHashBtn) copyHashBtn.dataset.value = sha;
    }
    // Đường dẫn tải: ưu tiên giá trị server trả về, nhưng chỉ nhận path nội bộ.
    if (dlLink && typeof src.url === 'string' && /^\/download\/[A-Za-z0-9._-]+$/.test(src.url)) {
      dlLink.setAttribute('href', src.url);
      dlLink.setAttribute('download', String(src.filename || EXE_FILE));
    }
  }

  /* Giá trị copy: ưu tiên dữ liệu server, không có thì lấy chữ đang hiển thị. */
  const readHash = () =>
    (copyHashBtn && copyHashBtn.dataset.value) ||
    (hashEl && hashEl.textContent ? hashEl.textContent.trim() : '') ||
    FALLBACK.sha256;

  if (copyHashBtn) {
    copyHashBtn.addEventListener('click', async () => {
      const okFlag = await copyText(readHash());
      toast(okFlag ? 'Đã copy mã SHA-256' : 'Không copy được — chọn mã rồi Ctrl+C',
        okFlag ? 'success' : 'error');
    });
  }
}
