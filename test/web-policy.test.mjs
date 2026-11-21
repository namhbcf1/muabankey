/**
 * web-policy.test.mjs — Chính sách đồng nhất + hiệu năng trang chủ + focus search.
 *
 * Khoá các phát hiện audit web:
 *   HIGH   /api/home có ở backend nhưng frontend không dùng (4 round-trip + waterfall)
 *   HIGH   ô tìm kiếm mất focus khi gõ (debounce -> navigate -> re-render)
 *   MEDIUM copy dùng thử mâu thuẫn (1 giờ vs 1 ngày, "không cần đăng ký")
 */
import { Suite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('Web: chính sách & hiệu năng');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Bỏ comment khỏi mã nguồn trước khi soát chuỗi.
 *
 * VÌ SAO CẦN: các khối comment giải thích lỗi cũ có nhắc lại đúng những
 * chuỗi bị cấm ("1 giờ", "không cần đăng ký", api('/api/stats')). Soát trên
 * mã chưa bóc comment sẽ báo lỗi giả.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const homeRaw = read('public/assets/pages/home.js');
const homeCode = stripComments(homeRaw);
const productsCode = stripComments(read('public/assets/pages/products.js'));
const appCode = stripComments(read('public/assets/app.js'));
const libCode = stripComments(read('public/assets/lib.js'));
const clientPolicySrc = read('public/assets/policy.js');
const serverPolicySrc = read('src/lib/policy.js');
const htmlSrc = read('public/index.html');

/* ================================================================== */
S.section('Policy: server và client phải nói CÙNG con số');

{
  const clientDays = Number(/days:\s*(\d+)/.exec(clientPolicySrc)?.[1]);
  const serverDays = Number(/days:\s*(\d+)/.exec(serverPolicySrc)?.[1]);

  S.ok(Number.isFinite(clientDays), 'client policy có days', String(clientDays));
  S.ok(Number.isFinite(serverDays), 'server policy có days', String(serverDays));
  S.eq(clientDays, serverDays, 'days KHỚP giữa client và server');

  const clientReq = /requiresAccount:\s*(true|false)/.exec(clientPolicySrc)?.[1];
  const serverReq = /requiresAccount:\s*(true|false)/.exec(serverPolicySrc)?.[1];
  S.eq(clientReq, serverReq, 'requiresAccount KHỚP');

  const clientMax = /maxAccountsPerDevice:\s*(\d+)/.exec(clientPolicySrc)?.[1];
  const serverMax = /maxAccountsPerDevice:\s*(\d+)/.exec(serverPolicySrc)?.[1];
  S.eq(clientMax, serverMax, 'maxAccountsPerDevice KHỚP');
}

S.section('Policy: không còn chuỗi "1 giờ" hay "không cần đăng ký"');

{
  S.ok(!/1 giờ/.test(homeCode), 'home.js KHÔNG còn "1 giờ" trong mã');
  S.ok(!/Không cần đăng ký/i.test(homeCode),
    'home.js KHÔNG còn "không cần đăng ký" trong mã');
  S.ok(homeRaw.includes("from '../policy.js'"), 'home.js import policy.js');
  S.ok(homeCode.includes('TRIAL.days'), 'home.js dùng TRIAL.days thay vì hardcode');
  S.ok(homeCode.includes('TRIAL_BADGE'), 'hero dùng TRIAL_BADGE từ policy');
  S.ok(homeCode.includes('TRIAL_START_NOTE'),
    'dùng chung ghi chú "bắt đầu từ lần đầu mở app"');

  S.ok(!/1 giờ/.test(htmlSrc), 'index.html KHÔNG còn "1 giờ"');
  S.ok(!/Không cần đăng ký/i.test(htmlSrc), 'index.html KHÔNG còn "không cần đăng ký"');
}

S.section('Hiệu năng: trang chủ dùng MỘT request /api/home');

{
  S.ok(homeCode.includes("api('/api/home')"), 'home.js gọi /api/home');
  S.ok(!/api\('\/api\/trial\/status'\)/.test(homeCode),
    'home.js KHÔNG còn gọi /api/trial/status riêng');
  S.ok(!/api\('\/api\/stats'\)/.test(homeCode),
    'home.js KHÔNG còn gọi /api/stats riêng');
  S.ok(!/await loadTrialQuota\(\)/.test(homeCode),
    'KHÔNG còn waterfall await loadTrialQuota() chặn tải sản phẩm');
  S.ok(!/await loadFeatured\(\)/.test(homeCode),
    'KHÔNG còn await loadFeatured() riêng lẻ');

  /*
   * Đường tải trang: đúng MỘT await api().
   *
   * Mốc cắt dùng BẢN GỐC (homeRaw) vì các dấu `/* ---- N.` là comment và bị
   * stripComments xoá mất. Cắt xong mới bóc comment để đếm.
   */
  const mountStart = homeRaw.indexOf('export async function mountHome');
  const loadPathRaw = homeRaw.slice(
    mountStart,
    homeRaw.indexOf('/* ---- 4.', mountStart),
  );
  const loadPath = stripComments(loadPathRaw);

  const awaits = [...loadPath.matchAll(/await api\(/g)].length;
  S.ok(awaits === 1, 'đường tải trang chỉ có 1 await api()', `${awaits}`);

  // Tổng số lời gọi (gồm cả 2 đường dự phòng: Thử lại + làm mới trial).
  const mountBody = homeCode.slice(homeCode.indexOf('export async function mountHome'));
  const apiCalls = [...mountBody.matchAll(/\bapi\('/g)].length;
  S.ok(apiCalls <= 3,
    'tổng tối đa 3 lời gọi API (1 bundle + 2 dự phòng)', `${apiCalls} lần`);
}

S.section('Hiệu năng: backend gộp đúng một batch');

{
  const productsSrc = read('src/routes/products.js');
  S.ok(productsSrc.includes('export async function homeBundle'), 'backend có homeBundle');
  S.ok(productsSrc.includes('env.DB.batch(stmts)'), 'homeBundle gộp bằng MỘT batch');
  const indexSrc = read('src/index.js');
  S.ok(indexSrc.includes("r.get('/api/home'"), 'index.js đăng ký /api/home');
}

S.section('Focus ô tìm kiếm: KHÔNG điều hướng khi đang gõ');

{
  const searchBlock = productsCode.slice(
    productsCode.indexOf('const onSearch = debounce'),
    productsCode.indexOf("root.querySelector('#sort-select')"),
  );

  S.ok(searchBlock.length > 0, 'tìm thấy khối xử lý search');
  S.ok(!/navigate\(/.test(searchBlock),
    'khối search KHÔNG gọi navigate() (navigate gây re-render -> mất focus)');
  S.ok(/loadPage\(root, current\)/.test(searchBlock),
    'chỉ tải lại LƯỚI sản phẩm, không đụng thanh công cụ');
  S.ok(/history\.replaceState/.test(searchBlock),
    'cập nhật URL bằng replaceState (không phát hashchange)');
  S.ok(/keydown/.test(searchBlock) && /Enter/.test(searchBlock),
    'Enter áp dụng ngay, không chờ debounce');
  S.ok(/onSearch\.cancel\?\./.test(searchBlock),
    'huỷ hẹn giờ trước khi chạy ngay (không gọi API 2 lần)');
}

S.section('debounce có cancel/flush');

{
  S.ok(/wrapped\.cancel\s*=/.test(libCode), 'debounce có .cancel()');
  S.ok(/wrapped\.flush\s*=/.test(libCode), 'debounce có .flush()');
  S.ok(/wrapped\.pending\s*=/.test(libCode), 'debounce có .pending()');
}

S.section('Router giữ focus khi người dùng đang gõ');

{
  S.ok(/if \(isTyping && document\.body\.contains\(active\)\) return;/.test(appCode),
    'focusMainIfNavigating bỏ qua khi đang gõ trong ô nhập còn sống');
}

S.section('Trạng thái dùng thử: đọc từ bundle, không gọi thêm');

{
  S.ok(/function renderTrialState/.test(homeCode), 'có renderTrialState()');
  S.ok(/bundle && bundle\.trial/.test(homeCode), 'đọc trial từ bundle');
  S.ok(/stateName === 'available'/.test(homeCode),
    'xử lý trạng thái available của mô hình mới');
  S.ok(/stateName === 'active'/.test(homeCode), 'xử lý trạng thái active');
  S.ok(/stateName === 'ended'/.test(homeCode), 'xử lý trạng thái ended');
}

S.section('Lỗi bundle -> có đường thử lại, không trang trống');

{
  S.ok(/bundleFailed/.test(homeCode), 'có cờ bundleFailed');
  S.ok(/data-retry-featured/.test(homeCode), 'có nút Thử lại');
  S.ok(/applyStats\(root,/.test(homeCode), 'số liệu lấy từ bundle');
}

process.exit(S.summary() ? 0 : 1);
