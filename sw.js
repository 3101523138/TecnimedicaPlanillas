const CACHE_NAME = "tecnomedica-cache-v1";
const urlsToCache = [
  "/",
  "/index.html",
  "/manifest.json",
  "/assets/app.css",
  "/assets/app.js",
  "/assets/icons/favicon-96x96.png",
  "/assets/icons/web-app-manifest-192x192.png",
  "/assets/icons/web-app-manifest-512x512.png"
];

// Instalación
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Activación
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    )
  );
});

// Fetch
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
