const CACHE_NAME = "tecnomedica-cache-v3";
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

// Instalación: cachea los archivos base y se salta la espera para activarse
// inmediatamente. skipWaiting asegura que un SW nuevo no quede en estado
// "waiting" hasta que el usuario cierre todas las pestañas.
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Activación: borra caches antiguos y reclama control sobre los clients ya
// abiertos (clients.claim) para que la próxima petición ya use este SW.
self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => caches.delete(name))
        )
      ),
      self.clients.claim(),
    ])
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
