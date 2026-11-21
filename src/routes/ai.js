/** Trợ lý AI tư vấn sản phẩm bằng Cloudflare Workers AI. */
import { ok, ApiError, readJson } from '../lib/http.js';
import { str, int } from '../lib/validate.js';
import { rateLimit, clientIp } from '../lib/ratelimit.js';

const SYSTEM_PROMPT = `Bạn là "Key Bot" - trợ lý tư vấn bán hàng của MuaBanKey, cửa hàng bản quyền số uy tín tại Việt Nam.

NHIỆM VỤ:
- Tư vấn sản phẩm phù hợp nhu cầu khách hàng (Windows, Office, AI tools, thiết kế, streaming, VPN, dev tools)
- Giải đáp về cách kích hoạt, bảo hành, hoàn tiền
- Hướng dẫn thanh toán QR và đặt hàng

NGUYÊN TẮC:
- Trả lời bằng tiếng Việt, thân thiện, ngắn gọn (tối đa 120 từ)
- Chỉ tư vấn về sản phẩm/dịch vụ của cửa hàng
- Không bịa đặt thông tin sản phẩm không có trong danh sách
- Không hứa hẹn giảm giá ngoài chương trình đang có
- Nếu khách hỏi ngoài phạm vi, lịch sự hướng về hỗ trợ
- Tất cả sản phẩm đều giao tự động 24/7 hoặc qua email trong 5-15 phút
- Bảo hành: Windows/Office 365 ngày, AI tools 30 ngày, streaming đổi mới khi lỗi`;

export async function aiChat(env, request) {
  const ip = clientIp(request);
  await rateLimit(env, `ai:${ip}`, 20, 3600);

  if (!env.AI) throw new ApiError(503, 'Trợ lý AI tạm thời không khả dụng', 'AI_UNAVAILABLE');

  const body = await readJson(request);
  const message = str(body.message, 'message', { min: 1, max: 1000 });
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];

  // Lấy context sản phẩm thực tế
  const { results: products } = await env.DB.prepare(
    `SELECT name, price, short_desc, stock_count, delivery_type, duration_label, warranty_days
     FROM products WHERE active = 1 ORDER BY featured DESC, sold_count DESC LIMIT 20`
  ).all();

  const catalog = (products || [])
    .map((p) => `- ${p.name}: ${p.price.toLocaleString('vi-VN')}đ (${p.duration_label || 'n/a'}), ${p.short_desc || ''}`)
    .join('\n');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'system',
      content: `DANH SÁCH SẢN PHẨM HIỆN CÓ:\n${catalog}\n\nGiá niêm yết bằng VND. Thanh toán qua chuyển khoản QR.`,
    },
    ...history
      .filter((h) => h && typeof h.content === 'string' && (h.role === 'user' || h.role === 'assistant'))
      .map((h) => ({ role: h.role, content: String(h.content).slice(0, 800) })),
    { role: 'user', content: message },
  ];

  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages,
      max_tokens: 400,
      temperature: 0.6,
    });
    const reply = (response && (response.response || response.result)) || '';
    if (!reply) throw new Error('empty');
    return ok({
      reply: String(reply).trim(),
      suggestions: await buildSuggestions(env, message),
    });
  } catch (e) {
    // Fallback: tư vấn theo từ khoá khi AI fail
    const fallback = await keywordAdvice(env, message);
    return ok({ reply: fallback, fallback: true, suggestions: await buildSuggestions(env, message) });
  }
}

async function buildSuggestions(env, q) {
  /*
   * ĐÃ BỎ bảng ánh xạ từ khoá -> slug danh mục.
   *
   * Lý do: shop chỉ còn MỘT danh mục có sản phẩm (`license-xarena`). Sáu danh
   * mục còn lại (windows-office, ai-tools, thiet-ke, giai-tri, lap-trinh,
   * bao-mat) đều 0 sản phẩm, nên mọi nhánh ánh xạ đều truy vấn ra rỗng và
   * chatbot trả về "gợi ý" trống — tệ hơn là không gợi ý gì.
   *
   * Nay luôn gợi ý theo sản phẩm nổi bật/bán chạy, đúng với thực tế shop.
   */
  void q;
  const { results } = await env.DB.prepare(
    'SELECT slug, name, price FROM products WHERE active = 1 ORDER BY featured DESC, sold_count DESC LIMIT 3'
  ).all();
  return (results || []).map((p) => ({ slug: p.slug, name: p.name, price: p.price }));
}

/**
 * Trả lời theo từ khoá khi AI không dùng được.
 *
 * ============================================================================
 * F09 — BẢN CŨ HƯỚNG DẪN SAI HOÀN TOÀN
 *
 * Bản trước trả về:
 *   "Bạn nạp tiền bằng cách vào mục Nạp tiền, quét mã VietQR… Tiền vào ví tự
 *    động… sau đó bạn có thể mua key ngay."
 *
 * Cả ba thứ đó đều KHÔNG CÒN tồn tại:
 *   • Không có trang "Nạp tiền" và không có ví — chủ shop bỏ mô hình ví.
 *   • Không có "key" để mua — quyền cộng thẳng vào tài khoản.
 *   • Thanh toán là QR THEO ĐƠN, không phải nạp trước.
 *
 * Khách làm đúng theo câu trả lời này sẽ đi tìm một trang không tồn tại.
 * Đây là dạng lỗi tệ nhất của bot: tự tin và sai.
 *
 * Nay câu trả lời lấy từ chính sách đang bán (src/lib/policy.js), nên khi
 * chính sách đổi thì câu trả lời đổi theo.
 * ============================================================================
 */
async function keywordAdvice(env, q) {
  const lower = q.toLowerCase();
  const { trialPolicySentence, FEATURE_LABEL } = await import('../lib/policy.js');

  const { results } = await env.DB.prepare(
    `SELECT name, price, duration_label FROM products WHERE active = 1 ORDER BY featured DESC, sold_count DESC LIMIT 5`
  ).all();

  if (/giá|bao nhiêu|price|gói/.test(lower)) {
    const list = (results || [])
      .map((p) => `• ${p.name}: ${p.price.toLocaleString('vi-VN')}đ`)
      .join('\n');
    return `Dưới đây là các gói đang bán:\n${list}\n\n`
      + `Shop bán hai tính năng: ${FEATURE_LABEL.nofog} và ${FEATURE_LABEL.grant}, `
      + 'gộp trong cùng một app. Bạn cần mình tư vấn gói nào không?';
  }

  if (/thanh toán|chuyển khoản|qr|mua/.test(lower)) {
    return 'Thanh toán theo TỪNG ĐƠN: vào trang sản phẩm, bấm "Mua ngay", '
      + 'hệ thống hiện mã QR VietQR đã điền sẵn số tiền và nội dung. '
      + 'Quét mã bằng app ngân hàng là xong — không cần nạp trước, không có ví. '
      + 'Tiền vào là quyền được cộng thẳng vào tài khoản của bạn.';
  }

  if (/dùng thử|trial|miễn phí/.test(lower)) {
    return trialPolicySentence();
  }

  if (/bảo hành|hoàn tiền|lỗi/.test(lower)) {
    return 'Có bảo hành 1 đổi 1 và hoàn tiền theo quy trình có chứng từ chuyển khoản. '
      + 'Nếu app báo lỗi, bạn gửi mã đơn và ảnh chụp màn hình cho hỗ trợ.';
  }

  if (/mấy máy|thiết bị|đổi máy/.test(lower)) {
    return 'Một tài khoản dùng trên MỘT máy tại một thời điểm. '
      + 'Đổi máy thì mở app và đăng nhập lại trên máy mới — máy cũ sẽ bị ngắt '
      + 'ở lần kiểm tra kế tiếp.';
  }

  return `Shop bán một app duy nhất với hai tính năng: ${FEATURE_LABEL.nofog} `
    + `và ${FEATURE_LABEL.grant}, quyền gắn với tài khoản (không phải mã key). `
    + 'Bạn muốn hỏi về giá, thanh toán, dùng thử hay đổi máy?';
}
