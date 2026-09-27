const cacheName = "period-tracker-v14";
const appShell = [
  "./",
  "./index.html",
  "./styles.css?v=14",
  "./backup.js?v=14",
  "./app.js?v=14",
  "./manifest.webmanifest",
  "./assets/apple-touch-icon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(appShell)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener("push", (event) => {
  let data;
  try { data = event.data?.json(); } catch { data = null; }
  event.waitUntil(self.registration.showNotification("Period Tracker", {
    body: data?.test ? "測試通知：推播已連線。" : "今天是預計經期開始日，記得記錄一下。",
    tag: typeof data?.tag === "string" ? data.tag : "period-reminder",
    icon: "./assets/icon-192.png",
    data: { url: self.registration.scope }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) return existing.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
