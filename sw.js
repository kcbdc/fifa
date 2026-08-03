const CACHE="komsco-kakao-sw-bypass-v54";
const STATIC=["./public/assets/world/world_day.png","./public/assets/world/world_exact_map.png","./public/assets/characters/hunmin.png","./public/assets/characters/daim.png","./public/assets/characters/sunsik.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 const req=e.request,pathname=new URL(req.url).pathname;
 // /api/** 요청은 절대 가로채지 않음 (SW를 완전히 우회, 네트워크로 그대로 통과).
 // 특히 /api/auth/kakao-start 같은 소셜로그인 시작/콜백 요청은 카카오톡 앱 전환 등
 // 추가 리다이렉트 홉을 거칠 수 있는데, 이걸 SW의 fetch()가 대신 따라가려다 실패하면
 // 로그인 자체가 SW 단계에서 막혀버림 (서버 코드까지 도달하지도 못함).
 // API 요청은 원래도 오프라인 캐시 대상이 아니므로 그냥 브라우저가 직접 처리하게 둔다.
 if(pathname.startsWith("/api/"))return;
 const networkFirst=req.mode==="navigate"||/\.(?:html|js|css)$/.test(pathname);
 if(networkFirst)e.respondWith(fetch(req,{cache:"no-store"}).then(res=>{if(!res.redirected){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return res}).catch(()=>caches.match(req)));
 else e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));return res})));
});