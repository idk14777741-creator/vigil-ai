/**
 * VIGIL AI — Wellness Monitor (Phase 5).
 * Simulated vitals + trends, clearly labelled demo data. Non-diagnostic:
 * everything is framed against the user's own baseline, with supportive
 * suggestions rather than clinical claims.
 */
(function (V) {
  const esc = V.UI.esc;
  const fmtDate = V.UI.fmtDate;
  const demoChip = V.UI.demoChip;
  const lineChart = V.UI.lineChart;
  const toast = V.UI.toast;

  V.ROUTER.register("/wellness", render, { title: "Wellness Monitor", nav: "/wellness", roles: ["personnel"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="card"><div class="skeleton skeleton-line title"></div><div class="skeleton skeleton-line" style="width:55%"></div></div>' +
      '<div class="grid-2">' + V.UI.skeletonCard() + V.UI.skeletonCard() + "</div></div>";
    load(el);
  }

  async function load(el) {
    const result = await V.UI.safe(function () { return V.API.endpoints.myWellness(); });
    if (!result) {
      el.innerHTML = '<div class="page"><div class="empty-state"><div class="icon">♡</div>' +
        "<h3>Wellness Monitor unavailable</h3><p>We couldn't load your readings. Please try again.</p>" +
        '<button class="btn primary" id="well-retry">Try again</button></div></div>';
      document.getElementById("well-retry")?.addEventListener("click", function () { render(el); });
      return;
    }
    if (!result.has_data) {
      el.innerHTML = '<div class="page"><div class="empty-state"><div class="icon">♡</div>' +
        "<h3>Your wellness view is on its way</h3><p>" + esc(result.message) + "</p></div></div>";
      return;
    }

    el.innerHTML = '<div class="page">' +
      header(result) +
      vitalsRow(result) +
      sleepCard(result) +
      activityCard(result) +
      insightsCard(result.insights) +
      privacyNote() +
      "</div>";
  }

  function header(d) {
    return '<section class="card">' +
      '<div class="row-between wrap gap-4">' +
      "<div>" +
      '<div class="eyebrow mb-2">Last 14 days ' + demoChip("Demo · Simulated data") + "</div>" +
      '<h1 class="display" style="font-size:24px">How you\'re doing</h1>' +
      '<p class="muted mt-2" style="max-width:58ch">These readings come from a simulated device for the demo. They describe patterns — they never diagnose anything.</p>' +
      "</div>" +
      '<span class="badge">' + esc(d.source === "simulated" ? "Simulated source" : esc(d.source)) + "</span>" +
      "</div></section>";
  }

  function vitalsRow(d) {
    const l = d.latest, base = d.baseline_7d;
    return '<section class="stat-row">' +
      vital("♡", "Resting heart rate", l.heart_rate, "bpm", base.hr !== null ? "usual " + base.hr : null, d.series.heart_rate, { min: 45, max: 95 }) +
      vital("◎", "SpO₂", l.spo2, "%", base.spo2 !== null ? "usual " + base.spo2 + "%" : null, d.series.spo2, { min: 92, max: 100 }) +
      vital("☾", "Sleep last night", hoursMin(l.sleep_minutes), "", base.sleep !== null ? "usual " + hoursMin(base.sleep) : null, d.series.sleep_hours, {}) +
      vital("◍", "Steps", (l.steps || 0).toLocaleString(), "", base.steps !== null ? "usual " + Math.round(base.steps).toLocaleString() : null, d.series.steps, {}) +
      "</section>";
  }

  function vital(icon, label, value, unit, usual, series, range) {
    return '<div class="card stat-card vital-card">' +
      '<div class="s-label"><span aria-hidden="true">' + icon + "</span> " + esc(label) + "</div>" +
      '<div class="s-value">' + value + '<span class="s-value-sub">' + unit + "</span></div>" +
      (usual ? '<div class="s-meta">' + esc(usual) + "</div>" : "") +
      '<div class="mt-3">' + lineChart(series, Object.assign({ label: label + " trend" }, range)) + "</div>" +
      "</div>";
  }

  function sleepCard(d) {
    const sp = d.sleep_pattern;
    const q = sp.avg_quality;
    const bars = d.series.sleep_hours.map(function (h, i) {
      return { label: new Date(d.series.dates[i]).toLocaleDateString(undefined, { day: "numeric" }), value: h || 0.1 };
    });
    return '<section class="card"><div class="card-header"><h3>Sleep pattern</h3>' + demoChip("Simulated") + "</div>" +
      '<p class="muted">' + esc(sp.message) + "</p>" +
      '<div class="row gap-4 mt-4 wrap">' +
      '<span class="badge tone-brand">Avg quality ' + (q !== null ? q + " / 5" : "—") + "</span>" +
      '<span class="badge' + (sp.short_nights >= 3 ? " tone-warning" : "") + '">' + sp.short_nights + " short night" + (sp.short_nights === 1 ? "" : "s") + " (&lt;6h)</span>" +
      (sp.diff_hours_vs_prior_week !== null ? '<span class="badge">' + (sp.diff_hours_vs_prior_week >= 0 ? "+" : "") + sp.diff_hours_vs_prior_week + "h vs prior week</span>" : "") +
      "</div>" +
      '<div class="mt-4">' + V.UI.barChart(bars, { height: 54, labelEvery: 2 }) + "</div>" +
      '<p class="meta mt-4">Sleep is the biggest single input to your Recovery Score.</p></section>';
  }

  function activityCard(d) {
    const a = d.activity;
    const pct = Math.min(100, Math.round((a.avg_steps || 0) / 10000 * 100));
    return '<section class="card"><div class="card-header"><h3>Activity</h3>' + demoChip("Simulated") + "</div>" +
      '<p class="muted">' + esc(a.message) + "</p>" +
      '<div class="mt-4"><div class="row-between mb-2"><span class="meta">toward 10k a day</span><span class="f-pts">' + pct + "%</span></div>" +
      '<div class="progress-track"><div class="progress-fill' + (pct >= 60 ? " tone-success" : "") + '" style="width:' + pct + '%"></div></div></div>' +
      '<p class="meta mt-4">Movement is one of five factors in your Recovery Score — gentle counts.</p></section>';
  }

  function insightsCard(insights) {
    return '<section class="card"><div class="card-header"><h3>Worth noticing</h3>' + demoChip("Pattern notes") + "</div>" +
      '<div class="flag-list">' + insights.map(function (i) {
        return '<div class="flag-row tone-' + (i.tone === "positive" ? "info" : i.tone) + '">' +
          '<span class="f-icon" aria-hidden="true">' + i.icon + "</span>" +
          '<div class="grow"><div class="f-title">' + esc(i.title) + "</div>" +
          '<p class="meta">' + esc(i.message) + "</p></div></div>";
      }).join("") + "</div>" +
      '<p class="meta mt-4">These notes compare your recent days with your own baseline. They are wellness observations, not medical advice — for anything that concerns you, your Medic Officer is one tap away.</p></section>';
  }

  function privacyNote() {
    return '<section class="card privacy-card"><div class="row gap-3">' +
      '<span class="f-icon" aria-hidden="true">🔒</span>' +
      '<div><strong>Who can see this</strong>' +
      '<p class="meta mt-2">Only you. Your supervisor sees workload (shifts and tasks) — never these readings. Your Medic Officer sees them only if you explicitly authorize it, and buddies never do.</p></div>' +
      "</div></section>";
  }

  function hoursMin(mins) {
    if (mins === null || mins === undefined) return "—";
    return Math.floor(mins / 60) + "h " + Math.round(mins % 60) + "m";
  }
})(window.VIGIL = window.VIGIL || {});
