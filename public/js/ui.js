/**
 * VIGIL AI — UI kit: toasts, modals, formatting, avatars, skeletons, charts (classic script).
 */
(function (V) {
  /* ---------- Escaping ---------- */

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ---------- Formatting ---------- */

  function timeAgo(iso) {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    const diff = Math.max(0, Date.now() - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + "d ago";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function fmtDate(iso, opts) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(undefined, opts || { weekday: "short", month: "short", day: "numeric" });
  }

  function fmtTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w[0]; }).join("").toUpperCase();
  }

  function avatarHtml(user, size) {
    const color = (user && user.avatar_color) || "teal";
    return '<span class="avatar ' + (size || "") + '" data-color="' + esc(color) + '" aria-hidden="true">' + esc(initials(user && user.full_name)) + "</span>";
  }

  function roleLabel(role) {
    return { personnel: "Personnel", medic: "Medic Officer", supervisor: "Supervisor", admin: "Administrator" }[role] || role;
  }

  /* ---------- Toasts ---------- */

  const TOAST_ICONS = { success: "✓", error: "!", warning: "⚠", info: "◆" };

  function toast(message, type, title) {
    type = type || "info";
    const region = document.getElementById("toast-region");
    if (!region) return;
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.setAttribute("role", "status");
    el.innerHTML =
      '<span class="t-icon" aria-hidden="true">' + (TOAST_ICONS[type] || TOAST_ICONS.info) + "</span>" +
      '<div class="grow">' +
      (title ? '<div class="t-title">' + esc(title) + "</div>" : "") +
      '<div class="t-msg">' + esc(message) + "</div></div>" +
      '<button class="t-close" aria-label="Dismiss">✕</button>';
    const dismiss = function () {
      el.classList.add("leaving");
      setTimeout(function () { el.remove(); }, 160);
    };
    el.querySelector(".t-close").addEventListener("click", dismiss);
    region.appendChild(el);
    setTimeout(dismiss, type === "error" ? 6500 : 4200);
  }

  /* ---------- Modals ---------- */

  function openModal(opts) {
    const root = document.getElementById("modal-root");
    if (!root) return { close: function () {}, el: null };
    root.innerHTML = "";
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal ' + (opts.size || "") + '" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '">' +
      '<div class="modal-head"><h2>' + esc(opts.title) + '</h2>' +
      '<button class="icon-btn modal-close" aria-label="Close dialog">✕</button></div>' +
      '<div class="modal-body">' + (opts.body || "") + "</div>" +
      (opts.footer ? '<div class="modal-foot">' + opts.footer + "</div>" : "") +
      "</div>";
    let closed = false;
    const close = function () {
      if (closed) return;
      closed = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = function (e) { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
    overlay.querySelector(".modal-close").addEventListener("click", close);
    root.appendChild(overlay);
    const focusable = overlay.querySelector("input, textarea, select, button:not(.modal-close)");
    if (focusable) focusable.focus();
    return { close: close, el: overlay };
  }

  function confirmModal(opts) {
    return new Promise(function (resolve) {
      const m = openModal({
        title: opts.title,
        size: "sm",
        body: '<p class="muted">' + esc(opts.message) + "</p>",
        footer:
          '<button class="btn ghost" data-act="cancel">Cancel</button>' +
          '<button class="btn ' + (opts.danger ? "danger" : "primary") + '" data-act="ok">' + esc(opts.confirmLabel || "Confirm") + "</button>",
      });
      m.el.querySelector('[data-act="cancel"]').addEventListener("click", function () { m.close(); resolve(false); });
      m.el.querySelector('[data-act="ok"]').addEventListener("click", function () { m.close(); resolve(true); });
    });
  }

  /* ---------- Loading helpers ---------- */

  function loadingBlock(label) {
    return '<div class="loading-block"><div class="spinner" role="status"></div><p>' + esc(label || "Loading…") + "</p></div>";
  }

  function skeletonCard() {
    return '<div class="card"><div class="skeleton skeleton-line title"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:70%"></div></div>';
  }

  function skeletonCards(n) {
    let out = "";
    for (let i = 0; i < (n || 3); i++) out += skeletonCard();
    return '<div class="grid-2">' + out + "</div>";
  }

  /* ---------- SVG line chart ---------- */

  function lineChart(series, opts) {
    opts = opts || {};
    const width = opts.width || 100;   // viewBox units — scales to container
    const height = opts.height || 40;
    const min = opts.min !== undefined ? opts.min : Math.min.apply(null, series.filter(function (v) { return v !== null; }));
    const max = opts.max !== undefined ? opts.max : Math.max.apply(null, series.filter(function (v) { return v !== null; }));
    const span = max - min || 1;
    const n = series.length;
    if (!n) return "";
    const pts = series.map(function (v, i) {
      if (v === null) return null;
      const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
      const y = height - 3 - ((v - min) / span) * (height - 8);
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
    const path = pts.filter(Boolean).map(function (p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join(" ");
    const area = path + (pts.filter(Boolean).length > 1 ? " L " + pts.filter(Boolean).slice(-1)[0][0] + " " + height + " L " + pts.filter(Boolean)[0][0] + " " + height + " Z" : "");
    const last = pts.filter(Boolean).slice(-1)[0];
    return '<svg viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none" class="line-chart" role="img" aria-label="' + esc(opts.label || "Trend chart") + '">' +
      '<path d="' + area + '" fill="var(--brand-soft)" opacity="0.55"/>' +
      '<path d="' + path + '" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      (last ? '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.2" fill="var(--brand-strong)"/>' : "") +
      "</svg>";
  }

  /* ---------- Tiny inline bar chart ---------- */

  function barChart(values, opts) {
    opts = opts || {};
    const height = opts.height || 56;
    if (!values || !values.length) return '<p class="meta">No data yet.</p>';
    let max = 1;
    values.forEach(function (v) { if (v.value > max) max = v.value; });
    const bars = values.map(function (v, i) {
      const h = Math.max(6, Math.round((v.value / max) * height));
      const label = opts.labelEvery && i % opts.labelEvery === 0
        ? '<span class="bar-label">' + esc(v.label || "") + "</span>"
        : '<span class="bar-label" aria-hidden="true"></span>';
      return '<div class="bar-col" title="' + esc(v.label || "") + ": " + v.value + '">' +
        '<div class="bar-fill" style="height:' + h + 'px"></div>' + label + "</div>";
    }).join("");
    return (
      '<style>' +
      ".bar-chart{display:flex;align-items:flex-end;gap:6px;height:" + (height + 22) + 'px;}' +
      ".bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;}" +
      ".bar-fill{width:100%;max-width:30px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--brand),var(--brand-strong));opacity:.9;}" +
      ".bar-label{font-size:10.5px;color:var(--text-3);white-space:nowrap;}" +
      "</style>" +
      '<div class="bar-chart" role="img" aria-label="Chart of ' + values.length + ' values">' + bars + "</div>"
    );
  }

  /* ---------- Misc ---------- */

  function demoChip(label) {
    return '<span class="demo-chip" title="This data is simulated for demonstration and is not real medical data.">◐ ' + esc(label || "Demo · Simulated data") + "</span>";
  }

  function unreadDot(count) {
    return count > 0 ? '<span class="pill">' + (count > 99 ? "99+" : count) + "</span>" : "";
  }

  function safe(fn, fallback) {
    return Promise.resolve().then(fn).catch(function () { return fallback === undefined ? null : fallback; });
  }

  V.UI = {
    esc: esc, timeAgo: timeAgo, fmtDate: fmtDate, fmtTime: fmtTime,
    initials: initials, avatarHtml: avatarHtml, roleLabel: roleLabel,
    toast: toast, openModal: openModal, confirmModal: confirmModal,
    loadingBlock: loadingBlock, skeletonCard: skeletonCard, skeletonCards: skeletonCards,
    barChart: barChart, lineChart: lineChart, demoChip: demoChip, unreadDot: unreadDot, safe: safe,
  };
})(window.VIGIL = window.VIGIL || {});
