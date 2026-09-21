/**
 * VIGIL AI — Personnel Dashboard (Phase 2): live shift, tasks, wellness summary,
 * transparent Recovery Score, and support requests — all demo data, labelled as such.
 */
(function (V) {
  const esc = V.UI.esc;
  const timeAgo = V.UI.timeAgo;
  const fmtTime = V.UI.fmtTime;
  const avatarHtml = V.UI.avatarHtml;
  const roleLabel = V.UI.roleLabel;
  const skeletonCards = V.UI.skeletonCards;
  const demoChip = V.UI.demoChip;
  const toast = V.UI.toast;

  V.ROUTER.register("/dashboard", render, { title: "Dashboard", nav: "/dashboard" });

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return "Good night";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }

  function render(el) {
    el.innerHTML = '<div class="page" id="dash-root">' +
      '<div class="card greeting-card"><div class="skeleton skeleton-line title"></div>' +
      '<div class="skeleton skeleton-line" style="width:60%"></div>' +
      '<div class="skeleton skeleton-line" style="width:40%"></div></div>' +
      skeletonCards(4) + "</div>";
    load(el);
  }

  async function load(el) {
    const state = V.STORE.getState();
    const results = await Promise.allSettled([
      V.API.endpoints.myDashboard(), V.API.endpoints.notifications(), V.API.endpoints.myTeam(),
      V.API.endpoints.forecast(),
    ]);
    const d = results[0].status === "fulfilled" ? results[0].value : null;
    const notifs = results[1].status === "fulfilled" ? results[1].value.notifications.slice(0, 4) : [];
    const unit = results[1].status === "fulfilled" ? results[1].value.unit : null;
    const members = results[2].status === "fulfilled" ? results[2].value.members : [];
    const fc = results[3].status === "fulfilled" && results[3].value.has_data ? results[3].value : null;

    if (results[0].status === "rejected") {
      el.innerHTML = '<div class="page"><div class="empty-state"><div class="icon">🍃</div>' +
        "<h3>Dashboard unavailable</h3><p>We couldn't load your overview. Your data is safe — please try again.</p>" +
        '<button class="btn primary" id="dash-retry">Try again</button></div></div>';
      const retry = document.getElementById("dash-retry");
      if (retry) retry.addEventListener("click", function () { render(el); });
      return;
    }

    const user = state.user;
    const firstName = user.full_name.split(" ")[0];
    const phaseLabel = state.mode === "demo" ? "Demo environment" : "Live";

    const quickActions = [
      ["△", "Report Incident", "Secure, private reporting", "/incidents"],
      ["✚", "Contact Medic", "Reach your Medic Officer", "/medic"],
      ["⚑", "Contact Supervisor", "Operational support", "/supervisor"],
      ["⇄", "Connect With Buddy", "Trusted-person support", "/buddy"],
      ["⌂", "Message From Home", "Notes from your people", "/home"],
      ["✦", "AI Assistant", "VIGIL AI is here to help", "/assistant"],
      ["♪", "De-stress Zone", "Music & mindfulness", "/destress"],
    ];

    const isPersonnel = user.role === "personnel";

    el.innerHTML =
      '<div class="page">' +
      '<section class="greeting-card"><div class="row-between wrap">' +
      "<div>" +
      '<div class="eyebrow">' + esc(phaseLabel) + " · " + new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + "</div>" +
      '<h1 class="display mt-2">' + esc(greeting()) + ", " + esc(firstName) + '.</h1>' +
      '<p class="g-sub">We\'re keeping an eye on things today — your shifts, tasks and wellbeing in one calm place.</p>' +
      "</div>" + avatarHtml(user, "lg") + "</div>" +
      '<div class="greeting-meta">' +
      '<span class="greeting-chip"><span class="c-icon">◈</span> Role: <strong>' + esc(roleLabel(user.role)) + "</strong></span>" +
      (unit ? '<span class="greeting-chip"><span class="c-icon">◎</span> Unit: <strong>' + esc(unit.name) + "</strong></span>" : "") +
      '<span class="greeting-chip"><span class="c-icon">◍</span> <strong>' + state.unread + "</strong> unread notification" + (state.unread === 1 ? "" : "s") + "</span>" +
      "</div></section>" +

      (isPersonnel
        ? '<section><div class="eyebrow mb-2">Quick actions</div><div class="quick-actions">' +
          quickActions.map(function (qa) {
            return '<button class="quick-action" data-go="' + qa[3] + '">' +
              '<span class="qa-icon" aria-hidden="true">' + qa[0] + "</span>" +
              '<span class="qa-label">' + esc(qa[1]) + "</span>" +
              '<span class="qa-sub">' + esc(qa[2]) + "</span></button>";
          }).join("") + "</div></section>" +

          '<section class="stat-row">' +
          shiftStat(d.shift) +
          taskStat(d.tasks) +
          wellnessStat(d.wellness) +
          recoveryStat(d.recovery) +
          "</section>" +

          insightSection(d.context) +

          forecastSection(fc) +

          '<div class="grid-2">' +
          '<section class="card"><div class="card-header"><h3>' + "Next tasks" + '</h3><a class="card-link" href="#/tasks">All tasks →</a></div>' +
          tasksList(d.tasks.next, d.tasks.overdue) + "</section>" +
          '<section class="card"><div class="card-header"><h3>Recovery — what shaped it</h3>' + demoChip("Demo · Simulated") + "</div>" +
          recoveryFactors(d.recovery.latest) + "</section>" +
          "</div>" +

          '<section class="card"><div class="card-header"><h3>Your support requests</h3><a class="card-link" href="#/medic">Request support →</a></div>' +
          supportSummary(d.support) + "</section>"
        : "") +

      '<div class="grid-2">' +
      '<section class="card"><div class="card-header"><h3>Recent notifications</h3><a class="card-link" href="#/notifications">View all →</a></div>' +
      (notifs.length
        ? '<div class="stack-list">' + notifs.map(function (n) {
            return '<div class="list-row"><div class="l-icon" aria-hidden="true">' + notifIcon(n.kind) + "</div>" +
              '<div class="grow"><div class="l-title">' + esc(n.title) + "</div>" +
              '<div class="l-sub">' + esc(n.body) + "</div>" +
              '<div class="n-time meta">' + esc(timeAgo(n.created_at)) + "</div></div>" +
              (n.read_at ? "" : '<span class="badge tone-brand">New</span>') + "</div>";
          }).join("") + "</div>"
        : '<div class="empty-state" style="padding: var(--sp-8) var(--sp-4)"><div class="icon">🍃</div>' +
          "<h3>All caught up</h3><p>No notifications right now. When your team needs you, you'll see it here.</p></div>") +
      "</section>" +

      '<section class="card"><div class="card-header"><h3>' + (unit ? esc(unit.name) : "Your team") + '</h3><a class="card-link" href="#/team">Open team →</a></div>' +
      (members.length
        ? '<div class="stack-list">' + members.slice(0, 6).map(function (m) {
            return "<div class=\"list-row\">" + avatarHtml(m) +
              '<div class="grow"><div class="l-title">' + esc(m.full_name) + (m.id === user.id ? " (you)" : "") + "</div>" +
              '<div class="l-sub">' + esc(roleLabel(m.role)) + "</div></div></div>";
          }).join("") + "</div>"
        : '<div class="empty-state" style="padding: var(--sp-8) var(--sp-4)"><div class="icon">◎</div>' +
          "<h3>No unit yet</h3><p>Your administrator will place you in a unit — then your team appears here.</p></div>") +
      "</section></div></div>";

    el.querySelectorAll("[data-go]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        location.hash = "#" + btn.getAttribute("data-go");
      });
    });

    // Closed support loop: tapping a support option records the engagement
    // (detect → recommend → engage) before navigating to the module.
    el.querySelectorAll("[data-iv]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const iv = btn.getAttribute("data-iv");
        const res = await V.UI.safe(function () { return V.API.endpoints.interventionEngage(iv, "dashboard"); });
        if (!res) return;
        toast(res.reused
          ? "Already tracked — your follow-up continues on the Wellbeing page."
          : "Support engagement recorded. VIGIL will follow up on your recovery trend — no pressure either way.");
        location.hash = "#" + IV_PATHS[iv];
      });
    });
  }

  /* ---------- Fatigue Forecast (intelligence phases 1–2) ---------- */

  const IV_PATHS = {
    destress_zone: "/destress", breathing: "/destress", buddy_connect: "/buddy",
    medic_connection: "/medic", supervisor_load: "/supervisor", rest_break: "/shifts",
    wellbeing_checkin: "/wellbeing",
  };

  function forecastSection(fc) {
    if (!fc) return ""; // no score yet, or endpoint hiccup — dashboard stays usable
    const confCls = fc.confidence === "high" ? "tone-success" : fc.confidence === "moderate" ? "tone-warning" : "tone-danger";
    const cell = function (label, h, accent) {
      const dir = h.change > 0 ? "tone-success" : h.change < 0 ? "tone-danger" : "";
      const arrow = h.change > 0 ? "▲" : h.change < 0 ? "▼" : "▬";
      return '<div class="fc-cell">' +
        '<div class="s-label">' + label + "</div>" +
        '<div class="s-value fc-value">' + h.projected + '<span class="fc-pm"> ± ' + h.pm + "</span></div>" +
        '<div class="s-meta">' + arrow + " " + Math.abs(h.change) + " · range " + h.range[0] + "–" + h.range[1] + "</div>" +
        (accent ? '<div class="fc-bar"><span style="width:' + h.projected + '%"></span></div>' : "") +
        "</div>";
    };
    let html = '<section class="card forecast-card"><div class="card-header"><h3>Fatigue Forecast</h3>' +
      '<span class="badge">' + esc(fc.label) + '</span><span class="badge ' + confCls + '">Confidence: ' + fc.confidence + "</span></div>" +
      '<div class="fc-strip">' +
      '<div class="fc-cell fc-current"><div class="s-label">◉ Current Recovery</div>' +
      '<div class="s-value fc-value">' + fc.current + '<span class="s-value-sub"> / 100</span></div>' +
      '<div class="s-meta">measured today</div>' +
      '<div class="fc-bar"><span style="width:' + fc.current + '%"></span></div></div>' +
      cell("24h Projection", fc.h24, true) +
      cell("48h Projection", fc.h48, true) +
      "</div>";

    if (fc.contributors && fc.contributors.length) {
      html += '<div class="eyebrow mb-2 mt-4">Main contributors</div><div class="fc-contribs">' +
        fc.contributors.map(function (c) {
          const cls = c.direction === "down" ? "tone-danger" : c.direction === "up" ? "tone-success" : "";
          const sign = c.direction === "down" ? "−" : "+";
          return '<div class="fc-contrib"><span class="badge ' + cls + '">' + sign + Math.abs(c.points) + "</span>" +
            '<div><strong>' + esc(c.label) + "</strong>" +
            '<div class="meta">' + esc(c.detail) + "</div></div></div>";
        }).join("") + "</div>";
    }

    html += '<details class="why-details mt-4"><summary>Why this forecast?</summary>' +
      '<ol class="why-list mt-2">' + fc.why.h24.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ol>" +
      '<p class="meta mt-2">' + esc(fc.disclaimer) + "</p></details>";

    html += '<div class="eyebrow mb-2 mt-4">If the trend holds — support options</div><div class="insight-support">' +
      [["♪", "De-Stress Zone", "destress_zone"], ["⇄", "Buddy Connect", "buddy_connect"],
       ["✚", "Medic Officer", "medic_connection"], ["⚑", "Supervisor — load talk", "supervisor_load"]].map(function (s) {
        return '<button class="support-opt as-btn" data-iv="' + s[2] + '"><span class="f-icon" aria-hidden="true">' + s[0] + "</span>" +
          '<span><span class="ins-title">' + s[1] + "</span>" +
          '<span class="ins-sub">engages the support loop</span></span></button>';
      }).join("") + "</div>" +
      '<p class="meta mt-4">A projection with uncertainty — never a guarantee, never a fitness-for-duty call. ' +
      '<a href="#/recovery">Your measured score →</a></p></section>';
    return html;
  }

  /* ---------- VIGIL Insight — the connected layer (SIU phases 3–5) ---------- */

  function insightSection(ctx) {
    if (!ctx) return ""; // engine hiccup — dashboard remains fully usable
    const load = ctx.load || {};
    const insights = ctx.insights || [];
    const support = ctx.support_options || [];
    const bandCls = load.band === "heavy" ? "tone-danger" : load.band === "elevated" ? "tone-warning" : "tone-success";

    let html = '<section class="card insight-card"><div class="card-header"><h3>VIGIL Insight</h3>' +
      '<span class="badge ' + bandCls + '">' + esc(load.label || "Operational load") + " · " + (load.score ?? "—") + "/100</span></div>";

    html += '<div class="insight-load">';
    if (load.reasons && load.reasons.length) {
      html += '<p class="muted mb-2">This view connects your shifts, tasks and rest from the past week. ' +
        "Right now it reflects: <strong>" + load.reasons.map(esc).join("; ") + "</strong>.</p>" +
        '<details class="why-details"><summary>Why am I seeing this?</summary>' +
        '<p class="meta mt-2">Operational load is a transparent composite: shift hours versus last week, ' +
        "tasks open or past due, last night's sleep against your weekly pattern, and your self-reported stress. " +
        "It never includes anything your buddies can see, and it is never shared with your supervisor. " +
        "It is a planning aid — not a medical measure.</p></details>";
    } else {
      html += '<p class="muted">Nothing to flag — your shifts, tasks and rest are in their usual rhythm.</p>';
    }
    html += "</div>";

    if (insights.length) {
      html += '<div class="insight-list">' + insights.map(function (ins) {
        const tone = ins.tone === "warning" ? "insight-warning" : "insight-info";
        return '<div class="insight-row ' + tone + '">' +
          '<span class="ins-icon" aria-hidden="true">' + ins.icon + "</span>" +
          '<div class="grow"><div class="ins-title">' + esc(ins.title) + "</div>" +
          '<p class="ins-msg">' + esc(ins.message) + "</p>" +
          (ins.evidence && ins.evidence.length
            ? '<div class="ins-evidence">' + ins.evidence.map(function (e) { return '<span class="evidence-chip">' + esc(e) + "</span>"; }).join("") + "</div>" : "") +
          '<div class="ins-actions">' + (ins.actions || []).map(function (a) {
            return '<a class="btn sm ghost" href="#' + esc(a.path) + '">' + esc(a.label) + "</a>";
          }).join("") + "</div></div></div>";
      }).join("") + "</div>";
    }

    if (support.length) {
      html += '<div class="eyebrow mb-2 mt-4">Support options for today</div><div class="insight-support">' +
        support.map(function (s) {
          return '<a class="support-opt" href="#' + esc(s.path) + '"><span class="f-icon" aria-hidden="true">' + s.icon + "</span>" +
            '<span><span class="ins-title">' + esc(s.title) + "</span>" +
            '<span class="ins-sub">' + esc(s.desc) + "</span></span></a>";
        }).join("") + "</div>";
    }
    html += '<p class="meta mt-4">Insights are generated from your own VIGIL data — deterministic and explainable, never an AI guess, never a diagnosis.</p></section>';
    return html;
  }

  /* ---------- stat cards ---------- */

  function shiftStat(shift) {
    let value, meta, badge = "";
    if (shift.active) {
      const s = shift.active;
      value = "On shift now";
      meta = esc(fmtTime(s.start_at)) + " – " + esc(fmtTime(s.end_at)) + " · break " + (s.break_minutes || 0) + "m";
      badge = '<span class="badge tone-success"><span class="dot"></span>Active</span>';
    } else if (shift.upcoming && shift.upcoming.length) {
      const s = shift.upcoming[0];
      value = "Next " + esc(fmtTime(s.start_at));
      meta = esc(fmtTime(s.start_at)) + " – " + esc(fmtTime(s.end_at)) + " · " + esc(dayLabel(s.start_at));
      badge = "";
    } else {
      value = "Off today";
      meta = shift.last_completed ? "Last shift ended " + esc(timeAgo(shift.last_completed.end_at)) : "No shifts scheduled";
    }
    return '<div class="card stat-card"><div class="s-label">◐ Next shift ' + badge + "</div>" +
      '<div class="s-value">' + value + "</div>" +
      '<div class="s-meta">' + meta + "</div>" +
      '<a class="card-link s-link" href="#/shifts">Shift Monitor →</a></div>';
  }

  function taskStat(tasks) {
    const parts = [];
    if (tasks.overdue) parts.push('<span class="tone-danger-text">' + tasks.overdue + " overdue</span>");
    if (tasks.due_today) parts.push(tasks.due_today + " due today");
    const meta = parts.length ? parts.join(" · ") : "Nothing due today — nice.";
    return '<div class="card stat-card"><div class="s-label">☑ Today\'s tasks</div>' +
      '<div class="s-value">' + tasks.open + '<span class="s-value-sub"> open</span></div>' +
      '<div class="s-meta">' + meta + "</div>" +
      '<a class="card-link s-link" href="#/tasks">Tasks →</a></div>';
  }

  function wellnessStat(w) {
    const l = w.latest;
    if (!l) {
      return '<div class="card stat-card"><div class="s-label">♡ Wellness</div><div class="s-value">—</div>' +
        '<div class="s-meta">No readings yet</div></div>';
    }
    return '<div class="card stat-card"><div class="s-label">♡ Wellness ' + demoChip("Demo") + "</div>" +
      '<div class="s-value">' + l.heart_rate + '<span class="s-value-sub"> bpm</span></div>' +
      '<div class="s-meta">SpO₂ ' + l.spo2 + "% · sleep " + hoursMin(l.sleep_minutes) + " · " + esc(l.steps.toLocaleString()) + " steps</div>" +
      '<a class="card-link s-link" href="#/wellness">Wellness Monitor →</a></div>';
  }

  function recoveryStat(rec) {
    const l = rec.latest;
    if (!l) {
      return '<div class="card stat-card"><div class="s-label">◉ Recovery Score</div><div class="s-value">—</div>' +
        '<div class="s-meta">Available after your first day</div></div>';
    }
    const prev = rec.previous ? rec.previous.score : null;
    let trend = "";
    if (prev !== null) {
      const diff = l.score - prev;
      const cls = diff > 0 ? "tone-success" : diff < 0 ? "tone-danger" : "";
      const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "▬";
      trend = '<span class="badge ' + cls + '">' + arrow + " " + Math.abs(diff) + " vs yesterday</span>";
    }
    return '<div class="card stat-card recovery-card"><div class="s-label">◉ Recovery Score ' + demoChip("Demo") + "</div>" +
      '<div class="row gap-4 mt-2">' + ring(l.score) +
      '<div><div class="s-meta">0–100 · transparent factors</div>' +
      (trend || '<div class="s-meta">First score</div>') + "</div></div>" +
      '<a class="card-link s-link" href="#/recovery">How it\'s calculated →</a></div>';
  }

  function ring(score) {
    const tone = score >= 70 ? "good" : score >= 45 ? "mid" : "low";
    const cls = tone === "good" ? "ring-good" : tone === "mid" ? "ring-mid" : "ring-low";
    return '<div class="score-ring ' + cls + '" style="--pct:' + score + '" role="img" aria-label="Recovery score ' + score + " out of 100\">" +
      '<div class="ring-inner"><span class="ring-num">' + score + "</span></div></div>";
  }

  function recoveryFactors(latest) {
    if (!latest) {
      return '<div class="empty-state" style="padding: var(--sp-8) var(--sp-4)"><div class="icon">◉</div>' +
        "<h3>Your first score arrives tomorrow</h3><p>After a day of shifts and rest, VIGIL AI builds a transparent 0–100 Recovery Score from your sleep, rest, workload, activity and self-reported stress.</p></div>";
    }
    const f = latest.factors || {};
    const rows = [
      ["Sleep", f.sleep, 30, hoursMin((f.inputs || {}).sleep_minutes || 0) + " of sleep"],
      ["Rest since last shift", f.rest, 25, ((f.inputs || {}).rest_hours ?? "—") + "h since duty ended"],
      ["Weekly shift load", f.shift_load, 25, ((f.inputs || {}).week_hours ?? "—") + "h this week"],
      ["Activity", f.activity, 10, ((f.inputs || {}).steps ?? 0).toLocaleString() + " steps"],
      ["Self-reported stress", f.stress, 10, "reported " + ((f.inputs || {}).stress ?? "—") + " of 5"],
    ];
    return '<p class="muted mb-4">' + esc(latest.explanation) + "</p>" +
      '<div class="factor-list">' + rows.map(function (r) {
        return '<div class="factor-row"><div class="f-head"><span class="f-name">' + esc(r[0]) + "</span>" +
          '<span class="f-pts">' + r[1] + " / " + r[2] + "</span></div>" +
          '<div class="progress-track"><div class="progress-fill" style="width:' + Math.round(r[1] / r[2] * 100) + '%"></div></div>' +
          '<div class="f-note meta">' + esc(r[3]) + "</div></div>";
      }).join("") + "</div>" +
      '<p class="meta mt-4">A wellness indicator — never a medical diagnosis. Readings are simulated for the demo.</p>';
  }

  function tasksList(next, overdueCount) {
    if (!next || !next.length) {
      return '<div class="empty-state" style="padding: var(--sp-8) var(--sp-4)"><div class="icon">☑</div>' +
        "<h3>No open tasks</h3><p>When your supervisor assigns work, it shows up here.</p></div>";
    }
    return '<div class="stack-list">' + next.map(function (t) {
      const due = taskDueLabel(t.due_at);
      const prio = { high: "tone-warning", critical: "tone-danger", medium: "", low: "" }[t.priority] || "";
      const overdue = t.overdue;
      return '<div class="task-row' + (overdue ? " overdue" : "") + '">' +
        '<div class="grow"><div class="l-title">' + esc(t.title) +
        (t.priority === "high" || t.priority === "critical" ? ' <span class="badge ' + prio + '">' + esc(t.priority) + "</span>" : "") + "</div>" +
        '<div class="l-sub">' + (overdue ? '<span class="tone-danger-text">Overdue · was due ' : "Due ") + esc(due) + (overdue ? "</span>" : "") +
        " · " + esc(t.status.replace("_", " ")) + "</div>" +
        '<div class="progress-track sm mt-2"><div class="progress-fill" style="width:' + t.progress + '%"></div></div></div>' +
        '<span class="t-pct meta">' + t.progress + "%</span></div>";
    }).join("") + "</div>" +
    (overdueCount ? '<p class="meta mt-4">' + overdueCount + " task" + (overdueCount === 1 ? "" : "s") + ' overdue — <a href="#/tasks">review in Tasks →</a></p>' : "");
  }

  function taskDueLabel(iso) {
    if (!iso) return "No due date";
    const d = new Date(iso);
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const tmr = new Date(today); tmr.setDate(tmr.getDate() + 1);
    if (d <= today) return d.toLocaleDateString(undefined, { weekday: "short" }) + " " + fmtTime(iso);
    if (d <= tmr) return "tomorrow " + fmtTime(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + fmtTime(iso);
  }

  function supportSummary(support) {
    const count = support.open_requests;
    const latest = support.latest;
    if (!count && !latest) {
      return '<div class="empty-state" style="padding: var(--sp-8) var(--sp-4)"><div class="icon">✚</div>' +
        "<h3>No open requests</h3><p>Reach your Medic Officer or Supervisor any time — no reason is too small.</p></div>";
    }
    const kind = latest.medic_id ? "Medic Officer" : "Supervisor";
    const badge = { open: "tone-brand", acknowledged: "tone-accent", in_progress: "tone-warning" }[latest.status] || "";
    return '<div class="support-summary">' +
      '<div class="sup-count"><div class="s-value" style="font-size:22px">' + count + "</div>" +
      '<div class="meta">open request' + (count === 1 ? "" : "s") + " — someone is on it</div></div>" +
      (latest ? '<div class="list-row grow"><div class="l-icon" aria-hidden="true">' + (latest.medic_id ? "✚" : "⚑") + "</div>" +
        '<div class="grow"><div class="l-title">' + esc(kind) + " · " + esc(latest.category.replace(/_/g, " ")) + "</div>" +
        '<div class="l-sub">' + esc(latest.description) + "</div>" +
        '<div class="meta mt-2">Requested ' + esc(timeAgo(latest.created_at)) + "</div></div>" +
        '<span class="badge ' + badge + '">' + esc(latest.status.replace("_", " ")) + "</span></div>" : "") +
      "</div>";
  }

  function hoursMin(mins) {
    if (mins === null || mins === undefined) return "—";
    return Math.floor(mins / 60) + "h " + Math.round(mins % 60) + "m";
  }

  function dayLabel(iso) {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }

  function notifIcon(kind) {
    return { shift: "◐", task: "☑", support: "✚", system: "◆", buddy: "⇄", message_home: "⌂", incident: "△" }[kind] || "◆";
  }
})(window.VIGIL = window.VIGIL || {});
