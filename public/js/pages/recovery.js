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
  const timeAgo = V.UI.timeAgo;

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

    const change = await V.UI.safe(function () { return V.API.endpoints.recoveryChange(); });
    const loop = await V.UI.safe(function () { return V.API.endpoints.interventions(); });
    const stress = await V.UI.safe(function () { return V.API.endpoints.stress(); });

    el.innerHTML = '<div class="page">' +
      hero(result) +
      stressCard(stress) +
      changeCard(change) +
      supportLoopCard(loop) +
      '<div class="grid-2">' +
      factorsCard(result.latest) +
      suggestionsCard(result.suggestions) +
      "</div>" +
      historyCard(result.history) +
      formulaCard(result.formula) +
      "</div>";

    // Support-loop actions: engage a support option / record a follow-up.
    el.querySelectorAll("[data-iv]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const res = await V.UI.safe(function () {
          return V.API.endpoints.interventionEngage(btn.getAttribute("data-iv"), "recovery");
        });
        if (!res) return;
        toast(res.reused
          ? "Already tracked — your follow-up continues below."
          : "Support engagement recorded. Check in again after your next score.");
        load(el);
      });
    });
    el.querySelectorAll("[data-ivf]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const sel = btn.parentElement.querySelector("select");
        const helpfulness = sel && sel.value ? parseInt(sel.value, 10) : null;
        const res = await V.UI.safe(function () {
          return V.API.endpoints.interventionFollowup(btn.getAttribute("data-ivf"), helpfulness);
        });
        if (!res) return;
        toast("Follow-up recorded — observed change: " +
          (res.followup.observed_change === null ? "no comparison yet" :
            (res.followup.observed_change > 0 ? "+" : "") + res.followup.observed_change + " pts"));
        load(el);
      });
    });
  }

  /* ---------- closed support loop (intelligence phase 3) ---------- */

  function supportLoopCard(loop) {
    if (!loop) return "";
    const engaged = {};
    (loop.open || []).forEach(function (o) { engaged[o.intervention_id] = true; });

    let html = '<section class="card loop-card"><div class="card-header"><h3>Your support loop</h3>' +
      demoChip("Observational") + "</div>";

    html += '<p class="muted mb-4">Detect → support → follow up → observe the trend. VIGIL records what happens around your ' +
      "support engagements — it never claims a support option caused any change, and none of this is a diagnosis.</p>";

    html += '<div class="eyebrow mb-2">Suggested support</div><div class="insight-support">' +
      loop.catalog.map(function (c) {
        return '<button class="support-opt as-btn' + (engaged[c.id] ? " engaged" : "") + '" data-iv="' + esc(c.id) + '">' +
          "<span class=\"f-icon\" aria-hidden=\"true\">" + esc(c.icon) + "</span>" +
          "<span><span class=\"ins-title\">" + esc(c.label) + "</span>" +
          "<span class=\"ins-sub\">" + (engaged[c.id] ? "engaged — follow up below" : "tap to engage & start tracking") + "</span></span></button>";
      }).join("") + "</div>";

    if ((loop.open || []).length) {
      html += '<div class="eyebrow mb-2 mt-4">Open engagements</div><div class="loop-open">' +
        loop.open.map(function (o) {
          const ch = o.change_so_far;
          const cls = ch > 0 ? "tone-success" : ch < 0 ? "tone-warning" : "";
          return '<div class="loop-row"><div class="f-icon" aria-hidden="true">' + esc(o.icon) + "</div>" +
            '<div class="grow"><div class="l-title">' + esc(o.label) + "</div>" +
            '<div class="l-sub">Engaged ' + esc(timeAgo(o.created_at)) +
            (o.recovery_before !== null ? " · recovery was " + o.recovery_before : "") +
            (ch !== null && ch !== undefined ? " · <span class=\"badge " + cls + "\">" + (ch > 0 ? "+" : "") + ch + " since</span>" : "") +
            "</div></div>" +
            '<div class="row gap-2">' +
            '<select class="followup-rate" aria-label="How helpful was this? (optional)">' +
            '<option value="">Rate (optional)</option><option value="5">5 · very</option><option value="4">4</option>' +
            '<option value="3">3</option><option value="2">2</option><option value="1">1 · not really</option></select>' +
            '<button class="btn sm primary" data-ivf="' + esc(o.id) + '">Record follow-up</button></div></div>';
        }).join("") + "</div>";
    }

    if ((loop.history || []).length) {
      html += '<div class="eyebrow mb-2 mt-4">Follow-up history</div><div class="loop-history">' +
        loop.history.map(function (h) {
          const fu = h.followup || {};
          const ch = fu.observed_change;
          const cls = ch > 0 ? "tone-success" : ch < 0 ? "tone-warning" : "";
          return '<div class="loop-row"><div class="f-icon" aria-hidden="true">' + esc(h.icon) + "</div>" +
            '<div class="grow"><div class="l-title">' + esc(h.label) + "</div>" +
            '<div class="l-sub">' +
            (h.recovery_before !== null && fu.recovery_after !== null
              ? "Recovery " + h.recovery_before + " → " + fu.recovery_after + " · " : "") +
            (ch !== null && ch !== undefined
              ? '<span class="badge ' + cls + '">observed change ' + (ch > 0 ? "+" : "") + ch + "</span> " : "") +
            esc(fu.status || "") +
            (fu.helpfulness ? " · rated " + fu.helpfulness + "/5" : "") + "</div></div></div>";
        }).join("") + "</div>";
    }

    html += '<p class="meta mt-4">' + esc(loop.observational || "") + "</p></section>";
    return html;
  }

  /* ---------- why did my score change (SIU phase 4) ---------- */

  function changeCard(change) {
    if (!change || change.has_change === false || !change.factors || !change.factors.length) {
      return '<section class="card change-card"><div class="card-header"><h3>Why did my score change?</h3>' +
        demoChip("Deterministic") + "</div>" +
        '<p class="muted">From your second day of scores onward, this section explains every change — factor by factor, with the exact inputs.</p></section>';
    }
    const dir = change.direction;
    const dirCls = dir === "up" ? "tone-success" : dir === "down" ? "tone-warning" : "";
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "▬";
    return '<section class="card change-card"><div class="card-header"><h3>Why did my score change?</h3>' +
      '<span class="badge ' + dirCls + '">' + arrow + " " + Math.abs(change.total_change) + " vs yesterday</span></div>" +
      '<p class="muted mb-4">' + esc(change.headline) + "</p>" +
      '<div class="factor-list">' + change.factors.map(function (f) {
        const up = f.delta > 0;
        const cls = up ? "tone-success" : "tone-danger";
        const sign = up ? "+" : "−";
        return '<div class="factor-row"><div class="f-head"><span class="f-name">' + esc(f.label) + "</span>" +
          '<span class="f-pts ' + cls + '">' + sign + Math.abs(f.delta) + " pts</span></div>" +
          '<div class="f-note meta">' + esc(f.input_prev) + " → " + esc(f.input_now) + "</div></div>";
      }).join("") + "</div>" +
      '<details class="why-details mt-4"><summary>How this explanation is built</summary>' +
      '<p class="meta mt-2">It compares yesterday\'s and today\'s score rows — the same numbers shown in "What shaped today\'s score" — ' +
      "and reports each factor's point change with the underlying inputs. No AI, no estimates: the same data always produces the same explanation.</p></details>" +
      "</section>";
  }

  /* ---------- hero ---------- */

  /* ---------- Stress Load — the second indicator, its own engine (addendum §5, §8) ---------- */

  function stressCard(st) {
    if (!st || !st.has_data) {
      return '<section class="card"><div class="card-header"><h3>Stress Load Score</h3>' +
        demoChip("Demo · Simulated") + "</div>" +
        '<p class="muted">Your Stress Load Score appears after a few days of shifts and readings. ' +
        "It is a separate indicator from Recovery — it measures how much load you're under, not how restored you are.</p></section>";
    }
    const bandCls = st.band === "high" ? "tone-danger" : st.band === "elevated" ? "tone-warning" : "tone-success";

    let html = '<section class="card"><div class="card-header"><h3>Stress Load Score</h3>' +
      '<span class="badge ' + bandCls + '">' + esc(st.band_label) + "</span>" + demoChip("Demo · Simulated") + "</div>";

    html += '<div class="row gap-4 mt-2 wrap">' +
      '<div><div class="ind-value">' + st.score + '<span> / 100</span></div>' +
      '<div class="s-meta">higher = more current load</div></div>' +
      '<p class="muted grow" style="max-width:480px">' + esc(st.summary) + "</p></div>";

    html += '<div class="factor-list mt-4">' + st.factor_meta.map(function (m) {
      const pct = m.max ? Math.round(m.points / m.max * 100) : 0;
      return '<div class="factor-row"><div class="f-head"><span class="f-name">' + esc(m.label) + "</span>" +
        '<span class="f-pts">+' + m.points + " / " + m.max + "</span></div>" +
        '<div class="progress-track"><div class="progress-fill ' +
        (pct >= 66 ? "tone-danger" : pct >= 33 ? "tone-warning" : "tone-success") +
        '" style="width:' + pct + '%"></div></div>' +
        '<div class="f-note meta">' + esc(m.input) + "</div></div>";
    }).join("") + "</div>";

    if (st.support && st.support.length) {
      html += '<div class="eyebrow mb-2 mt-4">If you want support today</div><div class="insight-support">' +
        st.support.map(function (s) {
          return '<button class="support-opt as-btn" data-iv="' + s.engage + '"><span class="f-icon" aria-hidden="true">' + s.icon + "</span>" +
            '<span><span class="ins-title">' + esc(s.title) + "</span>" +
            '<span class="ins-sub">' + esc(s.desc) + "</span></span></button>";
        }).join("") + "</div>";
    }

    html += '<details class="why-details mt-4"><summary>Why is this different from Recovery?</summary>' +
      '<p class="meta mt-2">' + esc(st.distinct_from_recovery) + "</p>" +
      '<p class="meta mt-2">' + esc(st.weights_note) + "</p>" +
      '<p class="meta mt-2">' + esc(st.disclaimer) + "</p></details>";

    html += "</section>";
    return html;
  }

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
