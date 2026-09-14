/**
 * VIGIL AI — Incident Reporting (Phase 14).
 * A secure, structured reporting flow: personnel file incidents with
 * severity levels and add context afterwards; supervisors and admins
 * triage through a status flow and record resolutions. Reporters,
 * supervisors, admins only — buddies and medics have no route here.
 */
(function (V) {
  const esc = V.UI.esc;
  const timeAgo = V.UI.timeAgo;
  const toast = V.UI.toast;
  const openModal = V.UI.openModal;

  const TYPES = [
    ["operational", "Operational"], ["safety", "Safety"], ["trauma", "Trauma-related"],
    ["near_miss", "Near miss"], ["other", "Other"],
  ];
  const SEVERITIES = [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["critical", "Critical"]];
  const SEV_TONE = { low: "info", medium: "warn", high: "warn", critical: "danger" };
  const STATUS_LABEL = { submitted: "Submitted", under_review: "Under review", action_taken: "Action taken", resolved: "Resolved", closed: "Closed" };
  const STATUS_TONE = { submitted: "warn", under_review: "info", action_taken: "info", resolved: "ok", closed: "muted" };

  const role = function () { return (V.STORE.getState().user || {}).role; };
  const canManage = function () { return role() === "supervisor" || role() === "admin"; };

  V.ROUTER.register("/incidents", render, { title: "Incident Reporting", nav: "/incidents", roles: ["personnel", "supervisor", "admin"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="page-header"><div><h1>Incident Reporting</h1>' +
      '<p class="sub">' + (canManage()
        ? "Reports from the team, sorted by what needs attention first. Triage, add context, and close the loop."
        : "Report what happened — near misses count too. Your report goes to supervisors only, and adding detail afterwards is always allowed.") + '</p></div>' +
      '<button class="btn primary" id="inc-new">＋ Report an incident</button>' +
      '</div><div id="inc-body"><div class="loading-block"><div class="spinner"></div><p>Loading…</p></div></div></div>';
    document.getElementById("inc-new").addEventListener("click", newIncidentModal);
    load(el);
  }

  async function load(el) {
    const data = await V.UI.safe(function () { return V.API.endpoints.incidentList(); });
    const target = document.getElementById("inc-body");
    if (!target) return;
    if (!data) {
      target.innerHTML = '<div class="empty-state"><div class="icon">△</div><h3>Couldn&#39;t load incidents</h3><p>Please try again.</p></div>';
      return;
    }
    const isQueue = data.scope === "queue";
    let html = "";

    if (isQueue) {
      html += '<div class="stat-row">' +
        '<div class="stat-card"><div class="stat-value">' + (data.open_count || 0) + '</div><div class="stat-label">Needs triage</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + (data.critical_count || 0) + '</div><div class="stat-label">Critical open</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + data.incidents.length + '</div><div class="stat-label">Total reports</div></div></div>';
    }

    html += '<section class="card"><div class="card-head"><h2>' + (isQueue ? "All reports" : "Your reports") + "</h2>" +
      '<span class="chip">' + data.incidents.length + "</span></div>";
    if (!data.incidents.length) {
      html += '<div class="empty-state"><div class="icon">△</div><h3>Nothing reported</h3>' +
        (isQueue
          ? "<p>A quiet queue is a good queue. New reports appear here the moment they&#39;re filed.</p>"
          : "<p>If something goes wrong — or almost goes wrong — report it here. Near misses are welcome: they&#39;re how the next incident gets prevented.</p>");
    } else {
      html += '<div class="medic-requests wide">';
      data.incidents.forEach(function (i) {
        html += '<button class="medic-request" data-id="' + esc(i.id) + '">' +
          '<div class="medic-request-top">' +
          (isQueue ? '<span class="medic-request-person">' + esc(i.reporter) + "</span>" : "") +
          '<span class="cat-chip">' + esc(typeLabel(i.incident_type)) + "</span>" +
          '<span class="sev-chip sev-' + i.severity + '">' + esc(sevLabel(i.severity)) + "</span>" +
          statusBadge(i.status) + "</div>" +
          '<p class="medic-request-desc">' + esc(i.description) + "</p>" +
          '<p class="meta">' + esc(dateLabel(i)) +
          (i.location ? " · " + esc(i.location) : "") +
          " · " + esc(timeAgo(i.created_at)) +
          (i.context_count ? " · " + i.context_count + " note" + (i.context_count === 1 ? "" : "s") : "") +
          "</p></button>";
      });
      html += "</div>";
    }
    html += "</section>";
    html += '<p class="privacy-note">🔒 Reports are visible to the reporter, supervisors and admins only. Medic Officers and buddies have no access. Every view and change is audit-logged.</p>';
    target.innerHTML = html;

    target.querySelectorAll(".medic-request").forEach(function (btn) {
      btn.addEventListener("click", function () { detailModal(btn.dataset.id, load.bind(null, el)); });
    });
  }

  /* ---------- filing ---------- */

  function newIncidentModal() {
    const typeOpts = TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + "</option>"; }).join("");
    const sevOpts = SEVERITIES.map(function (s, ix) { return '<option value="' + s[0] + '"' + (ix === 1 ? " selected" : "") + ">" + s[1] + "</option>"; }).join("");
    const m = openModal({
      title: "Report an incident",
      size: "lg",
      body:
        '<div class="field-row">' +
        '<div class="field"><label>Type *</label><select id="ni-type">' + typeOpts + "</select></div>" +
        '<div class="field"><label>Severity *</label><select id="ni-sev">' + sevOpts + "</select></div>" +
        "</div>" +
        '<div class="field-row">' +
        '<div class="field"><label>Date it happened *</label><input id="ni-date" type="date"></div>' +
        '<div class="field"><label>Approx. time</label><input id="ni-time" type="time"></div>' +
        "</div>" +
        '<div class="field"><label>Location</label><input id="ni-loc" maxlength="160" placeholder="North gate, comms room…"></div>' +
        '<div class="field"><label>What happened? *</label>' +
        '<textarea id="ni-desc" maxlength="5000" rows="5" placeholder="Facts first: what you saw, when, who was involved. It&#39;s fine to say &#39;I&#39;m not sure&#39; — report anyway."></textarea></div>' +
        '<div class="field"><label>People involved (optional)</label><input id="ni-people" maxlength="300" placeholder="Names or roles, if any"></div>' +
        '<div class="field"><label>Immediate action taken (optional)</label><input id="ni-action" maxlength="1000" placeholder="e.g. Taped it off, told the duty engineer…"></div>' +
        '<p class="hint">Goes to supervisors only — not to medics, not to buddies. Reporting a near miss is just as valuable as reporting an incident.</p>',
      footer:
        '<button class="btn ghost" data-act="cancel">Cancel</button>' +
        '<button class="btn primary" data-act="file">Submit report</button>',
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-act="file"]').addEventListener("click", async function () {
      const body = {
        incident_type: m.el.querySelector("#ni-type").value,
        severity: m.el.querySelector("#ni-sev").value,
        occurred_on: m.el.querySelector("#ni-date").value,
        occurred_at: m.el.querySelector("#ni-time").value,
        location: m.el.querySelector("#ni-loc").value.trim(),
        description: m.el.querySelector("#ni-desc").value.trim(),
        people_involved: m.el.querySelector("#ni-people").value.trim(),
        immediate_action: m.el.querySelector("#ni-action").value.trim(),
      };
      if (!body.occurred_on) { toast("Pick the date it happened.", "warning"); return; }
      if (body.description.length < 5) { toast("Describe what happened — even a couple of sentences helps.", "warning"); return; }
      const res = await V.UI.safe(function () { return V.API.endpoints.incidentCreate(body); });
      if (!res) return;
      m.close();
      toast("Report submitted. Supervisors have been notified — thank you for reporting it.");
      load(document.getElementById("main"));
    });
  }

  /* ---------- detail ---------- */

  async function detailModal(id, onDone) {
    const data = await V.UI.safe(function () { return V.API.endpoints.incidentGet(id); });
    if (!data) { toast("Couldn't open that report.", "warning"); return; }
    const i = data.incident;

    let body =
      '<div class="inc-detail-grid">' +
      '<div><span class="meta">Type</span><div>' + esc(typeLabel(i.incident_type)) + "</div></div>" +
      '<div><span class="meta">Severity</span><div><span class="sev-chip sev-' + i.severity + '">' + esc(sevLabel(i.severity)) + "</span></div></div>" +
      '<div><span class="meta">When</span><div>' + esc(dateLabel(i)) + "</div></div>" +
      '<div><span class="meta">Status</span><div>' + statusBadge(i.status) + "</div></div>" +
      (i.location ? '<div><span class="meta">Location</span><div>' + esc(i.location) + "</div></div>" : "") +
      '<div><span class="meta">Reported by</span><div>' + esc(i.reporter) + "</div></div>" +
      "</div>" +
      '<div class="thread-opening">' + esc(i.description) + "</div>" +
      (i.people_involved ? '<p class="inc-line"><span class="meta">People involved:</span> ' + esc(i.people_involved) + "</p>" : "") +
      (i.immediate_action ? '<p class="inc-line"><span class="meta">Immediate action:</span> ' + esc(i.immediate_action) + "</p>" : "") +
      (i.resolution ? '<p class="inc-line"><span class="meta">Resolution:</span> ' + esc(i.resolution) + "</p>" : "");

    body += '<h3 class="inc-sub">Context notes</h3><div class="chat-thread" id="icontext">';
    if (!(data.context || []).length) {
      body += '<p class="meta thread-empty">No notes yet.</p>';
    }
    (data.context || []).forEach(function (u) {
      body += '<div class="chat-msg ' + (u.mine ? "mine" : "theirs") + '"><div class="msg-body">' +
        '<div class="msg-sender">' + esc(u.author) + "</div>" +
        '<div class="msg-text">' + esc(u.body) + "</div>" +
        '<div class="msg-time">' + esc(timeAgo(u.created_at)) + "</div></div></div>";
    });
    body += "</div>" +
      '<div class="thread-composer"><textarea id="ic-note" rows="2" maxlength="2000" placeholder="Add context, corrections or follow-up…"></textarea>' +
      '<button class="btn ghost" id="ic-add">Add note</button></div>';

    let statusHtml = "";
    if (i.can_manage) {
      statusHtml = '<div class="field"><label>Status</label><select id="ic-status">' +
        Object.keys(STATUS_LABEL).map(function (s) {
          return '<option value="' + s + '"' + (s === i.status ? " selected" : "") + ">" + STATUS_LABEL[s] + "</option>";
        }).join("") + "</select></div>" +
        '<div class="field"><label>Resolution (required to resolve or close)</label>' +
        '<textarea id="ic-res" rows="2" maxlength="2000" placeholder="What was done about it…">' + esc(i.resolution || "") + "</textarea></div>";
    }

    const m = openModal({
      title: (i.is_mine ? "Your report" : "Report from " + i.reporter) + " · " + typeLabel(i.incident_type),
      size: "lg",
      body: body + statusHtml,
      footer:
        '<button class="btn ghost" data-act="close">Close</button>' +
        (i.can_manage ? '<button class="btn primary" data-act="save">Save update</button>' : ""),
    });
    const threadEl = m.el.querySelector("#icontext");
    threadEl.scrollTop = threadEl.scrollHeight;
    m.el.querySelector('[data-act="close"]').addEventListener("click", m.close);

    m.el.querySelector("#ic-add").addEventListener("click", async function () {
      const box = m.el.querySelector("#ic-note");
      const text = box.value.trim();
      if (!text) { toast("Write the note first.", "warning"); return; }
      const res = await V.UI.safe(function () { return V.API.endpoints.incidentAddNote(id, text); });
      if (!res) return;
      box.value = "";
      threadEl.querySelector(".thread-empty") && threadEl.querySelector(".thread-empty").remove();
      threadEl.insertAdjacentHTML("beforeend",
        '<div class="chat-msg mine"><div class="msg-body">' +
        '<div class="msg-sender">You</div><div class="msg-text">' + esc(text) + "</div>" +
        '<div class="msg-time">just now</div></div></div>');
      threadEl.scrollTop = threadEl.scrollHeight;
    });

    const saveBtn = m.el.querySelector('[data-act="save"]');
    if (saveBtn) {
      saveBtn.addEventListener("click", async function () {
        const status = m.el.querySelector("#ic-status").value;
        const resolution = m.el.querySelector("#ic-res").value.trim();
        const res = await V.UI.safe(function () {
          return V.API.endpoints.incidentSetStatus(id, status, resolution);
        });
        if (!res) return;
        toast("Report updated — the reporter has been notified.");
        m.close();
        if (onDone) onDone();
      });
    }
  }

  /* ---------- helpers ---------- */

  function typeLabel(t) {
    const hit = TYPES.find(function (x) { return x[0] === t; });
    return hit ? hit[1] : t;
  }
  function sevLabel(s) {
    const hit = SEVERITIES.find(function (x) { return x[0] === s; });
    return hit ? hit[1] : s;
  }
  function statusBadge(status) {
    return '<span class="status-badge tone-' + (STATUS_TONE[status] || "muted") + '">' + (STATUS_LABEL[status] || status) + "</span>";
  }
  function dateLabel(i) {
    let out = i.occurred_on;
    if (i.occurred_at) out += " · " + String(i.occurred_at).slice(0, 5);
    return out;
  }
})(window.VIGIL);
