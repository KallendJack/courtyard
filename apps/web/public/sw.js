// Courtyard's service worker. It keeps the app's own files on the device, so the app opens
// straight away and can still say "worker offline" when the worker can't be reached. It never
// stores anything from the worker's API: sessions, workspaces and logins stay on the worker.
//
// The build fills in BUILD and FILES (apps/web/scripts/finish-build.mjs): each build keeps its
// files under its own name, and the previous build's are cleared once this one takes over.

const BUILD = "__COURTYARD_BUILD__";
/**
 * Every file the app is made of, kept on install so pages not yet opened work offline too; all but
 * Mermaid's, which are kept once a diagram needs them, like any file fetched.
 */
const FILES = /* __COURTYARD_FILES__ */ [];

const CACHE = `courtyard-app-${BUILD}`;
/** The page every route of the app is, kept for when the worker can't be reached. */
const APP_PAGE = "/index.html";

/** The kind of file each built file must be, so an error page is never kept in a file's place. */
const EXPECTED_TYPE = { ".js": "javascript", ".css": "css", ".png": "image/", ".svg": "image/" };

const isTheRightKind = (url, response) => {
  const extension = Object.keys(EXPECTED_TYPE).find((ext) => url.pathname.endsWith(ext));
  const type = response.headers.get("content-type") ?? "";
  return extension === undefined || type.includes(EXPECTED_TYPE[extension]);
};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([APP_PAGE, ...FILES])));
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
    event.respondWith(
      fetch(request)
        .then((response) => {
          // A redirect (a login in front of Courtyard, say) is the browser's to follow.
          if (response.type === "opaqueredirect" || response.redirected) return response;
          // A proxy answering for a worker that's down counts as no answer.
          if (response.status >= 500) throw new Error(`status ${response.status}`);
          // Only the app's page is kept as the app's page: not an icon opened in a tab.
          if (response.ok && (response.headers.get("content-type") ?? "").includes("text/html")) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(APP_PAGE, copy));
          }
          return response;
        })
        .catch(() => caches.match(APP_PAGE).then((kept) => kept ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((kept) => {
      // Built files are named after their content, so a kept copy is always the right one.
      if (kept) return kept;
      return fetch(request).then((response) => {
        if (response.ok && isTheRightKind(url, response)) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

// Notifications (#173): the worker pushes one when a session needs the owner's OK, and when a
// turn finishes or fails. It carries only the session's title, what it needs, and the session's
// id, since it shows on a locked screen; a tap opens that session.

/** A notification's parts, or nothing when a push isn't one of Courtyard's. */
const noticeIn = (data) => {
  try {
    const notice = data?.json();
    const parts = [notice?.title, notice?.body, notice?.session];
    return parts.every((part) => typeof part === "string") ? notice : undefined;
  } catch {
    return undefined;
  }
};

/** Whether the owner has the session open in front of them on this device already. */
const watching = async (session) => {
  const windows = await self.clients.matchAll({ type: "window" });
  return windows.some(
    (window) =>
      window.visibilityState === "visible" &&
      new URL(window.url).pathname.endsWith(`/sessions/${session}`),
  );
};

self.addEventListener("push", (event) => {
  const notice = noticeIn(event.data);
  if (notice === undefined) return;
  event.waitUntil(
    watching(notice.session).then((open) => {
      if (open) return;
      return self.registration.showNotification(notice.title, {
        body: notice.body,
        icon: "/icons/icon-192.png",
        // A session's newer notification replaces its older one.
        tag: notice.session,
        data: { session: notice.session },
      });
    }),
  );
});

/** How long a tap waits to hear which workspace a session is in, before opening the home page. */
const FIND_SESSION_MS = 3000;

/** The page a session is on, asked of the worker, since the notification doesn't carry it. */
const pageOf = async (session) => {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(session)}`, {
      signal: AbortSignal.timeout(FIND_SESSION_MS),
    });
    const found = response.ok ? await response.json() : undefined;
    if (typeof found?.workspaceId !== "string") return "/";
    return `/workspaces/${encodeURIComponent(found.workspaceId)}/sessions/${encodeURIComponent(session)}`;
  } catch {
    return "/";
  }
};

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const session = event.notification.data?.session;
  if (typeof session !== "string") return;
  event.waitUntil(
    pageOf(session).then(async (page) => {
      const windows = await self.clients.matchAll({ type: "window" });
      const open = windows.find((window) => new URL(window.url).pathname === page);
      if (open) return open.focus();
      // Courtyard already open: that window goes to the session, rather than another opening.
      const app = windows[0];
      if (app) {
        return app
          .navigate(page)
          .then((moved) => moved?.focus())
          .catch(() => self.clients.openWindow(page));
      }
      return self.clients.openWindow(page);
    }),
  );
});
