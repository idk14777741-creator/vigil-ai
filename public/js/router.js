/**
 * VIGIL AI — hash router with role-based guards (classic script).
 */
(function (V) {
  const routes = [];
  let notFoundHandler = function () {};

  function currentPath() {
    const raw = location.hash.replace(/^#/, "") || "/dashboard";
    return raw.split("?")[0];
  }

  function navigate(path) {
    location.hash = "#" + path;
  }

  function register(path, handler, opts) {
    opts = opts || {};
    routes.push({ path: path, handler: handler, title: opts.title || "", roles: opts.roles || null, nav: opts.nav || "" });
  }

  function setNotFound(fn) {
    notFoundHandler = fn;
  }

  /** Resolve a route; returns {route} or {forbidden:true} or {route:null}. */
  function resolve(path) {
    const user = V.STORE.getState().user;
    let best = null;
    for (const route of routes) {
      if (path === route.path || path.indexOf(route.path + "/") === 0) {
        if (!best || route.path.length > best.path.length) best = route;
      }
    }
    if (!best) return { route: null };
    if (best.roles && (!user || best.roles.indexOf(user.role) === -1)) {
      return { forbidden: true };
    }
    return { route: best };
  }

  /**
   * Render the active route. host = { el: contentElement, setTitle: fn }.
   * Page handlers receive the content element directly: handler(el, path).
   */
  function handleRoute(host) {
    const path = currentPath();
    const result = resolve(path);
    if (result.forbidden) {
      host.setTitle("Not available");
      host.el.innerHTML =
        '<div class="page"><div class="empty-state">' +
        '<div class="icon">🔒</div><h2>This area isn\'t available for your role</h2>' +
        "<p>If you believe you should have access, ask your administrator to review your role permissions.</p>" +
        '<a class="btn primary" href="#/dashboard">Back to dashboard</a></div></div>';
      return;
    }
    if (!result.route) {
      notFoundHandler(host, path);
      return;
    }
    document.title = result.route.title ? result.route.title + " · VIGIL AI" : "VIGIL AI";
    host.setTitle(result.route.title || "VIGIL AI");
    result.route.handler(host.el, path);
  }

  function activeNav(path) {
    const result = resolve(path);
    return result.route ? result.route.nav : "";
  }

  V.ROUTER = { register: register, setNotFound: setNotFound, handleRoute: handleRoute, currentPath: currentPath, navigate: navigate, activeNav: activeNav };
})(window.VIGIL = window.VIGIL || {});
