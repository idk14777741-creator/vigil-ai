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

  function greetingKey() {
    const h = new Date().getHours();
    if (h < 5) return "dash.greeting.night";
    if (h < 12) return "dash.greeting.morning";
    if (h < 17) return "dash.greeting.afternoon";
    return "dash.greeting.evening";
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
      V.API.endpoints.forecast(), V.API.endpoints.stress(),
    ]);
    const d = results[0].status === "fulfilled" ? results[0].value : null;
    const notifs = results[1].status === "fulfilled" ? results[1].value.notifications.slice(0, 4) : [];
    const unit = results[1].status === "fulfilled" ? results[1].value.unit : null;
    const members = results[2].status === "fulfilled" ? results[2].value.members : [];
    const fc = results[3].status === "fulfilled" && results[3].value.has_data ? results[3].value : null;
    const st = results[4].status === "fulfilled" && results[4].value.has_data ? results[4].value : null;

    if (results[0].status === "rejected") {
      el.innerHTML = '<div class="page"><div class="empty-state"><div class="icon">🍃</div>' +
        "<h3>" + V.I18N.t("dash.unavailable") + "</h3><p>" + V.I18N.t("dash.unavailableBody") + "</p>" +
        '<button class="btn primary" id="dash-retry">' + V.I18N.t("common.tryAgain") + "</button></div></div>";
      const retry = document.getElementById("dash-retry");
      if (retry) retry.addEventListener("click", function () { render(el); });
      return;
    }

    const user = state.user;
    const firstName = user.full_name.split(" ")[0];
    const phaseLabel = state.mode === "demo" ? V.I18N.t("dash.demoEnvironment") : V.I18N.t("dash.live");

    const quickActions = [
      ["△", "dash.qa.incident", "dash.qa.incidentSub", "/incidents"],
      ["✚", "dash.qa.medic", "dash.qa.medicSub", "/medic"],
      ["⚑", "dash.qa.supervisor", "dash.qa.supervisorSub", "/supervisor"],
      ["⇄", "dash.qa.buddy", "dash.qa.buddySub", "/buddy"],
      ["⌂", "dash.qa.home", "dash.qa.homeSub", "/home"],
      ["✦", "dash.qa.ai", "dash.qa.aiSub", "/assistant"],
      ["♪", "dash.qa.destress", "dash.qa.destressSub", "/destress"],
    ];

    const isPersonnel = user.role === "personnel";

    el.innerHTML =
      '<div class="page">' +
      '<section class="greeting-card"><div class="row-between wrap">' +
      "<div>" +
      '<div class="eyebrow">' + esc(phaseLabel) + " · " + V.I18N.fmtDate(new Date(), { weekday: "long", month: "long", day: "numeric" }) + "</div>" +
      '<h1 class="display mt-2">' + esc(V.I18N.t(greetingKey())) + ", " + esc(firstName) + '.</h1>' +
      '<p class="g-sub">' + V.I18N.t("dash.greetingSub") + "</p>" +
      "</div>" + avatarHtml(user, "lg") + "</div>" +
      '<div class="greeting-meta">' +
      '<span class="greeting-chip"><span class="c-icon">◈</span> ' + V.I18N.t("common.role") + ' <strong>' + esc(roleLabel(user.role)) + "</strong></span>" +
      (unit ? '<span class="greeting-chip"><span class="c-icon">◎</span> ' + V.I18N.t("common.unit") + ' <strong>' + esc(unit.name) + "</strong></span>" : "") +
      '<span class="greeting-chip"><span class="c-icon">◍</span> <strong>' + state.unread + "</strong> " + esc(V.I18N.t(state.unread === 1 ? "dash.unreadNotifications" : "dash.unreadNotificationsPlural", { n: state.unread })) + "</span>" +
      "</div></section>" +

      (isPersonnel
        ? '<section><div class="eyebrow mb-2">' + V.I18N.t("dash.quickActions") + '</div><div class="quick-actions">' +
          quickActions.map(function (qa) {
            return '<button class="quick-action" data-go="' + qa[3] + '">' +
              '<span class="qa-icon" aria-hidden="true">' + qa[0] + "</span>" +
              '<span class="qa-label">' + esc(V.I18N.t(qa[1])) + "</span>" +
              '<span class="qa-sub">' + esc(V.I18N.t(qa[2])) + "</span></button>";
          }).join("") + "</div></section>" +

          '<section class="stat-row">' +
          shiftStat(d.shift) +
          taskStat(d.tasks) +
          wellnessStat(d.wellness) +
          recoveryStat(d.recovery) +
          "</section>" +

          insightSection(d.context) +

          indicatorsRow(d.recovery, st, fc) +

          forecastSection(fc) +

          '<div class="grid-2">' +
          '<section class="card"><div class="card-header"><h3>' + V.I18N.t("dash.nextTasks") + '</h3><a class="card-link" href="#/tasks">' + V.I18N.t("dash.allTasks") + "</a></div>" +
          tasksList(d.tasks.next, d.tasks.overdue) + "</section>" +
          '<section class="card"><div class="card-header"><h3>' + V.I18N.t("dash.recoveryShaped") + '</h3>' + demoChip(V.I18N.t("common.demoSimulated")) + "</div>" +
          recoveryFactors(d.recovery.latest) + "</section>" +
          "</div>" +

          '<section class="card"><div class="card-header"><h3>' + V.I18N.t("dash.supportRequests") + '</h3><a class="card-link" href="#/medic">' + V.I18N.t("dash.requestSupport") + "</a></div>" +
          supportSummary(d.support) + "</section>"
        : "") +

      '<div class="grid-2">' +
      '<section class="card"><div class="card-header"><h3>' + V.I18N.t("dash.recentNotifications") + '</h3><a class="card-link" href="#/notifications">' + V.I18N.t("common.viewAll") + "</a></div>" +
      (notifs.length
        ? '<div class="stack-list">' + notifs.map(function (n) {
            return '<div class="list-row"><div class="l-icon" aria-hidden="true">' + notifIcon(n.kind) + "</div>" +
              '<div class="grow"><div class="l-title">' + esc(n.title) + "</div>" +
              '<div class="l-sub">' + esc(n.body) + "</div>" +
              '<div class="n-time meta">' + esc(timeAgo(n.created_at)) + "</div></div>" +
              (n.read_at ? "" : '<span class="badge tone-brand">' + V.I18N.t("common.new") + "</span>") + "</div>";
          }).join("") + "</div>"
        : '<div class="empty-state" style="padding: var(--sp-8) var(--sp-4)"><div class="icon">🍃</div>' +
          "<h3>" + V.I18N.t("dash.allCaughtUp") + "</h3><p>" + V.I18N.t("dash.noNotifications") + "</p></div>") +
      "</section>" +

      '<section class="card"><div class="card-header"><h3>' + (unit ? esc(unit.name) : V.I18N.t("dash.yourTeam")) + '</h3><a class="card-link" href="#/team">' + V.I18N.t("dash.openTeam") + "</a></div>" +
      (members.length
        ? '<div class="stack-list">' + members.slice(0, 6).map(function (m) {
            return "<div class=\"list-row\">" + avatarHtml(m) +
              '<div class="grow"><div class="l-title">' + esc(m.full_name) + (m.id === user.id ? " " + V.I18N.t("dash.you") : "") + "</div>" +
              '<div class="l-sub">' + esc(roleLabel(m.role)) + "</div></div></div>";
          }).join("") + "</div>"
        : '<div class="empty-state" style="padding: var(--sp-8) var(--sp-4)"><div class="icon">◎</div>' +
          "<h3>" + V.I18N.t("dash.noUnit") + "</h3><p>" + V.I18N.t("dash.noUnitBody") + "</p></div>") +
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

  /* ---------- Three indicators — Recovery | Stress Load | Fatigue Risk (addendum §5–§6, §28) ----------
   * Three distinct questions, never merged into one score:
   *   Recovery — "How recovered am I?"  (higher = better)
   *   Stress  — "How much load am I under?" (higher = more load, own engine)
   *   Fatigue — "Does the pattern indicate near-term fatigue risk?" (the forecast)
   */

  function indicatorsRow(rec, st, fc) {
    let html = '<section class="card"><div class="card-header"><h3>' + V.I18N.t("ind.threeIndicators") + '</h3>' +
      demoChip("Demo · Simulated") + "</div>";
    html += '<div class="ind-strip">';

    // 1 — Recovery (from the measured score)
    const recScore = rec.latest ? rec.latest.score : null;
    const recPrev = rec.previous_score;
    const recTrend = recScore !== null && recPrev !== null ? recScore - recPrev : null;
    html += indCell({
      icon: "◉", name: V.I18N.t("ind.recovery"), q: V.I18N.t("ind.recoveryQ"),
      value: recScore !== null ? recScore + " / 100" : "—",
      bar: recScore, goodHigh: true,
      trend: recTrend === null ? "" :
        (recTrend > 0 ? "<span class='badge tone-success'>" + V.I18N.t("ind.improving") + "</span>" :
         recTrend < 0 ? "<span class='badge tone-danger'>" + V.I18N.t("ind.down", { n: Math.abs(recTrend) }) + "</span>" :
         "<span class='badge'>" + V.I18N.t("ind.stable") + "</span>"),
      href: "#/recovery", link: V.I18N.t("ind.link.recovery"),
      why: rec.latest ? (rec.latest.explanation || "") : "Your first score arrives after a day of shifts and rest.",
    });

    // 2 — Stress Load (its own engine — never 100 − recovery)
    if (st) {
      const bandCls = st.band === "high" ? "tone-danger" : st.band === "elevated" ? "tone-warning" : "tone-success";
      html += indCell({
        icon: "⌁", name: V.I18N.t("ind.stressLoad"), q: V.I18N.t("ind.stressQ"),
        value: st.score + " / 100",
        bar: st.score, goodHigh: false,
        trend: "<span class='badge " + bandCls + "'>" + esc(V.I18N.t("ind.band." + st.band)) + "</span>",
        href: "#/recovery", link: V.I18N.t("ind.link.driving"),
        why: st.summary + " " + st.distinct_from_recovery,
      });
    } else {
      html += indCell({
        icon: "⌁", name: V.I18N.t("ind.stressLoad"), q: V.I18N.t("ind.stressQ"),
        value: "—", bar: null, goodHigh: false, trend: "",
        href: "#/recovery", link: V.I18N.t("ind.link.recovery"),
        why: "Your Stress Load Score appears after a few days of shifts and readings.",
      });
    }

    // 3 — Fatigue Risk (the forecast band, not a number)
    if (fc) {
      // Risk word derived from the projected 48h change — calm bands, not a new score.
      const drop = -(fc.h48.change);
      const riskWord = drop >= 12 ? V.I18N.t("ind.band.elevated") : drop >= 5 ? V.I18N.t("ind.band.watch") : V.I18N.t("ind.band.low");
      const riskCls = drop >= 12 ? "tone-warning" : "tone-success";
      html += indCell({
        icon: "◔", name: V.I18N.t("ind.fatigueRisk"), q: V.I18N.t("ind.fatigueQ"),
        value: riskWord, bar: null, goodHigh: false,
        trend: "<span class='badge " + riskCls + "'>" + esc(fc.confidence) + "</span>",
        href: "#/recovery", link: V.I18N.t("ind.link.view48"),
        why: "The forecast projects your measured Recovery over the next 24–48 hours with an uncertainty " +
          "range. Projected 48h change: " + (fc.h48.change > 0 ? "+" : "") + fc.h48.change + " points. " +
          "Main drivers now: " + (fc.contributors || []).slice(0, 2).map(function (c) { return c.label; }).join(", ") + ". " + fc.disclaimer,
      });
    } else {
      html += indCell({
        icon: "◔", name: V.I18N.t("ind.fatigueRisk"), q: V.I18N.t("ind.fatigueQ"),
        value: "—", bar: null, goodHigh: false, trend: "",
        href: "#/recovery", link: V.I18N.t("ind.link.recovery"),
        why: "The fatigue-risk estimate appears once a Recovery trend exists.",
      });
    }

    html += "</div>";
    html += '<p class="meta mt-4">' + V.I18N.t("dash.threeQuestionsNote") + "</p>";
    html += "</section>";
    return html;
  }

  function indCell(c) {
    let bar = "";
    if (c.bar !== null && c.bar !== undefined) {
      // For stress, a fuller bar means MORE load — flip the fill colour axis,
      // not the semantics: recovery fills green-ward, stress fills amber-ward.
      const cls = c.goodHigh ? (c.bar >= 70 ? "fill-good" : c.bar >= 45 ? "fill-mid" : "fill-low")
                            : (c.bar >= 65 ? "fill-low" : c.bar >= 40 ? "fill-mid" : "fill-good");
      bar = '<div class="ind-bar"><span class="' + cls + '" style="width:' + c.bar + '%"></span></div>';
    }
    return '<div class="ind-cell">' +
      '<div class="ind-name"><span class="ind-icon" aria-hidden="true">' + c.icon + "</span>" + esc(c.name) + "</div>" +
      '<div class="ind-value">' + c.value + "</div>" +
      bar +
      '<div class="ind-trend">' + c.trend + "</div>" +
      '<div class="ind-q meta">' + esc(c.q) + "</div>" +
      '<details class="why-details mt-2"><summary>' + V.I18N.t("common.why") + '</summary><p class="meta mt-2">' + esc(c.why) + "</p></details>" +
      '<a class="card-link s-link mt-2" href="' + c.href + '">' + esc(c.link) + "</a></div>";
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
        '<div class="s-meta">' + arrow + " " + Math.abs(h.change) + " · " + V.I18N.t("fc.range") + " " + h.range[0] + "–" + h.range[1] + "</div>" +
        (accent ? '<div class="fc-bar"><span style="width:' + h.projected + '%"></span></div>' : "") +
        "</div>";
    };
    let html = '<section class="card forecast-card"><div class="card-header"><h3>' + V.I18N.t("fc.title") + '</h3>' +
      '<span class="badge">' + esc(fc.label) + '</span><span class="badge ' + confCls + '">' + V.I18N.t("common.confidence") + " " + esc(fc.confidence) + "</span></div>" +
      '<div class="fc-strip">' +
      '<div class="fc-cell fc-current"><div class="s-label">' + V.I18N.t("fc.currentRecovery") + "</div>" +
      '<div class="s-value fc-value">' + fc.current + '<span class="s-value-sub"> / 100</span></div>' +
      '<div class="s-meta">' + V.I18N.t("fc.measuredToday") + "</div>" +
      '<div class="fc-bar"><span style="width:' + fc.current + '%"></span></div></div>' +
      cell(V.I18N.t("fc.h24"), fc.h24, true) +
      cell(V.I18N.t("fc.h48"), fc.h48, true) +
      "</div>";

    if (fc.contributors && fc.contributors.length) {
      html += '<div class="eyebrow mb-2 mt-4">' + V.I18N.t("fc.contributors") + '</div><div class="fc-contribs">' +
        fc.contributors.map(function (c) {
          const cls = c.direction === "down" ? "tone-danger" : c.direction === "up" ? "tone-success" : "";
          const sign = c.direction === "down" ? "−" : "+";
          return '<div class="fc-contrib"><span class="badge ' + cls + '">' + sign + Math.abs(c.points) + "</span>" +
            '<div><strong>' + esc(c.label) + "</strong>" +
            '<div class="meta">' + esc(c.detail) + "</div></div></div>";
        }).join("") + "</div>";
    }

    html += '<details class="why-details mt-4"><summary>' + V.I18N.t("fc.why") + '</summary>' +
      '<ol class="why-list mt-2">' + fc.why.h24.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ol>" +
      '<p class="meta mt-2">' + esc(fc.disclaimer) + "</p></details>";

    html += '<div class="eyebrow mb-2 mt-4">' + V.I18N.t("fc.supportOptions") + '</div><div class="insight-support">' +
      [["♪", "nav.destress", "destress_zone"], ["⇄", "nav.buddy", "buddy_connect"],
       ["✚", "term.medicOfficer", "medic_connection"], ["⚑", "term.supervisor", "supervisor_load"]].map(function (s) {
        return '<button class="support-opt as-btn" data-iv="' + s[2] + '"><span class="f-icon" aria-hidden="true">' + s[0] + "</span>" +
          '<span><span class="ins-title">' + V.I18N.t(s[1]) + "</span>" +
          '<span class="ins-sub">' + V.I18N.t("fc.engagesLoop") + '</span></span></button>';
      }).join("") + "</div>" +
      '<p class="meta mt-4">' + V.I18N.t("fc.disclaimerShort") + " " +
      '<a href="#/recovery">' + V.I18N.t("fc.measuredScore") + "</a></p></section>";
    return html;
  }

  /* ---------- VIGIL Insight — the connected layer (SIU phases 3–5) ---------- */

  function insightSection(ctx) {
    if (!ctx) return ""; // engine hiccup — dashboard remains fully usable
    const load = ctx.load || {};
    const insights = ctx.insights || [];
    const support = ctx.support_options || [];
    const bandCls = load.band === "heavy" ? "tone-danger" : load.band === "elevated" ? "tone-warning" : "tone-success";

    let html = '<section class="card insight-card"><div class="card-header"><h3>' + V.I18N.t("insight.title") + "</h3>" +
      '<span class="badge ' + bandCls + '">' + esc(load.label || V.I18N.t("insight.operationalLoad")) + " · " + (load.score ?? "—") + "/100</span></div>";

    html += '<div class="insight-load">';
    if (load.reasons && load.reasons.length) {
      html += '<p class="muted mb-2">' + V.I18N.t("insight.connects") + " <strong>" + load.reasons.map(esc).join("; ") + "</strong>.</p>" +
        '<details class="why-details"><summary>' + V.I18N.t("insight.whySeeing") + "</summary>" +
        '<p class="meta mt-2">' + V.I18N.t("insight.whySeeingBody") + "</p></details>";
    } else {
      html += '<p class="muted">' + V.I18N.t("insight.nothingToFlag") + '</p>';
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
      html += '<div class="eyebrow mb-2 mt-4">' + V.I18N.t("insight.supportToday") + '</div><div class="insight-support">' +
        support.map(function (s) {
          return '<a class="support-opt" href="#' + esc(s.path) + '"><span class="f-icon" aria-hidden="true">' + s.icon + "</span>" +
            '<span><span class="ins-title">' + esc(s.title) + "</span>" +
            '<span class="ins-sub">' + esc(s.desc) + "</span></span></a>";
        }).join("") + "</div>";
    }
    html += '<p class="meta mt-4">' + V.I18N.t("insight.note") + "</p></section>";
    return html;
  }

  /* ---------- stat cards ---------- */

  function shiftStat(shift) {
    let value, meta, badge = "";
    if (shift.active) {
      const s = shift.active;
      value = V.I18N.t("stat.onShiftNow");
      meta = esc(fmtTime(s.start_at)) + " – " + esc(fmtTime(s.end_at)) + " · " + V.I18N.t("stat.break") + " " + (s.break_minutes || 0) + "m";
      badge = '<span class="badge tone-success"><span class="dot"></span>' + V.I18N.t("stat.active") + "</span>";
    } else if (shift.upcoming && shift.upcoming.length) {
      const s = shift.upcoming[0];
      value = V.I18N.t("stat.next") + " " + esc(fmtTime(s.start_at));
      meta = esc(fmtTime(s.start_at)) + " – " + esc(fmtTime(s.end_at)) + " · " + esc(dayLabel(s.start_at));
      badge = "";
    } else {
      value = V.I18N.t("stat.offToday");
      meta = shift.last_completed ? V.I18N.t("stat.lastShiftEnded") + " " + esc(timeAgo(shift.last_completed.end_at)) : V.I18N.t("stat.noShiftsScheduled");
    }
    return '<div class="card stat-card"><div class="s-label">◐ ' + V.I18N.t("stat.nextShift") + " " + badge + "</div>" +
      '<div class="s-value">' + value + "</div>" +
      '<div class="s-meta">' + meta + "</div>" +
      '<a class="card-link s-link" href="#/shifts">' + V.I18N.t("stat.shiftMonitor") + "</a></div>";
  }

  function taskStat(tasks) {
    const parts = [];
    if (tasks.overdue) parts.push('<span class="tone-danger-text">' + tasks.overdue + " " + V.I18N.t("stat.overdue") + "</span>");
    if (tasks.due_today) parts.push(tasks.due_today + " " + V.I18N.t("stat.dueToday"));
    const meta = parts.length ? parts.join(" · ") : V.I18N.t("stat.nothingDue");
    return '<div class="card stat-card"><div class="s-label">☑ ' + V.I18N.t("stat.todayTasks") + "</div>" +
      '<div class="s-value">' + tasks.open + '<span class="s-value-sub"> ' + V.I18N.t("stat.open") + "</span></div>" +
      '<div class="s-meta">' + meta + "</div>" +
      '<a class="card-link s-link" href="#/tasks">' + V.I18N.t("stat.tasks") + "</a></div>";
  }

  function wellnessStat(w) {
    const l = w.latest;
    if (!l) {
      return '<div class="card stat-card"><div class="s-label">♡ ' + V.I18N.t("stat.wellness") + '</div><div class="s-value">—</div>' +
        '<div class="s-meta">' + V.I18N.t("stat.noReadings") + "</div></div>";
    }
    return '<div class="card stat-card"><div class="s-label">♡ ' + V.I18N.t("stat.wellness") + " " + demoChip(V.I18N.t("common.demo")) + "</div>" +
      '<div class="s-value">' + l.heart_rate + '<span class="s-value-sub"> bpm</span></div>' +
      '<div class="s-meta">SpO₂ ' + l.spo2 + "% · " + V.I18N.t("stat.sleep") + " " + hoursMin(l.sleep_minutes) + " · " + esc(l.steps.toLocaleString()) + " " + V.I18N.t("stat.steps") + "</div>" +
      '<a class="card-link s-link" href="#/wellness">' + V.I18N.t("stat.wellnessMonitor") + "</a></div>";
  }

  function recoveryStat(rec) {
    const l = rec.latest;
    if (!l) {
      return '<div class="card stat-card"><div class="s-label">◉ ' + V.I18N.t("stat.recoveryScore") + '</div><div class="s-value">—</div>' +
        '<div class="s-meta">' + V.I18N.t("stat.availableAfterFirstDay") + "</div></div>";
    }
    const prev = rec.previous ? rec.previous.score : null;
    let trend = "";
    if (prev !== null) {
      const diff = l.score - prev;
      const cls = diff > 0 ? "tone-success" : diff < 0 ? "tone-danger" : "";
      const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "▬";
      trend = '<span class="badge ' + cls + '">' + arrow + " " + Math.abs(diff) + " " + V.I18N.t("stat.vsYesterday") + "</span>";
    }
    return '<div class="card stat-card recovery-card"><div class="s-label">◉ ' + V.I18N.t("stat.recoveryScore") + " " + demoChip(V.I18N.t("common.demo")) + "</div>" +
      '<div class="row gap-4 mt-2">' + ring(l.score) +
      '<div><div class="s-meta">' + V.I18N.t("stat.transparentFactors") + "</div>" +
      (trend || '<div class="s-meta">' + V.I18N.t("stat.firstScore") + '</div>') + "</div></div>" +
      '<a class="card-link s-link" href="#/recovery">' + V.I18N.t("stat.howCalculated") + "</a></div>";
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
        "<h3>" + V.I18N.t("factor.firstScoreTitle") + "</h3><p>" + V.I18N.t("factor.firstScoreBody") + "</p></div>";
    }
    const f = latest.factors || {};
    const rows = [
      [V.I18N.t("factor.sleep"), f.sleep, 30, hoursMin((f.inputs || {}).sleep_minutes || 0) + " " + V.I18N.t("factor.ofSleep")],
      [V.I18N.t("factor.rest"), f.rest, 25, ((f.inputs || {}).rest_hours ?? "—") + " " + V.I18N.t("factor.sinceDuty")],
      [V.I18N.t("factor.shiftLoad"), f.shift_load, 25, ((f.inputs || {}).week_hours ?? "—") + " " + V.I18N.t("factor.thisWeek")],
      [V.I18N.t("factor.activity"), f.activity, 10, ((f.inputs || {}).steps ?? 0).toLocaleString() + " " + V.I18N.t("stat.steps")],
      [V.I18N.t("factor.selfStress"), f.stress, 10, V.I18N.t("factor.reportedOf5", { n: (f.inputs || {}).stress ?? "—" })],
    ];
    return '<p class="muted mb-4">' + esc(latest.explanation) + "</p>" +
      '<div class="factor-list">' + rows.map(function (r) {
        return '<div class="factor-row"><div class="f-head"><span class="f-name">' + esc(r[0]) + "</span>" +
          '<span class="f-pts">' + r[1] + " / " + r[2] + "</span></div>" +
          '<div class="progress-track"><div class="progress-fill" style="width:' + Math.round(r[1] / r[2] * 100) + '%"></div></div>' +
          '<div class="f-note meta">' + esc(r[3]) + "</div></div>";
      }).join("") + "</div>" +
      '<p class="meta mt-4">' + V.I18N.t("factor.wellnessNote") + "</p>";
  }

  function tasksList(next, overdueCount) {
    if (!next || !next.length) {
      return '<div class="empty-state" style="padding: var(--sp-8) var(--sp-4)"><div class="icon">☑</div>' +
        "<h3>" + V.I18N.t("task.noOpen") + "</h3><p>" + V.I18N.t("task.noOpenBody") + "</p></div>";
    }
    return '<div class="stack-list">' + next.map(function (t) {
      const due = taskDueLabel(t.due_at);
      const prio = { high: "tone-warning", critical: "tone-danger", medium: "", low: "" }[t.priority] || "";
      const overdue = t.overdue;
      return '<div class="task-row' + (overdue ? " overdue" : "") + '">' +
        '<div class="grow"><div class="l-title">' + esc(t.title) +
        (t.priority === "high" || t.priority === "critical" ? ' <span class="badge ' + prio + '">' + esc(t.priority) + "</span>" : "") + "</div>" +
        '<div class="l-sub">' + (overdue ? '<span class="tone-danger-text">' + V.I18N.t("task.overdueWasDue") + " " : V.I18N.t("task.due") + " ") + esc(due) + (overdue ? "</span>" : "") +
        " · " + esc(V.I18N.t("status." + t.status)) + "</div>" +
        '<div class="progress-track sm mt-2"><div class="progress-fill" style="width:' + t.progress + '%"></div></div></div>' +
        '<span class="t-pct meta">' + t.progress + "%</span></div>";
    }).join("") + "</div>" +
    (overdueCount ? '<p class="meta mt-4">' + V.I18N.t(overdueCount === 1 ? "task.overdueCount" : "task.overdueCountPlural", { n: overdueCount }) + ' <a href="#/tasks">' + V.I18N.t("task.reviewInTasks") + '</a></p>' : "");
  }

  function taskDueLabel(iso) {
    if (!iso) return V.I18N.t("task.noDueDate");
    const d = new Date(iso);
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const tmr = new Date(today); tmr.setDate(tmr.getDate() + 1);
    if (d <= today) return V.I18N.fmtDate(d, { weekday: "short" }) + " " + fmtTime(iso);
    if (d <= tmr) return V.I18N.t("time.tomorrow") + " " + fmtTime(iso);
    return V.I18N.fmtDate(d, { month: "short", day: "numeric" }) + " " + fmtTime(iso);
  }

  function supportSummary(support) {
    const count = support.open_requests;
    const latest = support.latest;
    if (!count && !latest) {
      return '<div class="empty-state" style="padding: var(--sp-8) var(--sp-4)"><div class="icon">✚</div>' +
        "<h3>" + V.I18N.t("support.noOpen") + "</h3><p>" + V.I18N.t("support.noOpenBody") + "</p></div>";
    }
    const kind = latest.medic_id ? V.I18N.t("term.medicOfficer") : V.I18N.t("term.supervisor");
    const badge = { open: "tone-brand", acknowledged: "tone-accent", in_progress: "tone-warning" }[latest.status] || "";
    return '<div class="support-summary">' +
      '<div class="sup-count"><div class="s-value" style="font-size:22px">' + count + "</div>" +
      '<div class="meta">' + V.I18N.t("support.openRequests") + "</div></div>" +
      (latest ? '<div class="list-row grow"><div class="l-icon" aria-hidden="true">' + (latest.medic_id ? "✚" : "⚑") + "</div>" +
        '<div class="grow"><div class="l-title">' + esc(kind) + " · " + esc(latest.category.replace(/_/g, " ")) + "</div>" +
        '<div class="l-sub">' + esc(latest.description) + "</div>" +
        '<div class="meta mt-2">' + V.I18N.t("support.requested") + " " + esc(timeAgo(latest.created_at)) + "</div></div>" +
        '<span class="badge ' + badge + '">' + esc(V.I18N.t("status." + latest.status)) + "</span></div>" : "") +
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
    if (diff === 0) return V.I18N.t("time.today");
    if (diff === 1) return V.I18N.t("time.tomorrow");
    return V.I18N.fmtDate(d, { weekday: "short" });
  }

  function notifIcon(kind) {
    return { shift: "◐", task: "☑", support: "✚", system: "◆", buddy: "⇄", message_home: "⌂", incident: "△" }[kind] || "◆";
  }
})(window.VIGIL = window.VIGIL || {});
