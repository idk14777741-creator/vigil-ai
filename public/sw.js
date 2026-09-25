/* VIGIL AI service worker — static shell only.
 *
 * Strategy: cache-first for the app shell (HTML/CSS/JS/icons/manifest),
 * network-only for everything under /api/ (data is never served stale —
 * this is a wellness app, wrong data is worse than no data).
 *
 * Bump CACHE_VERSION whenever shell assets change to invalidate old caches.
 */
const CACHE_VERSION = "vigil-shell-v6";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/css/tokens.css",
  "/css/base.css",
  "/css/components.css",
  "/css/layout.css",
  "/css/pages.css",
  "/css/auth.css",
  "/js/api.js",
  "/js/store.js",
  "/js/theme.js",
  "/js/router.js",
  "/js/ui.js",
  "/js/offline.js",
  "/js/transfer.js",
  "/js/audio_engine.js",
  "/js/app.js",
  "/js/pages/auth.js",
  "/js/pages/dashboard.js",
  "/js/pages/shifts.js",
  "/js/pages/tasks.js",
  "/js/pages/timeline.js",
  "/js/pages/wellness.js",
  "/js/pages/recovery.js",
  "/js/pages/wellbeing.js",
  "/js/pages/report.js",
  "/js/pages/assistant.js",
  "/js/pages/destress.js",
  "/js/pages/buddy.js",
  "/js/pages/home.js",
  "/js/pages/medic.js",
  "/js/pages/supervisor.js",
  "/js/pages/incidents.js",
  "/js/pages/notifications.js",
  "/js/pages/offline.js",
  "/js/pages/settings.js",
  "/js/pages/team.js",
  "/js/pages/admin.js",
  "/js/pages/placeholders.js",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // Best-effort: a missing asset shouldn't break installation.
      return Promise.allSettled(SHELL_ASSETS.map(function (url) {
        return cache.add(url);
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) {
    return; // network-only for data and mutations
  }
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () {
        // Offline and not cached: fall back to the shell for navigations.
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
        return Response.error();
      });
    })
  );
});
