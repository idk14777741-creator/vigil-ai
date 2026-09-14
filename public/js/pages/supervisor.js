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

    let html = '<div class="stat-row"><div class="stat-card"><div class="stat-value">' + (data.open_count || 0) + '</div><div class="stat-label">Needs your attention</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + rows.length + '</div><div class="stat-label">Total requests</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + rows.filter(function (r) { return r.status === "resolved"; }).length + '</div><div class="stat-label">Resolved</div></div></div>';

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
      body: threadHtml + statusHtml +
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

  function statusBadge(status) {
    return '<span class="status-badge tone-' + (STATUS_TONE[status] || "muted") + '">' + (STATUS_LABEL[status] || status) + "</span>";
  }
})(window.VIGIL);
