/**
 * VIGIL AI — Recovery Score (Phase 6).
 * Transparent 0–100 wellness indicator: current score, trend, per-day factor
 * breakdown, kind suggestions, 14-day history, and the formula in plain sight.
 */
(function (V) {
  const esc = V.UI.esc;
  const fmtDate = V.UI.fmtDate;
  const demoChip = V.UI.demoChip;
  const toast = V.UI.toast;

  V.ROUTER.register("/recovery", render, { title: "Recovery Score", nav: "/recovery", roles: ["personnel"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="card"><div class="skeleton skeleton-line title"></div><div class="skeleton skeleton-line" style="width:55%"></div></div>' +
      '<div class="grid-2">' + V.UI.skeletonCard() + V.UI.skeletonCard() + "</div></div>";
    load(el);
  }

  async function load(el) {
    const result = await V.UI.safe(function () { return V.API.endpoints.myRecovery(); });
    if (!result) {
      el.innerHTML = '<div class="page"><div class="empty-state"><div class="icon">◉</div>' +
        "<h3>Recovery Score unavailable</h3><p>We couldn't load your score. Please try again.</p>" +
        '<button class="btn primary" id="rec-retry">Try again</button></div></div>';
      document.getElementById("rec-retry")?.addEventListener("click", function () { render(el); });
      return;
    }
    if (!result.has_data) {
      el.innerHTML = '<div class="page"><div class="empty-state"><div class="icon">◉</div>' +
        "<h3>Your first score is on its way</h3><p>" + esc(result.message) + "</p></div></div>";
      return;
    }

    el.innerHTML = '<div class="page">' +
      hero(result) +
      '<div class="grid-2">' +
      factorsCard(result.latest) +
      suggestionsCard(result.suggestions) +
      "</div>" +
      historyCard(result.history) +
      formulaCard(result.formula) +
      "</div>";
  }

  /* ---------- hero ---------- */

  function hero(d) {
    const l = d.latest;
    const score = l.score;
    const tone = score >= 70 ? "good" : score >= 45 ? "mid" : "low";
    const toneCls = tone === "good" ? "tone-success" : tone === "mid" ? "tone-warning" : "tone-danger";
    let trendBadge = "";
    if (d.previous_score !== null && d.previous_score !== undefined) {
      const diff = score - d.previous_score;
      const cls = diff > 0 ? "tone-success" : diff < 0 ? "tone-danger" : "";
      const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "▬";
      trendBadge = '<span class="badge ' + cls + '">' + arrow + " " + Math.abs(diff) + " vs yesterday</span>";
    }
    return '<section class="card rec-hero">' +
      '<div class="row gap-6 wrap">' +
      bigRing(score) +
      "<div>" +
      '<div class="eyebrow mb-2">Today ' + demoChip("Demo · Simulated data") + "</div>" +
      '<h1 class="display" style="font-size:24px">Recovery ' + score + " <span class=\"s-value-sub\">/ 100</span></h1>" +
      '<p class="muted mt-2" style="max-width:52ch">' + esc(d.trend_message) + "</p>" +
      '<div class="row gap-2 mt-4 wrap">' + trendBadge +
      (d.week_avg !== null ? '<span class="badge">weekly avg ~' + d.week_avg + "</span>" : "") +
      '<span class="badge ' + toneCls + '">' + (tone === "good" ? "Recovering well" : tone === "mid" ? "Take it steady" : "Time to recharge") + "</span>" +
      "</div></div></div></section>";
  }

  function bigRing(score) {
    const tone = score >= 70 ? "ring-good" : score >= 45 ? "ring-mid" : "ring-low";
    return '<div class="score-ring ' + tone + '" style="--pct:' + score + '; --ring:104px" role="img" aria-label="Recovery score ' + score + " out of 100\">" +
      '<div class="ring-inner"><span class="ring-num" style="font-size:26px">' + score + "</span></div></div>";
  }

  /* ---------- factors ---------- */

  function factorsCard(latest) {
    return '<section class="card"><div class="card-header"><h3>What shaped today\'s score</h3>' +
      '<span class="meta">' + esc(fmtDate(latest.computed_at, { month: "short", day: "numeric" })) + "</span></div>" +
      '<p class="muted mb-4">' + esc(latest.explanation) + "</p>" +
      '<div class="factor-list">' + latest.factors.map(function (f) {
        const pct = Math.round(f.points / f.max * 100);
        return '<div class="factor-row"><div class="f-head"><span class="f-name">' + esc(f.label) + "</span>" +
          '<span class="f-pts">' + f.points + " / " + f.max + "</span></div>" +
          '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="f-note meta">' + esc(f.input) + " · " + esc(f.desc) + "</div></div>";
      }).join("") + "</div></section>";
  }

  /* ---------- suggestions ---------- */

  function suggestionsCard(suggestions) {
    return '<section class="card"><div class="card-header"><h3>What would help</h3>' + demoChip("Gentle suggestions") + "</div>" +
      '<div class="suggestion-list">' + suggestions.map(function (s) {
        return '<div class="suggestion-row"><span class="f-icon" aria-hidden="true">' + s.icon + "</span>" +
          '<div><div class="f-title">' + esc(s.title) + "</div>" +
          '<p class="meta">' + esc(s.message) + "</p></div></div>";
      }).join("") + "</div>" +
      '<div class="quick-links row gap-2 mt-4 wrap">' +
      '<a class="btn sm ghost" href="#/destress">De-stress Zone</a>' +
      '<a class="btn sm ghost" href="#/medic">Talk to Medic</a>' +
      '<a class="btn sm ghost" href="#/supervisor">Talk to Supervisor</a>' +
      "</div></section>";
  }

  /* ---------- history ---------- */

  function historyCard(history) {
    const bars = history.map(function (h, i) {
      return { label: new Date(h.date).toLocaleDateString(undefined, { day: "numeric" }), value: h.score };
    });
    const avg = Math.round(history.reduce(function (a, h) { return a + h.score; }, 0) / history.length);
    return '<section class="card"><div class="card-header"><h3>Last 14 days</h3><span class="badge">avg ' + avg + "</span></div>" +
      V.UI.barChart(bars, { height: 64, labelEvery: 2 }) +
      '<p class="meta mt-4">Bars show your score each morning. Dips usually follow heavy shifts — they recover with rest.</p></section>';
  }

  /* ---------- formula ---------- */

  function formulaCard(formula) {
    const order = ["sleep", "rest", "shift_load", "activity", "stress"];
    return '<section class="card formula-card"><div class="card-header"><h3>How the score works</h3>' +
      demoChip("Fully transparent") + "</div>" +
      '<p class="muted">Five factors, fixed weights — nothing hidden:</p>' +
      '<div class="formula-grid mt-4">' + order.map(function (key) {
        const f = formula[key];
        return '<div class="formula-item"><div class="f-pts">' + f.max + " pts</div>" +
          '<div class="f-name">' + esc(f.desc) + "</div></div>";
      }).join("") + "</div>" +
      '<p class="meta mt-4">Your score is a wellness indicator to help you plan rest. It is never a medical assessment and never shared with your supervisor.</p></section>';
  }
})(window.VIGIL = window.VIGIL || {});
