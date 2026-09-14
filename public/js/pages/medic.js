/**
 * VIGIL AI — Medic Connection (Phase 12).
 * Personnel: raise requests to the Medic Officer, chat privately, and
 * choose (always revocable) whether to share a wellness summary.
 * Medics: a queue of requests, private threads, and — only with explicit
 * authorization — a 7-day wellness summary. Context, never a diagnosis.
 */
(function (V) {
  const esc = V.UI.esc;
  const timeAgo = V.UI.timeAgo;
  const toast = V.UI.toast;
  const openModal = V.UI.openModal;

  const CATS = [
    ["injury", "Injury"], ["illness", "Illness"], ["mental_health", "Mental health"],
    ["medication", "Medication"], ["follow_up", "Follow-up"], ["other", "Something else"],
  ];
  const STATUS_LABEL = { open: "Open", acknowledged: "Acknowledged", in_progress: "In progress", resolved: "Resolved", declined: "Declined" };
  const STATUS_TONE = { open: "warn", acknowledged: "info", in_progress: "info", resolved: "ok", declined: "muted" };

  const role = function () { return (V.STORE.getState().user || {}).role; };
  const isMedic = function () { return role() === "medic" || role() === "admin"; };

  V.ROUTER.register("/medic", render, { title: "Medic Connection", nav: "/medic", roles: ["personnel", "medic", "admin"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="page-header"><div><h1>Medic Connection</h1>' +
      '<p class="sub">' + (isMedic()
        ? "Requests from your team — answer in a private thread, with wellness context only where they&#39;ve authorized it."
        : "A direct, private line to your Medic Officer. You decide what they can see — and you can change that any time.") + '</p></div>' +
      (isMedic() ? "" : '<button class="btn primary" id="medic-new">＋ New request</button>') +
      '</div><div id="medic-body"><div class="loading-block"><div class="spinner"></div><p>Loading…</p></div></div></div>';
    const btn = document.getElementById("medic-new");
    if (btn) btn.addEventListener("click", newRequestModal);
    load(el);
  }

  async function load(el) {
    if (isMedic()) return loadMedic(el);
    return loadPersonnel(el);
  }

  /* ================= personnel ================= */

  async function loadPersonnel(el) {
    const data = await V.UI.safe(function () { return V.API.endpoints.medicMy(); });
    const target = document.getElementById("medic-body");
    if (!target) return;
    if (!data) {
      target.innerHTML = '<div class="empty-state"><div class="icon">✚</div><h3>Couldn&#39;t load Medic Connection</h3><p>Please try again.</p></div>';
      return;
    }
    const medic = data.medic || {};
    let html = "";

    /* Medic officer card */
    html += '<section class="card medic-intro"><div class="medic-intro-row">' +
      '<div class="medic-avatar" aria-hidden="true">✚</div>' +
      '<div><h3>' + esc(medic.full_name || "Your Medic Officer") + '</h3>' +
      '<p class="muted">Assigned Medic Officer for your unit. Requests go straight to them — nobody else.</p></div></div>' +
      '<div class="auth-toggle">' +
      '<div><strong>Share my wellness summary</strong>' +
      '<p class="muted">Lets them see a 7-day average (sleep, resting heart rate, SpO₂, steps, stress self-report) for context. They see it only while this is on — and never your chat history, requests or anything from home.</p></div>' +
      '<label class="switch"><input type="checkbox" id="medic-auth" ' + (data.wellness_authorized ? "checked" : "") + '><span class="slider"></span><span class="sr-only">Share wellness summary</span></label>' +
      "</div></section>";

    /* Requests */
    html += '<section class="card"><div class="card-head"><h2>Your requests</h2>' +
      '<span class="chip">' + data.requests.length + "</span></div>";
    if (!data.requests.length) {
      html += '<div class="empty-state"><div class="icon">✚</div><h3>Nothing here yet</h3>' +
        "<p>For anything health-related — a niggle, a question, a rough week — your Medic Officer is the right person. Asking early is always okay.</p></div>";
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
    html += '<p class="privacy-note">🔒 Requests and messages are private between you and your Medic Officer. Supervisors and buddies never see them.</p>';
    target.innerHTML = html;

    const authToggle = document.getElementById("medic-auth");
    authToggle.addEventListener("change", async function () {
      const on = authToggle.checked;
      const res = await V.UI.safe(function () { return V.API.endpoints.medicAuthorize(on); });
      if (!res) { authToggle.checked = !on; return; }
      toast(on
        ? "Wellness summary shared with " + (medic.full_name || "your Medic Officer") + ". You can switch it off any time."
        : "Wellness sharing switched off. They no longer see your summary.");
    });
    target.querySelectorAll(".medic-request").forEach(function (btn) {
      btn.addEventListener("click", function () { threadModal(btn.dataset.id, load.bind(null, el)); });
    });
  }

  function newRequestModal() {
    const options = CATS.map(function (c) {
      return '<option value="' + c[0] + '">' + c[1] + "</option>";
    }).join("");
    const m = openModal({
      title: "New request to your Medic Officer",
      size: "lg",
      body:
        '<div class="field"><label>What&#39;s it about? *</label><select id="nr-cat">' + options + "</select></div>" +
        '<div class="field"><label>Tell them a little about it *</label>' +
        '<textarea id="nr-desc" maxlength="2000" rows="4" placeholder="What you noticed, since when, anything that makes it better or worse…"></textarea>' +
        '<span class="hint">Private between you and the Medic Officer. For emergencies, contact them or emergency services directly.</span></div>',
      footer:
        '<button class="btn ghost" data-act="cancel">Cancel</button>' +
        '<button class="btn primary" data-act="send">Send request</button>',
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-act="send"]').addEventListener("click", async function () {
      const category = m.el.querySelector("#nr-cat").value;
      const description = m.el.querySelector("#nr-desc").value.trim();
      if (description.length < 3) { toast("Tell them a little about what's going on.", "warning"); return; }
      const res = await V.UI.safe(function () { return V.API.endpoints.medicCreate(category, description); });
      if (!res) return;
      m.close();
      toast("Request sent. Your Medic Officer will get back to you here.");
      load(document.getElementById("main"));
    });
  }

  /* ================= medic ================= */

  async function loadMedic(el) {
    const data = await V.UI.safe(function () { return V.API.endpoints.medicQueue(); });
    const authData = await V.UI.safe(function () { return V.API.endpoints.medicAuthorized(); });
    const target = document.getElementById("medic-body");
    if (!target) return;
    if (!data) {
      target.innerHTML = '<div class="empty-state"><div class="icon">✚</div><h3>Couldn&#39;t load the queue</h3><p>Please try again.</p></div>';
      return;
    }
    const authedIds = {};
    ((authData && authData.authorized) || []).forEach(function (a) { authedIds[a.personnel_id] = true; });
    const order = { open: 0, acknowledged: 1, in_progress: 2, resolved: 3, declined: 4 };
    const rows = (data.requests || []).slice().sort(function (a, b) {
      return (order[a.status] - order[b.status]) || (a.updated_at < b.updated_at ? 1 : -1);
    });

    let html = '<div class="stat-row"><div class="stat-card"><div class="stat-value">' + (data.open_count || 0) + '</div><div class="stat-label">Needs your attention</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + rows.length + '</div><div class="stat-label">Total requests</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + Object.keys(authedIds).length + '</div><div class="stat-label">Wellness shared</div></div></div>';

    html += '<section class="card"><div class="card-head"><h2>Requests</h2><span class="chip">private threads</span></div>';
    if (!rows.length) {
      html += '<div class="empty-state"><div class="icon">✚</div><h3>No requests right now</h3><p>When someone on the team reaches out, it appears here.</p></div>';
    } else {
      html += '<div class="medic-requests wide">';
      rows.forEach(function (r) {
        html += '<button class="medic-request" data-id="' + esc(r.id) + '">' +
          '<div class="medic-request-top"><span class="medic-request-person">' + esc(r.person) + '</span>' +
          '<span class="cat-chip">' + esc(catLabel(r.category)) + "</span>" + statusBadge(r.status) + "</div>" +
          '<p class="medic-request-desc">' + esc(r.description) + "</p>" +
          '<p class="meta">' + esc(timeAgo(r.updated_at)) +
          (r.message_count ? " · " + r.message_count + " message" + (r.message_count === 1 ? "" : "s") : "") +
          (authedIds[r.person_id] ? ' · <span class="auth-dot" title="Wellness sharing on">✚ wellness shared</span>' : "") +
          "</p></button>";
      });
      html += "</div>";
    }
    html += "</section>";
    html += '<p class="privacy-note">🔒 You see wellness summaries only while a person keeps sharing switched on — switching it off cuts access instantly, and you&#39;ll see their threads without it. Never a diagnosis, always context.</p>';
    target.innerHTML = html;

    target.querySelectorAll(".medic-request").forEach(function (btn) {
      btn.addEventListener("click", function () { threadModal(btn.dataset.id, load.bind(null, el)); });
    });
  }

  /* ================= shared thread ================= */

  async function threadModal(requestId, onDone) {
    const data = await V.UI.safe(function () { return V.API.endpoints.medicThread(requestId); });
    if (!data) { toast("Couldn't open that request.", "warning"); return; }
    const req = data.request;
    const canReply = req.can_reply && req.status !== "declined";
    const canStatus = req.can_set_status;

    let threadHtml = '<div class="thread-meta">' + esc(catLabel(req.category)) + " · " + esc(req.person) + " · " + esc(timeAgo(req.created_at)) + "</div>" +
      '<div class="thread-opening">' + esc(req.description) + "</div>" +
      '<div class="chat-thread" id="mthread">';
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
      statusHtml = '<div class="field"><label>Status</label><select id="mt-status">' +
        Object.keys(STATUS_LABEL).map(function (s) {
          return '<option value="' + s + '"' + (s === req.status ? " selected" : "") + ">" + STATUS_LABEL[s] + "</option>";
        }).join("") + "</select></div>";
    }

    const m = openModal({
      title: req.is_mine ? "Your request" : "Request from " + req.person,
      size: "lg",
      body: threadHtml + statusHtml +
        (canReply
          ? '<div class="thread-composer"><textarea id="mt-msg" rows="2" maxlength="2000" placeholder="Write a reply…"></textarea>' +
            '<button class="btn primary" id="mt-send">Send</button></div>'
          : '<p class="muted">This request is closed for replies.</p>'),
      footer:
        '<button class="btn ghost" data-act="close">Close</button>' +
        (canStatus ? '<button class="btn primary" data-act="status">Save status</button>' : ""),
    });
    const threadEl = m.el.querySelector("#mthread");
    threadEl.scrollTop = threadEl.scrollHeight;
    m.el.querySelector('[data-act="close"]').addEventListener("click", m.close);

    const statusBtn = m.el.querySelector('[data-act="status"]');
    if (statusBtn) {
      statusBtn.addEventListener("click", async function () {
        const status = m.el.querySelector("#mt-status").value;
        const res = await V.UI.safe(function () { return V.API.endpoints.medicSetStatus(requestId, status); });
        if (!res) return;
        toast("Status updated — they've been notified.");
        m.close();
        if (onDone) onDone();
      });
    }

    const sendBtn = m.el.querySelector("#mt-send");
    if (sendBtn) {
      const send = async function () {
        const box = m.el.querySelector("#mt-msg");
        const text = box.value.trim();
        if (!text) return;
        sendBtn.disabled = true;
        const res = await V.UI.safe(function () { return V.API.endpoints.medicReply(requestId, text); });
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
      m.el.querySelector("#mt-msg").addEventListener("keydown", function (e) {
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
