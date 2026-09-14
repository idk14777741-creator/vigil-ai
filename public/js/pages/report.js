/**
 * VIGIL AI — Weekly Report (Phase 7).
 * One calm review of the last 7 days: workload, tasks, wellness, recovery,
 * support activity — with highlights, a mock AI summary (labelled), and a
 * private personal reflection.
 */
(function (V) {
  const esc = V.UI.esc;
  const demoChip = V.UI.demoChip;
  const toast = V.UI.toast;
  const barChart = V.UI.barChart;
  const lineChart = V.UI.lineChart;

  V.ROUTER.register("/report", render, { title: "Weekly Report", nav: "/report", roles: ["personnel"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="card"><div class="skeleton skeleton-line title"></div><div class="skeleton skeleton-line" style="width:55%"></div></div>' +
      '<div class="grid-2">' + V.UI.skeletonCard() + V.UI.skeletonCard() + "</div></div>";
    load(el);
  }

  async function load(el) {
    const result = await V.UI.safe(function () { return V.API.endpoints.myReport(); });
    if (!result) {
      el.innerHTML = '<div class="page"><div class="empty-state"><div class="icon">▤</div>' +
        "<h3>Weekly Report unavailable</h3><p>We couldn't load your report. Please try again.</p>" +
        '<button class="btn primary" id="rep-retry">Try again</button></div></div>';
      document.getElementById("rep-retry")?.addEventListener("click", function () { render(el); });
      return;
    }

    el.innerHTML = '<div class="page">' +
      header(result) +
      highlightsCard(result.highlights) +
      workloadCard(result.workload) +
      '<div class="grid-2">' + tasksCard(result.tasks) + recoveryCard(result.recovery) + "</div>" +
      wellnessCard(result.wellness) +
      aiCard(result.ai_summary) +
      reflectionCard(result) +
      "</div>";

    wireReflection(result, el);
  }

  function header(d) {
    return '<section class="card report-hero">' +
      '<div class="row-between wrap gap-4">' +
      "<div>" +
      '<div class="eyebrow mb-2">Your week ' + demoChip("Demo · Simulated data") + "</div>" +
      '<h1 class="display" style="font-size:24px">' + esc(d.label) + "</h1>" +
      '<p class="muted mt-2" style="max-width:56ch">A calm look back so next week can be even better. Only you can see this report.</p>' +
      "</div></div></section>";
  }

  function highlightsCard(highlights) {
    return '<section class="card"><div class="card-header"><h3>This week at a glance</h3></div>' +
      '<ul class="hl-list">' + highlights.map(function (h) {
        return "<li>" + esc(h) + "</li>";
      }).join("") + "</ul></section>";
  }

  function workloadCard(w) {
    return '<section class="card"><div class="card-header"><h3>Workload</h3><span class="badge">' + w.shifts + " shifts</span></div>" +
      '<div class="week-stats">' +
      ws(w.hours + "h", "Total") + ws(w.shifts, "Shifts") +
      ws(w.longest_shift_h + "h", "Longest") +
      ws(Math.round(w.break_minutes / 60 * 10) / 10 + "h", "Breaks") +
      "</div>" +
      (w.extended_shifts
        ? '<p class="meta">' + w.extended_shifts + " extended shift" + (w.extended_shifts === 1 ? "" : "s") + " — extra rest earned afterwards.</p>"
        : '<p class="meta">No extended shifts — a well-paced week.</p>') +
      "</section>";
  }

  function ws(v, l) { return '<div class="ws"><div class="ws-v">' + esc(String(v)) + '</div><div class="ws-l">' + esc(l) + "</div></div>"; }

  function tasksCard(t) {
    return '<section class="card"><div class="card-header"><h3>Tasks</h3></div>' +
      '<div class="week-stats" style="grid-template-columns:repeat(3,1fr)">' +
      ws(t.completed, "Completed") + ws(t.open, "Open") + ws(t.overdue, "Overdue") +
      "</div>" +
      (t.completed_titles && t.completed_titles.length
        ? '<div class="meta mb-2">Recently completed:</div><ul class="hl-list">' +
          t.completed_titles.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>"
        : '<p class="meta">No tasks completed this week — that\'s fine. Open tasks wait for you in Tasks.</p>') +
      "</section>";
  }

  function recoveryCard(r) {
    const bars = r.series.map(function (p) {
      return { label: new Date(p.date).toLocaleDateString(undefined, { day: "numeric" }), value: p.score };
    });
    return '<section class="card"><div class="card-header"><h3>Recovery</h3>' + demoChip("Simulated") + "</div>" +
      '<div class="week-stats" style="grid-template-columns:repeat(3,1fr)">' +
      ws(r.avg !== null ? r.avg : "—", "Average") +
      ws(r.low !== null ? r.low : "—", "Lowest") +
      ws(r.high !== null ? r.high : "—", "Best") +
      "</div>" +
      barChart(bars, { height: 56, labelEvery: 2 }) +
      '<p class="meta mt-4">Dips usually follow heavier shifts and recover with rest.</p>' +
      "</section>";
  }

  function wellnessCard(w) {
    const sleepBars = w.series_dates.map(function (d, i) {
      return { label: new Date(d).toLocaleDateString(undefined, { day: "numeric" }), value: w.series_sleep_hours[i] || 0.1 };
    });
    const h = w.sleep_avg_minutes !== null ? Math.floor(w.sleep_avg_minutes / 60) : "—";
    const m = w.sleep_avg_minutes !== null ? Math.round(w.sleep_avg_minutes % 60) : "";
    return '<section class="card"><div class="card-header"><h3>Wellness</h3>' + demoChip("Simulated") + "</div>" +
      '<div class="week-stats">' +
      ws(h !== "—" ? h + "h " + m + "m" : "—", "Avg sleep") +
      ws(w.sleep_quality_avg !== null ? w.sleep_quality_avg + " / 5" : "—", "Sleep quality") +
      ws(w.hr_avg !== null ? w.hr_avg + " bpm" : "—", "Resting HR") +
      ws(w.stress_avg !== null ? w.stress_avg + " / 5" : "—", "Stress self-report") +
      "</div>" +
      lineChart(w.series_hr, { label: "Resting heart rate, 7 days", min: 45, max: 95 }) +
      barChart(sleepBars, { height: 50, labelEvery: 2 }) +
      '<p class="meta mt-4">Simulated readings — a pattern view, never a diagnosis.</p>' +
      "</section>";
  }

  function aiCard(summary) {
    return '<section class="card ai-card"><div class="card-header"><h3>✦ VIGIL AI summary</h3>' +
      '<span class="badge tone-brand">AI (mock) · demo</span></div>' +
      '<p class="ai-text">' + esc(summary) + "</p>" +
      '<p class="meta mt-4">In live mode this summary is generated by a real AI model from your week\'s data — it never sees your identity, and nothing is shared with anyone.</p>' +
      "</section>";
  }

  function reflectionCard(d) {
    const saved = d.reflection && d.reflection.reflection ? d.reflection.reflection : "";
    return '<section class="card"><div class="card-header"><h3>Your reflection</h3><span class="badge">Private — only you</span></div>' +
      '<div class="field"><label for="week-reflection">How did this week feel? What helped? What would you change?</label>' +
      '<textarea id="week-reflection" maxlength="2000" placeholder="A sentence or two is plenty…">' + esc(saved) + "</textarea>" +
      '<span class="hint">Saved privately to your record. Nothing here is shared with anyone.</span></div>' +
      '<button class="btn primary" id="save-reflection">Save reflection</button>' +
      '<span id="reflection-saved-at" class="meta ml-4">' + (d.reflection && d.reflection.updated_at ? "Saved " + new Date(d.reflection.updated_at).toLocaleString() : "") + "</span>" +
      "</section>";
  }

  function wireReflection(d, el) {
    const btn = document.getElementById("save-reflection");
    btn?.addEventListener("click", async function () {
      const text = document.getElementById("week-reflection").value;
      btn.disabled = true;
      try {
        const res = await V.API.endpoints.saveReflection(d.week_start, text);
        document.getElementById("reflection-saved-at").textContent =
          "Saved " + new Date(res.reflection.updated_at).toLocaleString();
        toast("Reflection saved — it stays private to you.", "success");
      } catch (e) {
        toast(e.message, "error");
      }
      btn.disabled = false;
    });
  }
})(window.VIGIL = window.VIGIL || {});
