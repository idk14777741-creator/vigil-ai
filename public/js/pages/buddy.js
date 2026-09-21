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
      "<div><strong>Consent-first, by design</strong>" +
      '<p class="meta mt-2">Your buddy gets <strong>nothing</strong> until you switch it on — item by item, with a confirm step, revocable at any time. Never shareable, ever: factor-level Recovery inputs, AI conversations, incident reports, medic and supervisor communications.</p></div></div></section>';

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
    const first = esc(c.buddy.full_name.split(" ")[0]);
    return '<section class="card"><div class="card-header"><h3>Your buddy</h3>' +
      '<button class="btn ghost sm" data-remove="' + c.id + '">Revoke access</button></div>' +
      '<div class="list-row" style="border:none; padding:0 0 var(--sp-3)">' + avatarHtml(c.buddy, "lg") +
      '<div class="grow"><div class="l-title" style="font-size:16px">' + esc(c.buddy.full_name) + "</div>" +
      '<div class="l-sub">Connected ' + esc(timeAgo(c.created_at)) + "</div></div></div>" +
      '<div class="eyebrow mb-2 mt-4">What would you like to share?</div>' +
      '<div class="share-toggles">' +
      shareToggle(c.id, "presence", c.share_scope.presence, "On shift or off", "Whether you're currently on duty — nothing more.") +
      shareToggle(c.id, "task_status", c.share_scope.task_status, "Open task count", "How many tasks you have open — no titles or details.") +
      shareToggle(c.id, "shift_info", c.share_scope.shift_info, "Shift information", "Weekly shift hours and last shift length.") +
      shareToggle(c.id, "recovery_score", c.share_scope.recovery_score, "Recovery Score", "Your 0–100 score and its day-to-day direction — never the factor inputs.") +
      shareToggle(c.id, "sleep", c.share_scope.sleep, "Sleep", "Last night's sleep duration only.") +
      shareToggle(c.id, "wellness_trends", c.share_scope.wellness_trends, "Wellness trends", "7-day averages: sleep, steps, resting heart rate.") +
      "</div>" +
      '<p class="meta mt-2">Nothing is shared until <em>you</em> switch it on. ' +
      "Recovery factor inputs, AI conversations, incidents and medic/supervisor threads are never shareable — there is no code path that exposes them.</p>" +
      '<div class="row gap-2 mt-3"><button class="btn primary sm" id="share-confirm">Confirm sharing</button>' +
      '<button class="btn ghost sm" id="share-revoke-all">Turn everything off</button></div>' +
      '<p class="meta mt-2" id="share-hint">Tick the boxes, then confirm. You can revoke any item — or everything — at any time.</p>' +
      '<div class="mt-4"><div class="eyebrow mb-2">What ' + first + " shares with you</div>" +
      sharedSummary(data.shared) + "</div></section>";
  }

  function sharedSummary(shared) {
    if (!shared || !Object.keys(shared).length) {
      return '<p class="meta">Nothing yet — they haven\'t switched anything on.</p>';
    }
    const rows = [];
    if (shared.presence) rows.push(["◐", "On shift: " + (shared.presence.on_shift ? "yes" : "no")]);
    if (shared.task_status) rows.push(["☑", "Open tasks: " + shared.task_status.open]);
    if (shared.shift_info) rows.push(["⚑", "This week: " + shared.shift_info.week_hours + "h across " + shared.shift_info.shifts_this_week + " shifts"]);
    if (shared.recovery_score) rows.push(["◉", "Recovery: " + shared.recovery_score.score + "/100" +
      (shared.recovery_score.change !== null && shared.recovery_score.change !== undefined ?
        (shared.recovery_score.change >= 0 ? " (▲ " : " (▼ ") + Math.abs(shared.recovery_score.change) + " vs yesterday)" : "")]);
    if (shared.sleep) rows.push(["☾", "Last night: " + shared.sleep.hours + "h sleep"]);
    if (shared.wellness_trends) rows.push(["♡", "7-day avg: " + shared.wellness_trends.sleep_avg_hours + "h sleep · " +
      (shared.wellness_trends.steps_avg || 0).toLocaleString() + " steps · " + (shared.wellness_trends.hr_avg || "—") + " bpm"]);
    return '<div class="stack-list">' + rows.map(function (r) {
      return '<div class="list-row"><span class="l-icon" aria-hidden="true">' + r[0] + "</span>" +
        '<div class="grow"><div class="l-sub">' + esc(r[1]) + "</div></div></div>";
    }).join("") + "</div>";
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
    // consent-first sharing: stage checkboxes, apply on Confirm
    const conn = data.connection;
    const hint = document.getElementById("share-hint");
    if (conn) {
      let dirty = false;
      target.querySelectorAll("[data-share]").forEach(function (box) {
        box.addEventListener("change", function () {
          dirty = true;
          if (hint) hint.textContent = "Changes not applied yet — press Confirm sharing to save.";
        });
      });
      const confirmBtn = document.getElementById("share-confirm");
      confirmBtn?.addEventListener("click", async function () {
        const patch = { connection_id: conn.id };
        target.querySelectorAll("[data-share]").forEach(function (box) {
          patch[box.getAttribute("data-share")] = box.checked;
        });
        const res = await V.UI.safe(function () { return V.API.endpoints.buddyShare(patch); });
        if (!res) { toast("Couldn't update sharing.", "error"); return; }
        dirty = false;
        if (hint) hint.textContent = "Saved — " + Object.keys(patch).filter(function (k) { return k !== "connection_id" && patch[k]; }).length + " item(s) now shared.";
        toast("Sharing preferences saved.", "success");
        load(target.closest("#page-content") || document.getElementById("page-content"));
      });
      document.getElementById("share-revoke-all")?.addEventListener("click", async function () {
        const ok = await confirmModal({
          title: "Revoke all sharing?",
          message: "Your buddy will see none of your data. Messages between you stay.",
          confirmLabel: "Revoke all", danger: true,
        });
        if (!ok) return;
        const patch = { connection_id: conn.id };
        target.querySelectorAll("[data-share]").forEach(function (box) {
          box.checked = false;
          patch[box.getAttribute("data-share")] = false;
        });
        const res = await V.UI.safe(function () { return V.API.endpoints.buddyShare(patch); });
        if (!res) { toast("Couldn't update sharing.", "error"); return; }
        toast("All sharing revoked. Your data stays yours.", "success");
        load(target.closest("#page-content") || document.getElementById("page-content"));
      });
    }
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
