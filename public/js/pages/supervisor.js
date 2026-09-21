/**
 * VIGIL AI — Supervisor Connection (Phase 13).
 * Personnel raise shift / task / workload concerns with their supervisor
 * and follow up privately. Supervisors work a queue with status control.
 * Workload only — wellness never enters this channel.
 */
(function (V) {
  const esc = V.UI.esc;
  const timeAgo = V.UI.timeAgo;
  const toast = V.UI.toast;
  const openModal = V.UI.openModal;

  const CATS = [
    ["shift_concern", "Shift concern"], ["task_concern", "Task concern"],
    ["work_issue", "Work issue"], ["general_support", "General support"],
  ];
  const STATUS_LABEL = { open: "Open", acknowledged: "Acknowledged", in_progress: "In progress", resolved: "Resolved", declined: "Declined" };
  // SIU workflow: request → acknowledged → in progress → resolved
  const REQ_FLOW = ["open", "acknowledged", "in_progress", "resolved"];
  const STATUS_TONE = { open: "warn", acknowledged: "info", in_progress: "info", resolved: "ok", declined: "muted" };

  const role = function () { return (V.STORE.getState().user || {}).role; };
  const isSupervisor = function () { return role() === "supervisor" || role() === "admin"; };

  V.ROUTER.register("/supervisor", render, { title: "Supervisor Connection", nav: "/supervisor", roles: ["personnel", "supervisor", "admin"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="page-header"><div><h1>Supervisor Connection</h1>' +
      '<p class="sub">' + (isSupervisor()
        ? "Concerns from your team — shifts, tasks and workload. Resolve them together in a private thread."
        : "Raise shift, task or workload concerns with your supervisor — privately, and followed up in one place.") + '</p></div>' +
      (isSupervisor() ? "" : '<button class="btn primary" id="sup-new">＋ New request</button>') +
      '</div><div id="sup-body"><div class="loading-block"><div class="spinner"></div><p>Loading…</p></div></div></div>';
    const btn = document.getElementById("sup-new");
    if (btn) btn.addEventListener("click", newRequestModal);
    load(el);
  }

  async function load(el) {
    if (isSupervisor()) return loadQueue(el);
    return loadPersonnel(el);
  }

  /* ================= personnel ================= */

  async function loadPersonnel(el) {
    const data = await V.UI.safe(function () { return V.API.endpoints.supervisorMy(); });
    const target = document.getElementById("sup-body");
    if (!target) return;
    if (!data) {
      target.innerHTML = '<div class="empty-state"><div class="icon">⚑</div><h3>Couldn&#39;t load Supervisor Connection</h3><p>Please try again.</p></div>';
      return;
    }
    const sup = data.supervisor || {};
    let html = '<section class="card medic-intro"><div class="medic-intro-row">' +
      '<div class="medic-avatar" aria-hidden="true">⚑</div>' +
      '<div><h3>' + esc(sup.full_name || "Your supervisor") + '</h3>' +
      '<p class="muted">Your unit supervisor. Requests go straight to them — nobody else. Wellness data never enters this channel.</p></div></div></section>';

    html += '<section class="card"><div class="card-head"><h2>Your requests</h2>' +
      '<span class="chip">' + data.requests.length + "</span></div>";
    if (!data.requests.length) {
      html += '<div class="empty-state"><div class="icon">⚑</div><h3>Nothing here yet</h3>' +
        "<p>Shift swaps, kit problems, workload that feels off — raising it early is the professional move, and it stays between you two.</p></div>";
    } else {
      html += '<div class="medic-requests">';
      data.requests.forEach(function (r) {
        html += '<button class="medic-request" data-id="' + esc(r.id) + '">' +
          '<div class="medic-request-top"><span class="cat-chip">' + esc(catLabel(r.category)) + "</span>" +
          statusBadge(r.status) + "</div>" +
          '<p class="medic-request-desc">' + esc(r.description) + "</p>" +
          '<p class="meta">' + esc(timeAgo(r.created_at)) +
          (r.message_count ? " · " + r.message_count + " message" + (r.message_count === 1 ? "" : "s") : " · no replies yet") +
          "</p></button>";
      });
      html += "</div>";
    }
    html += "</section>";
    html += '<p class="privacy-note">🔒 Requests and messages are private between you and your supervisor. Your wellness data, buddy chats and Message From Home videos are never visible here.</p>';
    target.innerHTML = html;

    target.querySelectorAll(".medic-request").forEach(function (btn) {
      btn.addEventListener("click", function () { threadModal(btn.dataset.id, load.bind(null, el)); });
    });
  }

  function newRequestModal() {
    const options = CATS.map(function (c) {
      return '<option value="' + c[0] + '">' + c[1] + "</option>";
    }).join("");
    const m = openModal({
      title: "New request to your supervisor",
      size: "lg",
      body:
        '<div class="field"><label>What&#39;s it about? *</label><select id="nr-cat">' + options + "</select></div>" +
        '<div class="field"><label>Describe it *</label>' +
        '<textarea id="nr-desc" maxlength="2000" rows="4" placeholder="What&#39;s happening, since when, what would help…"></textarea>' +
        '<span class="hint">Private between you and your supervisor. Keep it about work: shifts, tasks, equipment, workload.</span></div>',
      footer:
        '<button class="btn ghost" data-act="cancel">Cancel</button>' +
        '<button class="btn primary" data-act="send">Send request</button>',
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-act="send"]').addEventListener("click", async function () {
      const category = m.el.querySelector("#nr-cat").value;
      const description = m.el.querySelector("#nr-desc").value.trim();
      if (description.length < 3) { toast("Describe the concern so your supervisor can help.", "warning"); return; }
      const res = await V.UI.safe(function () { return V.API.endpoints.supervisorCreate(category, description); });
      if (!res) return;
      m.close();
      toast("Request sent. Your supervisor will follow up here.");
      load(document.getElementById("main"));
    });
  }

  /* ================= supervisor ================= */

  async function loadQueue(el) {
    const data = await V.UI.safe(function () { return V.API.endpoints.supervisorQueue(); });
    const target = document.getElementById("sup-body");
    if (!target) return;
    if (!data) {
      target.innerHTML = '<div class="empty-state"><div class="icon">⚑</div><h3>Couldn&#39;t load the queue</h3><p>Please try again.</p></div>';
      return;
    }
    const order = { open: 0, acknowledged: 1, in_progress: 2, resolved: 3, declined: 4 };
    const rows = (data.requests || []).slice().sort(function (a, b) {
      return (order[a.status] - order[b.status]) || (a.updated_at < b.updated_at ? 1 : -1);
    });

    const intel = await V.UI.safe(function () { return V.API.endpoints.teamIntel(); });
    const roster = await V.UI.safe(function () { return V.API.endpoints.teamRoster(); });
    const scenarios = await V.UI.safe(function () { return V.API.endpoints.rosterScenarios(); });

    let html = '<div class="stat-row"><div class="stat-card"><div class="stat-value">' + (data.open_count || 0) + '</div><div class="stat-label">Needs your attention</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + rows.length + '</div><div class="stat-label">Total requests</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + rows.filter(function (r) { return r.status === "resolved"; }).length + '</div><div class="stat-label">Resolved</div></div></div>';

    html += teamOverviewCard(intel) + rosterBalancerCard(roster, scenarios);

    html += '<section class="card"><div class="card-head"><h2>Requests</h2><span class="chip">private threads</span></div>';
    if (!rows.length) {
      html += '<div class="empty-state"><div class="icon">⚑</div><h3>No requests right now</h3><p>When someone on the team raises a concern, it appears here.</p></div>';
    } else {
      html += '<div class="medic-requests wide">';
      rows.forEach(function (r) {
        html += '<button class="medic-request" data-id="' + esc(r.id) + '">' +
          '<div class="medic-request-top"><span class="medic-request-person">' + esc(r.person) + '</span>' +
          '<span class="cat-chip">' + esc(catLabel(r.category)) + "</span>" + statusBadge(r.status) + "</div>" +
          '<p class="medic-request-desc">' + esc(r.description) + "</p>" +
          '<p class="meta">' + esc(timeAgo(r.updated_at)) +
          (r.message_count ? " · " + r.message_count + " message" + (r.message_count === 1 ? "" : "s") : "") +
          "</p></button>";
      });
      html += "</div>";
    }
    html += "</section>";
    html += '<p class="privacy-note">🔒 This channel carries workload concerns only. Wellness data, recovery scores and AI conversations are never visible to supervisors — by design, not by settings.</p>';
    target.innerHTML = html;

    target.querySelectorAll(".medic-request").forEach(function (btn) {
      btn.addEventListener("click", function () { threadModal(btn.dataset.id, load.bind(null, el)); });
    });

    wireRosterBalancer(target, el);
  }

  /* ================= team overview + roster balancer (intelligence phase 5) =================
     Aggregate-only by design: the payload carries NO individual recovery or
     biometric values — the server refuses to compute them into any response.
  */

  function teamOverviewCard(intel) {
    if (!intel || intel.has_team === false) {
      return '<section class="card"><div class="card-header"><h3>Team Overview</h3></div>' +
        '<p class="muted">' + esc((intel && intel.message) || "No personnel assigned to your units yet.") + "</p></section>";
    }
    const bandCls = intel.team_recovery_band === "heavy" ? "tone-danger" : intel.team_recovery_band === "elevated" ? "tone-warning" : "tone-success";
    const dist = intel.distribution || {};
    const wl = intel.workload || {};
    return '<section class="card team-intel-card"><div class="card-header"><h3>Team Overview</h3>' +
      '<span class="badge">Aggregate only · no individual health data</span></div>' +
      '<div class="fc-strip">' +
      '<div class="fc-cell"><div class="s-label">Team recovery (avg of bands)</div>' +
      '<div class="s-value fc-value">' + intel.team_recovery_avg + '<span class="fc-pm">/100</span></div>' +
      '<div class="s-meta">' + esc(intel.band_label || "") + " · " + intel.team_size + " members</div>" +
      '<div class="fc-bar"><span style="width:' + intel.team_recovery_avg + '%"></span></div></div>' +
      '<div class="fc-cell"><div class="s-label">Workload this week</div>' +
      '<div class="s-value fc-value">' + wl.avg_hours_per_person + '<span class="fc-pm">h avg</span></div>' +
      '<div class="s-meta">' + wl.week_hours_total + "h total · " + (wl.extended_duty_upcoming || 0) + " extended duties upcoming</div></div>" +
      '<div class="fc-cell"><div class="s-label">Recovery-risk window</div>' +
      '<div class="s-value fc-value" style="font-size:18px">' + esc(intel.risk_window || "Next 24–48h") + "</div>" +
      '<div class="s-meta">' + (dist.steady || 0) + " steady · " + (dist.elevated || 0) + " elevated · " + (dist.heavy || 0) + " strained (counts only)</div></div>" +
      "</div>" +
      '<p class="meta mt-4">Counts and averages come from data you cannot see individually — VIGIL aggregates where the data lives. ' +
      "No member\'s recovery, biometrics or conversations are included in this view.</p></section>";
  }

  function rosterBalancerCard(roster, scenarios) {
    if (!roster || !roster.members || !roster.members.length) return "";
    const scs = (scenarios && scenarios.scenarios) || [];
    let html = '<section class="card roster-card"><div class="card-header"><h3>Roster Fatigue Balancer</h3>' +
      '<span class="badge">What-if · aggregate impact</span></div>' +
      '<p class="muted mb-4">Experiment with the upcoming roster and see the projected effect on <strong>aggregate team recovery</strong>. ' +
      "Members appear here with operational facts only (hours, consecutive days) — never health values.</p>";
    html += '<div class="roster-table">' +
      '<div class="mini-table">' +
      '<div class="mini-row roster-head"><strong>Member</strong><span>Week hours</span><span>Consecutive days</span><span>Extend next shift +</span></div>' +
      roster.members.map(function (m) {
        const up = m.upcoming_shifts && m.upcoming_shifts[0];
        return '<div class="mini-row"><strong>' + esc(m.name) + "</strong>" +
          "<span>" + m.week_hours + "h</span>" +
          "<span>" + m.consecutive_days + (m.consecutive_days >= 5 ? ' <span class="badge tone-warning">watch</span>' : "") + "</span>" +
          (up ? '<span class="row gap-2"><input type="number" class="roster-ext" data-shift="' + esc(up.id) + '" data-member="' + esc(m.name) + '" min="0" max="12" step="1" value="0" style="width:70px" aria-label="Extend hours for ' + esc(m.name) + '"> <span class="meta">next: ' + m.upcoming_shifts[0].hours + "h</span></span>" : "<span class='meta'>none scheduled</span>") +
          "</div>";
      }).join("") + "</div></div>";
    html += '<div class="row gap-2 mt-4 wrap"><button class="btn primary" id="roster-sim">Project aggregate impact</button>' +
      '<span class="meta">Nothing is applied — this is a projection you can discard.</span></div>' +
      '<div id="roster-result"></div>';
    if (scs.length) {
      html += '<div class="eyebrow mb-2 mt-4">Saved scenarios</div><div class="stack-list">' + scs.map(function (s) {
        return '<div class="list-row"><div class="l-icon" aria-hidden="true">⚑</div>' +
          '<div class="grow"><div class="l-title">' + esc(s.name) + "</div>" +
          '<div class="l-sub">' + esc(s.result_summary && s.result_summary.impact || "") + "</div></div>" +
          '<span class="meta">' + esc(timeAgo(s.created_at)) + "</span></div>";
      }).join("") + "</div>";
    }
    html += "</section>";
    return html;
  }

  function wireRosterBalancer(target, el) {
    const simBtn = target.querySelector("#roster-sim");
    if (!simBtn) return;
    simBtn.addEventListener("click", async function () {
      const extend = {};
      const names = {};
      target.querySelectorAll(".roster-ext").forEach(function (inp) {
        const h = parseFloat(inp.value);
        if (h > 0) {
          extend[inp.dataset.shift] = h;
          names[inp.dataset.shift] = { name: inp.dataset.member, hours: h };
        }
      });
      if (!Object.keys(extend).length) {
        toast("Set an extension on at least one upcoming shift first.", "warning");
        return;
      }
      simBtn.disabled = true;
      const res = await V.UI.safe(function () { return V.API.endpoints.rosterSimulate({ extend: extend }); });
      simBtn.disabled = false;
      if (!res) return;
      const box = target.querySelector("#roster-result");
      if (!box) return;
      const cur = res.current_team_recovery;
      const proj = res.projected_team_recovery;
      const impactCls = res.impact && res.impact.indexOf("→") !== -1 && res.projected_band === "heavy" ? "tone-danger"
        : res.impact && res.impact.indexOf("→") !== -1 ? "tone-warning" : "tone-success";
      let html = '<div class="fc-strip mt-4"><div class="fc-cell"><div class="s-label">Current team recovery</div>' +
        '<div class="s-value fc-value">' + cur + '</div><div class="fc-bar"><span style="width:' + cur + '%"></span></div></div>' +
        '<div class="fc-cell"><div class="s-label">Projected (with changes)</div>' +
        '<div class="s-value fc-value">' + proj + '</div><div class="fc-bar projected"><span style="width:' + proj + '%"></span></div></div>' +
        '<div class="fc-cell"><div class="s-label">Impact</div>' +
        '<div class="s-value fc-value" style="font-size:18px"><span class="badge ' + impactCls + '">' + esc(res.impact || "No change") + "</span></div>" +
        "<div class='s-meta'>aggregate projection — never individual</div></div></div>";
      if (res.suggestions && res.suggestions.length) {
        html += '<div class="eyebrow mb-2 mt-4">Suggested roster adjustments</div><div class="stack-list">' +
          res.suggestions.map(function (s) {
            return '<div class="list-row"><div class="l-icon" aria-hidden="true">⚑</div>' +
              '<div class="grow"><div class="l-title">' + esc(s.name) + " · " + esc(s.suggestion) + "</div>" +
              '<div class="l-sub">' + esc(s.reason) + "</div></div></div>";
          }).join("") + "</div>";
      }
      html += '<div class="row gap-2 mt-4 wrap"><button class="btn ghost sm" id="roster-save">Save scenario</button>' +
        '<span class="meta">' + esc(res.privacy || "") + "</span></div>";
      box.innerHTML = html;
      const saveBtn = box.querySelector("#roster-save");
      if (saveBtn) {
        saveBtn.addEventListener("click", async function () {
          const label = Object.keys(names).map(function (sid) { return names[sid].name + " +" + names[sid].hours + "h"; }).join(", ");
          const saved = await V.UI.safe(function () {
            return V.API.endpoints.rosterSaveScenario({
              name: label.slice(0, 60),
              scenario: { extend: extend },
              result_summary: { impact: res.impact, projected: proj },
            });
          });
          if (saved) { toast("Scenario saved to your planner."); load(el); }
        });
      }
    });
  }

  /* ================= shared thread ================= */

  async function threadModal(requestId, onDone) {
    const data = await V.UI.safe(function () { return V.API.endpoints.supervisorThread(requestId); });
    if (!data) { toast("Couldn't open that request.", "warning"); return; }
    const req = data.request;
    const canReply = req.can_reply && req.status !== "declined";
    const canStatus = req.can_set_status;

    let threadHtml = '<div class="thread-meta">' + esc(catLabel(req.category)) + " · " + esc(req.person) + " · " + esc(timeAgo(req.created_at)) + "</div>" +
      '<div class="thread-opening">' + esc(req.description) + "</div>" +
      '<div class="chat-thread" id="sthread">';
    if (!data.messages.length) {
      threadHtml += '<p class="meta thread-empty">No messages yet — the conversation starts below.</p>';
    }
    data.messages.forEach(function (msg) {
      threadHtml += '<div class="chat-msg ' + (msg.mine ? "mine" : "theirs") + '"><div class="msg-body">' +
        '<div class="msg-sender">' + esc(msg.sender_name) + "</div>" +
        '<div class="msg-text">' + esc(msg.body) + "</div>" +
        '<div class="msg-time">' + esc(timeAgo(msg.created_at)) + "</div></div></div>";
    });
    threadHtml += "</div>";

    let statusHtml = "";
    if (canStatus) {
      statusHtml = '<div class="field"><label>Status</label><select id="st-status">' +
        Object.keys(STATUS_LABEL).map(function (s) {
          return '<option value="' + s + '"' + (s === req.status ? " selected" : "") + ">" + STATUS_LABEL[s] + "</option>";
        }).join("") + "</select></div>";
    }

    const m = openModal({
      title: req.is_mine ? "Your request" : "Request from " + req.person,
      size: "lg",
      body: requestStepper(req.status) + threadHtml + statusHtml +
        (canReply
          ? '<div class="thread-composer"><textarea id="st-msg" rows="2" maxlength="2000" placeholder="Write a reply…"></textarea>' +
            '<button class="btn primary" id="st-send">Send</button></div>'
          : '<p class="muted">This request is closed for replies.</p>'),
      footer:
        '<button class="btn ghost" data-act="close">Close</button>' +
        (canStatus ? '<button class="btn primary" data-act="status">Save status</button>' : ""),
    });
    const threadEl = m.el.querySelector("#sthread");
    threadEl.scrollTop = threadEl.scrollHeight;
    m.el.querySelector('[data-act="close"]').addEventListener("click", m.close);

    const statusBtn = m.el.querySelector('[data-act="status"]');
    if (statusBtn) {
      statusBtn.addEventListener("click", async function () {
        const status = m.el.querySelector("#st-status").value;
        const res = await V.UI.safe(function () { return V.API.endpoints.supervisorSetStatus(requestId, status); });
        if (!res) return;
        toast("Status updated — they've been notified.");
        m.close();
        if (onDone) onDone();
      });
    }

    const sendBtn = m.el.querySelector("#st-send");
    if (sendBtn) {
      const send = async function () {
        const box = m.el.querySelector("#st-msg");
        const text = box.value.trim();
        if (!text) return;
        sendBtn.disabled = true;
        const res = await V.UI.safe(function () { return V.API.endpoints.supervisorReply(requestId, text); });
        sendBtn.disabled = false;
        if (!res) return;
        box.value = "";
        threadEl.querySelector(".thread-empty") && threadEl.querySelector(".thread-empty").remove();
        threadEl.insertAdjacentHTML("beforeend",
          '<div class="chat-msg mine"><div class="msg-body">' +
          '<div class="msg-sender">You</div><div class="msg-text">' + esc(text) + "</div>" +
          '<div class="msg-time">just now</div></div></div>');
        threadEl.scrollTop = threadEl.scrollHeight;
      };
      sendBtn.addEventListener("click", send);
      m.el.querySelector("#st-msg").addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
      });
    }
  }

  /* ---------- helpers ---------- */

  function catLabel(cat) {
    const hit = CATS.find(function (c) { return c[0] === cat; });
    return hit ? hit[1] : cat;
  }

  function requestStepper(status) {
    if (status === "declined") {
      return '<div class="inc-stepper"><div class="inc-step done"><span class="inc-step-dot">✓</span>' +
        '<span class="inc-step-label">Declined — your request was reviewed and closed</span></div></div>';
    }
    const idx = REQ_FLOW.indexOf(status);
    if (idx === -1) return "";
    return '<div class="inc-stepper" role="list" aria-label="Request progress">' +
      REQ_FLOW.map(function (s, i) {
        const state = i < idx ? "done" : i === idx ? "current" : "todo";
        return '<div class="inc-step ' + state + '" role="listitem">' +
          '<span class="inc-step-dot" aria-hidden="true">' + (i < idx ? "✓" : i + 1) + "</span>" +
          '<span class="inc-step-label">' + STATUS_LABEL[s] + "</span></div>";
      }).join("") + "</div>";
  }

  function statusBadge(status) {
    return '<span class="status-badge tone-' + (STATUS_TONE[status] || "muted") + '">' + (STATUS_LABEL[status] || status) + "</span>";
  }
})(window.VIGIL);
