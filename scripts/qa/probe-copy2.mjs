/** Kiểm chứng lỗi copy kỹ hơn: lỗi gì, có phải do headless mất focus? */
import { connect } from './harness.mjs';

(async () => {
  const B = await connect();
  await B.viewport(1440, 900, false);
  await B.goto('/products', 3000);
  await B.send('Page.bringToFront').catch(() => {});

  const r = await B.ev(`(async function(){
    var out={hasFocus: document.hasFocus(), vis: document.visibilityState};
    try { await navigator.clipboard.writeText('X1'); out.writeText='OK'; }
    catch(e){ out.writeText='ERR:'+e.name+' :: '+e.message; }

    // thử lại sau khi focus vào body
    document.body.focus();
    try { await navigator.clipboard.writeText('X2'); out.afterFocus='OK'; }
    catch(e){ out.afterFocus='ERR:'+e.name; }

    // đọc lại
    try { out.read = await navigator.clipboard.readText(); } catch(e){ out.read='ERR:'+e.name; }
    return out;
  })()`);
  console.log('PROBE1', JSON.stringify(r, null, 2));

  // thử qua CDP Input thật (mouse click thật) thay vì el.click()
  await B.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await B.goto('/products', 2500);
  await B.ev(`(function(){
    var b=document.createElement('button');
    b.id='realBtn'; b.textContent='COPY'; b.style.cssText='position:fixed;top:10px;left:10px;z-index:99999;width:120px;height:50px';
    b.onclick = async function(){
      try { await navigator.clipboard.writeText('REAL-MEMO'); window.__copyRes='OK'; }
      catch(e){ window.__copyRes='ERR:'+e.name; }
    };
    document.body.appendChild(b);
    return 1;
  })()`);
  const box = await B.ev(`(function(){var r=document.getElementById('realBtn').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await B.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await B.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await B.wait(1200);
  console.log('PROBE2 realClick =', await B.ev('window.__copyRes || "no-result"'));

  await B.close();
})();
