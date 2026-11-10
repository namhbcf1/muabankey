/** Trang hỗ trợ: FAQ, chính sách, hướng dẫn. */
import { esc } from '../lib.js';

const FAQS = [
  ['Key tôi mua có phải hàng chính hãng không?',
   'Có. Tất cả key đều là key Retail/OEM chính hãng mua trực tiếp từ nhà phân phối ủy quyền. Bạn có thể kiểm tra tính hợp lệ bằng công cụ chính thức của Microsoft hoặc nhà cung cấp.'],
  ['Bao lâu thì tôi nhận được key sau khi thanh toán?',
   'Với sản phẩm giao tự động, key hiển thị ngay lập tức trong mục "Đơn hàng" (thường dưới 5 giây). Với sản phẩm giao thủ công (tài khoản), chúng tôi xử lý trong 5-15 phút qua email hoặc Telegram.'],
  ['Tôi nạp tiền nhưng chưa thấy tiền vào ví?',
   'Hệ thống tự động cộng tiền sau 1-2 phút kể từ khi ngân hàng ghi nhận giao dịch. Nếu bạn chuyển sai nội dung, vui lòng liên hệ Telegram/Zalo kèm ảnh chụp giao dịch để được hỗ trợ.'],
  ['Key không kích hoạt được thì sao?',
   'Trong thời hạn bảo hành (365 ngày với Windows/Office, 30 ngày với AI tools, đổi mới với streaming), chúng tôi đổi key mới hoàn toàn miễn phí. Nếu không còn hàng thay thế, bạn được hoàn 100% vào ví.'],
  ['Có được dùng key trên nhiều máy không?',
   'Key Windows/Office Retail bind vào tài khoản Microsoft của bạn nên có thể cài trên nhiều thiết bị cá nhân (thường giới hạn phụ thuộc license). Key tài khoản AI/Streaming chỉ dùng 1 thiết bị tại một thời điểm.'],
  ['Tôi có thể bán lại key cho người khác không?',
   'Về mặt kỹ thuật key đã bind vào tài khoản của bạn nên không chuyển nhượng được. Chúng tôi không hỗ trợ việc mua bán lại.'],
];

export function renderSupport() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <div class="pd-breadcrumb"><a href="#/">Trang chủ</a><span>/</span><span>Hỗ trợ</span></div>
      <div class="sec-head">
        <div>
          <h1 class="sec-title">Trung tâm hỗ trợ</h1>
          <p class="sec-desc">Mọi thứ bạn cần biết về mua hàng, bảo hành và thanh toán</p>
        </div>
      </div>

      <div class="checkout-grid">
        <div>
          <div class="panel" id="guide">
            <div class="panel-title">🛒 Hướng dẫn mua hàng</div>
            <div style="display:flex;flex-direction:column;gap:16px">
              ${[
                ['1', 'Tạo tài khoản', 'Đăng ký bằng email và mật khẩu. Xác nhận trong vài giây, không cần chờ duyệt.'],
                ['2', 'Nạp tiền vào ví', 'Vào mục "Nạp tiền", chọn số tiền, quét mã VietQR bằng app ngân hàng. Tiền vào ví tự động.'],
                ['3', 'Chọn sản phẩm', 'Thêm sản phẩm vào giỏ hàng hoặc bấm "Mua ngay". Kiểm tra tồn kho trước khi đặt.'],
                ['4', 'Thanh toán & nhận key', 'Bấm "Xác nhận thanh toán". Key hiển thị ngay và được lưu vĩnh viễn trong mục Đơn hàng.'],
              ].map(([n, t, d]) => `
                <div class="flex gap-1" style="align-items:flex-start">
                  <div style="width:29px;height:29px;border-radius:9px;display:grid;place-items:center;background:var(--grad-brand);color:#fff;font-weight:800;font-size:13px;flex-shrink:0">${n}</div>
                  <div>
                    <div style="font-size:14px;font-weight:800;margin-bottom:3px">${esc(t)}</div>
                    <div style="font-size:13px;color:var(--text-mute);line-height:1.6">${esc(d)}</div>
                  </div>
                </div>`).join('')}
            </div>
          </div>

          <div class="panel mt-2" id="warranty">
            <div class="panel-title">🛡️ Chính sách bảo hành</div>
            <div style="font-size:13.5px;color:var(--text-dim);line-height:1.8">
              <p style="margin-bottom:12px"><strong style="color:var(--text)">Thời hạn bảo hành:</strong></p>
              <ul style="list-style:none;display:flex;flex-direction:column;gap:7px;margin-bottom:16px">
                <li>✓ Windows & Office: <strong>365 ngày</strong> (1 đổi 1)</li>
                <li>✓ Công cụ AI (ChatGPT, Claude, Gemini): <strong>30 ngày</strong></li>
                <li>✓ Streaming (Netflix, Spotify, YouTube): <strong>đổi mới ngay khi có lỗi</strong></li>
                <li>✓ Bảo mật & VPN: <strong>365 ngày</strong></li>
              </ul>
              <p><strong style="color:var(--text)">Điều kiện bảo hành:</strong> Key không kích hoạt được, bị vô hiệu hoá bởi nhà sản xuất, hoặc tài khoản bị lỗi không do người dùng. Không áp dụng cho trường hợp cài đặt sai, dùng phần mềm crack, hoặc chia sẻ key cho nhiều người.</p>
            </div>
          </div>

          <div class="panel mt-2" id="refund">
            <div class="panel-title">↩️ Chính sách hoàn tiền</div>
            <div style="font-size:13.5px;color:var(--text-dim);line-height:1.8">
              <p style="margin-bottom:12px">Bạn được <strong class="text-green">hoàn 100% vào ví</strong> trong các trường hợp:</p>
              <ul style="list-style:none;display:flex;flex-direction:column;gap:7px">
                <li>✓ Đơn hàng không được giao trong 24 giờ</li>
                <li>✓ Key không hoạt động và không có hàng thay thế</li>
                <li>✓ Sản phẩm không đúng mô tả</li>
              </ul>
              <p class="mt-2">Tiền hoàn về ví trong vòng 1-2 giờ làm việc. Yêu cầu qua Telegram/Zalo kèm mã đơn hàng.</p>
            </div>
          </div>

          <div class="panel mt-2" id="faq">
            <div class="panel-title">❓ Câu hỏi thường gặp</div>
            <div style="display:flex;flex-direction:column;gap:2px">
              ${FAQS.map(([q, a], i) => `
                <details style="border-bottom:1px solid var(--border);padding:13px 0">
                  <summary style="cursor:pointer;font-size:14px;font-weight:700;list-style:none;display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                    <span>${esc(q)}</span>
                    <span style="color:#a99cff;font-size:18px;line-height:1;flex-shrink:0">+</span>
                  </summary>
                  <div style="font-size:13.5px;color:var(--text-dim);line-height:1.7;margin-top:10px">${esc(a)}</div>
                </details>`).join('')}
            </div>
          </div>
        </div>

        <div>
          <div class="panel" style="position:sticky;top:calc(var(--header-h) + 20px)">
            <div class="panel-title">📞 Liên hệ hỗ trợ</div>
            <div class="flex flex-col gap-1">
              <a class="btn btn-primary btn-block" href="https://t.me/muabankey" target="_blank" rel="noopener">✈️ Telegram (nhanh nhất)</a>
              <a class="btn btn-ghost btn-block" href="https://zalo.me/0000000000" target="_blank" rel="noopener">💬 Zalo</a>
              <a class="btn btn-ghost btn-block" href="mailto:support@muabankey.vn">✉️ support@muabankey.vn</a>
            </div>
            <div class="alert alert-info mt-2" style="margin-bottom:0;font-size:12.5px">
              <span class="ico">⏰</span>
              <span>Thời gian hỗ trợ: <strong>8:00 - 23:00</strong> hàng ngày (kể cả cuối tuần)</span>
            </div>

            <div style="margin-top:20px;padding-top:18px;border-top:1px solid var(--border)">
              <div class="panel-title" style="font-size:14px;margin-bottom:12px">🤖 Trợ lý AI</div>
              <p style="font-size:13px;color:var(--text-mute);line-height:1.6;margin-bottom:12px">
                Key Bot có thể tư vấn sản phẩm và trả lời câu hỏi 24/7 tức thì.
              </p>
              <button class="btn btn-gold btn-block" id="open-ai-support">💬 Hỏi Key Bot ngay</button>
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
