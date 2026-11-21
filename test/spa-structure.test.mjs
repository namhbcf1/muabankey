/**
 * spa-structure.test.mjs — Cấu trúc DOM + tiêu đề trang của SPA.
 *
 * Khoá các lỗi audit web:
 *   HIGH   <header>/<footer> nằm TRONG <main> (ngược WCAG 1.3.1)
 *   MEDIUM SPA không cập nhật document.title khi đổi route
 *   MEDIUM SPA không quản lý focus khi đổi route
 */
import { Suite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestDocument, buildApp, ensureMain, attach, CHROME_IDS } from './dom-shim.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('Cấu trúc SPA');

const appSrc = readFileSync(join(ROOT, 'public/assets/app.js'), 'utf8');

/* ================================================================== */
S.section('Landmark: header/footer PHẢI nằm ngoài <main>');

{
  const doc = new TestDocument();
  // Markup giống hệt một trang thật (home.js render).
  const app = buildApp(doc, `
    <div id="site-header"></div>
    <section class="hero"></section>
    <h1>Tiêu đề</h1>
    <div id="site-footer"></div>
  `);
  attach(doc, app);

  const before = doc.outline(app);
  S.ok(!app.querySelector('main#main-content'), 'trước: chưa có <main>');

  ensureMain(app);

  const header = app.querySelector('#site-header');
  const footer = app.querySelector('#site-footer');
  const main = app.querySelector('main#main-content');

  S.ok(!!main, 'sau: có <main id="main-content">');
  S.ok(!!header && !!footer, 'sau: header và footer vẫn tồn tại');
  S.ok(doc.insideMain(header) === false,
    'HEADER KHÔNG nằm trong <main>', `ancestry=${doc.ancestry(header).join(' < ')}`);
  S.ok(doc.insideMain(footer) === false,
    'FOOTER KHÔNG nằm trong <main>', `ancestry=${doc.ancestry(footer).join(' < ')}`);

  const h1 = app.querySelector('h1');
  S.ok(doc.insideMain(h1) === true, 'nội dung trang NẰM TRONG <main>');

  // Thứ tự: header -> main -> footer
  const kids = app.childNodes.filter((n) => n.nodeType === 1).map((n) => n.id || n.tagName.toLowerCase());
  S.eq(kids, ['site-header', 'main-content', 'site-footer'],
    'thứ tự đúng: header → main → footer');

  void before;
}

S.section('Landmark: <main> không chứa phần tử overlay (AI widget)');

{
  const doc = new TestDocument();
  const app = buildApp(doc, `
    <div id="site-header"></div>
    <section></section>
    <div id="site-footer"></div>
  `);
  attach(doc, app);
  const ai = doc.createElement('div');
  ai.id = 'ai-fab';
  app.appendChild(ai);

  ensureMain(app);
  S.ok(doc.insideMain(ai) === false, 'AI widget nằm ngoài <main>');
  S.ok(CHROME_IDS.has('ai-fab') === false,
    'ai-fab được xử lý riêng, không nằm trong danh sách placeholder trang',
    [...CHROME_IDS].join(','));
}

S.section('Landmark: trang KHÔNG có header/footer vẫn phải có <main>');

{
  const doc = new TestDocument();
  const app = buildApp(doc, `<section class="only"><h1>x</h1></section>`);
  attach(doc, app);
  ensureMain(app);

  const main = app.querySelector('main#main-content');
  S.ok(!!main, 'vẫn tạo <main>');
  S.ok(main.childNodes.length > 0, '<main> chứa nội dung trang');
  S.ok(doc.querySelector('#site-header') === null, 'không tạo header giả');
}

S.section('Landmark: gọi hai lần không nhân đôi <main>');

{
  const doc = new TestDocument();
  const app = buildApp(doc, `
    <div id="site-header"></div><section></section><div id="site-footer"></div>
  `);
  attach(doc, app);
  ensureMain(app);
  ensureMain(app);

  const mains = app.querySelectorAll('main#main-content');
  S.ok(mains.length === 1, 'chỉ có MỘT <main>', `${mains.length}`);
}

S.section('Landmark: bản shim khớp với app.js thật');

{
  /*
   * Nếu ai đó sửa ensureMain trong app.js mà không cập nhật shim, test trên
   * sẽ xanh giả. So sánh các dấu hiệu cấu trúc quan trọng để phát hiện lệch.
   */
  S.ok(appSrc.includes('const CHROME_IDS = new Set(['),
    'app.js có CHROME_IDS');
  S.ok(appSrc.includes("if (headerEl && headerEl.parentNode === app)"),
    'app.js chèn <main> ngay sau header');
  S.ok(appSrc.includes("headerEl.insertAdjacentElement('afterend', main)"),
    'app.js dùng insertAdjacentElement(afterend)');
  S.ok(appSrc.includes('if (!isChromeNode(node)) content.push(node)'),
    'app.js chỉ chuyển node KHÔNG phải chrome vào <main>');
  S.ok(!/while \(app\.firstChild\) main\.appendChild/.test(appSrc),
    'app.js KHÔNG còn vòng lặp chuyển toàn bộ con vào <main> (lỗi cũ)');
}

S.section('Tiêu đề trang theo route');

{
  S.ok(/document\.title\s*=/.test(appSrc), 'app.js có đặt document.title');
  S.ok(appSrc.includes('function applyRouteTitle'), 'có applyRouteTitle()');
  S.ok(appSrc.includes('export function setPageTitle'), 'có setPageTitle() cho trang tự đặt');
  S.ok(appSrc.includes('const TITLES = {'), 'có bảng tiêu đề');

  // Mọi route khai báo trong ROUTES phải có tiêu đề (route alias dùng tiêu đề
  // của trang đích, khai báo trong routeTitleKey).
  const routesBlock = appSrc.slice(appSrc.indexOf('const ROUTES = ['), appSrc.indexOf('let currentCleanup'));
  const paths = [...routesBlock.matchAll(/pattern:\s*\/\^\\\/([\w-]*)/g)]
    .map((m) => '/' + m[1])
    .filter((p) => p !== '/');

  // Alias: route này hiển thị nội dung của route khác.
  const ALIAS = { '/wallet': '/orders', '/order': '/checkout' };

  const titlesBlock = appSrc.slice(appSrc.indexOf('const TITLES = {'), appSrc.indexOf('const SITE'));
  const keyFn = appSrc.slice(appSrc.indexOf('function routeTitleKey'), appSrc.indexOf('let lastTitleSet'));

  for (const p of paths) {
    const alias = ALIAS[p];
    if (alias) {
      S.ok(keyFn.includes(`'${alias}'`),
        `route alias ${p} dùng tiêu đề của ${alias}`, 'xem routeTitleKey()');
    } else {
      S.ok(titlesBlock.includes(`'${p}'`), `route ${p} có tiêu đề riêng`);
    }
  }
}

S.section('Focus khi đổi route');

{
  S.ok(appSrc.includes('function focusMainIfNavigating'), 'có focusMainIfNavigating()');
  S.ok(/main\.focus\(\{ preventScroll: true \}\)/.test(appSrc),
    'focus vào <main> không cuộn lại');
  S.ok(appSrc.includes('hasRenderedOnce'),
    'không cướp focus ở lần tải đầu');
  S.ok(appSrc.includes("tag === 'input' || tag === 'textarea' || tag === 'select'"),
    'không cướp focus khi người dùng đang gõ trong ô nhập');
  S.ok(appSrc.includes('applyRouteTitle(route, param, matched)'),
    'router gọi applyRouteTitle');
  S.ok(appSrc.includes('focusMainIfNavigating()'),
    'router gọi focusMainIfNavigating');
}

S.section('404 cũng phải có landmark + tiêu đề');

{
  S.ok(/renderNotFound\(\);[\s\S]{0,200}ensureMain\(app\)/.test(appSrc),
    'nhánh 404 gọi ensureMain (cấu trúc landmark đúng)');
  S.ok(appSrc.includes('Không tìm thấy trang · ${SITE}'),
    'nhánh 404 đặt tiêu đề');
}

process.exit(S.summary() ? 0 : 1);
