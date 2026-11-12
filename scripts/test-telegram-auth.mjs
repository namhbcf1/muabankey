/**
 * test-telegram-auth.mjs — kiểm chứng vá lỗ xác thực callback Telegram.
 *
 * 3 kịch bản phải bị chặn/cho qua đúng:
 *   1. TG_CHAT_ID CHƯA cấu hình  -> TỪ CHỐI (trước đây CHO QUA = lỗ)
 *   2. Người lạ bấm (from.id khác) -> TỪ CHỐI
 *   3. Thành viên nhóm admin bấm (from.id khác chat.id nhóm) -> TỪ CHỐI
 *   4. Đúng admin bấm -> CHO QUA
 *
 * Chạy: node scripts/test-telegram-auth.mjs [baseUrl]
 * Yêu cầu: dev server local đã chạy, .dev.vars có TG_WEBHOOK_SECRET.
 */
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8795';

function devVar(name) {
  try {
    const t = readFileSync('.dev.vars', 'utf8');
    const m = t.match(new RegExp('^' + name + '=(.*)$', 'm'));
    return m ? m[1].trim() : null;
  } catch { return null; }
}

const SECRET = devVar('TG_WEBHOOK_SECRET');
if (!SECRET) {
  console.log('Thiếu TG_WEBHOOK_SECRET trong .dev.vars — dừng.');
  process.exit(1);
}

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

/** Gửi 1 callback giả, trả body JSON. */
async function callback({ fromId, chatId, secret = SECRET }) {
  const body = {
    callback_query: {
      id: 'test-cq-1',
      from: { id: Number(fromId), first_name: 'Test' },
      message: { chat: { id: Number(chatId) }, message_id: 1 },
      data: 'tp:ok:00000000-0000-0000-0000-000000000000',
    },
  };
  const res = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': secret,
    },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* */ }
  return { status: res.status, data };
}

console.log('=== 0. Secret sai phải bị 401 ===');
{
  const r = await callback({ fromId: 1, chatId: 1, secret: 'sai-hoan-toan' });
  ok('secret sai -> 401', r.status === 401, `status=${r.status}`);
}

console.log('\n=== 1. Người lạ bấm (from.id khác admin) ===');
{
  const admin = devVar('TG_CHAT_ID') || '999888777';
  const r = await callback({ fromId: Number(admin) + 12345, chatId: admin });
  const denied = r.data?.denied === 'not_admin' || r.data?.denied === 'no_admin_chat_configured';
  ok('người lạ -> bị từ chối', r.status === 200 && denied,
    `status=${r.status} body=${JSON.stringify(r.data)}`);
}

console.log('\n=== 2. Thành viên nhóm admin bấm (chat là nhóm, from là người khác) ===');
{
  // Nhóm có id âm; admin id dương. Trước đây chỉ cần msgChat==allowed là qua.
  const groupId = -1001234567890;
  const memberId = 555000111;
  const r = await callback({ fromId: memberId, chatId: groupId });
  const denied = r.data?.denied === 'not_admin' || r.data?.denied === 'no_admin_chat_configured';
  ok('thành viên nhóm -> bị từ chối', r.status === 200 && denied,
    `status=${r.status} body=${JSON.stringify(r.data)}`);
}

console.log('\n=== 3. Đúng admin bấm ===');
{
  const adminCfg = (devVar('TG_CHAT_ID') || '').trim();
  const r = await callback({ fromId: Number(adminCfg || '0'), chatId: Number(adminCfg || '0') });
  if (!adminCfg) {
    /*
     * Chưa cấu hình chat id -> fail-closed là ĐÚNG. Đây là hành vi ta muốn:
     * không biết admin là ai thì không duyệt được, thay vì bản cũ cho qua.
     */
    ok('không có TG_CHAT_ID -> fail-closed (từ chối)', r.data?.denied === 'no_admin_chat_configured',
      `body=${JSON.stringify(r.data)}`);
  } else {
    ok('admin -> không bị chặn quyền',
      r.status === 200 && r.data?.denied !== 'not_admin' && r.data?.denied !== 'no_admin_chat_configured',
      `status=${r.status} body=${JSON.stringify(r.data).slice(0, 200)}`);
  }
}

console.log('\n' + '─'.repeat(54));
console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
if (fail) {
  console.log('\nLỗi:\n' + fails.map((f) => '  • ' + f).join('\n'));
  process.exit(1);
}
console.log('🎉 XÁC THỰC CALLBACK TELEGRAM CHẶT');
