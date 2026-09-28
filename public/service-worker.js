const CACHE="maleficent-chat-v2";
const ASSETS=["/","/style.css","/app.js","/manifest.json"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).catch(()=>cached))));
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
