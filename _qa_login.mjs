import { launch, connect, newPage, sleep, PROD } from './qa/cdp.mjs';

const b = await launch({ port: 9403, headless: true, width: 1440, height: 900 });
const s = await connect(b.port);
const p = await newPage(s, { width: 1440, height: 900 });

for (const h of ['#/login', '#/orders', '#/wallet', '#/account', '#/licenses', '#/admin']) {
  p.clearLogs();
  await p.goto(PROD + '/' + h);
  await sleep(2000);
  const info = await p.eval(`(() => ({
    hash: location.hash,
    text: document.body.innerText.replace(/\\n+/g,' | ').slice(0,400),
    hasForm: !!document.querySelector('form'),
    inputs: [...document.querySelectorAll('input')].map(i=>i.type+':'+(i.name||i.id||'')),
    btns: [...document.querySelectorAll('button, a[href]')].map(x=>x.textContent.trim().slice(0,30)).filter(Boolean).slice(0,12),
  }))()`);
  console.log('###', h, '=> final hash:', info.hash);
  console.log('   text:', info.text);
  console.log('   hasForm:', info.hasForm, '| inputs:', JSON.stringify(info.inputs));
  console.log('   buttons:', JSON.stringify(info.btns));
  console.log();
}

await p.close(); await b.close();
