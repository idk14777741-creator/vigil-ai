/**
 * VIGIL AI — session/user state (classic script).
 */
(function (V) {
  const state = { user: null, unread: 0, mode: "demo", version: "", loaded: false };
  const listeners = new Set();

  function emit() {
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* listener error */ } });
  }

  V.STORE = {
    getState: function () { return state; },
    setUser: function (user) { state.user = user; state.loaded = true; emit(); },
    setUnread: function (n) { state.unread = n; emit(); },
    setMeta: function (mode, version) { state.mode = mode || "demo"; state.version = version || ""; emit(); },
    clearSession: function () { state.user = null; state.unread = 0; emit(); },
    onChange: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
  };
})(window.VIGIL = window.VIGIL || {});
