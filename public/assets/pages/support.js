/** Trang hỗ trợ: FAQ, chính sách, hướng dẫn. */
import { esc } from '../lib.js';
import { icon } from '../icons.js';

/*
 * Toàn bộ nội dung trang này nói về SẢN PHẨM THẬT của shop: tool Windows cho
 * AoE1 / XArena (map sáng + thêm tài nguyên). Bản cũ nói về một ngành hàng
 * khác hoàn toàn (key hệ điều hành và văn phòng, tài khoản dịch vụ, bán lại
 * key), nên khách đọc xong hiểu sai hẳn về sản phẩm.
 */

const FAQS = [
  ['Tool này làm gì?',
   'Hai tool cho AoE1 / XArena: (1) MAP SÁNG — xoá sương mù toàn bản đồ và cả minimap; '
   + '(2) THÊM TÀI NGUYÊN — cộng vàng, gỗ, thịt trong trận đang chơi. Mua theo gói, '
   + 'licence gắn với máy.'],
  ['Mua xong dùng thế nào?',
   'Mua trên web (cần đăng nhập), rồi mở XA ARENA và bấm Đăng nhập — licence tự gắn vào tài khoản. '
   + 'Không có mã nào phải nhập hay copy.'],
  ['Tải và chạy ra sao?',
   'Một file duy nhất, không cần cài đặt: bấm "Tải XA ARENA" ở trang Tải về, mở xa_arena.exe, '
   + 'chọn Yes khi Windows hỏi quyền. Chưa mua thì bản dùng thử tự bật.'],
  ['Máy tôi cần cấu hình gì?',
   'Windows 10 hoặc Windows 11 bản 64-bit, chạy bằng quyền Administrator, '
   + 'và PHẢI có internet mỗi lần chạy — tool không có chế độ offline.'],
  ['Licence dùng được mấy máy?',
   'Một máy. Đổi máy thì mở app bấm "Gắn máy khác" (hoặc vào "Licence của tôi" trên web). '
   + 'Số lượt đổi máy có hạn, xem ngay trong thẻ licence.'],
  ['Dùng thử thế nào?',
   'Mở XA ARENA là dùng thử miễn phí, không cần tài khoản — đồng hồ gắn theo máy (HWID). '
   + 'Hết giờ, app hiện nút "Mua" để mở shop.'],
  ['Đã dùng được rồi có được hoàn tiền?',
   'Không. Licence đã kích hoạt (tool chạy được trên máy bạn) thì không hoàn tiền — '
   + 'kể cả khi bạn đổi ý hoặc không còn chơi. Xem mục "Chính sách hoàn tiền" bên dưới để biết '
   + 'trường hợp nào được hoàn.'],
];

/** Bốn bước mua hàng — tách ra ngoài để template dễ đọc. */
const STEPS = [
  ['1', 'Tạo tài khoản', 'Đăng ký bằng tài khoản và mật khẩu. Xác nhận trong vài giây, không cần chờ duyệt.'],
  ['2', 'Chọn gói', 'Chọn tool (MAP SÁNG hoặc THÊM TÀI NGUYÊN) và thời hạn 7/30/90/180 ngày tuỳ gói. Bấm "Mua ngay".'],
  ['3', 'Thanh toán bằng QR', 'Bấm "Tạo mã QR thanh toán", quét mã VietQR bằng app ngân hàng. Số tiền và nội dung đã điền sẵn.'],
  ['4', 'Tải app và đăng nhập', 'Bấm "Tải XA ARENA", mở file, bấm Đăng nhập — licence tự gắn vào tài khoản, không cần nhập mã.'],
];

/** Thời hạn của từng gói — số ngày do server cấp lúc gắn licence. */
const WARRANTY_ROWS = [
  ['Gói tuần / tháng / quý / năm', 'Đúng số ngày ghi trên đơn (7 / 30 / 90 / 180 / 365 ngày)'],
  ['Gói vĩnh viễn (MAP SÁNG)', 'Không giới hạn thời gian trên máy đã kích hoạt'],
  ['Licence không kích hoạt được (lỗi từ shop)', 'Gắn lại hoặc đổi licence mới, không mất phí'],
  ['Tool lỗi sau khi đã kích hoạt', 'Shop kiểm tra và cấp lại licence nếu lỗi thuộc về tool'],
];

const REFUND_ROWS = [
  'Đã thanh toán nhưng shop không gắn được licence',
  'Licence không kích hoạt được và shop không còn licence thay thế',
  'Sản phẩm giao không đúng tool / đúng thời hạn bạn đã đặt',
];

/** Trường hợp KHÔNG hoàn tiền — nói thẳng để khách biết trước khi mua. */
const NO_REFUND_ROWS = [
  'Licence đã kích hoạt thành công trên máy bạn',
  'Đổi ý sau khi đã nhận và dùng licence',
  'Tự ý đổi phần cứng / cài lại Windows làm mất lượt đổi máy có sẵn',
  'Dùng chung tài khoản cho nhiều máy rồi bị khoá',
];

/** Danh sách có dấu tích. Mỗi dòng là HTML đã an toàn (tự dựng, không từ người dùng). */
function checkList(rows) {
  return `<ul class="sp-list">
    ${rows.map((r) => `
      <li><span class="sp-check">${icon('check', { size: 13, stroke: 2.2 })}</span>
        <span>${r}</span></li>`).join('')}
  </ul>`;
}

/** Danh sách dấu X — dùng cho phần "không hoàn tiền". */
function crossList(rows) {
  return `<ul class="sp-list">
    ${rows.map((r) => `
      <li><span class="sp-check sp-cross">${icon('x', { size: 13, stroke: 2.2 })}</span>
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
          <p class="sec-desc">Tải và dùng, bảo hành, hoàn tiền và các câu hỏi thường gặp về tool XArena.</p>
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
                <strong class="sp-strong">Yêu cầu bắt buộc để tool chạy:</strong>
                Windows 10 / 11 bản 64-bit, quyền Administrator, và <strong>internet mỗi lần chạy</strong>
                (tool xác minh bản quyền với máy chủ, không có chế độ offline).
                Không hỗ trợ Windows 7 / 8, máy ảo và môi trường không có mạng.
              </p>
              <p>
                <strong class="sp-strong">Không áp dụng bảo hành:</strong>
                dùng sai hướng dẫn, dùng chung tài khoản cho nhiều máy, hoặc dùng phần mềm can thiệp
                vào tool.
              </p>
            </div>
          </section>

          <section class="panel mt-2" id="refund" aria-labelledby="refund-title">
            <h2 class="panel-title" id="refund-title">
              <span class="pt-ico">${icon('undo', { size: 15 })}</span>
              Chính sách hoàn tiền
            </h2>
            <div class="sp-body">
              <p>
                <strong class="sp-strong">Licence đã kích hoạt thì KHÔNG hoàn tiền.</strong>
                Một khi licence đã gắn và tool chạy được trên máy bạn, đơn hàng
                được coi là đã hoàn tất — kể cả khi bạn đổi ý.
              </p>
              <div class="sp-label">Được hoàn 100% qua chuyển khoản</div>
              ${checkList(REFUND_ROWS.map(esc))}
              <div class="sp-label">Không được hoàn</div>
              ${crossList(NO_REFUND_ROWS.map(esc))}
              <p>
                Yêu cầu hoàn tiền trong các trường hợp trên: gửi tên đăng nhập và mã đơn hàng qua Telegram.
                Tiền hoàn về trong vòng 1–2 giờ trong khung hỗ trợ.
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
            <a class="btn btn-ghost btn-sm" href="#/huong-dan">Hướng dẫn chạy app (SmartScreen)</a>
            <p class="sp-muted">
              Cần hỗ trợ? Chỉ cần gửi <strong>tên đăng nhập</strong> và <strong>app đang báo gì</strong>
              (vd "Hết giờ dùng thử", "Gắn máy khác"). Không cần gửi mã gì khác.
            </p>
            <div class="sp-contact">
              <a class="sp-contact-item" href="https://t.me/muabankey" target="_blank" rel="noopener">
                <span class="ic-box">${icon('send', { size: 15 })}</span>
                <span class="sp-contact-body">
                  <span class="sp-contact-t">Telegram</span>
                  <span class="sp-contact-d">Kênh hỗ trợ duy nhất</span>
                </span>
                ${icon('arrowUpRight', { size: 13, cls: 'sp-contact-go' })}
              </a>
              <a class="sp-contact-item" href="#/huong-dan">
                <span class="ic-box">${icon('book', { size: 15 })}</span>
                <span class="sp-contact-body">
                  <span class="sp-contact-t">Hướng dẫn</span>
                  <span class="sp-contact-d">Chạy app, SmartScreen, lỗi thường gặp</span>
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
                Key Bot tư vấn sản phẩm và trả lời câu hỏi trong khung hỗ trợ 8:00 - 23:00.
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
