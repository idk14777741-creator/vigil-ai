/**
 * VIGIL AI — My Team: unit roster with role grouping (classic script).
 */
(function (V) {
  const esc = V.UI.esc;
  const avatarHtml = V.UI.avatarHtml;
  const roleLabel = V.UI.roleLabel;
  const loadingBlock = V.UI.loadingBlock;

  V.ROUTER.register("/team", render, { title: "My Team", nav: "/team" });

  function render(el) {
    el.innerHTML = loadingBlock("Loading your team…");
    V.API.endpoints.myTeam().then(function (res) {
      const user = V.STORE.getState().user;
      const unit = res.unit;
      const members = res.members || [];
      const leaders = members.filter(function (m) { return m.role === "supervisor" || m.role === "medic"; });
      const personnel = members.filter(function (m) { return m.role === "personnel"; });

      el.innerHTML =
        '<div class="page">' +
        '<div class="page-header"><div><h1>My Team</h1>' +
        "<p class=\"sub\">" + (unit
          ? "People in " + esc(unit.name) + (unit.description ? " — " + esc(unit.description) : "") + "."
          : "You're not placed in a unit yet.") + "</p></div></div>" +
        (!unit
          ? '<div class="empty-state"><div class="icon">◎</div><h3>Awaiting unit assignment</h3>' +
            "<p>Your administrator will place you in a unit. Until then, your team roster will appear here.</p></div>"
          : "") +
        (members.length
          ? '<div class="grid-2">' + groupCard("Leadership", leaders) + groupCard("Personnel", personnel) + "</div>"
          : unit
            ? '<div class="empty-state"><div class="icon">◎</div><h3>No members yet</h3><p>Your unit has been created but has no active members right now.</p></div>'
            : "") +
        "</div>";

      function groupCard(title, rows) {
        if (!rows.length) return "";
        return '<section class="card"><div class="card-header"><h3>' + esc(title) + ' <span class="badge">' + rows.length + "</span></h3></div>" +
          '<div class="stack-list">' + rows.map(function (m) {
            return "<div class=\"list-row\">" + avatarHtml(m) +
              '<div class="grow"><div class="l-title">' + esc(m.full_name) + (m.id === user.id ? " <span class='badge tone-brand'>You</span>" : "") + "</div>" +
              '<div class="l-sub">' + esc(roleLabel(m.role)) + (m.phone ? " · " + esc(m.phone) : "") + "</div></div>" +
              '<span class="badge ' + (m.status === "active" ? "tone-success" : "") + '">' + esc(m.status || "active") + "</span></div>";
          }).join("") + "</div></section>";
      }
    }).catch(function (err) {
      el.innerHTML = '<div class="empty-state"><div class="icon">⚠</div><h2>Couldn\'t load your team</h2><p>' + esc(err.message) + "</p></div>";
    });
  }
})(window.VIGIL = window.VIGIL || {});
