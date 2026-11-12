/** Xác minh lại /tai-ve sau khi CDN cache được bust. */
import { connect } from './harness.mjs';

(async () => {
  const B = await connect();
  await B.viewport(1440, 900, false);
  await B.send('Page.bringToFront').catch(() => {});
  await B.send('Network.clearBrowserCache').catch(() => {});
  await B.send('Network.setCacheDisabled', { cacheDisabled: true });

  // ép tải lại module download.js với query phá cache
  const url = 'https://xienhl.com/?_t=' + Date.now() + '#/tai-ve';
  await B.send('Page.navigate', { url });
  await B.wait(5000);

  const r = await B.ev(`(function(){
    var d=document.documentElement;
    var svgs=Array.from(document.querySelectorAll('svg'));
    var big=svgs.filter(function(s){ return s.getBoundingClientRect().width > 2000; });
    return {
      scrollW: d.scrollWidth, clientW: d.clientWidth,
      overflow: d.scrollWidth > d.clientWidth + 1,
      totalSvg: svgs.length,
      bigSvg: big.length,
      maxSvgW: Math.max(0, ...svgs.map(function(s){return Math.round(s.getBoundingClientRect().width)})),
      textLen: document.body.innerText.length,
      hasDownloadBtn: !!document.querySelector('[data-dl-url]'),
      hasHash: !!document.querySelector('[data-dl-hash]'),
      hashText: (document.querySelector('[data-dl-hash]')||{}).textContent||'',
      hasSmartScreen: /SmartScreen|Windows protected/i.test(document.body.innerText),
      btnHref: (document.querySelector('[data-dl-url]')||{}).getAttribute ? document.querySelector('[data-dl-url]').getAttribute('href') : null,
      title: (document.querySelector('.dl-title')||{}).innerText||'',
    };
  })()`);
  console.log(JSON.stringify(r, null, 2));

  await B.shot('A4b-download-fixed', { clip: { x: 0, y: 0, width: 1440, height: 1400 } });

  // mobile
  await B.viewport(390, 844, true);
  await B.send('Page.navigate', { url: 'https://xienhl.com/?_t2=' + Date.now() + '#/tai-ve' });
  await B.wait(4500);
  const m = await B.overflow();
  const mb = await B.ev(`(function(){
    var b=document.querySelector('[data-dl-url]');
    var r=b?b.getBoundingClientRect():null;
    return {btnH:r?Math.round(r.height):0, btnW:r?Math.round(r.width):0,
      scrollW:document.documentElement.scrollWidth,
      hashVisible: !!document.querySelector('[data-dl-hash]')};
  })()`);
  console.log('\nMOBILE 390:', JSON.stringify({ docOverflow: m.docOverflow, ...mb }));
  await B.shot('A4c-download-fixed-mobile', { clip: { x: 0, y: 0, width: 390, height: 1400 } });
  await B.close();
})();
