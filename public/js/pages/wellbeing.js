/**
 * VIGIL AI — Weekly Wellbeing Check-in (intelligence phase 4).
 *
 * A recurring self-reflection: "How is my wellbeing changing over time?"
 * Deliberately separate from the Recovery Score (a daily device-derived
 * measure) and NOT a diagnosis or psychological test. Also hosts the
 * on-device anomaly-detection transparency panel.
 */
(function (V) {
  const esc = V.UI.esc;
  const fmtDate = V.UI.fmtDate;
  const demoChip = V.UI.demoChip;
  const toast = V.UI.toast;

  V.ROUTER.register("/wellbeing", render, { title: "Wellbeing Check-in", nav: "/wellbeing", roles: ["personnel"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="page-header"><div><h1>Weekly Wellbeing Check-in</h1>' +
      '<p class="sub">A once-a-week self-reflection — your own words in numbers, kept separate from your Recovery Score.</p></div></div>' +
      '<div id="wb-body"><div class="loading-block"><div class="spinner"></div><p>Loading…</p></div></div></div>';
    load(el);
  }

  async function load(el) {
    const target = document.getElementById("wb-body");
    const data = await V.UI.safe(function () { return V.API.endpoints.wellbeingCheckins(); });
    const anomaly = await V.UI.safe(function () { return V.API.endpoints.anomalies(); });
    if (!target) return;
    if (!data) {
      target.innerHTML = '<div class="empty-state"><div class="icon">☰</div><h3>Couldn&#39;t load your check-ins</h3><p>Please try again.</p></div>';
      return;
    }

    target.innerHTML =
      '<section class="card">' +
      '<div class="card-header"><h3>This week&#39;s check-in</h3>' + demoChip("Self-reflection") + '</div>' +
      '<p class="muted mb-4">Five quick ratings, once a week. There are no right answers, nothing is shared with your ' +
      'supervisor, and this is never a diagnosis or a psychological test — just a trend you own.</p>' +
      (data.questions || []).map(function (q) {
        return '<div class="wb-question"><div class="l-title">' + esc(q.label) + '</div>' +
          '<div class="wb-scale" data-key="' + esc(q.key) + '">' +
          [1, 2, 3, 4, 5].map(function (n) {
            return '<button class="wb-opt" data-q="' + esc(q.key) + '" data-v="' + n + '" aria-label="' + n + ' of 5">' + n + "</button>";
          }).join("") +
          '<span class="meta wb-scale-hint">1 · low — 5 · high</span></div></div>';
      }).join("") +
      '<div class="row gap-2 mt-4"><button class="btn primary" id="wb-save">Save this week&#39;s check-in</button>' +
      '<span class="meta" id="wb-save-hint"></span></div>' +
      "</section>" +

      trendCard(data) +

      anomalyCard(anomaly) +

      '<section class="card"><div class="card-header"><h3>How this fits together</h3>' + demoChip("Connected") + '</div>' +
      '<p class="muted">Your three wellbeing views stay distinct on purpose:</p>' +
      '<div class="wb-views">' +
      '<div class="wb-view"><div class="l-title">◉ Recovery Score</div><p class="meta">Daily · built from sleep, rest, load and stress</p><a class="card-link" href="#/recovery">Open Recovery →</a></div>' +
      '<div class="wb-view"><div class="l-title">☰ Weekly check-in</div><p class="meta">Weekly · your own reflection, your own trend</p></div>' +
      '<div class="wb-view"><div class="l-title">✦ Support loop</div><p class="meta">What changed after you engaged support</p><a class="card-link" href="#/recovery">Open the loop →</a></div>' +
      "</div></section>";

    target.querySelectorAll(".wb-opt").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const scale = btn.closest(".wb-scale");
        scale.querySelectorAll(".wb-opt").forEach(function (b) { b.classList.remove("picked"); });
        btn.classList.add("picked");
      });
    });

    const save = document.getElementById("wb-save");
    if (save) {
      save.addEventListener("click", async function () {
        const answers = {};
        let missing = false;
        target.querySelectorAll(".wb-scale").forEach(function (scale) {
          const picked = scale.querySelector(".wb-opt.picked");
          if (picked) answers[picked.dataset.q] = parseInt(picked.dataset.v, 10);
          else missing = true;
        });
        if (missing) { toast("Answer all five questions — 1 to 5 each.", "warning"); return; }
        const res = await V.UI.safe(function () { return V.API.endpoints.wellbeingCheckin(answers); });
        if (!res) return;
        const s = res.checkin.score;
        toast("Check-in saved" + (res.trend && res.trend.trend !== "insufficient" ? " — your trend: " + res.trend.trend + "." : "."));
        load(el);
      });
    }
  }

  function trendCard(data) {
    const t = data || {};
    const weeks = t.weeks || [];
    const cls = t.trend === "improving" ? "tone-success" : t.trend === "declining" ? "tone-warning" : "";
    let html = '<section class="card"><div class="card-header"><h3>Your weekly trend</h3>' +
      (t.trend && t.trend !== "insufficient" && t.trend !== "building"
        ? '<span class="badge ' + cls + '">' + esc(t.trend) + "</span>" : "") +
      "</div>";
    if (weeks.length) {
      const bars = weeks.map(function (w) {
        return { label: fmtDate(w.week_start + "T00:00:00", { month: "short", day: "numeric" }), value: w.score };
      });
      html += V.UI.barChart(bars, { height: 72, labelEvery: 2 }) +
        '<p class="muted mt-2">' + esc(t.message || "") + "</p>";
    } else {
      html += '<div class="empty-state" style="padding: var(--sp-6) var(--sp-4)"><div class="icon">☰</div>' +
        "<h3>Your trend starts this week</h3><p>Save your first check-in above — from three weeks on, VIGIL shows how your wellbeing drifts over time.</p></div>";
    }
    html += '<p class="meta mt-4">' + esc(t.distinct_from_recovery || "") + "</p></section>";
    return html;
  }

  function anomalyCard(anomaly) {
    let html = '<section class="card"><div class="card-header"><h3>On-device pattern detection</h3>' + demoChip("Local · private") + "</div>";
    html += '<p class="muted mb-4">Your browser watches for unusual patterns in your own recent readings — ' +
      "<strong>on this device</strong>. Raw heart-rate, HRV and sleep values never leave your device to be scored; " +
      "only a minimal result (pattern name, confidence, timestamp) is ever stored centrally. " +
      "It is a transparent self-baseline heuristic — not a medical model, never a diagnosis.</p>";
    const ev = (anomaly && anomaly.events) || [];
    if (ev.length) {
      html += '<div class="stack-list">' + ev.map(function (e) {
        const tone = e.status === "steady_pattern" ? "tone-success" : "tone-warning";
        const label = (anomaly.statuses && anomaly.statuses[e.status]) || e.status;
        return '<div class="list-row"><div class="l-icon" aria-hidden="true">🛡</div>' +
          '<div class="grow"><div class="l-title">' + esc(label) + '</div>' +
          '<div class="l-sub">Confidence ' + Math.round(e.confidence * 100) + "% · " + esc(fmtDate(e.detected_at)) +
          (e.synced_offline ? " · synced after offline" : "") + "</div></div>" +
          '<span class="badge ' + tone + '">on-device</span></div>';
      }).join("") + "</div>";
    } else {
      html += '<p class="meta">No patterns recorded yet — detection runs automatically after your data refreshes.</p>';
    }
    html += '<details class="why-details mt-4"><summary>What exactly leaves this device?</summary>' +
      '<div class="mini-table mt-2"><div class="mini-row"><strong>Local processing</strong><span>Your raw readings from the IndexedDB cache — heart rate, HRV, sleep, self-reports — are compared against your own baseline, here in the browser.</span></div>' +
      '<div class="mini-row"><strong>Uploaded</strong><span>Only: pattern name, confidence (0–1), timestamp. Nothing else. When offline, that minimal result waits in your sync queue.</span></div>' +
      '<div class="mini-row"><strong>Never uploaded</strong><span>Raw biometrics, readings, or anything used to compute the pattern.</span></div></div></details>';
    if (anomaly && anomaly.note) html += '<p class="meta mt-2">' + esc(anomaly.note) + "</p>";
    html += "</section>";
    return html;
  }
})(window.VIGIL = window.VIGIL || {});
