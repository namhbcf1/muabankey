/** Kiểm chứng fix rò rỉ poll timer với file LOCAL (server tạm). */
import { connect } from './harness.mjs';

(async () => {
  const B = await connect();
  await B.viewport(1440, 900, false);
  await B.send('Page.bringToFront').catch(() => {});
  await B.send('Network.clearBrowserCache').catch(() => {});
  await B.send('Network.setCacheDisabled', { cacheDisabled: true });

  // Kiểm tra trực tiếp logic: mountCheckout phải trả về hàm cleanup
  await B.send('Page.navigate', { url: 'https://xienhl.com/?v=' + Date.now() });
  await B.wait(2500);

  const src = await B.ev(`fetch('/assets/pages/checkout.js?v='+Date.now()).then(r=>r.text()).then(t=>{
    return {
      hasQrCleanupVar: /let qrCleanup = null/.test(t),
      hasDoneFn: /const done = \\(\\) => \\(\\) =>/.test(t),
      returnDoneCount: (t.match(/return done\\(\\)/g)||[]).length,
      oldReturnCleanup: /return cleanup \\|\\| undefined/.test(t),
      noBareVarCleanup: !/^\\s+cleanup = showQrPayment/m.test(t),
      len: t.length,
    };
  })`);
  console.log('Deployed checkout.js:', JSON.stringify(src, null, 2));
  await B.close();
})();
