const CACHE_NAME = "today-fragments-v12";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./styles.css?v=12",
  "./app.js",
  "./app.js?v=12",
  "./manifest.webmanifest",
  "./vendor/qrcode-generator.js",
  "./vendor/qrcode-generator.js?v=12",
  "./vendor/jsQR.js",
  "./vendor/jsQR.js?v=12",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(CORE_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: "reload" })
      .then((response) => {
        const copy = response.clone();
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => matchCached(event.request))
  );
});

async function matchCached(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const url = new URL(request.url);
  if (url.search) {
    url.search = "";
    const cleanCached = await caches.match(url.href);
    if (cleanCached) return cleanCached;
  }

  if (request.mode === "navigate") {
    return caches.match("./index.html");
  }
  return Response.error();
}
