/**
 * VIGIL AI — placeholder pages for upcoming phases 3–14 (classic script).
 */
(function (V) {
  const esc = V.UI.esc;

  const UPCOMING = [];

  const NOTES = {
    5: "Awareness, not diagnosis. Data stays yours.",
    6: "Every score explains its factors.",
    11: "Someone is rooting for you.",
  };

  UPCOMING.forEach(function (item) {
    const path = item[0], title = item[1], icon = item[2], phase = item[3], blurb = item[4], roles = item[5];
    V.ROUTER.register(path, function (el) {
      const note = NOTES[phase];
      el.innerHTML =
        '<div class="page"><div class="empty-state" style="padding: var(--sp-16) var(--sp-6)">' +
        '<div class="icon" aria-hidden="true">' + icon + "</div>" +
        '<div class="eyebrow mb-2">Phase ' + phase + " · coming soon</div>" +
        '<h2 style="font-size:24px">' + esc(title) + "</h2>" +
        "<p>" + esc(blurb) + "</p>" +
        (note ? '<p class="meta" style="margin-top:-6px">“' + esc(note) + "”</p>" : "") +
        '<a class="btn primary mt-4" href="#/dashboard">← Back to dashboard</a></div></div>';
    }, { title: title, nav: path, roles: roles });
  });

  V.PHASES = UPCOMING.map(function (item) { return { path: item[0], title: item[1], phase: item[3] }; });
})(window.VIGIL = window.VIGIL || {});
