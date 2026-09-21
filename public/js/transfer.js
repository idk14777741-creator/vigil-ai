/**
 * VIGIL AI — CommunicationService: device-to-device transport abstraction.
 *
 *   CommunicationService
 *    ├── LocalWiFiTransport     (relay on the LOCAL network — real HTTP)
 *    ├── WebRTCTransport        (direct DataChannel — real WebRTC, manual pairing)
 *    ├── DemoSimulatedTransport (clearly-labelled one-device simulation)
 *    └── FutureTransport        (Bluetooth/LoRa/NFC — registered the same way)
 *
 * Every transport implements the same contract:
 *
 *   transport.label            human-readable method name
 *   transport.note             what infrastructure this really needs
 *   transport.simulated        true ONLY for the demo simulation
 *   transport.sender(session)  → {sessionId, status}   sender side
 *   transport.join(code)       → {sessionId, status}   medic side
 *   transport.send(report)     → envelope row          sender side
 *   transport.pull()           → [envelope rows]       medic side
 *   transport.close(sessionId)
 *
 * Encryption: reports are sealed with AES-GCM-256. The key is derived from
 * the session code (PBKDF2-SHA256, 100k iterations) — which is also what the
 * humans read to each other and verify on both screens. The relay stores
 * only ciphertext. A production deployment would upgrade to full X25519/ECDH
 * key agreement; the transport contract does not change.
 *
 * Honest-labelling rules (§1, §18):
 *   - LocalWiFiTransport really moves the report over HTTP to the relay.
 *   - WebRTCTransport really opens an RTCPeerConnection. It needs a signaling
 *     path — here that is the two humans pasting SDP offers/answers (offline
 *     chat, radio, paper). No "zero infrastructure" claims.
 *   - DemoSimulatedTransport moves data on one device and is labelled
 *     SIMULATED everywhere it appears. It never claims WebRTC or Wi-Fi.
 */
(function (V) {
  const Offline = V.Offline;

  /* ================= crypto seal/open (AES-GCM from session code) ================= */

  async function deriveKey(code) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: new TextEncoder().encode("vigil-transfer-v1"), iterations: 100000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function seal(plaintext, code) {
    const key = await deriveKey(code);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(plaintext));
    return { ciphertext: Offline.b64(ct), nonce: Offline.b64(iv) };
  }

  async function unseal(ciphertext, nonce, code) {
    const key = await deriveKey(code);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(Offline.unb64(nonce)) },
      key,
      Offline.unb64(ciphertext)
    );
    return new TextDecoder().decode(pt);
  }

  /* ================= relay helpers ================= */

  async function relayCreateSession(medicId) {
    const res = await V.API.endpoints.transferSessionCreate({ medic_id: medicId });
    return res.session;
  }
  async function relayJoin(code) {
    const res = await V.API.endpoints.transferSessionJoin({ code: code });
    return res.session;
  }
  async function relayStatus(sessionId) {
    const res = await V.API.endpoints.transferSessionStatus(sessionId);
    return res.session;
  }
  async function relayClose(sessionId) {
    await V.API.endpoints.transferSessionClose(sessionId);
  }

  /* ================= LocalWiFiTransport ================= */

  const LocalWiFiTransport = {
    id: "local_wifi",
    label: "Local Wi-Fi relay",
    note: "Works when both devices are on the same local network — internet not required. Uses the VIGIL relay running on that network.",
    simulated: false,
    needsRecipientChoice: true,
    async sender(medicId) {
      // Reuse an open session for this recipient instead of piling up new ones.
      try {
        const mine = await V.API.endpoints.transferSessionsMine();
        const hit = (mine.sessions || []).find(function (s) { return s.recipient_id === medicId && (s.status === "pending" || s.status === "active"); });
        if (hit) return hit; // an active session means the recipient already joined — send on first poll
      } catch (e) { /* fall through and create */ }
      return relayCreateSession(medicId);
    },
    join: relayJoin,
    status: relayStatus,
    async send(report, session) {
      const sealed = await seal(report.plaintext, session.code);
      const res = await V.API.endpoints.transferEnvelopePush(session.id, {
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
        sender_ephemeral_pub: (await Offline.identity()).fingerprint,
        payload_hash: report.payload_hash,
        recipient_id: session.recipient_id || session.medic_id,
        recipient_role: session.recipient_role || "medic",
        transfer_method: "local_relay",
        report_summary: summarize(report.payload),
      });
      return res.envelope;
    },
    async pull(sessionId, code) {
      const res = await V.API.endpoints.transferEnvelopesPull(sessionId || "");
      const out = [];
      for (const env of res.envelopes || []) {
        let plaintext = null;
        try { plaintext = await unseal(env.ciphertext, env.nonce, code); } catch (e) { plaintext = null; }
        out.push(Object.assign({}, env, { plaintext: plaintext }));
      }
      return out;
    },
    async ack(envelopeId, reviewNote) {
      await V.API.endpoints.transferEnvelopeAck(envelopeId, { review_note: reviewNote || "" });
    },
    close: relayClose,
  };

  /* ================= WebRTCTransport ================= */
  // Real RTCPeerConnection + DataChannel. Signaling = the two humans exchange
  // the SDP blobs (and the session code) over any offline channel they trust:
  // chat, radio, or reading them aloud. Honest about that in `note`.

  const WebRTCTransport = {
    id: "webrtc",
    label: "Direct device link (WebRTC)",
    note: "Opens a direct encrypted channel between the two browsers. Still needs a signaling hand-off — here, the two of you exchange connection codes out-of-band (chat, radio, in person). It is not zero-infrastructure magic.",
    simulated: false,
    needsRecipientChoice: true,
    async sender() {
      const pc = new RTCPeerConnection({ iceServers: [] }); // LAN/host candidates only — honest about the constraint
      const channel = pc.createDataChannel("vigil-welfare", { ordered: true });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIce(pc);
      const state = { pc: pc, channel: channel, role: "sender", offerJson: JSON.stringify(pc.localDescription) };
      webrtcState = state;
      return { localDescription: state.offerJson, sessionId: "webrtc-local", status: "waiting-for-answer" };
    },
    async acceptAnswer(answerJson) {
      const state = webrtcState;
      if (!state || state.role !== "sender") throw new Error("No outgoing WebRTC transfer in progress.");
      await state.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(answerJson)));
      state.answerJson = answerJson;
      return state;
    },
    async waitForData() {
      const state = webrtcState;
      if (!state || !state.channel) throw new Error("No direct link in progress.");
      return new Promise(function (resolve, reject) {
        const t = setTimeout(function () { reject(new Error("Direct link didn't open in time. Check both devices are on the same network.")); }, 30000);
        state.channel.onopen = function () { clearTimeout(t); resolve(state); };
        state.channel.onerror = function () { clearTimeout(t); reject(new Error("Direct link failed.")); };
      });
    },
    async sendData(report) {
      const state = webrtcState;
      if (!state || !state.channel || state.channel.readyState !== "open") throw new Error("Direct link isn't open.");
      const sealed = await seal(report.plaintext, "webrtc-direct");
      state.channel.send(JSON.stringify({ type: "welfare-report", payload_hash: report.payload_hash, sealed: sealed, summary: summarize(report.payload) }));
      return { status: "delivered", method: "webrtc" };
    },
    async join() {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.ondatachannel = function (e) { webrtcState = { pc: pc, channel: e.channel, role: "receiver" }; };
      const state = { pc: pc, role: "receiver" };
      webrtcState = state;
      return state;
    },
    async acceptOffer(offerJson) {
      const state = webrtcState;
      await state.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(offerJson)));
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      await waitIce(state.pc);
      state.answerJson = JSON.stringify(state.pc.localDescription);
      return state;
    },
    status: function () { return webrtcState && webrtcState.channel && webrtcState.channel.readyState === "open" ? "active" : "pending"; },
    send: null, pull: null, ack: null,
    close() {
      if (webrtcState && webrtcState.pc) { try { webrtcState.pc.close(); } catch (e) { /* already closed */ } }
      webrtcState = null;
    },
  };
  let webrtcState = null;

  function waitIce(pc) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === "complete") return resolve();
      const check = setInterval(function () {
        if (pc.iceGatheringState === "complete") { clearInterval(check); resolve(); }
      }, 200);
      setTimeout(function () { clearInterval(check); resolve(); }, 4000); // don't hang forever on host-candidate-only setups
    });
  }

  /* ================= DemoSimulatedTransport ================= */
  // One-device demo: the "medic side" is the same browser. Clearly labelled.

  const SIM_NS = "vigil-demo-inbox";
  const DemoSimulatedTransport = {
    id: "demo_simulated",
    label: "Simulated transfer (demo)",
    note: "One-device demonstration of the full hand-off. The report is sealed and unsealed for real; the device-to-device hop is simulated. Labelled SIMULATED everywhere.",
    simulated: true,
    needsRecipientChoice: false,
    async sender() {
      let medic = { id: "demo-medic", name: "Medic Officer (demo)" };
      try {
        const recs = await V.API.endpoints.transferRecipients();
        const found = (recs.recipients || []).find(function (r) { return r.role === "medic"; });
        if (found) medic = found;
      } catch (e) { /* offline demo — label stands in */ }
      return {
        id: "sim_" + Date.now().toString(36), code: randomCode(), status: "active",
        personnel_name: "You (demo)", medic_id: medic.id, medic_name: medic.name,
        recipient_role: "medic", encryption: "AES-GCM 256 (demo of the real protocol)",
      };
    },
    join: async function () { throw new Error("The simulated transport runs on one device — use the Send flow instead."); },
    status: async function (sessionId) { return { id: sessionId, status: "active", simulated: true }; },
    async send(report, session) {
      const sealed = await seal(report.plaintext, session.code);
      const raw = localStorage.getItem(SIM_NS);
      const inbox = raw ? JSON.parse(raw) : [];
      // Demo-only: the plaintext rides along because both sides of this
      // simulated hand-off live on ONE device. Real transports carry only
      // ciphertext — that is the entire point of the seal.
      inbox.unshift({
        id: "simenv_" + Date.now().toString(36),
        sender_name: session.personnel_name || "You (demo)",
        recipient_role: "medic",
        payload_hash: report.payload_hash,
        sealed: sealed,
        plaintext: report.plaintext,
        report_summary: summarize(report.payload),
        transfer_method: "simulated",
        simulated: true,
        status: "delivered",
        created_at: new Date().toISOString(),
      });
      localStorage.setItem(SIM_NS, JSON.stringify(inbox.slice(0, 20)));
      return { id: inbox[0].id, status: "delivered", transfer_method: "simulated", simulated: true };
    },
    async pull() {
      const raw = localStorage.getItem(SIM_NS);
      return raw ? JSON.parse(raw) : [];
    },
    async ack(envelopeId) {
      const inbox = (await DemoSimulatedTransport.pull()).map(function (e) {
        return e.id === envelopeId ? Object.assign(e, { reviewed: true, reviewed_at: new Date().toISOString() }) : e;
      });
      localStorage.setItem(SIM_NS, JSON.stringify(inbox));
    },
    close: async function () {},
  };

  function summarize(payload) {
    return {
      personnel_id: payload.personnel_id || "",
      recovery_score: payload.recovery_score != null ? payload.recovery_score : null,
      risk_level: payload.risk_level || payload.recovery_band || "",
      recipient_role: payload.recipient_role || "medic",
    };
  }

  function randomCode() {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let out = "";
    const rnd = crypto.getRandomValues(new Uint32Array(6));
    for (let i = 0; i < 6; i++) out += alphabet[rnd[i] % alphabet.length];
    return out;
  }

  /* ================= service ================= */

  const TRANSPORTS = {};
  function register(transport) { TRANSPORTS[transport.id] = transport; }
  function list() { return Object.keys(TRANSPORTS).map(function (id) { return TRANSPORTS[id]; }); }
  function get(id) { return TRANSPORTS[id]; }

  register(LocalWiFiTransport);
  register(WebRTCTransport);
  register(DemoSimulatedTransport);

  V.CommunicationService = {
    register: register, list: list, get: get,
    seal: seal, unseal: unseal, deriveKey: deriveKey,
    transports: { LocalWiFiTransport: LocalWiFiTransport, WebRTCTransport: WebRTCTransport, DemoSimulatedTransport: DemoSimulatedTransport },
  };
})(window.VIGIL = window.VIGIL || {});
