/**
 * VIGIL AI — Buddy Connect (Phase 10).
 * Voluntary trusted-person support: invite by email, accept/decline, chat,
 * and explicit sharing controls. Buddies never see wellness data, incidents,
 * or AI conversations — only explicitly shared presence/task status.
 */
(function (V) {
  const esc = V.UI.esc;
  const timeAgo = V.UI.timeAgo;
  const avatarHtml = V.UI.avatarHtml;
  const toast = V.UI.toast;
  const confirmModal = V.UI.confirmModal;

  V.ROUTER.register("/buddy", render, { title: "Buddy Connect", nav: "/buddy", roles: ["personnel"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="page-header"><div><h1>Buddy Connect</h1>' +
      '<p class="sub">A voluntary link with someone you trust. You choose what they can see — and you can end it any time.</p></div></div>' +
      '<div id="buddy-body"><div class="loading-block"><div class="spinner"></div><p>Loading…</p></div></div>' +
      "</div>";
    load(el);
  }

  async function load(el) {
    const data = await V.UI.safe(function () { return V.API.endpoints.buddyStatus(); });
    const target = document.getElementById("buddy-body");
    if (!data) {
      target.innerHTML = '<div class="empty-state"><div class="icon">⇄</div><h3>Couldn&#39;t load Buddy Connect</h3><p>Please try again.</p></div>';
      return;
    }
    draw(target, data);
  }

  function draw(target, data) {
    let html = "";

    // privacy note
    html += '<section class="card privacy-card"><div class="row gap-3">' +
      '<span class="f-icon" aria-hidden="true">🔒</span>' +
      "<div><strong>What your buddy can — and can't — see</strong>" +
      '<p class="meta mt-2">Never shared: heart rate, SpO₂, sleep, Recovery Score, incidents, AI conversations, supervisor or medic communications. Shared only if <em>you</em> switch it on: whether you\'re on shift, and how many tasks you have open.</p></div></div></section>';

    // accepted connection
    if (data.connection) {
      html += acceptedCard(data);
    } else {
      // pending in/out + invite
      if (data.pending_incoming.length) {
        html += '<section class="card"><div class="card-header"><h3>Buddy requests</h3></div>' +
          '<div class="stack-list">' + data.pending_incoming.map(function (p) {
            return '<div class="list-row">' + avatarHtml(p.buddy) +
              '<div class="grow"><div class="l-title">' + esc(p.buddy.full_name) + "</div>" +
              '<div class="l-sub">wants to connect with you · ' + esc(timeAgo(p.created_at)) + "</div></div>" +
              '<button class="btn primary sm" data-accept="' + p.id + '">Accept</button>' +
              '<button class="btn ghost sm" data-decline="' + p.id + '">Decline</button></div>';
          }).join("") + "</div></section>";
      }
      html += inviteCard(data);
    }

    target.innerHTML = '<div class="grid-2">' + html +
      // messaging side (when connected)
      (data.connection ? chatCard(data) : "") + "</div>";

    wire(target, data);
  }

  function acceptedCard(data) {
    const c = data.connection;
    return '<section class="card"><div class="card-header"><h3>Your buddy</h3>' +
      '<button class="btn ghost sm" data-remove="' + c.id + '">End connection</button></div>' +
      '<div class="list-row" style="border:none; padding:0 0 var(--sp-3)">' + avatarHtml(c.buddy, "lg") +
      '<div class="grow"><div class="l-title" style="font-size:16px">' + esc(c.buddy.full_name) + "</div>" +
      '<div class="l-sub">Connected ' + esc(timeAgo(c.created_at)) + "</div></div></div>" +
      '<div class="eyebrow mb-2 mt-4">What you share with ' + esc(c.buddy.full_name.split(" ")[0]) + "</div>" +
      '<div class="share-toggles">' +
      shareToggle(c.id, "presence", c.share_scope.presence, "On shift or off", "Shows whether you're currently on duty — nothing more.") +
      shareToggle(c.id, "task_status", c.share_scope.task_status, "Open task count", "Shows how many tasks you have open — no titles or details.") +
      "</div>" +
      '<p class="meta mt-4">Changes apply immediately. Everything else stays private, always.</p></section>';
  }

  function shareToggle(connId, key, on, title, desc) {
    return '<label class="share-row"><div class="grow"><div class="l-title">' + esc(title) + "</div>" +
      '<div class="l-sub">' + esc(desc) + "</div></div>" +
      '<input type="checkbox" data-share="' + key + '" data-conn="' + connId + '"' + (on ? " checked" : "") + ' aria-label="' + esc(title) + '"></label>';
  }

  function inviteCard(data) {
    let out = '<section class="card"><div class="card-header"><h3>Invite a buddy</h3></div>' +
      '<p class="muted mb-4">Your buddy needs a VIGIL AI personnel account. Send a request by email — they accept from their own Buddy Connect page.</p>' +
      '<form id="buddy-invite-form" class="row gap-2 wrap"><input id="buddy-email" type="email" placeholder="buddy@example.com" aria-label="Buddy email" style="flex:1 1 240px; padding:10px 13px; border:1px solid var(--border-strong); border-radius:10px; background:var(--surface); color:var(--text)">' +
      '<button class="btn primary" type="submit">Send request</button></form>';
    if (data.pending_outgoing.length) {
      out += '<div class="mt-4"><div class="eyebrow mb-2">Awaiting their reply</div><div class="stack-list">' +
        data.pending_outgoing.map(function (p) {
          return '<div class="list-row">' + avatarHtml(p.buddy) +
            '<div class="grow"><div class="l-title">' + esc(p.buddy.full_name) + "</div>" +
            '<div class="l-sub">Request sent ' + esc(timeAgo(p.created_at)) + "</div></div>" +
            '<span class="badge tone-brand">Pending</span></div>';
        }).join("") + "</div></div>";
    }
    return out + "</section>";
  }

  function chatCard(data) {
    return '<section class="card chat-card"><div class="card-header"><h3>Messages' +
      (data.unread ? ' <span class="badge tone-brand">' + data.unread + " new</span>" : "") + "</h3></div>" +
      '<div class="buddy-thread" id="buddy-thread" aria-live="polite"></div>' +
      '<form id="buddy-msg-form" class="row gap-2 mt-2">' +
      '<input id="buddy-msg-input" maxlength="2000" placeholder="Say something supportive…" aria-label="Message your buddy" style="flex:1; padding:10px 13px; border:1px solid var(--border-strong); border-radius:10px; background:var(--surface); color:var(--text)">' +
      '<button class="btn primary" type="submit">Send</button></form></section>';
  }

  function wire(target, data) {
    // accept / decline
    target.querySelectorAll("[data-accept]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        await V.API.endpoints.buddyRespond(btn.getAttribute("data-accept"), "accept").catch(function (e) { toast(e.message, "error"); });
        toast("You're connected. Say hello below!", "success");
        load(target.closest("#page-content") || document.getElementById("page-content"));
      });
    });
    target.querySelectorAll("[data-decline]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        await V.API.endpoints.buddyRespond(btn.getAttribute("data-decline"), "decline").catch(function (e) { toast(e.message, "error"); });
        load(target.closest("#page-content") || document.getElementById("page-content"));
      });
    });
    // remove
    target.querySelectorAll("[data-remove]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const ok = await confirmModal({
          title: "End buddy connection?",
          message: "This removes the connection and all messages. Any shared access ends immediately.",
          confirmLabel: "End connection", danger: true,
        });
        if (!ok) return;
        await V.API.endpoints.buddyRemove(btn.getAttribute("data-remove")).catch(function (e) { toast(e.message, "error"); });
        toast("Connection ended. Your data stays yours.", "success");
        load(target.closest("#page-content") || document.getElementById("page-content"));
      });
    });
    // share toggles
    target.querySelectorAll("[data-share]").forEach(function (box) {
      box.addEventListener("change", async function () {
        const body = { connection_id: box.getAttribute("data-conn") };
        body[box.getAttribute("data-share")] = box.checked;
        const res = await V.UI.safe(function () { return V.API.endpoints.buddyShare(body); });
        if (!res) { toast("Couldn't update sharing.", "error"); box.checked = !box.checked; return; }
        toast(box.checked ? "Now sharing with your buddy." : "Sharing turned off.", "success");
      });
    });
    // invite
    const form = document.getElementById("buddy-invite-form");
    form?.addEventListener("submit", async function (e) {
      e.preventDefault();
      const email = document.getElementById("buddy-email").value.trim();
      try {
        await V.API.endpoints.buddyInvite(email);
        toast("Request sent — they'll see it next time they sign in.", "success");
        load(target.closest("#page-content") || document.getElementById("page-content"));
      } catch (err) { toast(err.message, "error"); }
    });
    // chat
    if (data.connection) {
      wireChat(data.connection.id);
    }
  }

  function wireChat(connId) {
    const thread = document.getElementById("buddy-thread");
    const form = document.getElementById("buddy-msg-form");
    const input = document.getElementById("buddy-msg-input");
    const myId = V.STORE.getState().user.id;

    async function refresh() {
      const res = await V.UI.safe(function () { return V.API.endpoints.buddyMessages(connId); });
      if (!res || !res.connection) return;
      thread.innerHTML = res.messages.length
        ? res.messages.map(function (m) {
            const mine = m.sender_id === myId;
            return '<div class="bmsg ' + (mine ? "mine" : "theirs") + '"><div class="bmsg-text">' + esc(m.body) + "</div>" +
              '<div class="meta bmsg-time">' + esc(timeAgo(m.created_at)) + "</div></div>";
          }).join("")
        : '<p class="meta" style="text-align:center; padding: var(--sp-6)">No messages yet — a small check-in means a lot.</p>';
      thread.scrollTop = thread.scrollHeight;
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      try {
        await V.API.endpoints.buddySend(connId, text);
        refresh();
      } catch (err) { toast(err.message, "error"); }
    });

    refresh();
  }
})(window.VIGIL = window.VIGIL || {});
