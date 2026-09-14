/**
 * VIGIL AI — Message From Home (Phase 11).
 * Loved ones send supportive video messages. You approve contacts, watch,
 * hide or delete videos. Everything here is private to you — always.
 */
(function (V) {
  const esc = V.UI.esc;
  const timeAgo = V.UI.timeAgo;
  const toast = V.UI.toast;
  const openModal = V.UI.openModal;
  const confirmModal = V.UI.confirmModal;

  V.ROUTER.register("/home", render, { title: "Message From Home", nav: "/home", roles: ["personnel"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="page-header"><div><h1>Message From Home</h1>' +
      '<p class="sub">Supportive video messages from the people who love you — stored privately, just for you.</p></div>' +
      '<button class="btn primary" id="home-add">＋ Add someone</button></div>' +
      '<div id="home-body"><div class="loading-block"><div class="spinner"></div><p>Loading…</p></div></div>' +
      "</div>";
    document.getElementById("home-add").addEventListener("click", addContactModal);
    load(el);
  }

  async function load(el) {
    const data = await V.UI.safe(function () { return V.API.endpoints.homeStatus(); });
    const target = document.getElementById("home-body");
    if (!target) return;
    if (!data) {
      target.innerHTML = '<div class="empty-state"><div class="icon">⌂</div><h3>Couldn&#39;t load Message From Home</h3><p>Please try again.</p></div>';
      return;
    }
    const contacts = data.contacts || [];
    const videos = data.videos || [];
    const contactName = function (id) {
      const c = contacts.find(function (x) { return x.id === id; });
      return c ? c.name : "Someone who loves you";
    };

    let html = "";

    /* Contacts strip */
    html += '<section class="card"><div class="card-head"><h2>Your people</h2>' +
      '<span class="chip">' + contacts.length + " contact" + (contacts.length === 1 ? "" : "s") + "</span></div>";
    if (!contacts.length) {
      html += '<p class="muted">No one here yet. Add a parent, partner, sibling or friend — they&#39;ll get a private invite code for sending you video messages.</p>';
    } else {
      html += '<div class="home-contacts">';
      contacts.forEach(function (c) {
        html += '<div class="home-contact">' +
          '<div class="home-contact-name">' + esc(c.name) + "</div>" +
          '<div class="home-contact-rel">' + esc(c.relationship || "Family") + "</div>" +
          '<div class="home-contact-meta">' + (c.video_count || 0) + " video" + ((c.video_count || 0) === 1 ? "" : "s") + "</div>" +
          '<div class="home-contact-actions">' +
          '<button class="btn tiny ghost home-copy" data-code="' + esc(c.invite_code) + '" data-name="' + esc(c.name) + '">Copy invite code</button>' +
          '<button class="btn tiny ghost danger home-remove" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">Remove</button>' +
          "</div></div>";
      });
      html += "</div>";
      html += '<p class="hint">Invite codes let one trusted person send you videos from the family upload page. Removing them invalidates their code immediately.</p>';
    }
    html += "</section>";

    /* Videos grid */
    html += '<section class="card"><div class="card-head"><h2>Messages for you</h2>' +
      '<span class="chip demo-chip">Demo · placeholder playback</span></div>';
    if (!videos.length) {
      html += '<div class="empty-state"><div class="icon">⌂</div><h3>No messages yet</h3>' +
        "<p>When someone who loves you sends a video, it appears here — and you get a notification.</p></div>";
    } else {
      html += '<div class="home-videos">';
      videos.forEach(function (v) {
        html += '<article class="home-video' + (v.watched ? "" : " unwatched") + '">' +
          '<button class="home-thumb" data-action="play" data-id="' + esc(v.id) + '" aria-label="Play ' + esc(v.title) + '">' +
          '<span class="home-thumb-icon">▶</span>' +
          (v.watched ? "" : '<span class="badge accent home-new">New</span>') +
          "</button>" +
          '<div class="home-video-body">' +
          '<h3 class="home-video-title">' + esc(v.title) + "</h3>" +
          '<p class="home-video-from">From ' + esc(contactName(v.contact_id)) + " · " + esc(timeAgo(v.created_at)) + "</p>" +
          (v.message ? '<p class="home-video-msg">' + esc(v.message) + "</p>" : "") +
          '<div class="home-video-actions">' +
          '<button class="btn tiny ghost" data-action="play" data-id="' + esc(v.id) + '">Watch</button>' +
          '<button class="btn tiny ghost" data-action="delete" data-id="' + esc(v.id) + '">Delete</button>' +
          "</div></div></article>";
      });
      html += "</div>";
    }
    html += "</section>";

    /* Family corner — demo upload simulation */
    html += '<section class="card home-corner"><div class="card-head"><h2>Family corner</h2></div>' +
      "<p>In live mode, your people open a private upload link with their invite code and record a message straight from their phone. In this demo you can play that part yourself:</p>" +
      '<button class="btn ghost" id="home-simulate">Try the upload experience</button>' +
      '<p class="hint">This sends a real demo video to your own account — the same flow a loved one would use.</p></section>';

    html += '<p class="privacy-note">🔒 Videos are yours alone. Nobody else — not your buddy, supervisor or medic — can see them, and deleting one removes it completely.</p>';

    target.innerHTML = html;

    target.querySelectorAll(".home-copy").forEach(function (btn) {
      btn.addEventListener("click", function () { copyCode(btn.dataset.code, btn.dataset.name); });
    });
    target.querySelectorAll(".home-remove").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const ok = await confirmModal({
          title: "Remove " + btn.dataset.name + "?",
          message: "They won&#39;t be able to send you videos anymore, and their invite code stops working immediately. Videos they already sent stay until you delete them.",
          confirmLabel: "Remove contact",
        });
        if (!ok) return;
        await V.UI.safe(function () { return V.API.endpoints.homeRemoveContact(btn.dataset.id); });
        toast(btn.dataset.name + " removed. You can add them back any time.");
        load(el);
      });
    });
    target.querySelectorAll('[data-action="play"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        const v = videos.find(function (x) { return x.id === btn.dataset.id; });
        if (v) playModal(v, contactName(v.contact_id));
      });
    });
    target.querySelectorAll('[data-action="delete"]').forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const v = videos.find(function (x) { return x.id === btn.dataset.id; });
        const ok = await confirmModal({
          title: "Delete this video?",
          message: (v ? "&#39;" + v.title + "&#39; " : "This video ") + "will be removed completely. You can&#39;t undo this.",
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        await V.UI.safe(function () { return V.API.endpoints.homeDelete(btn.dataset.id); });
        toast("Video deleted.");
        load(el);
      });
    });
    const sim = document.getElementById("home-simulate");
    if (sim) sim.addEventListener("click", simulateUpload);
  }

  /* ---------- modals ---------- */

  function addContactModal() {
    const m = openModal({
      title: "Add someone from home",
      size: "lg",
      body:
        '<div class="field"><label>Their name *</label><input id="hc-name" maxlength="80" placeholder="Amma, Vikram, Meera…" autocomplete="off"></div>' +
        '<div class="field"><label>Relationship</label><input id="hc-rel" maxlength="40" placeholder="Mother, Partner, Friend…" autocomplete="off"></div>' +
        '<p class="hint">We generate a private invite code you can share with them. Only they can use it.</p>',
      footer:
        '<button class="btn ghost" data-act="cancel">Cancel</button>' +
        '<button class="btn primary" data-act="save">Add contact</button>',
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-act="save"]').addEventListener("click", async function () {
      const name = m.el.querySelector("#hc-name").value.trim();
      const rel = m.el.querySelector("#hc-rel").value.trim();
      if (name.length < 2) { toast("Enter their name.", "warning"); return; }
      const res = await V.UI.safe(function () { return V.API.endpoints.homeAddContact(name, rel); });
      if (!res) return;
      m.close();
      showInviteCode(res.contact);
      load(document.getElementById("main"));
    });
  }

  function showInviteCode(contact) {
    const m = openModal({
      title: "Invite code for " + contact.name,
      size: "sm",
      body:
        "<p>Share this code with <strong>" + esc(contact.name) + "</strong> — it&#39;s the only thing they need to send you a video:</p>" +
        '<div class="invite-code-box"><code>' + esc(contact.invite_code) + "</code></div>" +
        '<p class="hint">Anyone with this code can send videos to your account. Keep it private; removing the contact invalidates it.</p>',
      footer: '<button class="btn primary" data-act="done">Done</button>',
    });
    m.el.querySelector('[data-act="done"]').addEventListener("click", m.close);
  }

  function playModal(v, fromName) {
    const m = openModal({
      title: v.title,
      size: "lg",
      body:
        '<div class="video-placeholder home-play"><div class="vp-inner"><div class="vp-icon">▶</div>' +
        "<p><strong>" + esc(v.title) + "</strong></p>" +
        "<p>From " + esc(fromName) + (v.duration_sec ? " · about " + Math.max(1, Math.round(v.duration_sec / 60)) + " min" : "") + "</p>" +
        '<p class="hint">Demo placeholder — real video playback arrives with media integration.</p></div></div>' +
        (v.message ? '<blockquote class="home-msg">' + esc(v.message) + "</blockquote>" : "") +
        '<p class="meta">Only you can see this.</p>',
      footer: '<button class="btn primary" data-act="close">Close</button>',
    });
    m.el.querySelector('[data-act="close"]').addEventListener("click", m.close);
    V.API.endpoints.homeWatch(v.id).then(function () {
      v.watched = true;
      const card = document.querySelector('.home-video [data-action="play"][data-id="' + v.id + '"]');
      if (card) {
        const art = card.closest(".home-video");
        if (art) {
          art.classList.remove("unwatched");
          const badge = art.querySelector(".home-new");
          if (badge) badge.remove();
        }
      }
    });
  }

  function simulateUpload() {
    V.UI.safe(function () { return V.API.endpoints.homeStatus(); }).then(function (data) {
      const contacts = ((data && data.contacts) || []).filter(function (c) { return c.status === "active"; });
      if (!contacts.length) {
        toast("Add someone first — they need an invite code to send you a video.", "warning");
        addContactModal();
        return;
      }
      const options = contacts.map(function (c) {
        return '<option value="' + esc(c.invite_code) + '">' + esc(c.name) + "</option>";
      }).join("");
      const m = openModal({
        title: "Family upload (demo)",
        size: "lg",
        body:
          '<p class="hint">This simulates what your loved one sees after opening their private upload link.</p>' +
          '<div class="field"><label>Sending as</label><select id="hu-who">' + options + "</select></div>" +
          '<div class="field"><label>Video title *</label><input id="hu-title" maxlength="120" placeholder="Big hug from Dad"></div>' +
          '<div class="field"><label>Message (optional)</label><textarea id="hu-msg" maxlength="500" rows="3" placeholder="Saw your shift roster — eat properly, okay?"></textarea></div>',
        footer:
          '<button class="btn ghost" data-act="cancel">Cancel</button>' +
          '<button class="btn primary" data-act="send">Send with love</button>',
      });
      m.el.querySelector('[data-act="cancel"]').addEventListener("click", m.close);
      m.el.querySelector('[data-act="send"]').addEventListener("click", async function () {
        const code = m.el.querySelector("#hu-who").value;
        const title = m.el.querySelector("#hu-title").value.trim();
        const message = m.el.querySelector("#hu-msg").value.trim();
        if (!title) { toast("Give the video a title.", "warning"); return; }
        const res = await V.UI.safe(function () { return V.API.endpoints.homeUpload(code, title, message); });
        if (!res) return;
        m.close();
        toast(res.message || "Your video is on its way to them.");
        load(document.getElementById("main"));
      });
    });
  }

  function copyCode(code, name) {
    const done = function () { toast("Invite code copied — send it to " + (name || "them") + "."); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, done);
    } else {
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) { /* noop */ }
      document.body.removeChild(ta);
      done();
    }
  }
})(window.VIGIL);
