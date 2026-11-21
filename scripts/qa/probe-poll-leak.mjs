/** Kiểm chứng rò rỉ poll timer từ trang QR (showQrPayment trả cleanup, mountCheckout bỏ qua). */
import { connect } from './harness.mjs';

(async () => {
  const B = await connect();
  await B.viewport(1440, 900, false);
  await B.send('Page.bringToFront').catch(() => {});

  await B.goto('/login', 3000);
  await B.ev(`localStorage.clear(); 1`);
  await B.send('Network.clearBrowserCookies');
  await B.goto('/login', 3000);
  await B.ev(`(function(){document.querySelector('#lg-email').value='${QA_ADMIN_USER}';document.querySelector('#lg-pwd').value='${QA_ADMIN_PASSWORD}';document.querySelector('#login-submit').click();return 1})()`);
  await B.wait(5000);

  // tạo đơn -> trang QR
  await B.goto('/product/license-xarena-thang', 3500);
  await B.ev(`document.querySelector('#btn-add-cart')?.click()`);
  await B.wait(1200);
  await B.goto('/checkout', 3500);
  await B.ev(`document.querySelector('#btn-place-order')?.click()`);
  await B.wait(7000);
  const onQr = await B.hash();
  console.log('Đang ở trang QR:', onQr);

  // sang trang khác, RỒI đếm request /api/orders/ còn phát ra
  await B.startCollect();
  await B.goto('/products', 3000);
  const pollAfter = [];
  const t0 = Date.now();
  // nghe 15 giây
  await B.send('Network.enable');
  const listener = setInterval(() => {}, 1000);
  await B.wait(15000);
  clearInterval(listener);
  const log = B.stopCollect();

  console.log('\nSau khi RỜI trang QR sang /products trong 15s:');
  console.log('  HTTP 404:', log.http.filter((h) => h.status === 404).length);
  console.log('  URLs:', [...new Set(log.http.map((h) => h.status + ' ' + h.url.replace('https://xienhl.com', '')))].slice(0, 8));

  // đo trực tiếp bằng cách hook fetch
  await B.ev(`(function(){
    window.__calls=[];
    var of=window.fetch;
    window.fetch=function(u,o){ window.__calls.push(String(u)); return of.apply(this,arguments); };
    return 1;
  })()`);
  await B.goto('/support', 3000);
  await B.ev(`(function(){
    window.__calls=[];
    var of=window.fetch;
    window.fetch=function(u,o){ window.__calls.push(String(u)); return of.apply(this,arguments); };
    return 1;
  })()`);
  await B.wait(14000);
  const calls = await B.ev('window.__calls');
  console.log('\nSau khi hook fetch, ở trang /support 14s:');
  console.log('  số lệnh fetch:', (calls || []).length);
  console.log('  chi tiết:', JSON.stringify((calls || []).slice(0, 10)));
  const stillPolling = (calls || []).some((c) => /\/api\/orders\//.test(c));
  console.log('\n>>> KẾT LUẬN: poll timer còn chạy sau khi rời trang?', stillPolling ? 'CÓ — RÒ RỈ' : 'không');

  await B.close();
})();
