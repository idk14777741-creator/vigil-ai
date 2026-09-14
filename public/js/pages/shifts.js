/**
 * VIGIL AI — Shift Monitor (Phase 3): current status, upcoming and recent shifts,
 * weekly statistics, and supportive flags. Supervisor gets a team workload view.
 */
(function (V) {
  const esc = V.UI.esc;
  const fmtTime = V.UI.fmtTime;
  const fmtDate = V.UI.fmtDate;
  const timeAgo = V.UI.timeAgo;
  const avatarHtml = V.UI.avatarHtml;
  const demoChip = V.UI.demoChip;
  const barChart = V.UI.barChart;

  V.ROUTER.register("/shifts", render, { title: "Shift Monitor", nav: "/shifts", roles: ["personnel", "supervisor"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="card"><div class="skeleton skeleton-line title"></div>' +
      '<div class="skeleton skeleton-line" style="width:50%"></div></div>' +
      '<div class="grid-2">' + V.UI.skeletonCard() + V.UI.skeletonCard() + "</div></div>";
    load(el);
  }

  async function load(el) {
    const isSupervisor = V.STORE.getState().user.role === "supervisor";
    const mine = await V.UI.safe(function () { return V.API.endpoints.myShifts(); });
    const team = isSupervisor ? await V.UI.safe(function () { return V.API.endpoints.teamShifts(); }) : null;
    if (!mine) {
      el.innerHTML = '<div class="page"><div class="empty-state"><div class="icon">◐</div>' +
        "<h3>Shift Monitor unavailable</h3><p>We couldn't load your shifts. Your schedule is safe — please try again.</p>" +
        '<button class="btn primary" id="shift-retry">Try again</button></div></div>';
      const retry = document.getElementById("shift-retry");
      if (retry) retry.addEventListener("click", function () { render(el); });
      return;
    }
    const isTeam = isSupervisor && team && team.members && team.members.length;
    el.innerHTML = '<div class="page">' + hero(mine.status) + flagsBlock(mine.flags) + weeklyBlock(mine.weekly) +
      upcomingBlock(mine.upcoming) + historyBlock(mine.history) +
      (isTeam ? teamBlock(team) : "") + "</div>";
  }

  /* ---------- status hero ---------- */

  function hero(status) {
    const s = status.shift || status.last_shift;
    const when = s ? '<div class="s-meta">' + esc(fmtDate(s.start_at)) + " · " + esc(fmtTime(s.start_at)) + " – " + esc(fmtTime(s.end_at)) + "</div>" : "";
    let badge = "";
    let extra = "";
    if (status.kind === "active") {
      badge = '<span class="badge tone-success"><span class="dot"></span>On shift</span>';
      extra = '<div class="progress-track mt-4" style="max-width:340px"><div class="progress-fill" style="width:' + status.progress_pct + '%"></div></div>' +
        '<div class="meta mt-2">' + status.hours_done + "h done · about " + status.hours_left + "h to go</div>";
    } else if (status.kind === "upcoming") {
      badge = '<span class="badge tone-brand"><span class="dot"></span>Upcoming</span>';
      extra = '<div class="meta mt-2">Starts ' + esc(fmtTime(status.shift.start_at)) + " · " + esc(status.lead) + "</div>";
    } else if (status.kind === "off") {
      badge = '<span class="badge">Off shift</span>';
      extra = '<div class="meta mt-2">Last shift ended ' + esc(timeAgo(status.last_shift.end_at)) + " (" + status.since_hours + "h of rest so far)</div>";
    }
    return '<section class="card shift-hero">' +
      '<div class="row-between wrap gap-4">' +
      "<div>" +
      '<div class="eyebrow mb-2">Right now ' + demoChip("Demo schedule") + "</div>" +
      '<h1 class="display" style="font-size:24px">' + esc(status.message.split(".")[0]) + ".</h1>" +
      '<p class="muted mt-2" style="max-width:56ch">' + esc(status.message) + "</p>" + when + extra +
      "</div>" + badge + "</div></section>";
  }

  /* ---------- flags ---------- */

  function flagsBlock(flags) {
    if (!flags.length) {
      return '<section class="card flags-card ok"><div class="row gap-3">' +
        '<span class="f-icon" aria-hidden="true">✓</span>' +
        "<div><strong>All clear</strong><p class=\"meta\">No extended duty or short-rest patterns in your recent shifts.</p></div></div></section>";
    }
    return '<section class="card flags-card">' +
      '<div class="card-header"><h3>Worth knowing</h3>' + demoChip("Workload awareness") + "</div>" +
      '<div class="flag-list">' + flags.map(function (f) {
        return '<div class="flag-row tone-' + f.tone + '">' +
          '<span class="f-icon" aria-hidden="true">' + (f.tone === "warning" ? "◐" : "☾") + "</span>" +
          '<div class="grow"><div class="f-title">' + esc(f.title) + (f.when ? ' <span class="badge">' + esc(f.when) + "</span>" : "") + "</div>" +
          '<p class="meta">' + esc(f.message) + "</p></div></div>";
      }).join("") + "</div>" +
      '<p class="meta mt-4">These are gentle observations, not assessments of you. If something looks off, your supervisor and Medic Officer are easy to reach.</p></section>';
  }

  /* ---------- weekly stats ---------- */

  function weeklyBlock(weekly) {
    const t = weekly.this, p = weekly.previous;
    const trend = weekly.hours_trend === 0 ? "" :
      '<span class="badge ' + (weekly.hours_trend > 0 ? "tone-warning" : "tone-success") + '">' +
      (weekly.hours_trend > 0 ? "▲ " : "▼ ") + Math.abs(weekly.hours_trend) + "h vs last week</span>";
    const bars = [
      { label: "Last wk", value: p.hours || 0.1 },
      { label: "This wk", value: t.hours || 0.1 },
    ];
    return '<section class="card"><div class="card-header"><h3>This week</h3>' + trend + "</div>" +
      '<div class="week-stats">' +
      stat("Shifts", t.shifts) + stat("Hours", t.hours) + stat("Longest", t.longest_shift_h + "h") +
      stat("Breaks", Math.round(t.break_minutes / 6) / 10 + "h") +
      "</div>" + barChart(bars, { height: 46 }) +
      '<p class="meta mt-4">' + esc(weekly.message) + " Last week: " + p.hours + "h across " + p.shifts + " shifts.</p></section>";
  }

  function stat(label, value) {
    return '<div class="ws"><div class="ws-v">' + esc(String(value)) + '</div><div class="ws-l">' + esc(label) + "</div></div>";
  }

  /* ---------- upcoming + history ---------- */

  function upcomingBlock(upcoming) {
    if (!upcoming.length) return "";
    return '<section class="card"><div class="card-header"><h3>Coming up</h3></div>' +
      '<div class="stack-list">' + upcoming.slice(0, 4).map(function (s) {
        return '<div class="list-row"><div class="l-icon">◐</div>' +
          '<div class="grow"><div class="l-title">' + esc(fmtDate(s.start_at, { weekday: "long", month: "short", day: "numeric" })) + "</div>" +
          '<div class="l-sub">' + esc(fmtTime(s.start_at)) + " – " + esc(fmtTime(s.end_at)) + (s.notes ? " · " + esc(s.notes) : "") + "</div></div>" +
          '<span class="badge">' + esc(s.shift_type) + "</span></div>";
      }).join("") + "</div></section>";
  }

  function historyBlock(history) {
    if (!history.length) {
      return '<section class="card"><div class="empty-state" style="padding: var(--sp-8) var(--sp-4)"><div class="icon">◐</div>' +
        "<h3>No shifts yet</h3><p>Your shift history will build up here as you work.</p></div></section>";
    }
    return '<section class="card"><div class="card-header"><h3>Recent shifts</h3><span class="badge">' + history.length + "</span></div>" +
      '<div class="stack-list">' + history.map(function (s) {
        const hrs = hoursBetween(s.start_at, s.end_at);
        const long = hrs > 12;
        return '<div class="list-row"><div class="l-icon">' + (long ? "◐" : "○") + "</div>" +
          '<div class="grow"><div class="l-title">' + esc(fmtDate(s.start_at, { weekday: "short", month: "short", day: "numeric" })) + "</div>" +
          '<div class="l-sub">' + esc(fmtTime(s.start_at)) + " – " + esc(fmtTime(s.end_at)) + " · " + hrs + "h" +
          (s.notes ? " · " + esc(s.notes) : "") + "</div></div>" +
          (long ? '<span class="badge tone-warning">extended</span>' : '<span class="badge tone-success">done</span>') + "</div>";
      }).join("") + "</div></section>";
  }

  /* ---------- supervisor team view ---------- */

  function teamBlock(team) {
    return '<section class="card"><div class="card-header"><h3>Team workload — Alpha Unit</h3>' +
      demoChip("Operational data only") + "</div>" +
      '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>Member</th><th>Right now</th><th>This week</th><th>Next shift</th><th>Notes</th></tr></thead><tbody>" +
      team.members.map(function (m) {
        const now = m.status === "active"
          ? '<span class="badge tone-success"><span class="dot"></span>On shift</span>'
          : m.status === "upcoming"
            ? '<span class="badge tone-brand">Scheduled</span>'
            : '<span class="badge">Off</span>';
        return "<tr>" +
          "<td><div class=\"row gap-2\">" + avatarHtml(m, "sm") + "<span style=\"font-weight:600\">" + esc(m.full_name) + "</span></div></td>" +
          "<td>" + now + "</td>" +
          "<td>" + (m.weekly ? m.weekly.hours + "h · " + m.weekly.shifts + " shifts" : "—") + "</td>" +
          "<td>" + (m.next_shift_start ? esc(fmtDate(m.next_shift_start, { month: "short", day: "numeric" })) + " " + esc(fmtTime(m.next_shift_start)) : "—") + "</td>" +
          "<td>" + (m.worst_flag ? '<span class="badge tone-warning">' + esc(m.worst_flag) + "</span>" : '<span class="meta">—</span>') + "</td>" +
          "</tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="meta mt-4">You see workload and scheduling only. Wellness readings and recovery scores stay private to each person and their Medic Officer.</p></section>';
  }

  /* ---------- helpers ---------- */

  function hoursBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 3600000);
  }
})(window.VIGIL = window.VIGIL || {});
