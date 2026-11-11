const B='https://xienhl.com';
const t=async(p,o={})=>{const s=Date.now();try{const r=await fetch(B+p,o);const tx=await r.text();return{path:p,status:r.status,ms:Date.now()-s,ct:r.headers.get('content-type'),len:tx.length,body:tx.slice(0,1200)};}catch(e){return{path:p,err:String(e),ms:Date.now()-s};}};
const out=[];
out.push(await t('/api/health'));
out.push(await t('/api/stats'));
out.push(await t('/api/products'));
out.push(await t('/api/categories'));
out.push(await t('/api/products/featured'));
out.push(await t('/api/auth/me'));
for(const x of out){console.log('===',x.path,'|',x.status,x.ms+'ms','|',x.ct);console.log(x.body??x.err);console.log();}
