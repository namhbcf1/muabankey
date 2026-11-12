/** Kiểm chứng lỗi copy: dynamic import() làm mất user activation? */
import { connect } from './harness.mjs';

(async () => {
  const B = await connect();
  await B.viewport(1440, 900, false);
  await B.goto('/products', 3000);

  const r = await B.ev(`(async function(){
    var out={};

    // A: await import() TRƯỚC khi gọi clipboard (giống code hiện tại của checkout)
    out.A = await (async function(){
      var btn=document.createElement('button'); btn.id='tmpA'; document.body.appendChild(btn);
      return await new Promise(function(res){
        btn.onclick = async function(){
          var m = await import('/assets/lib.js');   // await -> mất activation
          var ok = await m.copyText('HELLO-MEMO');
          res({ok:ok, act: navigator.userActivation ? navigator.userActivation.isActive : null});
        };
        btn.click();
      });
    })();

    // B: gọi copyText TRỰC TIẾP (không await import)
    out.B = await (async function(){
      var m = await import('/assets/lib.js');
      var btn=document.createElement('button'); btn.id='tmpB'; document.body.appendChild(btn);
      return await new Promise(function(res){
        btn.onclick = async function(){
          var ok = await m.copyText('HELLO-MEMO');
          res({ok:ok, act: navigator.userActivation ? navigator.userActivation.isActive : null});
        };
        btn.click();
      });
    })();

    // C: chỉ execCommand('copy') trên textarea (fallback trong copyText)
    out.C = await (async function(){
      var btn=document.createElement('button'); btn.id='tmpC'; document.body.appendChild(btn);
      return await new Promise(function(res){
        btn.onclick = function(){
          var ta=document.createElement('textarea'); ta.value='HELLO-MEMO';
          ta.style.position='fixed'; ta.style.opacity='0';
          document.body.appendChild(ta); ta.select();
          var ok=false; try{ ok=document.execCommand('copy'); }catch(e){ ok='ERR:'+e.message; }
          ta.remove(); res({execCommand:ok});
        };
        btn.click();
      });
    })();

    out.hasClipboard = !!navigator.clipboard;
    out.permission = await navigator.permissions.query({name:'clipboard-write'}).then(p=>p.state).catch(e=>'ERR');
    return out;
  })()`);
  console.log(JSON.stringify(r, null, 2));
  await B.close();
})();
