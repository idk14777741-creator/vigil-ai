/**
 * VIGIL AI — Admin Panel: overview, user management, notifications, audit log (classic script).
 */
(function (V) {
  const esc = V.UI.esc;
  const timeAgo = V.UI.timeAgo;
  const avatarHtml = V.UI.avatarHtml;
  const roleLabel = V.UI.roleLabel;
  const toast = V.UI.toast;
  const loadingBlock = V.UI.loadingBlock;
  const openModal = V.UI.openModal;
  const barChart = V.UI.barChart;

  V.ROUTER.register("/admin", render, { title: "Admin Panel", nav: "/admin", roles: ["admin"] });

  function render(el) {
    el.innerHTML =
      '<div class="page">' +
      '<div class="page-header"><div><h1>Admin Panel</h1>' +
      "<p class=\"sub\">Manage people, roles, platform notifications and the audit trail.</p></div>" +
      '<button class="btn ghost" id="btn-reset-demo" title="Wipe and reseed the demo data">↺ Reset demo data</button>' +
      '<button class="btn primary" id="btn-broadcast">◍ Send notification</button></div>' +
      '<div class="tabs" id="admin-tabs">' +
      '<button class="active" data-t="overview">Overview</button>' +
      '<button data-t="users">Users</button>' +
      '<button data-t="audit">Audit log</button></div>' +
      '<div id="admin-body">' + loadingBlock("Loading overview…") + "</div></div>";

    const body = el.querySelector("#admin-body");
    el.querySelectorAll("#admin-tabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        el.querySelectorAll("#admin-tabs button").forEach(function (x) { x.classList.toggle("active", x === b); });
        if (b.getAttribute("data-t") === "overview") loadOverview(body);
        if (b.getAttribute("data-t") === "users") loadUsers(body);
        if (b.getAttribute("data-t") === "audit") loadAudit(body);
      });
    });
    el.querySelector("#btn-broadcast").addEventListener("click", function () {
      broadcastModal(function () { loadOverview(body); });
    });
    el.querySelector("#btn-reset-demo").addEventListener("click", async function () {
      const ok = await V.UI.confirmModal({
        title: "Reset the demo environment?",
        message: "Everything created so far — tasks, requests, chats, incidents — is wiped and replaced with the fresh demo seed. Useful between demos; obviously never available in live mode.",
        confirmLabel: "Reset demo",
        danger: true,
      });
      if (!ok) return;
      V.API.endpoints.resetDemo().then(function () {
        V.UI.toast("Demo environment reset — fresh seed loaded.", "success");
        loadOverview(el);
      }).catch(function (err) { V.UI.toast(err.message, "error"); });
    });
    loadOverview(body);
  }

  /* ---------- Overview ---------- */

  function loadOverview(el) {
    el.innerHTML = loadingBlock("Loading overview…");
    V.API.endpoints.adminOverview().then(function (data) {
      const t = data.totals;
      const roleEntries = Object.keys(data.users_by_role).map(function (k) {
        return { label: roleLabel(k).split(" ")[0], value: data.users_by_role[k] };
      });
      el.innerHTML =
        '<div class="page">' +
        '<div class="admin-grid">' +
        stat("Users", t.users, "registered accounts") +
        stat("Units", t.units, "organisational groups") +
        stat("Notifications", t.notifications, "sent to date") +
        stat("Audit events", t.audit_events, "security-relevant actions") +
        "</div>" +
        '<div class="grid-2">' +
        '<section class="card"><div class="card-header"><h3>Users by role</h3></div>' + barChart(roleEntries, { height: 90 }) + "</section>" +
        '<section class="card" id="integrations-card"><div class="card-header"><h3>Integrations (live mode)</h3></div>' +
        '<div class="stack-list"><div class="meta">Loading…</div></div></section>' +
        '<section class="card"><div class="card-header"><h3>Recent activity</h3><a class="card-link" href="#audit" id="see-audit">Full audit log →</a></div>' +
        '<div class="stack-list">' + data.recent_audit.map(function (e) {
          return '<div class="list-row"><div class="grow">' +
            '<div class="l-title audit-action">' + esc(e.action) + "</div>" +
            '<div class="l-sub">' + esc(e.actor_id || "system") + (e.target ? " → " + esc(e.target) : "") + "</div></div>" +
            '<span class="meta nowrap">' + esc(timeAgo(e.created_at)) + "</span></div>";
        }).join("") + "</div></section></div></div>";
      el.querySelector("#see-audit").addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelector('#admin-tabs [data-t="audit"]').click();
      });
      loadIntegrations(el);
    }).catch(function (err) { el.innerHTML = errorBox(err); });
  }

  function loadIntegrations(el) {
    const card = el.querySelector("#integrations-card");
    if (!card) return;
    V.API.endpoints.integrationStatus().then(function (rep) {
      const rows = Object.keys(rep.categories).map(function (key) {
        const c = rep.categories[key];
        return '<div class="list-row"><div class="grow">' +
          '<div class="l-title">' + esc(c.label) + "</div>" +
          '<div class="l-sub">' + esc(c.env.join(", ")) + "</div></div>" +
          (c.configured
            ? '<span class="status-badge tone-ok">Ready</span>'
            : '<span class="status-badge tone-muted">Not set</span>') +
          "</div>";
      }).join("");
      const ping = rep.supabase_ping
        ? '<p class="meta">Supabase reachability: ' + (rep.supabase_ping.ok ? "OK" : "unreachable (" + esc(rep.supabase_ping.detail) + ")") + "</p>"
        : "";
      card.innerHTML = '<div class="card-header"><h3>Integrations (live mode)</h3></div>' +
        '<div class="stack-list">' + rows + "</div>" + ping +
        '<p class="hint">Keys live in the server environment only — this panel shows status, never values.</p>';
    }).catch(function () {
      card.innerHTML = '<div class="card-header"><h3>Integrations (live mode)</h3></div><p class="meta">Status unavailable.</p>';
    });
  }

  function stat(label, value, sub) {
    return '<div class="card stat-card"><div class="s-label">' + esc(label) + '</div><div class="s-value">' + value + '</div><div class="s-meta">' + esc(sub) + "</div></div>";
  }

  /* ---------- Users ---------- */

  function loadUsers(el) {
    el.innerHTML = loadingBlock("Loading users…");
    let users = [];
    V.API.endpoints.adminUsers().then(function (res) {
      users = res.users;
      const me = V.STORE.getState().user;
      el.innerHTML =
        '<div class="page"><div class="card">' +
        '<div class="filter-bar mb-4">' +
        '<div class="field"><label for="u-q">Search</label><input id="u-q" placeholder="Name or email…" /></div>' +
        '<div class="field"><label for="u-role">Role</label><select id="u-role">' +
        '<option value="">All roles</option><option value="personnel">Personnel</option>' +
        '<option value="medic">Medic Officers</option><option value="supervisor">Supervisors</option>' +
        '<option value="admin">Administrators</option></select></div>' +
        '<button class="btn primary" id="u-add" style="align-self:flex-end">+ Add user</button></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>' +
        '<tbody>' + users.map(function (u) { return rowHtml(u, me); }).join("") + "</tbody></table></div></div></div>";

      const qInput = el.querySelector("#u-q");
      const roleSel = el.querySelector("#u-role");
      const refreshRows = function () {
        V.API.endpoints.adminUsers(qInput.value, roleSel.value).then(function (res) {
          users = res.users;
          el.querySelector("tbody").innerHTML = users.map(function (u) { return rowHtml(u, me); }).join("");
          wireRows();
        });
      };
      const debounced = debounce(refreshRows, 300);
      qInput.addEventListener("input", debounced);
      roleSel.addEventListener("change", refreshRows);
      el.querySelector("#u-add").addEventListener("click", function () { addUserModal(loadUsers.bind(null, el)); });
      wireRows();

      function wireRows() {
        el.querySelectorAll("[data-edit]").forEach(function (btn) {
          btn.onclick = function () {
            const u = users.find(function (x) { return x.id === btn.getAttribute("data-edit"); });
            if (u) manageModal(u, function () { loadUsers(el); });
          };
        });
      }
    }).catch(function (err) { el.innerHTML = errorBox(err); });
  }

  function rowHtml(u, me) {
    return '<tr data-id="' + esc(u.id) + '">' +
      '<td><div class="row gap-2">' + avatarHtml(u) +
      "<div><div style=\"font-weight:600\">" + esc(u.full_name) + (u.id === me.id ? " (you)" : "") + "</div>" +
      '<div class="meta">' + esc(u.email) + "</div></div></div></td>" +
      '<td><span class="badge tone-brand">' + esc(roleLabel(u.role)) + "</span></td>" +
      '<td><span class="badge ' + (u.status === "active" ? "tone-success" : "tone-danger") + '">' + esc(u.status) + "</span></td>" +
      '<td class="meta">' + (u.last_login_at ? esc(timeAgo(u.last_login_at)) : "Never") + "</td>" +
      '<td><button class="btn sm ghost" data-edit="' + esc(u.id) + '">Manage</button></td></tr>';
  }

  function addUserModal(done) {
    const m = openModal({
      title: "Add user",
      body:
        '<div class="field"><label for="au-name">Full name</label><input id="au-name" /></div>' +
        '<div class="field"><label for="au-email">Email</label><input id="au-email" type="email" /></div>' +
        '<div class="field-row">' +
        '<div class="field"><label for="au-role">Role</label><select id="au-role">' +
        '<option value="personnel">Personnel</option><option value="medic">Medic Officer</option>' +
        '<option value="supervisor">Supervisor</option><option value="admin">Administrator</option></select></div>' +
        '<div class="field"><label for="au-pass">Temp password</label><input id="au-pass" type="text" placeholder="Min 8 chars" /></div></div>' +
        '<p class="hint">Share the temporary password through a secure channel. The user should change it after first sign-in.</p>',
      footer: '<button class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary" data-act="save">Create user</button>',
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-act="save"]').addEventListener("click", function () {
      V.API.endpoints.adminCreateUser({
        full_name: m.el.querySelector("#au-name").value.trim(),
        email: m.el.querySelector("#au-email").value.trim(),
        role: m.el.querySelector("#au-role").value,
        password: m.el.querySelector("#au-pass").value,
      }).then(function () {
        toast("User created.", "success");
        m.close();
        done();
      }).catch(function (err) { toast(err.message, "error"); });
    });
  }

  function manageModal(u, done) {
    const m = openModal({
      title: "Manage — " + u.full_name,
      body:
        '<div class="field"><label for="mu-name">Full name</label><input id="mu-name" value="' + esc(u.full_name) + '" /></div>' +
        '<div class="field"><label for="mu-role">Role</label><select id="mu-role">' +
        ["personnel", "medic", "supervisor", "admin"].map(function (r) {
          return '<option value="' + r + '"' + (u.role === r ? " selected" : "") + ">" + roleLabel(r) + "</option>";
        }).join("") + "</select></div>" +
        '<div class="field"><label for="mu-status">Status</label><select id="mu-status">' +
        '<option value="active"' + (u.status === "active" ? " selected" : "") + ">Active</option>" +
        '<option value="suspended"' + (u.status === "suspended" ? " selected" : "") + ">Suspended</option></select></div>",
      footer: '<button class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary" data-act="save">Save changes</button>',
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-act="save"]').addEventListener("click", function () {
      V.API.endpoints.adminUpdateUser(u.id, {
        full_name: m.el.querySelector("#mu-name").value.trim(),
        role: m.el.querySelector("#mu-role").value,
        status: m.el.querySelector("#mu-status").value,
      }).then(function () {
        toast("User updated.", "success");
        m.close();
        done();
      }).catch(function (err) { toast(err.message, "error"); });
    });
  }

  /* ---------- Broadcast ---------- */

  function broadcastModal(done) {
    const m = openModal({
      title: "Send platform notification",
      body:
        '<div class="field"><label for="nb-title">Title</label><input id="nb-title" maxlength="120" placeholder="e.g. Scheduled maintenance" /></div>' +
        '<div class="field"><label for="nb-msg">Message</label><textarea id="nb-msg" maxlength="500" placeholder="Keep it brief and supportive."></textarea></div>' +
        '<div class="field"><label for="nb-aud">Audience</label><select id="nb-aud">' +
        '<option value="all">Everyone</option><option value="personnel">All personnel</option>' +
        '<option value="medic">All Medic Officers</option><option value="supervisor">All supervisors</option>' +
        '<option value="admin">All administrators</option></select></div>',
      footer: '<button class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary" data-act="send">Send</button>',
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-act="send"]').addEventListener("click", function () {
      V.API.endpoints.adminBroadcast({
        title: m.el.querySelector("#nb-title").value.trim(),
        message: m.el.querySelector("#nb-msg").value.trim(),
        audience: m.el.querySelector("#nb-aud").value,
        kind: "system",
      }).then(function (res) {
        toast("Notification sent to " + res.sent + (res.sent === 1 ? " person." : " people."), "success");
        m.close();
        done();
      }).catch(function (err) { toast(err.message, "error"); });
    });
  }

  /* ---------- Audit ---------- */

  function loadAudit(el) {
    el.innerHTML = loadingBlock("Loading audit log…");
    V.API.endpoints.adminAudit().then(function (res) {
      const events = res.events;
      const prefixes = [];
      events.forEach(function (e) {
        const p = e.action.split(".")[0];
        if (prefixes.indexOf(p) === -1) prefixes.push(p);
      });
      el.innerHTML =
        '<div class="page"><div class="card">' +
        '<div class="filter-bar mb-4"><div class="field"><label for="au-f">Filter by prefix</label>' +
        '<select id="au-f"><option value="">All events</option>' +
        prefixes.map(function (p) { return '<option value="' + p + '">' + p + ".*</option>"; }).join("") +
        "</select></div></div>" +
        '<div class="table-wrap"><table class="data">' +
        "<thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>IP</th></tr></thead><tbody>" +
        (events.length ? events.map(function (e) {
          return "<tr><td class=\"meta nowrap\">" + esc(timeAgo(e.created_at)) + "</td>" +
            '<td class="audit-action">' + esc(e.action) + "</td>" +
            '<td class="meta">' + esc(e.actor_id || "—") + "</td>" +
            '<td class="meta">' + esc(e.target || "—") + "</td>" +
            '<td class="meta">' + esc(e.ip || "—") + "</td></tr>";
        }).join("") : '<tr><td colspan="5" class="meta" style="text-align:center; padding: 28px">No audit events match.</td></tr>') +
        "</tbody></table></div></div></div>";
      el.querySelector("#au-f").addEventListener("change", function () { loadAudit(el); });
    }).catch(function (err) { el.innerHTML = errorBox(err); });
  }

  function errorBox(err) {
    return '<div class="empty-state"><div class="icon">⚠</div><h2>Couldn\'t load this view</h2><p>' + esc(err.message) + "</p></div>";
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }
})(window.VIGIL = window.VIGIL || {});
