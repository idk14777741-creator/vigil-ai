/**
 * VIGIL AI — Settings: profile, appearance, security (classic script).
 */
(function (V) {
  const esc = V.UI.esc;
  const toast = V.UI.toast;
  const roleLabel = V.UI.roleLabel;
  const confirmModal = V.UI.confirmModal;
  const avatarHtml = V.UI.avatarHtml;

  V.ROUTER.register("/settings", render, { title: "Settings", nav: "/settings" });

  const COLORS = ["teal", "blue", "violet", "amber", "rose", "green"];

  function render(el) {
    const state = V.STORE.getState();
    const user = state.user;
    el.innerHTML =
      '<div class="page">' +
      '<div class="page-header"><div><h1>Settings</h1><p class="sub">Your profile, appearance and security — all in one place.</p></div></div>' +
      '<div class="settings-grid"><div class="col gap-6">' +

      '<section class="card"><div class="card-header"><h3>Profile</h3></div>' +
      '<form id="profile-form">' +
      '<div class="row gap-4 mb-4" id="profile-avatar">' + avatarHtml(user, "lg") +
      "<div><div style=\"font-weight:650\">" + esc(user.full_name) + "</div>" +
      '<div class="meta">' + esc(user.email) + " · " + esc(roleLabel(user.role)) + "</div></div></div>" +
      '<div class="field"><label for="st-name">Full name</label><input id="st-name" value="' + esc(user.full_name) + '" maxlength="80" /></div>' +
      '<div class="field"><label for="st-phone">Phone (optional)</label><input id="st-phone" value="' + esc(user.phone || "") + '" placeholder="+91 98765 43210" />' +
      "<span class=\"hint\">Only visible to you and, when you choose, your support network.</span></div>" +
      '<div class="field"><label>Avatar color</label><div class="row gap-2" id="color-picker">' +
      COLORS.map(function (c) {
        const selected = c === (user.avatar_color || "teal");
        return '<button type="button" class="avatar" data-color="' + c + '" style="cursor:pointer; border:2px solid ' + (selected ? "var(--brand)" : "transparent") + '" aria-label="Avatar color ' + c + '">' + c[0].toUpperCase() + "</button>";
      }).join("") +
      "</div></div>" +
      '<button class="btn primary" type="submit">Save changes</button></form></section>' +

      '<section class="card"><div class="card-header"><h3>Security</h3></div>' +
      '<form id="pw-form">' +
      '<div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password" /></div>' +
      '<div class="field-row">' +
      '<div class="field"><label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password" /></div>' +
      '<div class="field"><label for="pw-new2">Confirm new password</label><input id="pw-new2" type="password" autocomplete="new-password" /></div>' +
      "</div>" +
      '<button class="btn primary" type="submit">Change password</button></form></section>' +

      "</div><div class=\"col gap-6\">" +

      '<section class="card"><div class="card-header"><h3>Appearance</h3></div>' +
      '<div class="field"><label for="theme-select">Theme</label><select id="theme-select">' +
      '<option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option>' +
      "</select></div></section>" +

      '<section class="card"><div class="card-header"><h3>About</h3></div><div class="stack-list">' +
      '<div class="list-row"><div class="grow"><div class="l-title">Mode</div><div class="l-sub">' + esc(state.mode) + " — demo data is simulated locally</div></div></div>" +
      '<div class="list-row"><div class="grow"><div class="l-title">Version</div><div class="l-sub">' + esc(state.version || "Phase 1") + "</div></div></div>" +
      '<div class="list-row"><div class="grow"><div class="l-title">Wellness disclaimer</div><div class="l-sub">VIGIL AI provides wellness indicators, not medical advice or diagnosis.</div></div></div>' +
      "</div></section>" +

      '<section class="card danger-zone"><div class="card-header"><h3>Session</h3></div>' +
      '<p class="muted mb-4" style="font-size:13.5px">Signing out ends this session on the server.</p>' +
      '<button class="btn danger" id="sign-out">Sign out</button></section>' +

      "</div></div></div>";

    // set theme select to current value
    const themeSelect = el.querySelector("#theme-select");
    themeSelect.value = V.THEME.getTheme();
    themeSelect.addEventListener("change", function () { V.THEME.setTheme(themeSelect.value); });

    // avatar color picker
    let color = user.avatar_color || "teal";
    el.querySelectorAll("#color-picker [data-color]").forEach(function (b) {
      b.addEventListener("click", function () {
        color = b.getAttribute("data-color");
        el.querySelectorAll("#color-picker [data-color]").forEach(function (x) {
          x.style.border = "2px solid " + (x.getAttribute("data-color") === color ? "var(--brand)" : "transparent");
        });
      });
    });

    el.querySelector("#profile-form").addEventListener("submit", function (e) {
      e.preventDefault();
      V.API.endpoints.updateMe({
        full_name: el.querySelector("#st-name").value.trim(),
        phone: el.querySelector("#st-phone").value.trim(),
        avatar_color: color,
      }).then(function (res) {
        V.STORE.setUser(res.user);
        toast("Profile updated.", "success");
      }).catch(function (err) { toast(err.message, "error"); });
    });

    el.querySelector("#pw-form").addEventListener("submit", function (e) {
      e.preventDefault();
      const next = el.querySelector("#pw-new").value;
      const next2 = el.querySelector("#pw-new2").value;
      if (next !== next2) return toast("New passwords don't match.", "error");
      V.API.endpoints.changePassword(el.querySelector("#pw-cur").value, next).then(function (res) {
        toast(res.message || "Password changed.", "success");
        e.target.reset();
      }).catch(function (err) { toast(err.message, "error"); });
    });

    el.querySelector("#sign-out").addEventListener("click", function () {
      confirmModal({ title: "Sign out?", message: "You can sign back in any time.", confirmLabel: "Sign out", danger: true }).then(function (ok) {
        if (!ok) return;
        V.API.auth.logout().catch(function () {});
        V.STORE.clearSession();
        location.hash = "#/login";
        location.reload();
      });
    });
  }
})(window.VIGIL = window.VIGIL || {});
