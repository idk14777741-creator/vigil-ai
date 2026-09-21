/**
 * VIGIL AI — Personnel Timeline (SIU phase 11).
 * One calm, chronological view of the user's own journey across modules:
 * shifts, tasks, recovery updates, support requests, incidents. Helps a
 * judge (and the user) see that VIGIL is one connected system, not
 * separate pages. Only the user's own events — nothing private from
 * anyone else appears here, ever.
 */
(function (V) {
  const esc = V.UI.esc;
  const toast = V.UI.toast;
  const fmtDate = V.UI.fmtDate;
  const fmtTime = V.UI.fmtTime;
  const demoChip = V.UI.demoChip;

  V.ROUTER.register("/timeline", render, { title: "Timeline", nav: "/timeline", roles: ["personnel"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="page-header"><div><h1>Personnel Timeline</h1>' +
      '<p class="sub">Your recent journey across shifts, tasks, recovery and support — one connected story. Every entry links to the page where it lives.</p></div>' +
      '<span class="chip">Own data only</span></div>' +
      '<div id="tl-body"><div class="loading-block"><div class="spinner"></div><p>Loading…</p></div></div>' +
      "</div>";
    load(el);
  }

  async function load(el) {
    const data = await V.UI.safe(function () { return V.API.endpoints.myTimeline(); });
    const target = document.getElementById("tl-body");
    if (!target) return;
    if (!data) {
      target.innerHTML = '<div class="empty-state"><div class="icon">◍</div>' +
        "<h3>Couldn&#39;t load your timeline</h3><p>Please try again.</p>" +
        '<button class="btn primary" id="tl-retry">Try again</button></div>';
      document.getElementById("tl-retry")?.addEventListener("click", function () { load(el); });
      return;
    }
    const events = data.events || [];
    if (!events.length) {
      target.innerHTML = '<div class="empty-state"><div class="icon">◍</div>' +
        "<h3>Your timeline starts with your first shift</h3>" +
        "<p>Shifts, tasks, recovery updates and support requests will appear here as they happen.</p></div>";
      return;
    }

    // Group by day for a calm reading rhythm.
    const byDay = new Map();
    events.forEach(function (e) {
      const day = (e.at || "").slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(e);
    });

    let html = '<section class="card"><div class="card-header"><h3>' + events.length + " recent events</h3>" +
      demoChip("Demo data") + "</div>";
    html += '<div class="timeline-wrap">';
    byDay.forEach(function (rows, day) {
      const d = new Date(day + "T00:00:00");
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const diff = Math.round((d - today) / 86400000);
      const label = diff === 0 ? "Today" : diff === -1 ? "Yesterday" :
        diff === 1 ? "Tomorrow" :
        d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
      html += '<div class="eyebrow mt-4 mb-2">' + esc(label) + "</div>";
      rows.forEach(function (e) {
        const cls = e.kind === "support" || e.kind === "task_done" ? "tl-support" :
          e.kind === "incident" ? "tl-incident" : e.kind === "recovery" ? "tl-recovery" : "";
        html += '<div class="tl-row ' + cls + '">' +
          '<div class="tl-head"><span class="tl-title"><span aria-hidden="true">' + e.icon + "</span> " + esc(e.title) + "</span>" +
          '<span class="tl-time">' + esc(fmtTime(e.at)) + "</span></div>" +
          (e.detail ? '<div class="tl-detail">' + esc(e.detail) + "</div>" : "") +
          '<a class="meta" href="#' + esc(e.path) + '">Open ' + esc(pathLabel(e.path)) + " →</a></div>";
      });
    });
    html += "</div></section>" +
      '<p class="privacy-note">🔒 Your timeline shows only your own events. Nobody else — not your supervisor, medic, buddy or administrator — can see this page.</p>';
    target.innerHTML = html;
  }

  function pathLabel(path) {
    return ({ "/shifts": "Shift Monitor", "/tasks": "Tasks", "/recovery": "Recovery Score",
      "/medic": "Medic Connection", "/supervisor": "Supervisor Connection", "/incidents": "Incident Reporting" })[path] || "module";
  }
})(window.VIGIL = window.VIGIL || {});
