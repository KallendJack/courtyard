// Courtyard's service worker. It keeps the app's own files on the device, so the app opens
// straight away and can still say "worker offline" when the worker can't be reached. It never
// stores anything from the worker's API: sessions, workspaces and logins stay on the worker.

const CACHE = "courtyard-app-v1";
/** The page every route of the app is, kept for when the worker can't be reached. */
const APP_PAGE = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(APP_PAGE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Only the app's own files: never the API, never another site, never anything but reading.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // The newest page when the worker answers; the kept one when it doesn't (or a proxy answers
    // for it with an error), so the app can show its own offline page.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) throw new Error(`status ${response.status}`);
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(APP_PAGE, copy));
          return response;
        })
        .catch(() => caches.match(APP_PAGE).then((kept) => kept ?? Response.error())),
    );
    return;
  }

  // Built files have their content's fingerprint in their names, so a kept copy never goes stale.
  // Icons and the manifest are refreshed in the background.
  event.respondWith(
    caches.match(request).then((kept) => {
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => kept ?? Response.error());
      return url.pathname.startsWith("/assets/") && kept ? kept : (kept ?? fresh);
    }),
  );
});
