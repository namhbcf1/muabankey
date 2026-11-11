/** Trang hỗ trợ: FAQ, chính sách, hướng dẫn. */
import { esc } from '../lib.js';
import { icon } from '../icons.js';

const FAQS = [
  ['Key tôi mua có phải hàng chính hãng không?',
   'Có. Tất cả key đều là key Retail/OEM chính hãng mua trực tiếp từ nhà phân phối ủy quyền. Bạn có thể kiểm tra tính hợp lệ bằng công cụ chính thức của Microsoft hoặc nhà cung cấp.'],
  ['Bao lâu thì tôi nhận được key sau khi thanh toán?',
   'Với sản phẩm giao tự động, key hiển thị ngay lập tức trong mục "Đơn hàng" (thường dưới 5 giây). Mọi sản phẩm còn hàng đều giao tự động ngay sau khi trừ ví (dưới 5 giây) hoặc Telegram.'],
  ['Key không kích hoạt được thì sao?',
   'Trong thời hạn bảo hành (365 ngày với Windows/Office, 30 ngày với AI tools, đổi mới với streaming), chúng tôi đổi key mới hoàn toàn miễn phí. Nếu không còn hàng thay thế, bạn được hoàn 100% qua chuyển khoản.'],
  ['Có được dùng key trên nhiều máy không?',
   'Key Windows/Office Retail bind vào tài khoản Microsoft của bạn nên có thể cài trên nhiều thiết bị cá nhân (thường giới hạn phụ thuộc license). Key tài khoản AI/Streaming chỉ dùng 1 thiết bị tại một thời điểm.'],
  ['Tôi có thể bán lại key cho người khác không?',
   'Về mặt kỹ thuật key đã bind vào tài khoản của bạn nên không chuyển nhượng được. Chúng tôi không hỗ trợ việc mua bán lại.'],
];

/** Bốn bước mua hàng — tách ra ngoài để template dễ đọc. */
const STEPS = [
  ['1', 'Tạo tài khoản', 'Đăng ký bằng tài khoản và mật khẩu. Xác nhận trong vài giây, không cần chờ duyệt.'],
  ['2', 'Thanh toán đơn bằng QR', 'Bấm Mua ngay, quét mã QR bằng app ngân hàng. Số tiền và nội dung đã điền sẵn.'],
  ['3', 'Chọn sản phẩm', 'Thêm sản phẩm vào giỏ hàng hoặc bấm "Mua ngay". Kiểm tra tồn kho trước khi đặt.'],
  ['4', 'Thanh toán và nhận key', 'Bấm "Xác nhận thanh toán". Key hiển thị ngay và được lưu vĩnh viễn trong mục Đơn hàng.'],
];

const WARRANTY_ROWS = [
  ['Windows & Office', '365 ngày, 1 đổi 1'],
  ['Công cụ AI (ChatGPT, Claude, Gemini)', '30 ngày'],
  ['Streaming (Netflix, Spotify, YouTube)', 'Đổi mới ngay khi có lỗi'],
  ['Bảo mật & VPN', '365 ngày'],
];

const REFUND_ROWS = [
  'Đơn hàng không được giao trong 24 giờ',
  'Key không hoạt động và không có hàng thay thế',
  'Sản phẩm không đúng mô tả',
];

/** Danh sách có dấu tích. Mỗi dòng là HTML đã an toàn (tự dựng, không từ người dùng). */
function checkList(rows) {
  return `<ul class="sp-list">
    ${rows.map((r) => `
      <li><span class="sp-check">${icon('check', { size: 13, stroke: 2.2 })}</span>
        <span>${r}</span></li>`).join('')}
  </ul>`;
}

export function renderSupport() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <div class="pd-breadcrumb"><a href="#/">Trang chủ</a><span>/</span><span>Hỗ trợ</span></div>
      <div class="sec-head">
        <div>
          <h1 class="sec-title">Trung tâm hỗ trợ</h1>
          <p class="sec-desc">Mua hàng, bảo hành, hoàn tiền và các câu hỏi thường gặp.</p>
        </div>
      </div>

      <nav class="sp-jump" aria-label="Mục lục trang hỗ trợ">
        <a href="#/support#guide" class="cat-chip">Hướng dẫn mua hàng</a>
        <a href="#/support#warranty" class="cat-chip">Bảo hành</a>
        <a href="#/support#refund" class="cat-chip">Hoàn tiền</a>
        <a href="#/support#faq" class="cat-chip">Câu hỏi thường gặp</a>
      </nav>

      <div class="checkout-grid">
        <div class="sp-col">
          <section class="panel" id="guide" aria-labelledby="guide-title">
            <h2 class="panel-title" id="guide-title">
              <span class="pt-ico">${icon('cart', { size: 15 })}</span>
              Hướng dẫn mua hàng
            </h2>
            <ol class="sp-steps">
              ${STEPS.map(([n, t, d]) => `
                <li class="sp-step">
                  <span class="sp-step-n" aria-hidden="true">${n}</span>
                  <span class="sp-step-body">
                    <span class="sp-step-t">${esc(t)}</span>
                    <span class="sp-step-d">${esc(d)}</span>
                  </span>
                </li>`).join('')}
            </ol>
          </section>

          <section class="panel mt-2" id="warranty" aria-labelledby="warranty-title">
            <h2 class="panel-title" id="warranty-title">
              <span class="pt-ico">${icon('shieldCheck', { size: 15 })}</span>
              Chính sách bảo hành
            </h2>
            <div class="sp-body">
              <div class="sp-label">Thời hạn bảo hành</div>
              ${checkList(WARRANTY_ROWS.map(([k, v]) => `${esc(k)}: <strong>${esc(v)}</strong>`))}
              <p>
                <strong class="sp-strong">Điều kiện áp dụng:</strong>
                key không kích hoạt được, bị vô hiệu hoá bởi nhà sản xuất, hoặc tài khoản bị lỗi
                không do người dùng. Không áp dụng cho trường hợp cài đặt sai, dùng phần mềm crack
                hoặc chia sẻ key cho nhiều người.
              </p>
            </div>
          </section>

          <section class="panel mt-2" id="refund" aria-labelledby="refund-title">
            <h2 class="panel-title" id="refund-title">
              <span class="pt-ico">${icon('undo', { size: 15 })}</span>
              Chính sách hoàn tiền
            </h2>
            <div class="sp-body">
              <p>Bạn được <strong class="text-green">hoàn 100% qua chuyển khoản</strong> trong các trường hợp:</p>
              ${checkList(REFUND_ROWS.map(esc))}
              <p>
                Tiền hoàn về ví trong vòng 1-2 giờ làm việc. Gửi yêu cầu qua Telegram/Zalo kèm mã đơn hàng.
              </p>
            </div>
          </section>

          <section class="panel mt-2" id="faq" aria-labelledby="faq-title">
            <h2 class="panel-title" id="faq-title">
              <span class="pt-ico">${icon('help', { size: 15 })}</span>
              Câu hỏi thường gặp
            </h2>
            <div class="sp-faq">
              ${FAQS.map(([q, a]) => `
                <details>
                  <summary>
                    <span class="sp-faq-q">${esc(q)}</span>
                    <span class="sp-faq-ico" aria-hidden="true">${icon('chevronDown', { size: 15 })}</span>
                  </summary>
                  <div class="sp-faq-a">${esc(a)}</div>
                </details>`).join('')}
            </div>
          </section>
        </div>

        <div>
          <div class="panel sp-aside">
            <h2 class="panel-title">
              <span class="pt-ico">${icon('messageCircle', { size: 15 })}</span>
              Liên hệ hỗ trợ
            </h2>
            <a class="btn btn-primary btn-block" href="https://t.me/muabankey" target="_blank" rel="noopener">
              ${icon('send', { size: 15 })} Telegram — phản hồi nhanh nhất
            </a>
        <a class="btn btn-ghost btn-sm" href="#/huong-dan">Hướng dẫn cài đặt (SmartScreen)</a>
            <div class="sp-contact">
              <a class="sp-contact-item" href="https://zalo.me/0836768597" target="_blank" rel="noopener">
                <span class="ic-box">${icon('message', { size: 15 })}</span>
                <span class="sp-contact-body">
                  <span class="sp-contact-t">Zalo</span>
                  <span class="sp-contact-d">0836 768 597</span>
                </span>
                ${icon('arrowUpRight', { size: 13, cls: 'sp-contact-go' })}
              </a>
              <a class="sp-contact-item" href="mailto:support@muabankey.vn">
                <span class="ic-box">${icon('mail', { size: 15 })}</span>
                <span class="sp-contact-body">
                  <span class="sp-contact-t">Email</span>
                  <span class="sp-contact-d">support@muabankey.vn</span>
                </span>
                ${icon('arrowUpRight', { size: 13, cls: 'sp-contact-go' })}
              </a>
            </div>

            <div class="alert alert-info mt-2 sp-hours">
              <span class="ico">${icon('clock', { size: 14 })}</span>
              <span>Hỗ trợ <strong>8:00 - 23:00</strong> hàng ngày, kể cả cuối tuần.</span>
            </div>

            <div class="sp-divide">
              <h3 class="sp-subtitle">
                <span class="pt-ico">${icon('bot', { size: 15 })}</span>
                Trợ lý AI
              </h3>
              <p class="sp-muted">
                Key Bot tư vấn sản phẩm và trả lời câu hỏi 24/7.
              </p>
              <button class="btn btn-ghost btn-block" id="open-ai-support">
                ${icon('sparkles', { size: 15 })} Hỏi Key Bot
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
  <div id="site-footer"></div>`;
}

export function mountSupport(root) {
  const btn = root.querySelector('#open-ai-support');
  if (btn) btn.onclick = () => document.getElementById('ai-fab')?.click();

  // Mở rộng FAQ đầu tiên
  const first = root.querySelector('#faq details');
  if (first) first.open = true;
}
