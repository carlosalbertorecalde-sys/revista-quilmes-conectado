/* Public image cache only. No admin HTML, manifests, tokens or API requests. */
const CACHE='qc-public-images-v1';
const LIMIT=30*1024*1024,MAX_IMAGE=3*1024*1024,MAX_ENTRIES=100;
let writes=Promise.resolve();
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function eligible(request){
 const u=new URL(request.url);
 return request.method==='GET'&&request.destination==='image'&&u.origin===self.location.origin&&
 /^\/anuncios\/[A-Za-z0-9._-]+\.(webp|png|jpe?g)$/i.test(u.pathname)&&
 u.searchParams.get('qc_public')==='1'&&/^[0-9a-f]{64}$/.test(u.searchParams.get('v')||'')&&
 [...u.searchParams.keys()].every(k=>k==='qc_public'||k==='v');
}
async function store(request,response){
 if(!response.ok||response.redirected||!/^image\/(webp|png|jpeg)(;|$)/i.test(response.headers.get('content-type')||''))return;
 if(Number(response.headers.get('content-length')||0)>MAX_IMAGE)return;
 const reader=response.body?.getReader();if(!reader)return;
 const chunks=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_IMAGE){await reader.cancel();return}chunks.push(value)}
 }finally{reader.releaseLock()}
 if(!size)return;
 const cache=await caches.open(CACHE);
 const keys=await cache.keys();
 let total=0;const entries=[];
 for(const key of keys){const old=await cache.match(key);const bytes=Number(old?.headers.get('x-qc-bytes')||0);if(!Number.isFinite(bytes)||bytes<=0){await cache.delete(key);continue}entries.push({key,bytes});total+=bytes}
 let count=entries.length;
 for(const entry of entries){
  if(total+size<=LIMIT&&count<MAX_ENTRIES)break;
  if(await cache.delete(entry.key)){total-=entry.bytes;count--}
 }
 await cache.put(request,new Response(new Blob(chunks),{headers:{'Content-Type':response.headers.get('content-type'),'X-QC-Bytes':String(size)}}));
}
self.addEventListener('fetch',event=>{
 if(!eligible(event.request))return;
 const request=event.request;
 event.respondWith((async()=>{
  try{const hit=await (await caches.open(CACHE)).match(request);if(hit)return hit}catch(_){}
  const response=await fetch(request);
  if(response.ok){
   const copy=response.clone();
   const task=writes.then(()=>store(request,copy)).catch(()=>{});
   writes=task;
   await task;
  }
  return response;
 })());
});
