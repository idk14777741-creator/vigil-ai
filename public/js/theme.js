/**
 * VIGIL AI — theme system: light / dark / system (classic script).
 */
(function (V) {
  const KEY = "vigil-theme";
  const mq = window.matchMedia("(prefers-color-scheme: dark)");

  function apply(theme) {
    const dark = theme === "dark" || (theme === "system" && mq.matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.documentElement.dispatchEvent(new CustomEvent("themechange", { detail: { theme: theme, dark: dark } }));
  }

  V.THEME = {
    initTheme: function () {
      apply(localStorage.getItem(KEY) || "system");
      if (mq.addEventListener) {
        mq.addEventListener("change", function () { if (getTheme() === "system") apply("system"); });
      }
    },
    getTheme: function () { return localStorage.getItem(KEY) || "system"; },
    setTheme: function (theme) { localStorage.setItem(KEY, theme); apply(theme); },
  };
})(window.VIGIL = window.VIGIL || {});
