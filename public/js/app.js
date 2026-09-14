/**
 * VIGIL AI — application shell: boot, sidebar, topbar, routing, offline banner (classic script).
 */
(function (V) {
  const esc = V.UI.esc;
  const avatarHtml = V.UI.avatarHtml;
  const roleLabel = V.UI.roleLabel;
  const toast = V.UI.toast;

  /* ============================================================
     Navigation model — role-based
     ============================================================ */

  const NAV = [
    { section: "Overview", items: [
      { path: "/dashboard", label: "Dashboard", icon: "◆", roles: ["personnel", "supervisor", "medic", "admin"] },
    ]},
    { section: "Operational", items: [
      { path: "/shifts", label: "Shift Monitor", icon: "◐", roles: ["personnel", "supervisor"] },
      { path: "/tasks", label: "Tasks", icon: "☑", roles: ["personnel", "supervisor"] },
    ]},
    { section: "Wellbeing", items: [
      { path: "/wellness", label: "Wellness Monitor", icon: "♡", roles: ["personnel"] },
      { path: "/recovery", label: "Recovery Score", icon: "◉", roles: ["personnel"] },
      { path: "/report", label: "Weekly Report", icon: "▤", roles: ["personnel"] },
      { path: "/assistant", label: "VIGIL AI Assistant", icon: "✦", roles: ["personnel"] },
      { path: "/destress", label: "De-stress Zone", icon: "♪", roles: ["personnel"] },
    ]},
    { section: "Support network", items: [
      { path: "/buddy", label: "Buddy Connect", icon: "⇄", roles: ["personnel"] },
      { path: "/home", label: "Message From Home", icon: "⌂", roles: ["personnel"] },
      { path: "/medic", label: "Medic Connection", icon: "✚", roles: ["personnel", "medic"] },
      { path: "/supervisor", label: "Supervisor Connection", icon: "⚑", roles: ["personnel", "supervisor"] },
      { path: "/incidents", label: "Incident Reporting", icon: "△", roles: ["personnel", "supervisor"] },
    ]},
    { section: "Workspace", items: [
      { path: "/notifications", label: "Notifications", icon: "◍", roles: ["personnel", "supervisor", "medic", "admin"] },
      { path: "/team", label: "My Team", icon: "◎", roles: ["personnel", "supervisor", "medic", "admin"] },
      { path: "/settings", label: "Settings", icon: "⚙", roles: ["personnel", "supervisor", "medic", "admin"] },
    ]},
    { section: "Administration", items: [
      { path: "/admin", label: "Admin Panel", icon: "▣", roles: ["admin"] },
    ]},
  ];

  /* ============================================================
     Boot
     ============================================================ */

  async function boot() {
    V.THEME.initTheme();
    window.addEventListener("hashchange", renderRoute);
    window.addEventListener("offline", updateOfflineBanner);
    window.addEventListener("online", updateOfflineBanner);

    try {
      const me = await V.API.endpoints.me();
      V.STORE.setUser(me.user);
      V.STORE.setUnread(me.unread_notifications || 0);
      V.STORE.setMeta(me.mode, me.version);
    } catch (e) {
      V.STORE.clearSession();
    }

    renderRoute();
    refreshUnreadLoop();
    registerServiceWorker();
  }

  function registerServiceWorker() {
    // Installable/offline shell. Never caches API data (see sw.js).
    if ("serviceWorker" in navigator && location.protocol === "http:") {
      navigator.serviceWorker.register("/sw.js").catch(function () { /* best-effort */ });
    }
  }

  function refreshUnreadLoop() {
    setInterval(function () {
      if (!V.STORE.getState().user) return;
      V.API.endpoints.me().then(function (me) {
        V.STORE.setUnread(me.unread_notifications || 0);
      }).catch(function () { /* offline; banner handles it */ });
    }, 30000);
  }

  /* ============================================================
     Shell rendering
     ============================================================ */

  function navItemsHtml() {
    const state = V.STORE.getState();
    const user = state.user;
    return NAV.map(function (group) {
      const items = group.items.filter(function (it) { return !it.roles || it.roles.indexOf(user.role) !== -1; });
      if (!items.length) return "";
      return '<div class="nav-section"><div class="eyebrow">' + esc(group.section) + "</div></div>" +
        items.map(function (it) {
          return '<a class="nav-item" data-nav="' + it.path + '" href="#' + it.path + '">' +
            '<span class="n-icon" aria-hidden="true">' + it.icon + "</span>" +
            "<span>" + esc(it.label) + "</span>" +
            (it.path === "/notifications" ? V.UI.unreadDot(state.unread) : "") +
            (it.phase ? '<span class="badge tone-brand right" title="Coming in Phase ' + it.phase + '">P' + it.phase + "</span>" : "") +
            "</a>";
        }).join("");
    }).join("");
  }

  function renderShell() {
    const state = V.STORE.getState();
    const user = state.user;
    const app = document.getElementById("app");
    app.innerHTML =
      '<div class="app-shell" data-app>' +
      '<aside class="sidebar" id="sidebar" aria-label="Primary navigation">' +
      '<div class="sidebar-brand">' +
      '<div class="brand-mark" aria-hidden="true">' +
      '<svg width="20" height="20" viewBox="0 0 32 32" fill="none">' +
      '<path d="M16 4l9 4v7c0 6-4 10.4-9 13-5-2.6-9-7-9-13V8l9-4z" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="13.5" r="2.4" fill="currentColor"/>' +
      '<path d="M16 16.5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></div>' +
      "<div><div class=\"brand-name\">VIGIL AI</div>" +
      '<div class="brand-tag">Someone is looking out for you</div></div></div>' +
      '<nav class="sidebar-nav" id="side-nav">' + navItemsHtml() + "</nav>" +
      '<div class="sidebar-foot"><div class="row">' + avatarHtml(user) +
      '<div class="grow" style="min-width:0">' +
      '<div class="truncate" style="font-weight:650; font-size:13.5px">' + esc(user.full_name) + "</div>" +
      '<div class="meta truncate">' + esc(roleLabel(user.role)) + "</div></div>" +
      '<button class="icon-btn" id="user-menu-btn" aria-label="Account menu" aria-haspopup="true">⋯</button>' +
      "</div></div></aside>" +
      '<div class="scrim" id="scrim"></div>' +
      '<div class="main-col">' +
      "<header class=\"topbar\">" +
      '<button class="icon-btn sidebar-toggle" id="sidebar-toggle" aria-label="Open navigation">☰</button>' +
      '<span class="page-title" id="topbar-title">Dashboard</span>' +
      '<span class="mode-chip" title="' + esc(state.version) + '">' + esc(state.mode) + " mode</span>" +
      '<div class="right row gap-2">' +
      '<button class="icon-btn" id="theme-btn" aria-label="Toggle color theme" title="Theme: ' + esc(V.THEME.getTheme()) + '">◐</button>' +
      '<a class="icon-btn" id="notif-btn" href="#/notifications" aria-label="Notifications">' + "◍" + (state.unread ? '<span class="dot-badge"></span>' : "") + "</a>" +
      "</div></header>" +
      '<main class="content" id="page-content" tabindex="-1"></main>' +
      "</div></div>" +
      '<div id="user-menu-root"></div>';

    wireShell();
  }

  function wireShortcuts() {
    // "g" then key = go to page. Ignores typing in inputs/teasxtareas/modals.
    const NAV = { d: "#/dashboard", s: "#/shifts", t: "#/tasks", w: "#/wellness",
                  r: "#/recovery", p: "#/report", a: "#/assistant", z: "#/destress",
                  b: "#/buddy", h: "#/home", m: "#/medic", v: "#/supervisor",
                  i: "#/incidents", n: "#/notifications", c: "#/team", "?": "help" };
    let armed = false;
    let armTimer = null;
    document.addEventListener("keydown", function (e) {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector(".modal-overlay")) return;
      if (e.key === "g" && !armed) {
        armed = true;
        clearTimeout(armTimer);
        armTimer = setTimeout(function () { armed = false; }, 1500);
        return;
      }
      if (armed && e.key === "?") {
        armed = false;
        toast("Shortcuts: g then d dashboard · s shifts · t tasks · w wellness · r recovery · p report · a assistant · z de-stress · b buddy · h home · m medic · v supervisor · i incidents · n notifications · c team");
        return;
      }
      if (armed && NAV[e.key]) {
        armed = false;
        const user = V.STORE.getState().user;
        if (!user) return;
        location.hash = NAV[e.key];
      }
      armed = false;
    });
  }

  function wireShell() {
    wireShortcuts();
    const toggle = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");
    const scrim = document.getElementById("scrim");
    const closeSidebar = function () { sidebar.classList.remove("open"); scrim.classList.remove("show"); };
    toggle?.addEventListener("click", function () {
      const open = sidebar.classList.toggle("open");
      scrim.classList.toggle("show", open);
    });
    scrim?.addEventListener("click", closeSidebar);

    document.getElementById("theme-btn")?.addEventListener("click", function () {
      const next = V.THEME.getTheme() === "dark" ? "light" : "dark";
      V.THEME.setTheme(next);
      const btn = document.getElementById("theme-btn");
      if (btn) btn.title = "Theme: " + next;
      toast(next === "dark" ? "Dark theme on" : "Light theme on", "info");
    });

    document.getElementById("user-menu-btn")?.addEventListener("click", openUserMenu);
  }

  function openUserMenu() {
    const root = document.getElementById("user-menu-root");
    const user = V.STORE.getState().user;
    if (!root || !user) return;
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.position = "fixed";
    wrap.style.right = "18px";
    wrap.style.bottom = "76px";
    wrap.style.zIndex = "60";
    wrap.innerHTML =
      '<div class="menu open" style="display:block">' +
      '<div class="menu-header"><div style="font-weight:650">' + esc(user.full_name) + "</div>" +
      '<div class="meta">' + esc(user.email) + '</div></div>' +
      '<a class="menu-item" href="#/settings">⚙ Settings</a>' +
      '<button class="danger" data-act="logout">⏻ Sign out</button></div>';
    let closed = false;
    const close = function () {
      if (closed) return;
      closed = true;
      document.removeEventListener("click", onDoc, true);
      wrap.remove();
    };
    const onDoc = function (e) { if (!wrap.contains(e.target)) close(); };
    setTimeout(function () { document.addEventListener("click", onDoc, true); });
    wrap.querySelector('[data-act="logout"]').addEventListener("click", function () {
      close();
      V.API.auth.logout().catch(function () {});
      V.STORE.clearSession();
      renderAuthScreen();
    });
    root.appendChild(wrap);
  }

  /* ============================================================
     Route rendering
     ============================================================ */

  function renderRoute() {
    const user = V.STORE.getState().user;
    if (!user) {
      renderAuthScreen();
      return;
    }
    if (!document.querySelector("[data-app]")) {
      renderShell();
    }
    const path = V.ROUTER.currentPath();
    const content = document.getElementById("page-content");
    content.innerHTML = "";
    content.scrollTop = 0;
    content.focus({ preventScroll: true });  // screen-reader/keyboard: announce new page
    if (window.scrollTo) window.scrollTo(0, 0);

    let dead = false;
    const kill = function () { dead = true; };
    window.addEventListener("hashchange", kill, { once: true });
    // Let pages clean up (e.g. the De-stress Zone stops its audio).
    window.dispatchEvent(new CustomEvent("vigil:navigating"));
    // Async page loaders check this before painting stale results.
    content.dataset.deadCheck = "";

    const host = {
      el: content,
      isCurrent: function () { return "deadCheck" in content.dataset; },
      setTitle: function (t) { document.getElementById("topbar-title").textContent = t || "VIGIL AI"; },
    };

    try {
      V.ROUTER.handleRoute(host);
    } catch (err) {
      // A page that throws during render must never blank the app.
      console.error("page render failed:", err);
      content.innerHTML = '<div class="page"><div class="empty-state">' +
        '<div class="icon">⚠</div><h3>Something went wrong on this page</h3>' +
        '<p>' + String(err && err.message || err).replace(/[<>&]/g, "") + '</p>' +
        '<button class="btn primary" id="err-reload">Try again</button></div></div>';
      document.getElementById("err-reload").addEventListener("click", function () { renderRoute(); });
      document.getElementById("topbar-title").textContent = "VIGIL AI";
    }

    document.querySelectorAll(".nav-item").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-nav") === path);
    });
    const sidebar = document.getElementById("sidebar");
    if (sidebar && sidebar.classList.contains("open")) {
      sidebar.classList.remove("open");
      const scrim = document.getElementById("scrim");
      if (scrim) scrim.classList.remove("show");
    }
  }

  /* ============================================================
     Auth screen hand-off
     ============================================================ */

  function renderAuthScreen() {
    document.title = "Sign in · VIGIL AI";
    const app = document.getElementById("app");
    app.innerHTML = '<div id="auth-root"></div>';
    window.dispatchEvent(new CustomEvent("vigil:auth-screen"));
  }

  /* ============================================================
     404
     ============================================================ */

  V.ROUTER.setNotFound(function (host) {
    const content = (host && host.el) || document.getElementById("page-content");
    if (!content) return;
    host.setTitle("Not found");
    content.innerHTML =
      '<div class="page"><div class="empty-state">' +
      '<div class="icon">🧭</div><h2>Page not found</h2>' +
      "<p>The page you're looking for doesn't exist or has moved.</p>" +
      '<a class="btn primary" href="#/dashboard">Go to dashboard</a></div></div>';
  });

  /* ============================================================
     Offline banner
     ============================================================ */

  function updateOfflineBanner() {
    const existing = document.getElementById("offline-banner");
    if (existing) existing.remove();
    if (navigator.onLine === false) {
      const banner = document.createElement("div");
      banner.id = "offline-banner";
      banner.className = "offline-banner";
      banner.innerHTML = '<span class="dot"></span> You\'re offline — showing your last loaded data.';
      document.body.appendChild(banner);
    }
  }

  /* ============================================================
     State subscription — keep badges in sync with unread count
     ============================================================ */

  V.STORE.onChange(function (state) {
    const notifLink = document.getElementById("notif-btn");
    if (notifLink) {
      notifLink.innerHTML = "◍" + (state.unread ? '<span class="dot-badge"></span>' : "");
      notifLink.setAttribute("aria-label", "Notifications" + (state.unread ? ", " + state.unread + " unread" : ""));
    }
    const navPill = document.querySelector('.nav-item[data-nav="/notifications"] .pill');
    if (navPill && !state.unread) {
      navPill.remove();
    } else if (state.unread && notifLink) {
      const navNotif = document.querySelector('.nav-item[data-nav="/notifications"]');
      if (navNotif && !navNotif.querySelector(".pill")) {
        navNotif.insertAdjacentHTML("beforeend", V.UI.unreadDot(state.unread));
      } else if (navNotif) {
        const pill = navNotif.querySelector(".pill");
        if (pill) pill.textContent = state.unread > 99 ? "99+" : state.unread;
      }
    }
  });

  boot();
})(window.VIGIL = window.VIGIL || {});
