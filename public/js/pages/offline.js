/**
 * VIGIL AI — Offline & Transfers (offline-first welfare data transfer).
 *
 * One page, three role views:
 *   personnel        — generate Authorized Welfare Reports, choose recipient +
 *                      transport, store-and-forward pending queue, history
 *   medic/supervisor — join transfer sessions, receive + review inbox
 *   everyone         — connection status strip, sync status, labeled demo tools
 *
 * Honest-labelling rules live here too: the simulated transport is marked
 * SIMULATED in the UI, and the page distinguishes clearly between
 *   no internet      → normal, local mode keeps working
 *   no channel       → transfers park in the store-and-forward queue
 *   internet returns → queued records sync centrally (idempotent)
 */
(function (V) {
  const esc = V.UI.esc;
  const toast = V.UI.toast;
  const openModal = V.UI.openModal;
  const timeAgo = V.UI.timeAgo;

  const role = function () { return (V.STORE.getState().user || {}).role; };
  const isPersonnel = function () { return role() === "personnel"; };
  const isRecipient = function () { return role() === "medic" || role() === "supervisor"; };

  const METHOD_LABEL = {
    local_wifi: "Local Wi-Fi relay",
    local_relay: "Local Wi-Fi relay",
    webrtc: "Direct device link",
    demo_simulated: "Simulated (demo)",
    simulated: "Simulated (demo)",
  };

  const STATUS_TONE = { sent: "ok", delivered: "ok", reviewed: "ok", pending: "warn", failed: "danger" };
  const STATUS_LABEL = { sent: "Delivered", delivered: "Delivered", reviewed: "Reviewed", pending: "Waiting for connection", failed: "Failed" };

  V.ROUTER.register("/offline", render, { title: "Offline & Transfers", nav: "/offline", roles: ["personnel", "medic", "supervisor", "admin"] });

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="page-header"><div><h1>Offline &amp; Transfers</h1>' +
      '<p class="sub">No internet does not mean no support. Your data stays on this device, welfare reports can move over a local channel, and everything syncs when connectivity returns.</p></div></div>' +
      '<div id="ox-status"></div>' +
      '<div id="ox-body"><div class="loading-block"><div class="spinner"></div><p>Loading…</p></div></div></div>';
    V.Offline.ready().then(function () {
      paintStatus();
      V.Offline.onChange(paintStatus);
      V.Offline.probeTransfer();
      load(el);
    });
  }

  /* ================= status strip ================= */

  function paintStatus() {
    const target = document.getElementById("ox-status");
    if (!target) return;
    const s = V.Offline.getStatus();
    const sim = s.simulatedOffline;
    const netLabel = sim ? "OFFLINE (simulated)" : s.net === "online" ? "ONLINE" : "OFFLINE";
    const netTone = sim ? "warn" : s.net === "online" ? "ok" : "warn";
    let syncLabel = s.syncing ? "SYNCING…" : (s.lastSync ? "SYNCED" : (s.net === "online" && !sim ? "SYNCED" : "SYNC PENDING"));
    let syncTone = s.syncing ? "info" : (s.net === "online" && !sim) || s.lastSync ? "ok" : "warn";
    const transfer = s.transferAvailable === "available"
      ? '<span class="ox-chip tone-ok">TRANSFER AVAILABLE</span>'
      : s.transferAvailable === "unavailable"
        ? '<span class="ox-chip tone-warn">⚠ TRANSFER UNAVAILABLE</span>'
        : "";
    target.innerHTML = '<div class="ox-strip card">' +
      '<span class="ox-chip tone-' + netTone + '"><span class="ox-dot"></span>' + netLabel + "</span>" +
      '<span class="ox-chip tone-' + syncTone + '">' + syncLabel + "</span>" +
      transfer +
      (s.pending ? '<span class="ox-chip tone-info">' + s.pending + " pending transfer" + (s.pending === 1 ? "" : "s") + "</span>" : "") +
      (sim
        ? '<button class="btn small" id="ox-sim-off">End offline simulation</button>'
        : '<button class="btn small ghost" id="ox-sim-on">Simulate offline (demo)</button>') +
      "</div>";
    const simOff = document.getElementById("ox-sim-off");
    if (simOff) simOff.addEventListener("click", function () { V.Offline.setSimulateOffline(false); toast("Back to real connectivity.", "info"); });
    const simOn = document.getElementById("ox-sim-on");
    if (simOn) simOn.addEventListener("click", function () { V.Offline.setSimulateOffline(true); toast("Simulating no internet — VIGIL keeps working locally. Clearly labelled as a simulation.", "info"); });
  }

  /* ================= load ================= */

  async function load(el) {
    const body = document.getElementById("ox-body");
    if (!body) return;
    if (isPersonnel()) return loadPersonnel(el);
    if (isRecipient()) return loadRecipient(el);
    return loadAdmin(el);
  }

  /* ================= personnel view ================= */

  async function loadPersonnel(el) {
    const body = document.getElementById("ox-body");
    if (!body) return;
    const [reports, pending, historyRes] = await Promise.all([
      V.Offline.listReports(),
      V.Offline.listPending(),
      V.UI.safe(function () { return V.API.endpoints.transferHistory(); }),
    ]);
    if (!body) return;

    const sent = ((historyRes && historyRes.history) || []).filter(function (h) { return h.direction === "sent"; });

    let html = "";

    /* --- generate a report --- */
    html += '<section class="card"><div class="card-head"><h2>Authorized Welfare Report</h2>' +
      '<span class="chip">minimum data, always</span></div>' +
      '<p class="muted">A welfare report contains <strong>only</strong> what the recipient is authorized to see — never your full database, private conversations, or raw records.</p>' +
      '<div class="row gap-2 wrap mt-2">' +
      '<button class="btn primary" id="ox-gen-medic">Generate report for Medic Officer</button>' +
      '<button class="btn ghost" id="ox-gen-supervisor">Generate report for Supervisor</button>' +
      "</div>" +
      '<p class="hint mt-2">Works offline too — if the server can\'t be reached, the report is built from the data cached on this device.</p></section>';

    /* --- pending transfers (store-and-forward) --- */
    html += '<section class="card"><div class="card-head"><h2>Pending transfers</h2>' +
      (pending.length ? '<span class="chip">' + pending.length + "</span>" : "") + "</div>";
    if (!pending.length) {
      html += '<div class="empty-state small"><div class="icon">✓</div><h3>Nothing waiting</h3><p>Reports you generate are transferred straight away when a channel is available. Anything that can\'t move waits here securely — it is never deleted.</p></div>';
    } else {
      html += pending.map(function (p) {
        return '<div class="ox-pending" data-id="' + esc(p.id) + '">' +
          '<div class="grow"><strong>Welfare report</strong>' +
          '<div class="meta">Recipient: ' + esc(p.recipient_name || p.recipient_role) + " · " + esc(METHOD_LABEL[p.method] || p.method) +
          " · Created " + esc(timeAgo(p.created_at)) + "</div>" +
          (p.last_error ? '<div class="meta tone-danger">Last attempt: ' + esc(p.last_error) + "</div>" : "") +
          "</div>" +
          '<div class="row gap-2">' + statusBadge(p.state) +
          '<button class="btn small" data-act="retry">Retry</button>' +
          '<button class="btn small ghost" data-act="discard">Discard</button></div></div>';
      }).join("");
    }
    html += "</section>";

    /* --- transfer history --- */
    html += '<section class="card"><div class="card-head"><h2>Transfer history</h2></div>';
    if (!sent.length) {
      html += '<div class="empty-state small"><div class="icon">⇄</div><h3>No transfers yet</h3><p>Your delivered welfare reports will appear here with the method used.</p></div>';
    } else {
      html += sent.slice(0, 8).map(function (h) {
        return '<div class="ox-history-row"><span class="ox-history-ic">' + (h.status === "pending" ? "⏳" : "✓") + "</span>" +
          '<div class="grow"><div>Sent to ' + esc(h.recipient_role === "supervisor" ? "Supervisor" : "Medic Officer") + "</div>" +
          '<div class="meta">Method: ' + esc(METHOD_LABEL[h.transfer_method] || h.transfer_method) + " · " + esc(timeAgo(h.created_at)) + "</div></div>" +
          statusBadge(h.status) + "</div>";
      }).join("");
    }
    html += "</section>";

    /* --- how this works --- */
    html += howItWorksCard();

    body.innerHTML = html;

    document.getElementById("ox-gen-medic")?.addEventListener("click", function () { startTransfer("medic"); });
    document.getElementById("ox-gen-supervisor")?.addEventListener("click", function () { startTransfer("supervisor"); });
    body.querySelectorAll(".ox-pending [data-act]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const id = btn.closest(".ox-pending").dataset.id;
        const row = pending.find(function (p) { return p.id === id; });
        if (btn.dataset.act === "discard") {
          await V.Offline.removePending(id);
          toast("Removed from the pending queue. The report itself stays in your history.", "info");
        } else {
          await retryTransfer(row);
        }
        load(el);
      });
    });
  }

  function statusBadge(status) {
    return '<span class="status-badge tone-' + (STATUS_TONE[status] || "muted") + '">' + (STATUS_LABEL[status] || status) + "</span>";
  }

  /* --- transfer wizard --- */

  async function startTransfer(recipientRole) {
    const user = V.STORE.getState().user;
    toast("Building your authorized report…", "info");
    const report = await V.UI.safe(function () { return V.Offline.generateReport(user, recipientRole); });
    if (!report) return;

    const recipientsRes = await V.UI.safe(function () { return V.API.endpoints.transferRecipients(); });
    const recipients = (recipientsRes && recipientsRes.recipients) || [];
    const options = recipients.filter(function (r) { return r.role === recipientRole; });
    const roleLabel = recipientRole === "medic" ? "Medic Officer" : "Supervisor";

    const m = openModal({
      title: "Transfer Welfare Report",
      size: "lg",
      body:
        '<div class="ox-transfer-recipient"><div class="field"><label>Recipient — ' + roleLabel + '</label>' +
        (options.length
          ? '<select id="ox-recipient">' + options.map(function (r) {
              return '<option value="' + esc(r.id) + '">' + esc(r.name) + "</option>";
            }).join("") + "</select>"
          : '<p class="muted">No ' + roleLabel.toLowerCase() + " is available on the server right now. You can still generate and store the report — it will wait in Pending transfers.</p>") +
        "</div></div>" +
        '<div class="ox-share-pick"><div class="eyebrow">Data being shared</div>' +
        report.shared.map(function (s) { return '<div class="ox-share-yes">✓ ' + esc(s) + "</div>"; }).join("") +
        '<div class="eyebrow mt-2">Not shared</div>' +
        report.not_shared.map(function (s) { return '<div class="ox-share-no">✕ ' + esc(s) + "</div>"; }).join("") +
        "</div>" +
        '<div class="field mt-2"><label>Transfer method</label><select id="ox-method">' +
        '<option value="local_wifi">Local Wi-Fi relay — works without internet, both devices on the same network</option>' +
        '<option value="webrtc">Direct device link (WebRTC) — needs an out-of-band connection hand-off</option>' +
        '<option value="demo_simulated">Simulated transfer (demo) — one device, clearly labelled</option>' +
        "</select></div>" +
        '<div class="hint" id="ox-method-note"></div>' +
        '<div class="ox-summary mt-2"><div class="eyebrow">Report summary</div>' +
        '<div class="meta">Recovery: ' + esc(report.payload.recovery_score != null ? report.payload.recovery_score : "—") +
        " · Risk level: " + esc(report.payload.risk_level || report.payload.recovery_band || "—") +
        " · Source: " + esc(report.payload.source || "simulated") + " data</div></div>",
      footer:
        '<button class="btn ghost" data-act="cancel">Cancel</button>' +
        '<button class="btn primary" data-act="go">Confirm transfer</button>',
    });
    const methodSel = m.el.querySelector("#ox-method");
    const noteEl = m.el.querySelector("#ox-method-note");
    const paintNote = function () {
      const t = V.CommunicationService.get(methodSel.value);
      noteEl.textContent = t ? t.note : "";
    };
    paintNote();
    methodSel.addEventListener("change", paintNote);

    m.el.querySelector('[data-act="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-act="go"]').addEventListener("click", async function () {
      const recipientId = (m.el.querySelector("#ox-recipient") || {}).value || "";
      const methodId = methodSel.value;
      const transport = V.CommunicationService.get(methodId);
      if (!transport) return;
      if (transport.needsRecipientChoice && !recipientId) {
        toast("No recipient is available to receive this report right now. It will be kept in Pending transfers.", "warning");
        await V.Offline.queueTransfer({
          report_id: report.id, recipient_id: "", recipient_name: roleLabel,
          recipient_role: recipientRole, method: methodId, state: "pending",
          report_summary: { personnel_id: report.payload.personnel_id, recovery_score: report.payload.recovery_score, risk_level: report.payload.risk_level || report.payload.recovery_band || "" },
          payload_hash: report.payload_hash,
        });
        m.close();
        load(document.getElementById("page-content"));
        return;
      }
      m.close();
      await runTransfer(report, transport, recipientId, recipientRole);
    });
  }

  async function runTransfer(report, transport, recipientId, recipientRole) {
    if (transport.simulated) return runSimulated(report);
    if (transport.id === "webrtc") return runWebRTC(report, recipientRole);

    // Local Wi-Fi relay: create the session, then wait for the recipient to
    // join on their device — only then does the sealed report move.
    let session;
    try {
      session = await transport.sender(recipientId);
    } catch (err) {
      await parkPending(report, transport.id, recipientId, recipientRole, err.message);
      load(document.getElementById("page-content"));
      return;
    }
    await waitAndSend(report, transport, session, recipientId, recipientRole);
  }

  /* Shared wait-for-join choreography: shows the pairing code, polls until
   * the recipient joins (identity verified on both screens), then sends.
   * onSent lets the retry path clean up its pending row after delivery. */
  async function waitAndSend(report, transport, session, recipientId, recipientRole, onSent) {
    const m = openModal({
      title: "Waiting for the recipient to join",
      size: "md",
      body:
        '<div class="ox-pair"><div class="eyebrow">Read this code to them</div><div class="ox-code">' + esc(session.code) + "</div></div>" +
        '<div class="ox-pair"><div class="eyebrow">They enter it on their device</div>' +
        '<div class="hint">The report moves only after they join and you can see their name verified here. Keep this open until it sends.</div></div>' +
        '<div class="ox-pair" id="ox-wait-status"><div class="meta">Waiting for ' + esc(session.recipient_name || "the recipient") + " to join…</div></div>",
      footer: '<button class="btn ghost" data-act="cancel">Close — keep in Pending</button>',
    });
    let sent = false;
    let parked = false;
    const parkOnce = async function (reason) {
      if (parked || sent) return;
      parked = true;
      await parkPending(report, transport.id, recipientId, recipientRole, reason || "Waiting for the recipient to join the transfer session");
      load(document.getElementById("page-content"));
    };
    m.el.querySelector('[data-act="cancel"]').addEventListener("click", async function () { clearInterval(timer); await parkOnce(); m.close(); });
    const statusEl = m.el.querySelector("#ox-wait-status");
    const timer = setInterval(async function () {
      if (!document.body.contains(statusEl)) { clearInterval(timer); await parkOnce(); return; }
      try {
        const st = await transport.status(session.id);
        if (st.status === "active") {
          clearInterval(timer);
          statusEl.innerHTML = '<div class="meta">Verified: <strong>' + esc(st.recipient_name) + '</strong> — sending the sealed report…</div>';
          try {
            await transport.send(report, session);
            sent = true;
            await V.Offline.DB.put("welfare_reports", Object.assign(report, { transferred: true, transferred_at: new Date().toISOString(), method: transport.id }));
            await V.Offline.enqueueSync("welfare_report_transferred", {
              envelope_id: session.id, method: "local_relay", recipient_role: recipientRole,
              payload_hash: report.payload_hash, transferred_at: new Date().toISOString(),
            });
            if (onSent) await onSent();
            statusEl.innerHTML = '<div class="ox-share-yes">✓ Delivered to ' + esc(st.recipient_name) + " over the local relay. They'll review it in their inbox.</div>";
            toast("Report delivered over the local relay.");
            setTimeout(function () { if (document.body.contains(m.el)) m.close(); }, 1800);
          } catch (sendErr) {
            await parkOnce(String(sendErr.message || sendErr).slice(0, 200));
            m.close();
          }
        }
      } catch (pollErr) {
        clearInterval(timer);
        await parkOnce(String(pollErr.message || pollErr).slice(0, 200));
        m.close();
      }
    }, 1500);
  }

  async function parkPending(report, method, recipientId, recipientRole, errorMessage) {
    const user = V.STORE.getState().user;
    let recipientName = recipientRole === "medic" ? "Medic Officer" : "Supervisor";
    try {
      const recs = await V.API.endpoints.transferRecipients();
      const hit = (recs.recipients || []).find(function (r) { return r.id === recipientId; });
      if (hit) recipientName = hit.name;
    } catch (e) { /* offline — generic label fine */ }
    await V.Offline.queueTransfer({
      report_id: report.id, recipient_id: recipientId, recipient_name: recipientName,
      recipient_role: recipientRole, method: method, state: "pending",
      report_summary: { personnel_id: report.payload.personnel_id, recovery_score: report.payload.recovery_score, risk_level: report.payload.risk_level || report.payload.recovery_band || "" },
      payload_hash: report.payload_hash,
      last_error: String(errorMessage || "").slice(0, 200),
    });
    toast("No communication channel available — the report waits securely in Pending transfers. Nothing is deleted.", "warning");
  }

  async function retryTransfer(row) {
    const user = V.STORE.getState().user;
    const report = await V.Offline.DB.get("welfare_reports", row.report_id);
    if (!report) { toast("The stored report for this transfer is missing on this device.", "warning"); return; }
    const transport = V.CommunicationService.get(row.method);
    if (!transport) { toast("That transfer method isn't available on this device.", "warning"); return; }
    if (transport.simulated) {
      const session = await transport.sender();
      await transport.send(report, session);
      await V.Offline.updatePending(Object.assign(row, { state: "sent", sent_at: new Date().toISOString() }));
      toast("Simulated transfer delivered (labelled as demo).");
      return;
    }
    try {
      if (transport.id === "local_wifi") {
        const session = await transport.sender(row.recipient_id);
        await waitAndSend(report, transport, session, row.recipient_id, row.recipient_role,
          async function () { await V.Offline.removePending(row.id); });
      } else {
        toast("Direct device link transfers need both devices present — starting the pairing screen.", "info");
        runWebRTC(report, row.recipient_role);
      }
    } catch (err) {
      await V.Offline.updatePending(Object.assign(row, { attempts: (row.attempts || 0) + 1, last_error: String(err.message || err).slice(0, 200) }));
      toast("Still no channel — the report keeps waiting. (" + String(err.message || err).slice(0, 80) + ")", "warning");
    }
  }

  /* --- simulated one-device demo --- */

  async function runSimulated(report) {
    const transport = V.CommunicationService.get("demo_simulated");
    const session = await transport.sender();
    await transport.send(report, session);
    await V.Offline.DB.put("welfare_reports", Object.assign(report, { transferred: true, transferred_at: new Date().toISOString(), method: "simulated" }));
    const m = openModal({
      title: "Simulated transfer complete",
      body:
        '<div class="ox-sim-banner">SIMULATED — DEMO ONLY</div>' +
        "<p>The full hand-off ran on this device: the report was sealed with the real AES-GCM protocol, moved through the demo inbox, and can now be opened on the receiving side.</p>" +
        '<p class="muted">In the field this step happens over the Local Wi-Fi relay or a direct device link. No real device-to-device hop occurred in this demonstration.</p>' +
        '<div class="hint">Pairing code (as the medic would see it): <strong>' + esc(session.code) + "</strong></div>",
      footer: '<button class="btn primary" data-act="ok">Done</button>',
    });
    m.el.querySelector('[data-act="ok"]').addEventListener("click", m.close);
    toast("Simulated transfer delivered — switch to the Medic view to open it.");
    load(document.getElementById("page-content"));
  }

  /* --- WebRTC direct path (manual pairing) --- */

  async function runWebRTC(report, recipientRole) {
    const T = V.CommunicationService.get("webrtc");
    const m = openModal({
      title: "Direct device link (WebRTC)",
      size: "lg",
      body:
        '<p class="muted">Both devices must be on the same network. You exchange connection codes with the recipient over any trusted channel (chat, radio, in person) — this is the signaling step, and it is honest about needing it.</p>' +
        '<div class="field"><label>1 · Your connection offer — send this to the recipient</label>' +
        '<textarea id="ox-webrtc-offer" rows="4" readonly></textarea></div>' +
        '<div class="field"><label>2 · Paste the recipient&#39;s answer</label>' +
        '<textarea id="ox-webrtc-answer" rows="4" placeholder="Paste the answer code here…"></textarea></div>' +
        '<div class="row gap-2 mt-2"><button class="btn primary" id="ox-webrtc-connect">Connect &amp; transfer</button></div>' +
        '<div id="ox-webrtc-status" class="hint mt-2"></div>',
      footer: '<button class="btn ghost" data-act="cancel">Cancel</button>',
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener("click", function () { T.close(); m.close(); });
    const offerEl = m.el.querySelector("#ox-webrtc-offer");
    const statusEl = m.el.querySelector("#ox-webrtc-status");
    try {
      const offer = await T.sender();
      offerEl.value = offer.localDescription;
    } catch (err) {
      statusEl.textContent = "This browser couldn't open a direct link: " + err.message;
      return;
    }
    m.el.querySelector("#ox-webrtc-connect").addEventListener("click", async function () {
      const answerJson = m.el.querySelector("#ox-webrtc-answer").value.trim();
      if (!answerJson) { toast("Paste the recipient's answer first.", "warning"); return; }
      statusEl.textContent = "Opening direct link…";
      try {
        await T.acceptAnswer(answerJson);
        await T.waitForData();
        await T.sendData(report);
        await V.Offline.DB.put("welfare_reports", Object.assign(report, { transferred: true, transferred_at: new Date().toISOString(), method: "webrtc" }));
        await V.API.endpoints.transferReportRegister({
          payload_hash: report.payload_hash, transfer_method: "webrtc", delivered: true, recipient_role: recipientRole,
          report_summary: { personnel_id: report.payload.personnel_id, recovery_score: report.payload.recovery_score },
        });
        statusEl.textContent = "Delivered over the direct link. The recipient should confirm receipt on their device.";
        toast("Report delivered over the direct device link.");
        setTimeout(function () { T.close(); m.close(); }, 1200);
        load(document.getElementById("page-content"));
      } catch (err) {
        statusEl.textContent = err.message;
        await parkPending(report, "webrtc", "", recipientRole, err.message);
      }
    });
  }

  /* ================= medic / supervisor view ================= */

  async function loadRecipient(el) {
    const body = document.getElementById("ox-body");
    if (!body) return;
    const [inboxRes, historyRes] = await Promise.all([
      V.UI.safe(function () { return V.API.endpoints.medicInbox(); }),
      V.UI.safe(function () { return V.API.endpoints.transferHistory(); }),
    ]);
    if (!body) return;
    let inbox = (inboxRes && inboxRes.inbox) || [];
    // One-device demo: merge the clearly-labelled simulated inbox so the
    // receiving side of the demo works in a single browser too.
    try {
      const raw = localStorage.getItem("vigil-demo-inbox");
      const sim = raw ? JSON.parse(raw) : [];
      sim.forEach(function (e) {
        if (inbox.some(function (x) { return x.id === e.id; })) return;
        inbox.push(Object.assign({}, e, { status: e.reviewed ? "reviewed" : "delivered" }));
      });
      inbox.sort(function (a, b) {
        return (a.delivered_at || a.created_at) < (b.delivered_at || b.created_at) ? 1 : -1;
      });
    } catch (e) { /* demo inbox unreadable */ }
    const received = ((historyRes && historyRes.history) || []).filter(function (h) { return h.direction === "received"; });

    let html = '<section class="card"><div class="card-head"><h2>Join a transfer session</h2></div>' +
      '<p class="muted">When a team member transfers their welfare report, they&#39;ll read you a 6-character pairing code. Verify their name on the confirmation screen before accepting.</p>' +
      '<div class="row gap-2 mt-2"><input id="ox-join-code" maxlength="6" placeholder="Pairing code" style="text-transform:uppercase; max-width:180px">' +
      '<button class="btn primary" id="ox-join">Join session</button></div>' +
      '<div id="ox-join-status" class="hint mt-2"></div></section>';

    html += '<section class="card"><div class="card-head"><h2>Welfare inbox</h2>' + (inbox.length ? '<span class="chip">' + inbox.length + "</span>" : "") + "</div>";
    if (!inbox.length) {
      html += '<div class="empty-state small"><div class="icon">📥</div><h3>No welfare reports yet</h3><p>Reports your team transfers to you appear here — only what they chose to share.</p></div>';
    } else {
      html += inbox.map(function (env) {
        return inboxRow(env);
      }).join("");
    }
    html += "</section>";

    html += '<section class="card"><div class="card-head"><h2>Received transfers</h2></div>';
    if (!received.length) {
      html += '<p class="muted">Nothing received yet.</p>';
    } else {
      html += received.slice(0, 8).map(function (h) {
        return '<div class="ox-history-row"><span class="ox-history-ic">✓</span>' +
          '<div class="grow"><div>From ' + esc(h.report_summary && h.report_summary.personnel_id ? h.report_summary.personnel_id : "a team member") + "</div>" +
          '<div class="meta">Method: ' + esc(METHOD_LABEL[h.transfer_method] || h.transfer_method) + " · " + esc(timeAgo(h.created_at)) + "</div></div>" +
          statusBadge(h.status) + "</div>";
      }).join("");
    }
    html += "</section>";

    body.innerHTML = html;

    document.getElementById("ox-join").addEventListener("click", async function () {
      const code = document.getElementById("ox-join-code").value.trim().toUpperCase();
      const statusEl = document.getElementById("ox-join-status");
      if (!code) { toast("Enter the 6-character pairing code.", "warning"); return; }
      const T = V.CommunicationService.get("local_wifi");
      try {
        const session = await T.join(code);
        statusEl.innerHTML = 'Connected to <strong>' + esc(session.personnel_name) + '</strong>. Pull their report when ready.';
        const pullBtn = document.createElement("button");
        pullBtn.className = "btn primary mt-2";
        pullBtn.textContent = "Pull report now";
        statusEl.appendChild(document.createElement("br"));
        statusEl.appendChild(pullBtn);
        pullBtn.addEventListener("click", async function () {
          const envs = await T.pull(session.id, session.code);
          if (!envs.length) { toast("No report has been sent in this session yet.", "warning"); return; }
          await receiveEnvelopes(envs, session);
          load(el);
        });
      } catch (err) {
        statusEl.textContent = err.message;
      }
    });

    body.querySelectorAll("[data-open-env]").forEach(function (btn) {
      btn.addEventListener("click", function () { openEnvelope(btn.dataset.openEnv, load.bind(null, el)); });
    });
  }

  function inboxRow(env) {
    const s = env.report_summary || {};
    return '<div class="ox-inbox-row">' +
      '<div class="grow"><div><strong>Welfare report</strong>' +
      (s.personnel_id ? ' · <span class="meta">' + esc(s.personnel_id) + "</span>" : "") + "</div>" +
      '<div class="meta">Recovery: ' + esc(s.recovery_score != null ? s.recovery_score : "—") +
      " · Risk: " + esc(s.risk_level || "—") + " · " + esc(METHOD_LABEL[env.transfer_method] || env.transfer_method) + " · " + esc(timeAgo(env.delivered_at || env.created_at)) + "</div></div>" +
      statusBadge(env.status) +
      '<button class="btn small" data-open-env="' + esc(env.id) + '">Open</button></div>';
  }

  async function receiveEnvelopes(envs, session) {
    for (const env of envs) {
      if (!env.plaintext) continue;
      let payload = null;
      try { payload = JSON.parse(env.plaintext); } catch (e) { payload = null; }
      if (payload) {
        await V.Offline.DB.put("welfare_reports", {
          id: "rx_" + env.id, user_id: "received", recipient_role: payload.recipient_role || "medic",
          payload: payload, plaintext: env.plaintext, payload_hash: env.payload_hash,
          shared: [], not_shared: [], created_at: env.created_at, received: true,
        });
      }
    }
    toast("Report decrypted and stored on your device. It was delivered" + (session ? " from " + session.personnel_name : "") + ".");
  }

  async function openEnvelope(envelopeId, onDone) {
    // Find it in the inbox payload (cached from the last load).
    const inboxRes = await V.UI.safe(function () { return V.API.endpoints.medicInbox(); });
    let env = ((inboxRes && inboxRes.inbox) || []).find(function (e) { return e.id === envelopeId; });
    if (!env) {
      // Demo-only simulated envelopes live in the one-device demo inbox.
      try {
        const raw = localStorage.getItem("vigil-demo-inbox");
        env = (raw ? JSON.parse(raw) : []).find(function (e) { return e.id === envelopeId; });
        if (env) env._demo = true;
      } catch (e) { env = null; }
    }
    if (!env) { toast("That report is no longer in your inbox.", "warning"); return; }

    // Local received copy (decrypted at pull time)?
    const local = await V.Offline.DB.get("welfare_reports", "rx_" + envelopeId);
    let payload = local && local.payload ? local.payload : null;
    let isSummaryOnly = !local;
    if (!payload && env._demo && env.plaintext) {
      try { payload = JSON.parse(env.plaintext); isSummaryOnly = false; } catch (e) { payload = null; }
    }
    payload = payload || env.report_summary || {};

    const m = openModal({
      title: "Authorized Welfare Report",
      size: "lg",
      body:
        (isSummaryOnly ? '<div class="ox-sim-banner subtle">Opened from the transfer record — the full decrypted report is stored on the device that pulled it.</div>' : "") +
        '<div class="ox-report">' + reportPayloadHtml(payload, isSummaryOnly) + "</div>" +
        '<div class="field mt-2"><label>Review note (kept with the record)</label>' +
        '<textarea id="ox-review-note" rows="2" maxlength="500" placeholder="e.g. followed up same day; suggested rest prioritization…"></textarea></div>' +
        '<p class="privacy-note">🔒 You see only what this report contains. Chat histories, incidents and personal records are never included in welfare transfers.</p>',
      footer:
        '<button class="btn ghost" data-act="close">Close</button>' +
        (env.status !== "reviewed" ? '<button class="btn primary" data-act="review">Mark reviewed</button>' : ""),
    });
    m.el.querySelector('[data-act="close"]').addEventListener("click", m.close);
    const reviewBtn = m.el.querySelector('[data-act="review"]');
    if (reviewBtn) {
      reviewBtn.addEventListener("click", async function () {
        const note = m.el.querySelector("#ox-review-note").value.trim();
        if (env._demo) {
          await V.CommunicationService.get("demo_simulated").ack(envelopeId);
        } else {
          await V.UI.safe(function () { return V.CommunicationService.get("local_wifi").ack(envelopeId, note); });
        }
        m.close();
        toast("Marked as reviewed — the sender's history updates too.");
        if (onDone) onDone();
      });
    }
  }

  function reportPayloadHtml(p, summaryOnly) {
    if (summaryOnly) {
      return '<div class="ox-kv"><div class="ox-k">Personnel</div><div class="ox-v">' + esc(p.personnel_id || "—") + "</div></div>" +
        '<div class="ox-kv"><div class="ox-k">Recovery</div><div class="ox-v">' + esc(p.recovery_score != null ? p.recovery_score : "—") + "</div></div>" +
        '<div class="ox-kv"><div class="ox-k">Risk level</div><div class="ox-v">' + esc(p.risk_level || "—") + "</div></div>";
    }
    const factors = p.recovery_factors || {};
    const fmt = function (key) { return factors[key] != null ? factors[key] : "—"; };
    return '<div class="ox-kv"><div class="ox-k">Personnel</div><div class="ox-v">' + esc(p.personnel_name || p.personnel_id || "—") + "</div></div>" +
      '<div class="ox-kv"><div class="ox-k">Recovery Score</div><div class="ox-v">' + esc(p.recovery_score != null ? p.recovery_score : "—") + " / 100</div></div>" +
      '<div class="ox-kv"><div class="ox-k">Risk level</div><div class="ox-v">' + esc(p.risk_level || "—") + "</div></div>" +
      '<div class="ox-kv"><div class="ox-k">Heart rate trend</div><div class="ox-v">' + esc(p.heart_rate_trend || "—") + "</div></div>" +
      '<div class="ox-kv"><div class="ox-k">HRV trend</div><div class="ox-v">' + esc(p.hrv_trend || "—") + "</div></div>" +
      '<div class="ox-kv"><div class="ox-k">Sleep summary</div><div class="ox-v">' + esc(p.sleep_summary && p.sleep_summary.avg_hours ? p.sleep_summary.avg_hours + "h avg" : "—") + "</div></div>" +
      '<div class="ox-kv"><div class="ox-k">Duty load</div><div class="ox-v">' + esc(p.duty_summary ? p.duty_summary.week_hours + "h this week · " + p.duty_summary.open_tasks + " open tasks" : "—") + "</div></div>" +
      '<div class="ox-kv"><div class="ox-k">Contributing factors</div><div class="ox-v">' + esc(p.contributing_factors || "—") + "</div></div>" +
      '<div class="ox-kv"><div class="ox-k">Recommended action</div><div class="ox-v">' + esc(p.recommended_action || "—") + "</div></div>" +
      '<div class="ox-kv"><div class="ox-k">Generated</div><div class="ox-v">' + esc(p.generated_at || "—") + " · " + esc(p.source || "") + " data</div></div>" +
      '<details class="why-details mt-2"><summary>Why am I seeing this?</summary>' +
      '<p class="muted">This report was generated on ' + esc(p.personnel_name || "the member") + '&#39;s device and contains only the fields they authorized for a ' + esc(p.recipient_role || "medic") + ". The data is simulated for the demo.</p></details>";
  }

  /* ================= admin view ================= */

  async function loadAdmin(el) {
    const body = document.getElementById("ox-body");
    if (!body) return;
    body.innerHTML =
      '<section class="card"><div class="card-head"><h2>Transfer system status</h2></div>' +
      '<p class="muted">Administrators audit transfers — they never receive welfare reports. Transfer events appear in the audit log (Admin Panel → Audit activity).</p>' +
      '<div class="mt-2">' + howItWorksCard() + "</div></section>";
  }

  /* ================= shared explainer ================= */

  function howItWorksCard() {
    return '<section class="card"><div class="card-head"><h2>How offline transfer works</h2></div>' +
      '<div class="ox-flow">' +
      flowStep("1", "Collected on this device", "Wellness and duty data is cached in this device's secure local database — losing internet never loses your records.") +
      flowStep("2", "Authorized report generated", "Before any transfer, VIGIL reduces your data to exactly what the recipient's role is allowed to see.") +
      flowStep("3", "Channel chosen", "Local Wi-Fi relay (no internet needed) or a direct device link. If no channel exists, the report waits — it is never deleted.") +
      flowStep("4", "Recipient verifies & accepts", "They confirm your identity with the pairing code before anything moves.") +
      flowStep("5", "Sync when internet returns", "Everything queued offline syncs to the central database — once, with no duplicates.") +
      "</div>" +
      '<p class="privacy-note">🔒 Transfers are end-to-end sealed (AES-GCM-256). The relay stores ciphertext only. Every transfer event is audit-logged.</p>' +
      "</section>";
  }
  function flowStep(n, title, text) {
    return '<div class="ox-flow-step"><div class="ox-flow-n">' + n + '</div><div><div class="ox-flow-t">' + esc(title) + '</div><div class="meta">' + esc(text) + "</div></div></div>";
  }

  /* ================= demo script (labeled) ================= */

  V.OfflineDemo = {
    /** One-device walkthrough used by the Admin demo guide and judges. */
    steps: function () {
      return [
        "1 · Toggle “Simulate offline” (below) — VIGIL switches to local mode; the status strip shows OFFLINE (simulated).",
        "2 · Open Wellness or Recovery — your data still renders from the device's local cache.",
        "3 · Generate the Authorized Welfare Report — built locally; only authorized fields included.",
        "4 · Choose “Simulated transfer (demo)” — the report is sealed and delivered to the demo inbox (labelled SIMULATED).",
        "5 · Sign in as Dr. Meera Rao (medic@vigil.demo) in a second tab — the report is in her Welfare inbox; open, review, add a note.",
        "6 · Turn off the simulation — the queued records sync to the central database automatically; the status strip shows SYNCED.",
        "7 · Show Admin → Audit activity — transfer.session_created, transfer.report_sent, transfer.report_received, transfer.report_reviewed, offline.sync are all logged.",
      ];
    },
    /** Toggle the offline simulation from anywhere (admin guide / keyboard). */
    toggleSimulation: function () { V.Offline.setSimulateOffline(!V.Offline.getStatus().simulatedOffline); },
  };
})(window.VIGIL = window.VIGIL || {});
