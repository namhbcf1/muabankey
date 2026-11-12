/**
 * Trang tải bộ cài /tai-ve  (hash route: #/tai-ve).
 *
 * Mục tiêu: khách mở trang là tải được ngay, và tin là file thật. Vì vậy
 * trang chứa ĐỦ thứ cần để tự kiểm chứng, không bắt khách nhảy sang trang
 * khác rồi quay lại:
 *
 *   1. Nút tải lớn -> /download/xa_nofog_pro.exe (route Worker, R2)
 *   2. Cảnh báo SmartScreen NGAY dưới nút + 3 bước bỏ qua
 *      (link #/huong-dan chỉ để xem bản đầy đủ, không phải bắt buộc)
 *   3. SHA-256 đầy đủ + nút Copy + lệnh certutil để khách tự đối chiếu
 *   4. Disclaimer: chỉ tải từ xienhl.com; shop không bao giờ gửi file qua
 *      Zalo/Messenger/Drive; hash khác thì XOÁ NGAY
 *   5. Ba bước sử dụng + yêu cầu hệ thống + link mua key khi hết hạn
 *
 * Dữ liệu phiên bản (version / sha256 / size / url) lấy từ
 * GET /api/app/version. Hằng số dưới đây CHỈ là giá trị hiển thị tạm trong
 * lúc chờ mạng — chúng bị ghi đè ngay khi API trả về, nên không thành nguồn
 * sự thật thứ hai. Trước đây phải chép tay hash vào 2 nơi và rất dễ lệch:
 * lệch hash làm khách tải ĐÚNG file mà vẫn tưởng file bị chèn.
 *
 * Trang KHÔNG cần đăng nhập: khách còn do dự vẫn phải xem được version, hash.
 */
import { api, esc, copyText, toast } from '../lib.js';
import { icon } from '../icons.js';

const EXE_URL = '/download/xa_nofog_pro.exe';
const EXE_FILE = 'xa_nofog_pro.exe';
const GUIDE_URL = '#/huong-dan';
const BUY_URL = '#/products?category=license-xarena';
const TRIAL_URL = '#/#trial-section';

/* Giá trị hiển thị tạm trong lúc chờ /api/app/version (bị ghi đè sau). */
const FALLBACK = {
  version: '1.4.0.0',
  sizeText: '8.6 MB',
  sha256: 'CF91F953386FEB3FC64B1279C5E4E4748D7A5F610F8A577296FD234D47D89456',
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

    <!-- ===== HERO + NÚT TẢI ===== -->
    <section class="dl-hero" aria-labelledby="dl-title">
      <div class="dl-eyebrow">${icon('download', { size: 13 })}<span>Bộ cài chính thức</span></div>
      <h1 class="dl-title" id="dl-title">Tải XArena No Fog</h1>
      <p class="dl-sub">
        Bộ xử lý bỏ sương mù toàn map + minimap. Tải trực tiếp từ máy chủ
        xienhl.com, không qua trung gian, không cần đăng nhập.
      </p>

      <div class="dl-meta">
        <span class="pill pill-gray">${icon('tag', { size: 11 })}<span data-dl-version>v${esc(FALLBACK.version)}</span></span>
        <span class="pill pill-gray">${icon('package', { size: 11 })}<span data-dl-size>${esc(FALLBACK.sizeText)}</span></span>
        <span class="pill pill-gray">${icon('shieldCheck', { size: 11 })}SHA-256 có sẵn</span>
        <span class="pill pill-green">${icon('checkCircle', { size: 11 })}Miễn phí tải</span>
      </div>

      <div class="dl-cta">
        <a class="btn btn-primary btn-lg btn-block dl-dl"
           href="${EXE_URL}" download="${EXE_FILE}"
           data-dl-url rel="noopener">
          ${icon('download', { size: 18 })} Tải bộ cài (EXE)
        </a>
        <div class="dl-hint">
          File <code class="mono">${esc(EXE_FILE)}</code> ·
          <span data-dl-size2>${esc(FALLBACK.sizeText)}</span> ·
          Windows 10/11 64-bit
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
          ${icon('book', { size: 13 })} Hướng dẫn chi tiết (kèm ảnh)
        </a>
      </div>
    </div>

    <!-- ===== SHA-256 ===== -->
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-title">${icon('key', { size: 15 })} Mã kiểm tra SHA-256</div>
      <p style="font-size:13px;line-height:1.7;color:var(--text-dim);margin-bottom:4px">
        Sau khi tải xong, hãy đối chiếu mã này. Nếu <strong>khớp</strong> thì file
        nguyên vẹn; nếu <strong>khác</strong> thì file đã bị can thiệp — xoá ngay.
      </p>

      <div class="dl-hash">
        <div class="dl-hash-val" data-dl-hash-box>
          <span class="mono" data-dl-hash>${esc(FALLBACK.sha256)}</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-dl-copy-hash
                aria-label="Sao chép mã SHA-256">
          ${icon('copy', { size: 13 })} Copy
        </button>
      </div>

      <div class="dl-cmd">
        <code>certutil -hashfile ${esc(FALLBACK.filename)} SHA256</code>
        <button type="button" class="btn btn-ghost btn-sm" data-dl-copy-cmd
                aria-label="Sao chép lệnh kiểm tra SHA-256">
          ${icon('copy', { size: 13 })} Copy lệnh
        </button>
      </div>

      <p class="note" style="margin-top:10px">
        <strong>Cách chạy:</strong> mở thư mục <code class="mono">Downloads</code>, click vào thanh địa chỉ,
        gõ <code class="mono">cmd</code> rồi Enter — dán lệnh trên vào cửa sổ vừa mở, Enter.
        Mã trả về phải trùng từng ký tự với mã ở trên (không phân biệt hoa/thường,
        dấu cách trong mã là do certutil xuống dòng, bỏ qua được).
      </p>
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
        <li><span class="tick">${icon('check', { size: 10, stroke: 2.6 })}</span><span>Chỉ tải từ <strong>xienhl.com</strong> — đúng địa chỉ, không có tên miền na ná.</span></li>
        <li><span class="tick">${icon('check', { size: 10, stroke: 2.6 })}</span><span>Shop không bao giờ gửi file qua <strong>Zalo / Messenger / Google Drive</strong>. Ai gửi là giả.</span></li>
        <li><span class="tick">${icon('check', { size: 10, stroke: 2.6 })}</span><span>Nếu <strong>mã SHA-256 khác</strong> mã trên trang này → <strong>XOÁ NGAY</strong>, rồi báo shop.</span></li>
      </ul>
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
          <span><strong>Double-click</strong> file <code class="mono">${esc(EXE_FILE)}</code> → bỏ qua SmartScreen theo 3 bước ở trên.</span>
        </li>
        <li class="dl-step">
          <span class="n" aria-hidden="true">3</span>
          <span><strong>Dùng thử 3 ngày</strong> miễn phí, hoặc <strong>nhập key</strong> đã mua để mở khoá toàn bộ.</span>
        </li>
      </ol>
      <div class="flex gap-1" style="flex-wrap:wrap;margin-top:16px">
        <a class="btn btn-ghost btn-sm" href="${TRIAL_URL}">
          ${icon('gift', { size: 13 })} Bắt đầu dùng thử
        </a>
        <a class="btn btn-ghost btn-sm" href="#/licenses">
          ${icon('key', { size: 13 })} License của tôi
        </a>
      </div>
    </div>

    <!-- ===== YÊU CẦU HỆ THỐNG + MUA KEY ===== -->
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
            <span class="v" style="color:var(--danger)">Không hỗ trợ — tool dùng Python 3.14, đã bỏ Win7</span>
          </div>
          <div class="def-row">
            <span class="k">RAM</span>
            <span class="v">Tối thiểu 4 GB (khuyến nghị 8 GB)</span>
          </div>
          <div class="def-row">
            <span class="k">Dung lượng trống</span>
            <span class="v">≥ 100 MB cho thư mục cài</span>
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
            <span class="v">Internet — cần để kích hoạt key</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">${icon('gem', { size: 15 })} Hết 3 ngày dùng thử?</div>
        <p style="font-size:13px;line-height:1.7;color:var(--text-dim);margin-bottom:14px">
          Key bản quyền giao tự động ngay sau khi thanh toán, kích hoạt theo máy
          (HWID), có đổi máy khi thay thiết bị.
        </p>
        <div class="flex gap-1" style="flex-wrap:wrap">
          <a class="btn btn-primary btn-sm" href="${BUY_URL}">
            ${icon('cart', { size: 13 })} Mua key ngay
          </a>
          <a class="btn btn-ghost btn-sm" href="#/support">
            ${icon('help', { size: 13 })} Cần hỗ trợ
          </a>
        </div>
        <p class="note" style="margin-top:14px">
          Đã mua rồi? Vào
          <a href="#/licenses" style="color:var(--info);font-weight:600">License của tôi</a>
          để lấy lệnh cài tự động kèm key, khỏi phải nhập tay.
        </p>
      </div>
    </div>

    <div style="margin-top:24px;text-align:center">
      <a class="btn btn-ghost" href="#/">${icon('arrowLeft', { size: 14 })} Về trang chủ</a>
    </div>
  </div>
  <div id="site-footer"></div>`;
}

export async function mountDownload(root) {
  const hashEl = root.querySelector('[data-dl-hash]');
  const copyHashBtn = root.querySelector('[data-dl-copy-hash]');
  const copyCmdBtn = root.querySelector('[data-dl-copy-cmd]');
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

  if (info && info.sha256) {
    const sha = String(info.sha256);
    // Ghi vào textContent, KHÔNG innerHTML: hash đến từ mạng, phải coi là dữ liệu.
    if (hashEl) hashEl.textContent = sha;
    if (copyHashBtn) copyHashBtn.dataset.value = sha;

    if (info.version) {
      root.querySelectorAll('[data-dl-version]').forEach((el) => {
        el.textContent = 'v' + String(info.version);
      });
    }
    if (info.sizeText) {
      root.querySelectorAll('[data-dl-size], [data-dl-size2], [data-dl-size3]').forEach((el) => {
        el.textContent = String(info.sizeText);
      });
    }
    // Lệnh certutil phải dùng đúng tên file mà server phục vụ.
    const cmdCode = root.querySelector('.dl-cmd code');
    if (cmdCode && info.filename) {
      cmdCode.textContent = `certutil -hashfile ${String(info.filename)} SHA256`;
    }
    // Đường dẫn tải: ưu tiên giá trị server trả về, nhưng chỉ nhận path nội bộ.
    if (dlLink && typeof info.url === 'string' && /^\/download\/[A-Za-z0-9._-]+$/.test(info.url)) {
      dlLink.setAttribute('href', info.url);
      dlLink.setAttribute('download', String(info.filename || EXE_FILE));
    }
  }

  /* Giá trị copy: ưu tiên dữ liệu server, không có thì lấy chữ đang hiển thị. */
  const readHash = () =>
    (copyHashBtn && copyHashBtn.dataset.value) ||
    (hashEl && hashEl.textContent ? hashEl.textContent.trim() : '') ||
    FALLBACK.sha256;

  const readCmd = () => {
    const c = root.querySelector('.dl-cmd code');
    return c && c.textContent ? c.textContent.trim() : `certutil -hashfile ${EXE_FILE} SHA256`;
  };

  if (copyHashBtn) {
    copyHashBtn.addEventListener('click', async () => {
      const okFlag = await copyText(readHash());
      toast(okFlag ? 'Đã copy mã SHA-256' : 'Không copy được — chọn mã rồi Ctrl+C',
        okFlag ? 'success' : 'error');
    });
  }

  if (copyCmdBtn) {
    copyCmdBtn.addEventListener('click', async () => {
      const okFlag = await copyText(readCmd());
      toast(okFlag ? 'Đã copy lệnh kiểm tra' : 'Không copy được — chọn lệnh rồi Ctrl+C',
        okFlag ? 'success' : 'error');
    });
  }
}
