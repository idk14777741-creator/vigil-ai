/**
 * VIGIL AI — Notifications center (classic script).
 */
(function (V) {
  const esc = V.UI.esc;
  const timeAgo = V.UI.timeAgo;
  const loadingBlock = V.UI.loadingBlock;
  const toast = V.UI.toast;

  V.ROUTER.register("/notifications", render, { title: "Notifications", nav: "/notifications" });

  const KINDS = [
    ["all", "All"], ["unread", "Unread"], ["shift", "Shifts"], ["task", "Tasks"],
    ["medic_request", "Medic"], ["medic_message", "Medic chat"], ["wellness_auth", "Wellness sharing"],
    ["supervisor_request", "Supervisor"], ["supervisor_message", "Supervisor chat"],
    ["incident", "Incidents"], ["buddy", "Buddy"], ["message_home", "From home"], ["system", "System"],
  ];

  let filter = "all";

  function render(el) {
    el.innerHTML = loadingBlock("Loading notifications…");
    load(el);
  }

  async function load(el) {
    let items = [];
    try {
      const res = await V.API.endpoints.notifications();
      items = res.notifications || [];
    } catch (err) {
      el.innerHTML = '<div class="empty-state"><div class="icon">⚠</div><h2>Couldn\'t load notifications</h2><p>' + esc(err.message) + "</p></div>";
      return;
    }

    const unreadCount = items.filter(function (n) { return !n.read_at; }).length;
    const filtered = filter === "all" ? items
      : filter === "unread" ? items.filter(function (n) { return !n.read_at; })
      : items.filter(function (n) { return n.kind === filter; });

    el.innerHTML =
      '<div class="page">' +
      '<div class="page-header"><div><h1>Notifications</h1>' +
      '<p class="sub">Shift reminders, task updates, support requests and messages — everything in one stream.</p></div>' +
      (unreadCount ? '<button class="btn ghost" id="mark-all">✓ Mark all as read</button>' : "") +
      "</div>" +
      '<div class="row gap-2 wrap"><div class="tabs" role="tablist">' +
      KINDS.filter(function (k) {
        return k[0] === "all" || k[0] === "unread" || k[0] === filter || items.some(function (n) { return n.kind === k[0]; });
      }).map(function (k) {
        const count = k[0] === "all" ? items.length : k[0] === "unread" ? unreadCount
          : items.filter(function (n) { return n.kind === k[0]; }).length;
        if (k[0] !== "all" && k[0] !== "unread" && !count && filter !== k[0]) return "";
        return '<button class="' + (filter === k[0] ? "active" : "") + '" data-f="' + k[0] + '">' + k[1] + " (" + count + ")</button>";
      }).join("") +
      "</div></div>" +
      (filtered.length
        ? '<div class="stack-list">' + filtered.map(function (n) {
            return '<div class="notif-item ' + (n.read_at ? "" : "unread") + '" data-id="' + esc(n.id) + '" tabindex="0" role="button" aria-label="' + esc(n.title) + (n.read_at ? ". Read" : ". Unread") + '">' +
              '<div class="n-icon" aria-hidden="true">' + icon(n.kind) + "</div>" +
              '<div class="grow"><div class="n-title">' + esc(n.title) + "</div>" +
              '<div class="n-body">' + esc(n.body) + "</div>" +
              '<div class="n-time">' + esc(timeAgo(n.created_at)) + "</div></div>" +
              (n.read_at ? "" : '<span class="badge tone-brand">New</span>') + "</div>";
          }).join("") + "</div>"
        : '<div class="empty-state"><div class="icon">' + (filter === "unread" ? "✓" : "🍃") + "</div>" +
          "<h3>" + (filter === "unread" ? "Nothing unread" : "No notifications yet") + "</h3>" +
          "<p>" + (filter === "unread" ? "You're all caught up. Nice." : "Reminders, requests and messages will appear here.") + "</p></div>") +
      "</div>";

    el.querySelectorAll("[data-f]").forEach(function (b) {
      b.addEventListener("click", function () { filter = b.getAttribute("data-f"); load(el); });
    });

    el.querySelector("#mark-all")?.addEventListener("click", function () {
      V.API.endpoints.markAllRead().then(function () {
        toast("All notifications marked as read.", "success");
        V.STORE.setUnread(0);
        load(el);
      }).catch(function (err) { toast(err.message, "error"); });
    });

    el.querySelectorAll(".notif-item").forEach(function (item) {
      const activate = function () {
        const id = item.getAttribute("data-id");
        const n = items.find(function (x) { return x.id === id; });
        if (n && !n.read_at) {
          V.API.endpoints.markRead([id]).then(function () {
            n.read_at = new Date().toISOString();
            V.STORE.setUnread(Math.max(0, V.STORE.getState().unread - 1));
            item.classList.remove("unread");
            const badge = item.querySelector(".badge");
            if (badge) badge.remove();
          }).catch(function () {});
        }
        if (n && n.link) location.hash = "#/" + n.link.replace(/^\//, "");
      };
      item.addEventListener("click", activate);
      item.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
      });
    });
  }

  function icon(kind) {
    return {
      shift: "◐", task: "☑", support: "✚", system: "◆", buddy: "⇄", message_home: "⌂", incident: "△",
      medic_request: "✚", medic_message: "✚", medic_status: "✚", wellness_auth: "❤",
      supervisor_request: "⚑", supervisor_message: "⚑", supervisor_status: "⚑",
    }[kind] || "◆";
  }
})(window.VIGIL = window.VIGIL || {});
