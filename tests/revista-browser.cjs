const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const official='https://revista-quilmes-conectado.pages.dev';
const api='https://api.github.com/repos/carlosalbertorecalde-sys/revista-quilmes-conectado/';
const root=process.cwd();
function fixturePdf(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 500] /Resources << >> /Contents 4 0 R >>','<< /Length 25 >>\nstream\n0 0 1 rg 20 20 90 90 re f\nendstream','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 300] /Resources << >> /Contents 6 0 R >>','<< /Length 25 >>\nstream\n1 0 0 rg 30 30 90 90 re f\nendstream'];
 let s='%PDF-1.4\n',offset=[0];for(let i=0;i<objects.length;i++){offset.push(Buffer.byteLength(s));s+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}const xref=Buffer.byteLength(s);s+='xref\n0 '+offset.length+'\n0000000000 65535 f \n'+offset.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+offset.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(s);
}
(async()=>{
 const browser=await chromium.launch({headless:true});try{
 const ctx=await browser.newContext({viewport:{width:412,height:870},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 let head='fixture-head',current={_pages:2,_layouts:{1:1}},draft={_pages:8,_layouts:{1:1,2:2},1:{name:'Existing',image:'anuncios/existing.webp'},7:{name:'Keep',image:'anuncios/keep.webp'}},draftSha='draft-start',tree=null,commits=0,writes=0,conflict=false,failReload=false,reloadFailed=false;
 const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,PATCH,OPTIONS','access-control-allow-headers':'*'};
 const logs=[];
 await ctx.route('**/*',async r=>{
  const req=r.request(),url=new URL(req.url());
  if(req.url().startsWith(api)){
   if(req.method()==='OPTIONS')return r.fulfill({status:204,headers:cors});
   if(req.headers().authorization!=='Bearer fixture-only')throw Error('Unexpected credential');
   const p=url.pathname.slice(new URL(api).pathname.length),method=req.method(),body=req.postDataJSON();
   let out,status=200;
   if(method==='GET'&&p==='contents/anuncios.json')out={sha:'public-start',content:Buffer.from(JSON.stringify(current)).toString('base64')};
   else if(method==='GET'&&p==='contents/borrador.json'){if(reloadFailed){status=503;out={message:'fixture reload unavailable'};}else out={sha:draftSha,content:Buffer.from(JSON.stringify(draft)).toString('base64')};}
   else if(method==='GET'&&p.startsWith('git/ref/heads/'))out={object:{sha:head}};
   else if(method==='GET'&&p.startsWith('git/commits/'))out={tree:{sha:'fixture-base-tree'}};
   else if(method==='PUT'&&p.startsWith('contents/anuncios/')){assert.ok(Buffer.from(body.content,'base64').length>0);assert.equal(body.branch,'main');await new Promise(r=>setTimeout(r,600));out={content:{path:p.slice('contents/'.length)}};}
   else if(method==='POST'&&p==='git/blobs'){assert.equal(body.encoding,'base64');assert.ok(Buffer.from(body.content,'base64').length>0);out={sha:'blob-'+(++writes)};}
   else if(method==='POST'&&p==='git/trees'){tree=body.tree;out={sha:'tree-'+writes};}
   else if(method==='POST'&&p==='git/commits'){assert.deepEqual(body.parents,[head]);out={sha:'commit-'+(++commits)};}
   else if(method==='PATCH'&&p.startsWith('git/refs/heads/')){assert.equal(body.force,false);if(conflict){status=422;out={message:'fixture conflict'};}else{const entry=tree.find(x=>x.path==='borrador.json');assert.ok(entry);draft=JSON.parse(entry.content);draftSha='draft-'+commits;head=body.sha;if(failReload)reloadFailed=true;out={object:{sha:head}};}}
   else{throw Error('Unexpected API route '+method+' '+p);}
   logs.push(method+' '+p);return r.fulfill({status,headers:cors,contentType:'application/json',body:JSON.stringify(out)});
  }
  if(url.origin===official||url.origin==='https://preview.invalid'){
   const rel=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
   const f=path.resolve(root,rel);
   if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile()){const ext=path.extname(f),types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'};return r.fulfill({path:f,contentType:types[ext]||'application/octet-stream'});}
   return r.fulfill({status:404,body:'fixture not found'});
  }
  return r.abort('blockedbyclient');
 });
 const page=await ctx.newPage();page.on('dialog',d=>d.accept());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://preview.invalid/admin.html');await page.locator('#token').fill('fixture-only');await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('sin conexión'));assert.equal(logs.length,0);
 await page.goto(official+'/admin.html');await page.locator('#token').fill('fixture-only');await page.locator('#connect').click();await page.waitForFunction(()=>!document.querySelector('#edition').disabled);
 await page.locator('#smartOpen').click();assert.equal(await page.locator('#smartDialog').isVisible(),false);
 assert.equal(await page.locator('#smartNotice').isVisible(),true);assert.match(await page.locator('#smartNotice').innerText(),/Estás en Edición publicada/);
 await page.locator('#edition').selectOption('borrador.json');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Editando borrador'));
 const makePng=async(w,h)=>Buffer.from(await page.evaluate(([w,h])=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#10549a';x.fillRect(0,0,w,h);return c.toDataURL('image/png').split(',')[1];},[w,h]),'base64');
 const h=await makePng(240,100),v=await makePng(100,240);
 const file=(name,buffer)=>({name,mimeType:'image/png',buffer});
 assert.equal(await page.locator('#batch,#multi,#queue').count(),0);assert.equal(await page.getByText('Cargar varias imágenes (hasta 30)',{exact:true}).count(),0);console.log('OK: obsolete 30-image upload removed');
 await page.locator('#smartOpen').click();
 assert.equal(await page.locator('#smartDialog').isVisible(),true);assert.equal(await page.locator('#smartHeading').isVisible(),true);assert.equal(await page.locator('#edition').isVisible(),false);assert.equal(await page.locator('#smartClose').isVisible(),true);
 await page.evaluate(()=>{window.fixtureDecode=window.createImageBitmap;window.createImageBitmap=()=>Promise.reject(Error('fixture Android decoder unavailable'))});
 await page.locator('#smartFiles').setInputFiles([file('h1.png',h),file('h2.png',h),file('v1.png',v)]);
 await page.waitForFunction(()=>!document.querySelector('#smartSave').disabled);
 assert.match(await page.locator('#smartStatus').innerText(),/3 imágenes.*2 horizontales.*1 verticales.*2 páginas/);
 assert.equal(await page.locator('#smartFiles').evaluate(e=>e.files.length),3);assert.equal(await page.locator('#smartPreview img').count(),3);console.log('OK: inline mobile panel, image decoder fallback, retained file selection');
 await page.locator('#smartSave').click();await page.waitForFunction(()=>document.querySelector('#smartStatus').textContent.includes('Guardadas 3 imágenes'),{},{timeout:30000});
 assert.equal(draft[1].name,'Existing');assert.equal(draft[7].name,'Keep');assert.equal(Object.keys(draft).filter(k=>/^\d+$/.test(k)).length,5);assert.deepEqual(current,{_pages:2,_layouts:{1:1}});
 await page.locator('#smartClose').click();
 assert.equal(await page.locator('#smartDialog').isVisible(),false);assert.equal(await page.locator('#edition').isVisible(),true);await page.evaluate(()=>{window.createImageBitmap=window.fixtureDecode;delete window.fixtureDecode});
 await page.locator('#articleOpen').click();await page.locator('#articleStart').fill('7');
 await page.locator('#smartFiles').setInputFiles([{name:'report.pdf',mimeType:'application/pdf',buffer:fixturePdf()},file('extra.png',v)]);
 await page.waitForFunction(()=>!document.querySelector('#smartSave').disabled,{},{timeout:60000});
 assert.match(await page.locator('#smartStatus').innerText(),/páginas 7 a 9/);
 await page.locator('#articleTitle').fill('Fixture report');await page.locator('#smartSave').click();await page.waitForFunction(()=>document.querySelector('#smartStatus').textContent.includes('Guardadas 3 imágenes'),{},{timeout:30000});
 assert.equal(Object.values(draft._articles)[0].count,3);assert.equal(draft._layouts[7],1);assert.equal(draft._layouts[9],1);
 await page.locator('#smartClose').click();
 await page.locator('#smartOpen').click();await page.locator('#smartFiles').setInputFiles([file('conflict.png',v)]);await page.waitForFunction(()=>!document.querySelector('#smartSave').disabled);
 const old=JSON.stringify(draft);conflict=true;await page.locator('#smartSave').click();await page.waitForFunction(()=>document.querySelector('#smartStatus').textContent.includes('No se confirmó la carga'));assert.equal(JSON.stringify(draft),old);
 conflict=false;
 await page.locator('#smartClose').click();
 await page.locator('#partialSelect').selectOption('2:2');
 await page.locator('#partialFill').click();
 await page.locator('#smartFiles').setInputFiles([file('fill-bottom.png',h)]);
 await page.waitForFunction(()=>!document.querySelector('#smartSave').disabled);
 await page.locator('#smartSave').click();
 await page.waitForFunction(()=>document.querySelector('#smartStatus').textContent.includes('Guardadas 1 imágenes'),{},{timeout:30000});
 assert.equal(draft[7].name,'Keep');assert.equal(draft[8].name,'fill-bottom');
 await page.locator('#smartClose').click();
 await page.locator('#emptyPageSelect').selectOption('5');
 await page.locator('#emptyFill').click();
 await page.locator('#smartFiles').setInputFiles([file('full-page.png',v)]);
 await page.waitForFunction(()=>!document.querySelector('#smartSave').disabled);
 await page.locator('#smartSave').click();
 await page.waitForFunction(()=>document.querySelector('#smartStatus').textContent.includes('Guardadas 1 imágenes'),{},{timeout:30000});
 assert.equal(draft._layouts[5],1);assert.equal(draft[25].name,'full-page');
 await page.locator('#smartClose').click();
 const beforeSchedule=commits;
 await page.locator('#publishDate').fill('2099-12-01');
 await page.locator('#scheduleEdition').click();
 assert.match(await page.locator('#status').innerText(),/páginas vacías/);
 assert.equal(commits,beforeSchedule);assert.equal(draft._publishAt,undefined);
 await page.locator('#smartOpen').click();
 await page.locator('#smartFiles').setInputFiles([{name:'wrong.pdf',mimeType:'application/pdf',buffer:fixturePdf()}]);
 await page.waitForFunction(()=>document.querySelector('#smartStatus').textContent.includes('No se importaron'));
 assert.equal(await page.locator('#smartSave').isDisabled(),true);assert.equal(commits,beforeSchedule);
 await page.locator('#smartClose').click();
 failReload=true;
 await page.locator('#smartOpen').click();await page.locator('#smartFiles').setInputFiles([file('saved-once.png',v)]);await page.waitForFunction(()=>!document.querySelector('#smartSave').disabled);await page.locator('#smartSave').click();await page.waitForFunction(()=>document.querySelector('#smartStatus').textContent.includes('El borrador se guardó, pero no se pudo recargar'));
 assert.equal(commits,beforeSchedule+1);assert.equal(Object.values(draft).filter(x=>x?.name==='saved-once').length,1);assert.equal(await page.locator('#smartSave').isDisabled(),true);
 await page.locator('#smartClose').click();await page.locator('#smartOpen').click();assert.equal(await page.locator('#smartDialog').isVisible(),false);
 reloadFailed=false;failReload=false;await page.locator('#token').fill('fixture-only');await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Conectado'));
 console.log('OK: committed once, refresh failure requires reconnect');
 await page.locator('#edition').selectOption('borrador.json');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Editando borrador'));
 await page.locator('#page').selectOption('6');await page.locator('#name').fill('Manual fixture');await page.locator('#photo').setInputFiles(file('manual.png',v));
 await page.locator('#publish').click();await page.waitForFunction(()=>document.querySelector('main > section').inert===true);assert.equal(await page.locator('#edition').evaluate(e=>e.closest('section').inert),true);
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Publicidad guardada en borrador'));
 assert.equal(draft[31].name,'Manual fixture');assert.equal(await page.locator('#edition').evaluate(e=>e.closest('section').inert),false);assert.deepEqual(current,{_pages:2,_layouts:{1:1}});
 console.log('OK: manual upload locks navigation and preserves active edition');
 assert.deepEqual(errors,[]);console.log('OK: browser image batch, mixed PDF, existing ads, preview-origin lock, atomic mock conflict');
 console.log('OK: fill partial, fill empty, schedule guard, reject PDF in ads mode');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
