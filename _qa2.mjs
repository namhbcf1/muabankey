const B='https://xienhl.com';
async function req(p,o={}){const s=Date.now();try{const r=await fetch(B+p,o);const t=await r.text();return{s:r.status,ms:Date.now()-s,ct:r.headers.get('content-type'),h:Object.fromEntries(r.headers),b:t};}catch(e){return{err:String(e)}}}
const post=(p,body,extra={})=>req(p,{method:'POST',headers:{'content-type':'application/json',...extra},body});
const show=(n,x)=>{console.log('###',n);if(x.err){console.log('ERR',x.err);return}
console.log('status',x.s,'| too long?',x.b.length,'bytes |',x.ct);
console.log(x.b.slice(0,700));console.log();};

// 22: no body
show('22 POST /api/trial/command NO BODY', await req('/api/trial/command',{method:'POST'}));
// 22b: empty json
show('22b POST with {} ', await post('/api/trial/command','{}'));
// 23: wrong kind
show('23 POST kind=xxx', await post('/api/trial/command',JSON.stringify({kind:'xxx'})));
show('23b POST kind=1h', await post('/api/trial/command',JSON.stringify({kind:'1h'})));
// 24: admin no auth
show('24 GET /api/admin/trial/whitelist', await req('/api/admin/trial/whitelist'));
show('24b POST /api/admin/trial/whitelist', await post('/api/admin/trial/whitelist',JSON.stringify({scope:'ip',value:'1.1.1.1'})));
// extra
show('25 download EXE headers', await req('/download/xa_nofog_pro.exe',{method:'HEAD'}));
show('404 api', await req('/api/nope'));
show('405', await post('/api/stats','{}'));
