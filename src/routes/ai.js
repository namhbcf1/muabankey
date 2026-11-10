/** Trợ lý AI tư vấn sản phẩm bằng Cloudflare Workers AI. */
import { ok, ApiError, readJson } from '../lib/http.js';
import { str, int } from '../lib/validate.js';
import { rateLimit, clientIp } from '../lib/ratelimit.js';

const SYSTEM_PROMPT = `Bạn là "Key Bot" - trợ lý tư vấn bán hàng của MuaBanKey, cửa hàng bản quyền số uy tín tại Việt Nam.

NHIỆM VỤ:
- Tư vấn sản phẩm phù hợp nhu cầu khách hàng (Windows, Office, AI tools, thiết kế, streaming, VPN, dev tools)
- Giải đáp về cách kích hoạt, bảo hành, hoàn tiền
- Hướng dẫn nạp tiền vào ví và đặt hàng

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
      content: `DANH SÁCH SẢN PHẨM HIỆN CÓ:\n${catalog}\n\nGiá niêm yết bằng VND. Thanh toán qua ví điện tử.`,
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
  const lower = q.toLowerCase();
  const map = [
    [/windows|microsoft|office|word|excel/, 'windows-office'],
    [/ai|chatgpt|claude|gemini|perplexity|trí tuệ/, 'ai-tools'],
    [/design|thiết kế|photoshop|canva|figma|adobe/, 'thiet-ke'],
    [/netflix|spotify|youtube|phim|nhạc|giải trí/, 'giai-tri'],
    [/code|lập trình|dev|github|copilot|ide/, 'lap-trinh'],
    [/vpn|antivirus|bảo mật|diệt virus/, 'bao-mat'],
  ];
  let slug = null;
  for (const [re, s] of map) {
    if (re.test(lower)) { slug = s; break; }
  }
  const sql = slug
    ? 'SELECT slug, name, price FROM products WHERE active = 1 AND category_id = (SELECT id FROM categories WHERE slug = ?) ORDER BY sold_count DESC LIMIT 3'
    : 'SELECT slug, name, price FROM products WHERE active = 1 ORDER BY featured DESC, sold_count DESC LIMIT 3';
  const { results } = slug
    ? await env.DB.prepare(sql).bind(slug).all()
    : await env.DB.prepare(sql).all();
  return (results || []).map((p) => ({ slug: p.slug, name: p.name, price: p.price }));
}

async function keywordAdvice(env, q) {
  const lower = q.toLowerCase();
  const { results } = await env.DB.prepare(
    `SELECT name, price, duration_label FROM products WHERE active = 1 ORDER BY featured DESC, sold_count DESC LIMIT 5`
  ).all();

  if (/giá|bao nhiêu|price/.test(lower)) {
    const list = (results || []).map((p) => `• ${p.name}: ${p.price.toLocaleString('vi-VN')}đ`).join('\n');
    return `Dưới đây là một số sản phẩm bán chạy:\n${list}\n\nBạn cần mình tư vấn cụ thể sản phẩm nào không?`;
  }
  if (/thanh toán|nạp tiền|chuyển khoản|ví/.test(lower)) {
    return 'Bạn nạp tiền bằng cách vào mục "Nạp tiền", quét mã VietQR và chuyển khoản đúng nội dung. Tiền vào ví tự động trong 1-2 phút, sau đó bạn có thể mua key ngay.';
  }
  if (/bảo hành|hoàn tiền|lỗi/.test(lower)) {
    return 'Tất cả sản phẩm đều có bảo hành: Windows/Office 365 ngày, AI tools 30 ngày, streaming đổi mới nếu lỗi. Nếu key không dùng được, bạn liên hệ hỗ trợ và được đổi mới hoặc hoàn tiền 100%.';
  }
  return 'Mình có thể tư vấn Windows/Office, công cụ AI (ChatGPT, Claude), thiết kế (Adobe, Canva), streaming (Netflix, Spotify) và bảo mật (VPN, antivirus). Bạn đang tìm sản phẩm nào ạ?';
}
