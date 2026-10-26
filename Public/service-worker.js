const CACHE="maleficent-chat-v5";
const ASSETS=["/","/style.css","/app.js","/manifest.json"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).catch(()=>cached))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("maleficent-chat-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
