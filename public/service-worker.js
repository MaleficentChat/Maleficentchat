const CACHE="maleficent-chat-v16-notifications-room-token";
const ASSETS=["/","/style.css","/app.js","/manifest.json","/favicon.svg","/robots.txt","/sitemap.xml","/doodle-studio.js"];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  const refreshable=event.request.mode==="navigate" ||
    ["/","/index.html","/app.js","/style.css","/manifest.json","/favicon.svg","/robots.txt","/sitemap.xml","/doodle-studio.js"].includes(url.pathname);

  if(refreshable){
    // Network-first for application code and the page shell prevents a
    // service worker from pinning users to an older deployment indefinitely.
    event.respondWith(
      fetch(new Request(event.request,{cache:"no-cache"}))
        .then(response=>{
          if(response.ok){
            const copy=response.clone();
            caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
          }
          return response;
        })
        .catch(()=>caches.match(event.request).then(cached=>cached||Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached=>cached||fetch(event.request).then(response=>{
        if(response.ok&&url.origin===self.location.origin){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
        }
        return response;
      }))
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key.startsWith("maleficent-chat-")&&key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification.data?.url||"/";
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      if("focus" in client){
        await client.focus();
        if("navigate" in client) await client.navigate(target);
        return;
      }
    }
    if(self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
