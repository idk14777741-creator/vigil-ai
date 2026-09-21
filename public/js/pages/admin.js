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
      '<button data-t="demo">Demo guide</button>' +
      '<button data-t="intel">Intelligence</button>' +
      '<button data-t="users">Users</button>' +
      '<button data-t="audit">Audit log</button></div>' +
      '<div id="admin-body">' + loadingBlock("Loading overview…") + "</div></div>";

    const body = el.querySelector("#admin-body");
    el.querySelectorAll("#admin-tabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        el.querySelectorAll("#admin-tabs button").forEach(function (x) { x.classList.toggle("active", x === b); });
        if (b.getAttribute("data-t") === "overview") loadOverview(body);
        if (b.getAttribute("data-t") === "demo") loadDemoGuide(body);
        if (b.getAttribute("data-t") === "intel") loadIntel(body);
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

  /* ---------- Demo guide (SIU phase 12) ---------- */

  const DEMO_ACCOUNTS = [
    ["priya@vigil.demo", "Personnel — the connected story", "Extended shift yesterday, task overdue, recovery dip: watch Dashboard → VIGIL Insight → Recovery → Support options.", "teal"],
    ["rohan@vigil.demo", "Personnel — the heavy-load story", "A 16h extended duty night and short sleep. Strongest demo of insights + supervisor routing.", "blue"],
    ["aarav@vigil.demo", "Personnel — the steady contrast", "Normal workload, no insights, recovery ~98. Shows the system stays calm when everything is fine.", "green"],
    ["supervisor@vigil.demo", "Supervisor", "Incident queue with the full workflow (assign → review → escalate → resolve), team workload view. Never sees wellness data.", "amber"],
    ["medic@vigil.demo", "Medic Officer", "Request queue; wellness visible ONLY where the person authorized it (Rohan yes, Priya no).", "rose"],
    ["admin@vigil.demo", "Administrator", "This panel: users, broadcast, audit trail, integrations, demo reset.", "violet"],
  ];

  function loadDemoGuide(el) {
    el.innerHTML = '<div class="page">' +
      '<section class="card"><div class="card-header"><h3>The one continuous demo</h3>' + demoChip() + "</div>" +
      '<p class="muted">Everything below works without touching the database. The personas are deliberately contrasted so the connected flow is visible.</p>' +
      '<ol class="demo-steps">' +
      "<li><strong>Sign in as Priya</strong> — Dashboard shows the connected picture: operational load chip, VIGIL Insight rows with evidence chips, support options ranked for her load band.</li>" +
      "<li><strong>Shift Monitor</strong> — yesterday's shift ran 8h scheduled vs 12.5h actual. This is the same fact the dashboard insight cites.</li>" +
      "<li><strong>Tasks</strong> — one task past due. Same number the insight and the assistant quote.</li>" +
      "<li><strong>Back to Dashboard → Recovery card</strong> — score moved; open Recovery page and expand <em>Why did my score change?</em> — a deterministic, factor-by-factor explanation. Re-run the demo and the explanation is identical.</li>" +
      "<li><strong>Ask the Assistant</strong> — “How has my week been?”, “Why did my recovery score change?”, “I need support.” — answers quote her own data; the support prompt renders one-tap links.</li>" +
      "<li><strong>Buddy Connect</strong> — six share categories, all off by default. Tick, confirm, then revoke. Leila/Rohan already share one item with each other.</li>" +
      "<li><strong>Message From Home</strong> — a supportive video message. Contacts can never see wellness, HR, or AI data.</li>" +
      "<li><strong>Timeline</strong> — her journey across modules in one view; each entry links to its page.</li>" +
      "<li><strong>Weekly Report</strong> — shifts, tasks, recovery trend, support activity together, with the AI summary clearly labelled.</li>" +
      "<li><strong>Sign in as Supervisor</strong> — Incident queue: the near-miss is mid-workflow (assigned → escalated). Assign, escalate, resolve — the reporter is notified at each step.</li>" +
      "<li><strong>Sign in as Medic</strong> — wellness visible only for the authorized person. The boundary is in the code, not just the UI.</li>" +
      "<li><strong>Finish as Admin</strong> — show the audit log: every sensitive action in the demo was recorded.</li>" +
      "</ol></section>" +
      '<section class="card"><div class="card-header"><h3>The offline demo — no internet does not mean no support</h3>' + demoChip() + "</div>" +
      '<p class="muted">Demonstrates the offline-first welfare transfer on one device (two tabs for the medic side). The simulated connectivity state is clearly labelled throughout — it never fakes a real transfer.</p>' +
      '<ol class="demo-steps">' +
      (window.VIGIL.OfflineDemo ? window.VIGIL.OfflineDemo.steps().map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") : "") +
      "</ol>" +
      '<div class="row gap-2 mt-2"><button class="btn" id="demo-sim-toggle">Toggle offline simulation</button>' +
      '<a class="btn ghost" href="#/offline">Open Offline &amp; Transfers</a></div></section>' +
      '<section class="card"><div class="card-header"><h3>The intelligence loop — forecast, support, measure</h3>' + demoChip() + "</div>" +
      '<p class="muted">The closed loop across the platform: forecast → explain → support → follow-up → aggregate insight. Observational language throughout — VIGIL never claims an intervention caused a change.</p>' +
      '<ol class="demo-steps">' +
      "<li><strong>Sign in as Supervisor (Daniel)</strong> — Supervisor Connection page: Team Overview shows aggregates only (avg recovery 82, counts, no individual values). Open the Roster Fatigue Balancer.</li>" +
      "<li><strong>Add an extended duty (+4h)</strong> for a member — the balancer shows operational facts only (hours, consecutive days), never health data. Click <em>Project aggregate impact</em>: 82 → 80 with aggregate-only suggestions. Nothing is applied — it is a discardable projection.</li>" +
      "<li><strong>Sign in as Priya</strong> — Dashboard: the Fatigue Forecast card shows 24h/48h projections with ± uncertainty and forecast confidence. Expand <em>Why this forecast?</em> — contributor-by-contributor explanation.</li>" +
      "<li><strong>Recovery page</strong> — the support loop lists suggested support with her recovery at that moment. Tap <em>De-Stress Zone</em> to engage: the engagement is recorded.</li>" +
      "<li><strong>Follow-up</strong> — the same panel shows the observed change afterwards, worded as <em>“observed recovery change following intervention”</em> — never as causation.</li>" +
      "<li><strong>Wellbeing Check-in</strong> — her weekly self-report trend (deliberately separate from the device-derived Recovery Score), plus the on-device anomaly panel: raw biometrics stay in the browser; only a status + confidence result is uploaded.</li>" +
      "<li><strong>Ask the Assistant</strong> — “What's my forecast?” — the answer is grounded in the same deterministic engine and quotes her own numbers.</li>" +
      "<li><strong>Sign in as Admin</strong> — Intelligence tab: intervention efficacy aggregates with honest guards (insufficient data is shown as insufficient data, never invented).</li>" +
      "<li><strong>Audit log</strong> — every step of the loop (forecast, engagement, follow-up, anomaly result, projection) is recorded there.</li>" +
      "</ol>" +
      '<div class="row gap-2 mt-2"><a class="btn ghost" href="#/supervisor">Open Supervisor view</a></div></section>' +
      '<section class="card"><div class="card-header"><h3>Demo accounts</h3></div>' +
      '<div class="stack-list">' + DEMO_ACCOUNTS.map(function (a) {
        return '<div class="list-row">' + V.UI.avatarHtml({ full_name: a[1].split(" — ")[1] || a[1], avatar_color: a[3] }) +
          '<div class="grow"><div class="l-title">' + esc(a[0]) + '</div>' +
          '<div class="l-sub"><strong>' + esc(a[1].split(" — ")[0]) + "</strong> — " + esc(a[1].split(" — ")[1] || "") + "</div>" +
          '<div class="meta mt-1">' + esc(a[2]) + "</div></div>" +
          '<span class="badge tone-brand">Vigil#2024</span></div>';
      }).join("") + "</div>" +
      '<p class="meta mt-4">All data is simulated and labelled “Demo” in-product. No real wearables, external services or credentials are involved. ' +
      "Reset the environment before a demo run for a fresh seed.</p></section>" +
      '<div class="row gap-2 mt-4"><button class="btn primary" id="demo-reset-2">↺ Reset demo data now</button></div>' +
      "</div>";
    el.querySelector("#demo-sim-toggle").addEventListener("click", function () {
      window.VIGIL.OfflineDemo.toggleSimulation();
      V.UI.toast("Offline simulation switched. Open Offline & Transfers to see the status strip.", "info");
    });
    el.querySelector("#demo-reset-2").addEventListener("click", async function () {
      const ok = await V.UI.confirmModal({
        title: "Reset the demo environment?",
        message: "Everything created so far is wiped and replaced with the fresh demo seed.",
        confirmLabel: "Reset demo", danger: true,
      });
      if (!ok) return;
      V.API.endpoints.resetDemo().then(function () {
        V.UI.toast("Demo environment reset — fresh seed loaded.", "success");
      }).catch(function (err) { V.UI.toast(err.message, "error"); });
    });
  }

  function demoChip() {
    return V.UI.demoChip("Simulated data");
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

  function loadIntel(el) {
    el.innerHTML = loadingBlock("Loading intervention efficacy…");
    V.API.endpoints.interventionEfficacy().then(function (res) {
      const rows = res.rows || [];
      const cell = function (v, suffix) {
        return v === null || v === undefined
          ? '<span class="badge">Insufficient data</span>'
          : "<strong>" + esc(String(v)) + (suffix || "") + "</strong>";
      };
      el.innerHTML =
        '<div class="page"><div class="card">' +
        '<div class="card-header"><h3>Intervention efficacy</h3>' + demoChip() + "</div>" +
        '<p class="muted">Anonymized, aggregate-only view of support engagements and what was <em>observed</em> afterwards. ' +
        "These are observational trends, not proof of causation. Percentages appear only once an intervention has at least " +
        esc(String(res.min_sample || 5)) + ' follow-ups — below that, “Insufficient data” is shown instead of a made-up number.</p>' +
        '<div class="table-wrap"><table class="data"><thead><tr>' +
        '<th>Support</th><th>Engagements</th><th>Follow-ups</th><th>Positive follow-up trend</th><th>Avg observed change</th><th>Self-reported helpfulness</th>' +
        "</tr></thead><tbody>" +
        rows.map(function (r) {
          const change = r.avg_observed_change === null || r.avg_observed_change === undefined ? null : Math.round(r.avg_observed_change * 10) / 10;
          return "<tr>" +
            '<td><span class="f-icon" aria-hidden="true">' + esc(r.icon || "·") + "</span> " + esc(r.label) + "</td>" +
            "<td>" + esc(String(r.engagements)) + "</td>" +
            "<td>" + esc(String(r.followups)) + "</td>" +
            "<td>" + (r.insufficient_data ? '<span class="badge">Insufficient data</span>' : cell(r.positive_trend_pct, "%")) + "</td>" +
            "<td>" + (r.insufficient_data ? '<span class="badge">Insufficient data</span>' : cell(change, " pts")) + "</td>" +
            "<td>" + cell(r.self_reported_helpful_avg, " / 5") + "</td>" +
            "</tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="meta mt-3">A negative “observed change” is shown as-is, never hidden — recovery moves with roster reality, not only with support. ' +
        "Individual identities are never part of this view.</p></div></div>";
    }).catch(function () {
      el.innerHTML = '<div class="page"><div class="card"><p class="muted">Could not load efficacy data. Try again.</p></div></div>';
    });
  }

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
