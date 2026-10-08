// Study Duel service worker: makes the app load instantly and work offline.
// Bump VERSION whenever you change any app file so phones pick up the update.
const VERSION = "studyduel-v2";
const SHELL = [
  "./", "./index.html", "./app.js", "./i18n.js", "./qr.js", "./firebase-config.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"
];
const CDN_HOSTS = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ours = url.origin === self.location.origin;
  const cdn = CDN_HOSTS.includes(url.hostname) && (url.hostname !== "www.gstatic.com" || url.pathname.startsWith("/firebasejs/"));
  if (!ours && !cdn) return; // Firestore / Auth API calls go straight to the network

  if (req.mode === "navigate") {
    // network first, so a new deploy shows up right away; fall back to the cached shell when offline
    e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
    return;
  }
  // stale-while-revalidate for everything else
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req);
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
