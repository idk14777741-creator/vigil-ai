/**
 * VIGIL AI — Assistant (Phase 8).
 * A calm, private chat. Conversations persist server-side and belong to the
 * author only. The assistant is supportive and never diagnostic — safety
 * topics are redirected to real humans server-side.
 */
(function (V) {
  const esc = V.UI.esc;
  const timeAgo = V.UI.timeAgo;
  const toast = V.UI.toast;

  V.ROUTER.register("/assistant", render, { title: "VIGIL AI Assistant", nav: "/assistant", roles: ["personnel"] });

  let activeConvId = null;
  let busy = false;

  const STARTERS = [
    ["Help me unwind after a heavy shift"],
    ["I'm feeling stressed"],
    ["Summarise my week"],
    ["Help me organise my tasks"],
    ["I can't sleep well lately"],
  ];

  function render(el) {
    el.innerHTML = '<div class="page assistant-page">' +
      '<div class="chat-layout card">' +
      '<aside class="chat-side">' +
      '<button class="btn primary block" id="new-chat">＋ New conversation</button>' +
      '<div class="chat-conv-list" id="conv-list"><div class="meta" style="padding:10px">Loading…</div></div>' +
      '<p class="meta" style="padding: 10px 12px">Conversations are private to you — always.</p>' +
      "</aside>" +
      '<div class="chat-main">' +
      '<div class="chat-thread" id="chat-thread" aria-live="polite"></div>' +
      '<div class="chat-starter" id="chat-starters"></div>' +
      '<form class="chat-composer" id="chat-form">' +
      '<textarea id="chat-input" rows="1" maxlength="2000" placeholder="Type anything — VIGIL AI is here to help…" aria-label="Message VIGIL AI"></textarea>' +
      '<button class="btn primary" id="chat-send" type="submit">Send</button>' +
      "</form>" +
      '<p class="meta chat-disclaimer">VIGIL AI offers wellbeing support, not medical advice. In an emergency, contact your Medic Officer or emergency services.</p>' +
      "</div></div></div>";

    wire(el);
    loadConversations();
    showEmptyThread();
  }

  function wire(el) {
    document.getElementById("new-chat").addEventListener("click", function () {
      activeConvId = null;
      showEmptyThread();
    });
    document.getElementById("chat-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      await send();
    });
    const input = document.getElementById("chat-input");
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    input.addEventListener("input", function () {
      input.style.height = "auto";
      input.style.height = Math.min(120, input.scrollHeight) + "px";
    });
  }

  function showEmptyThread() {
    const thread = document.getElementById("chat-thread");
    thread.innerHTML =
      '<div class="chat-hello">' +
      '<div class="hello-mark" aria-hidden="true">✦</div>' +
      '<h2>Hello. I\'m VIGIL AI.</h2>' +
      '<p class="muted">I can help you unwind, make sense of a heavy day, organise tasks, or point you to the right support. Everything you say stays between us.</p>' +
      "</div>";
    const starters = document.getElementById("chat-starters");
    starters.innerHTML = STARTERS.map(function (s, i) {
      return '<button class="chip" data-i="' + i + '">' + esc(s[0]) + "</button>";
    }).join("");
    starters.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.getElementById("chat-input").value = chip.textContent;
        send();
      });
    });
    renderConvList();
  }

  async function loadConversations() {
    const result = await V.UI.safe(function () { return V.API.endpoints.aiConversations(); });
    const list = document.getElementById("conv-list");
    if (!result) { list.innerHTML = '<div class="meta" style="padding:10px">Could not load conversations.</div>'; return; }
    if (!result.conversations.length) {
      list.innerHTML = '<div class="meta" style="padding:10px">No conversations yet — say hello below.</div>';
      return;
    }
    renderConvList(result.conversations);
  }

  function renderConvList(conversations) {
    const list = document.getElementById("conv-list");
    if (!conversations) return; // keep whatever is there
    if (!conversations.length) return;
    list.innerHTML = conversations.map(function (c) {
      return '<div class="conv-item' + (c.id === activeConvId ? " active" : "") + '" data-conv="' + c.id + '" tabindex="0" role="button">' +
        '<div class="conv-title">' + esc(c.title) + "</div>" +
        '<div class="conv-time meta">' + esc(timeAgo(c.updated_at || c.created_at)) + "</div>" +
        '<button class="conv-del" data-del="' + c.id + '" aria-label="Delete conversation">✕</button>' +
        "</div>";
    }).join("");
    list.querySelectorAll("[data-conv]").forEach(function (item) {
      item.addEventListener("click", function (e) {
        if (e.target.closest("[data-del]")) return;
        openConversation(item.getAttribute("data-conv"));
      });
    });
    list.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", async function (e) {
        e.stopPropagation();
        const ok = await V.UI.confirmModal({
          title: "Delete conversation?",
          message: "This removes the whole conversation permanently. Only you can see it, and only you can delete it.",
          confirmLabel: "Delete", danger: true,
        });
        if (!ok) return;
        await V.UI.safe(function () { return V.API.endpoints.aiDeleteConversation(btn.getAttribute("data-del")); });
        if (activeConvId === btn.getAttribute("data-del")) {
          activeConvId = null;
          showEmptyThread();
        }
        loadConversations();
        toast("Conversation deleted.", "success");
      });
    });
  }

  async function openConversation(convId) {
    const result = await V.UI.safe(function () { return V.API.endpoints.aiConversation(convId); });
    if (!result) { toast("Couldn't open that conversation.", "error"); return; }
    activeConvId = convId;
    const thread = document.getElementById("chat-thread");
    document.getElementById("chat-starters").innerHTML = "";
    thread.innerHTML = result.messages.map(function (m) {
      return bubble(m.role, m.content, m.created_at);
    }).join("") + typingHtml();
    hideTyping();
    thread.scrollTop = thread.scrollHeight;
    renderConvList();
    document.getElementById("chat-input").focus();
  }

  function bubble(role, text, at) {
    return '<div class="chat-msg ' + role + '">' +
      '<div class="msg-avatar" aria-hidden="true">' + (role === "user" ? "You".slice(0, 1) : "✦") + "</div>" +
      '<div class="msg-body"><div class="msg-text">' + esc(text).replace(/\n/g, "<br>") + "</div>" +
      (at ? '<div class="msg-time meta">' + esc(timeAgo(at)) + "</div>" : "") +
      "</div></div>";
  }

  function typingHtml() {
    return '<div class="chat-msg assistant typing" id="typing-row">' +
      '<div class="msg-avatar" aria-hidden="true">✦</div>' +
      '<div class="msg-body"><div class="msg-text typing-dots" aria-label="VIGIL AI is thinking"><span></span><span></span><span></span></div></div></div>';
  }

  function hideTyping() {
    document.getElementById("typing-row")?.remove();
  }

  async function send() {
    if (busy) return;
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    busy = true;
    const sendBtn = document.getElementById("chat-send");
    sendBtn.disabled = true;
    input.value = "";
    input.style.height = "auto";

    const thread = document.getElementById("chat-thread");
    if (activeConvId === null) {
      thread.innerHTML = ""; // clear hello screen
      document.getElementById("chat-starters").innerHTML = "";
    }
    thread.insertAdjacentHTML("beforeend", bubble("user", text));
    thread.insertAdjacentHTML("beforeend", typingHtml());
    thread.scrollTop = thread.scrollHeight;

    try {
      const res = await V.API.endpoints.aiChat(text, activeConvId);
      hideTyping();
      activeConvId = res.conversation_id;
      thread.insertAdjacentHTML("beforeend", bubble("assistant", res.reply));
      thread.scrollTop = thread.scrollHeight;
      loadConversations();
    } catch (e) {
      hideTyping();
      thread.insertAdjacentHTML("beforeend",
        '<div class="chat-msg assistant"><div class="msg-avatar" aria-hidden="true">✦</div>' +
        '<div class="msg-body"><div class="msg-text error-text">Sorry — I couldn&#39;t reach the service just then. Your message wasn&#39;t lost: ' +
        esc(text) + '</div></div></div>');
      thread.scrollTop = thread.scrollHeight;
    }
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
})(window.VIGIL = window.VIGIL || {});
