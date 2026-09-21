/**
 * VIGIL AI — Offline-first core (IndexedDB + device identity + sync queue).
 *
 * Responsibilities (kept separate per the offline architecture):
 *   - IndexedDB        → local data storage (NOT localStorage)
 *   - device identity  → ECDSA P-256 keypair generated on-device; the public
 *                        key fingerprint is what humans verify when pairing
 *   - sync queue       → pending offline records, drained idempotently
 *                        (client_ref dedupe) when internet returns
 *   - status engine    → ONLINE / OFFLINE / SYNCING / SYNCED states
 *
 * Stores:
 *   personnel_data    cached own profile (offline sign-in context)
 *   wellness_data     cached own wellness rows (offline dashboard)
 *   welfare_reports   generated Authorized Welfare Reports (plaintext, local)
 *   pending_transfers store-and-forward queue for welfare transfers
 *   sync_queue        records awaiting central sync
 *   kv                device keys, cursors, last sync time
 */
(function (V) {
  const DB_NAME = "vigil-offline";
  const DB_VERSION = 1;
  let dbPromise = null;
  const statusListeners = new Set();
  // §18: demo connectivity simulation is EXPLICIT and labelled — it never
  // fakes a successful transfer; it only gates network paths so the
  // store-and-forward behaviour can be demonstrated on one device.
  const SIM_KEY = "vigil-simulate-offline";
  let simulatedOffline = false;
  try { simulatedOffline = localStorage.getItem(SIM_KEY) === "1"; } catch (e) { /* private mode */ }
  let status = { net: navigator.onLine ? "online" : "offline", syncing: false, lastSync: null, pending: 0, transferAvailable: null, simulatedOffline: simulatedOffline };

  /* ---------------- IndexedDB ---------------- */

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains("personnel_data")) db.createObjectStore("personnel_data", { keyPath: "id" });
        if (!db.objectStoreNames.contains("wellness_data")) {
          const s = db.createObjectStore("wellness_data", { keyPath: "id" });
          s.createIndex("user_id", "user_id");
        }
        if (!db.objectStoreNames.contains("welfare_reports")) {
          const s = db.createObjectStore("welfare_reports", { keyPath: "id" });
          s.createIndex("user_id", "user_id");
        }
        if (!db.objectStoreNames.contains("pending_transfers")) db.createObjectStore("pending_transfers", { keyPath: "id" });
        if (!db.objectStoreNames.contains("sync_queue")) db.createObjectStore("sync_queue", { keyPath: "client_ref" });
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "k" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(store, mode);
        const out = fn(t.objectStore(store));
        t.oncomplete = function () { resolve(out && out.__value !== undefined ? out.__value : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  const DB = {
    put: function (store, value) { return tx(store, "readwrite", function (s) { s.put(value); }); },
    putAll: function (store, values) {
      return tx(store, "readwrite", function (s) { values.forEach(function (v) { s.put(v); }); });
    },
    all: function (store) { return tx(store, "readonly", function (s) { const p = reqToPromise(s.getAll()); return p; }); },
    get: function (store, key) { return tx(store, "readonly", function (s) { return reqToPromise(s.get(key)); }); },
    del: function (store, key) { return tx(store, "readwrite", function (s) { s.delete(key); }); },
    byIndex: function (store, index, value) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          const t = db.transaction(store, "readonly");
          const req = t.objectStore(store).index(index).getAll(value);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    kvGet: function (k) { return DB.get("kv", k).then(function (row) { return row ? row.v : undefined; }); },
    kvSet: function (k, v) { return DB.put("kv", { k: k, v: v }); },
  };

  /* ---------------- Device identity (ECDSA P-256) ---------------- */

  async function identity() {
    let id = await DB.kvGet("device-identity");
    if (id) return id;
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    // The private JWK is stored only in this device's IndexedDB (same-origin
    // sandbox). Production deployments can swap identity() for a
    // nonExtractable WebCrypto keypair (generateKey extractable:false) or a
    // device keystore — the transfer flow does not change.
    const fingerprint = await sha256Hex(JSON.stringify(pubJwk));
    id = { pub: pubJwk, priv: privJwk, fingerprint: fingerprint.slice(0, 16), created_at: new Date().toISOString() };
    await DB.kvSet("device-identity", id);
    return id;
  }

  async function signWithIdentity(text) {
    const id = await identity();
    const key = await crypto.subtle.importKey("jwk", id.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(text));
    return b64(sig);
  }

  /* ---------------- crypto helpers ---------------- */

  function b64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function unb64(str) {
    const bin = atob(str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  async function sha256B64(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return b64(digest);
  }

  /* ---------------- cache own data (offline reads) ---------------- */

  async function cacheMine(user) {
    if (!user) return;
    try {
      await DB.put("personnel_data", {
        id: user.id, user_id: user.id, full_name: user.full_name, role: user.role,
        email: user.email, unit_id: user.unit_id, cached_at: new Date().toISOString(),
      });
    } catch (e) { /* storage full or blocked — app still works online */ }
    try {
      const wellness = await V.API.api.get("/api/my/wellness");
      if (wellness && wellness.has_data && wellness.series && wellness.series.dates) {
        // Rebuild row-shaped cache entries from the wellness series so the
        // offline report builder reads the same shape as the server's.
        const rows = wellness.series.dates.map(function (d, i) {
          return {
            id: user.id + ":" + d, user_id: user.id, date: d, recorded_at: d,
            heart_rate: wellness.series.heart_rate[i],
            hrv_ms: wellness.series.hrv_ms ? wellness.series.hrv_ms[i] : null,
            spo2: wellness.series.spo2 ? wellness.series.spo2[i] : null,
            sleep_minutes: wellness.series.sleep_hours && wellness.series.sleep_hours[i] != null
              ? Math.round(wellness.series.sleep_hours[i] * 60) : null,
            steps: wellness.series.steps ? wellness.series.steps[i] : null,
            stress_self_report: wellness.series.stress ? wellness.series.stress[i] : null,
          };
        });
        await DB.putAll("wellness_data", rows);
      }
      const recovery = await V.API.api.get("/api/my/recovery");
      if (recovery && recovery.has_data && recovery.latest) {
        await DB.kvSet("last-recovery-" + user.id, recovery.latest);
      }
    } catch (e) { /* offline already — cache keeps whatever it has */ }
  }

  async function cachedProfile(userId) {
    return DB.get("personnel_data", userId);
  }

  /* ---------------- Authorized Welfare Report (local generation) ---------------- */

  async function generateReport(user, recipientRole) {
    let payload, shared, notShared, builtOffline = false;
    try {
      if (simulatedOffline) throw new Error("demo-offline");
      const preview = await V.API.endpoints.transferPreview({ recipient_role: recipientRole });
      payload = preview.payload; shared = preview.shared; notShared = preview.not_shared;
    } catch (e) {
      // Offline (real or simulated): build from the local cache so the
      // feature keeps working.
      builtOffline = true;
      const local = await buildFromCache(user, recipientRole);
      payload = local.payload; shared = local.shared; notShared = local.not_shared;
    }
    const plaintext = JSON.stringify(payload);
    const hash = await sha256B64(plaintext);
    const report = {
      id: "rpt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      user_id: user.id,
      recipient_role: recipientRole,
      payload: payload,
      plaintext: plaintext,
      payload_hash: hash,
      shared: shared,
      not_shared: notShared,
      created_at: new Date().toISOString(),
      transferred: false,
    };
    await DB.put("welfare_reports", report);
    await enqueueSync("welfare_report_generated", {
      report_ref: report.id, recipient_role: recipientRole,
      personnel_id: payload.personnel_id, recovery_score: payload.recovery_score || payload.recovery_band || null,
      generated_offline: builtOffline,
    });
    return report;
  }

  function riskFromScore(score) {
    if (score == null) return "unknown";
    if (score >= 75) return "steady";
    if (score >= 55) return "attention";
    return "stressed";
  }

  function trendFrom(values) {
    // Same shape as the server's _trend: direction over the window.
    const vals = (values || []).filter(function (v) { return typeof v === "number"; });
    if (vals.length < 3) return "insufficient data";
    const half = Math.floor(vals.length / 2);
    const first = vals.slice(0, half).reduce(function (a, b) { return a + b; }, 0) / half;
    const last = vals.slice(half).reduce(function (a, b) { return a + b; }, 0) / (vals.length - half);
    const delta = first ? (last - first) / first : 0;
    if (delta < -0.05) return "decreasing";
    if (delta > 0.05) return "increasing";
    return "stable";
  }

  async function buildFromCache(user, recipientRole) {
    const profile = await cachedProfile(user.id);
    const recovery = await DB.kvGet("last-recovery-" + user.id);
    const wellness = await DB.byIndex("wellness_data", "user_id", user.id);
    const avg = function (key) {
      const vals = wellness.map(function (w) { return w[key]; }).filter(function (v) { return typeof v === "number"; });
      return vals.length ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length * 10) / 10 : null;
    };
    const sleepAvgH = avg("sleep_minutes") ? Math.round(avg("sleep_minutes") / 6) / 10 : null;
    const payload = {
      report_type: "authorized_welfare_report",
      recipient_role: recipientRole,
      personnel_id: (profile && profile.full_name) || user.full_name,
      recovery_score: recovery ? recovery.score : null,
      risk_level: riskFromScore(recovery ? recovery.score : null),
      sleep_summary: { avg_hours: sleepAvgH, nights: wellness.length },
      heart_rate_trend: trendFrom(wellness.map(function (w) { return w.heart_rate; })),
      hrv_trend: trendFrom(wellness.map(function (w) { return w.hrv_ms; })),
      duty_summary: { week_hours: null, open_tasks: null, note: "duty data not cached on this device" },
      source: "simulated",
      generated_at: new Date().toISOString(),
      built_from: "local offline cache",
    };
    const shared = recipientRole === "medic"
      ? ["Recovery Score + risk level", "Cached sleep summary", "Duty context (from local cache)"]
      : ["Recovery band", "Duty context (from local cache)"];
    return {
      payload: payload,
      shared: shared,
      not_shared: ["Raw biometric feeds", "Private conversations", "Incident reports", "Message From Home content"],
    };
  }

  /* ---------------- sync queue (internet returns) ---------------- */

  async function enqueueSync(kind, payload) {
    const ref = "ref_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    await DB.put("sync_queue", { client_ref: ref, kind: kind, payload: payload, queued_at: new Date().toISOString(), attempts: 0 });
    await refreshStatus();
    return ref;
  }

  let drainTimer = null;
  async function drainSync() {
    if (status.syncing || navigator.onLine === false || simulatedOffline) return;
    const queue = await DB.all("sync_queue");
    if (!queue.length) { await refreshStatus(); return; }
    setStatus({ syncing: true });
    try {
      const res = await V.API.endpoints.transferSync(queue.slice(0, 100).map(function (r) {
        return { client_ref: r.client_ref, kind: r.kind, payload: r.payload };
      }));
      const done = {};
      (res.accepted || []).forEach(function (r) { done[r] = true; });
      (res.duplicates || []).forEach(function (r) { done[r] = true; }); // already synced — remove locally too
      for (const r of queue) {
        if (done[r.client_ref]) await DB.del("sync_queue", r.client_ref);
        else await DB.put("sync_queue", Object.assign(r, { attempts: (r.attempts || 0) + 1 }));
      }
      await DB.kvSet("last-sync", new Date().toISOString());
      setStatus({ syncing: false, lastSync: new Date().toISOString() });
    } catch (e) {
      setStatus({ syncing: false });
    }
    await refreshStatus();
  }

  function scheduleDrain() {
    clearTimeout(drainTimer);
    drainTimer = setTimeout(drainSync, 1500);
  }

  /* ---------------- on-device anomaly detection (intelligence phase 6) ----------------
     Wellness signals → browser → local processing → on-device inference → result.

     The heuristic below runs ENTIRELY on this device from the IndexedDB cache:
     raw heart-rate / HRV / sleep readings never leave the device to be scored.
     Only the minimal RESULT — {status, confidence, model} — is uploaded
     (directly when online, via the sync queue when offline). Honest labels:
     this is a transparent self-baseline heuristic (on_device_heuristic_v1),
     NOT a validated clinical model, and its output is never a diagnosis.
  */

  const ANOMALY_MODEL = "on_device_heuristic_v1";

  function detectAnomalyLocal(rows) {
    const vals = rows
      .filter(function (r) { return r && r.recorded_at; })
      .sort(function (a, b) { return a.recorded_at < b.recorded_at ? -1 : 1; });
    if (vals.length < 4) {
      return { status: "insufficient_local_data", confidence: 0, signals: [], samples: vals.length };
    }
    const mean = function (arr) {
      return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null;
    };
    const recent = vals.slice(-2);
    const baseline = vals.slice(Math.max(0, vals.length - 10), vals.length - 2);
    const signals = [];

    const hrRecent = mean(recent.map(function (r) { return r.heart_rate; }).filter(Number.isFinite));
    const hrBase = mean(baseline.map(function (r) { return r.heart_rate; }).filter(Number.isFinite));
    if (hrRecent != null && hrBase) {
      const ratio = (hrRecent - hrBase) / hrBase; // vs the person's OWN baseline
      signals.push({ key: "heart_rate", score: Math.min(1, Math.max(0, ratio / 0.08)), detail: "+" + Math.round(ratio * 100) + "% vs your baseline" });
    }
    const hrvRecent = mean(recent.map(function (r) { return r.hrv_ms; }).filter(Number.isFinite));
    const hrvBase = mean(baseline.map(function (r) { return r.hrv_ms; }).filter(Number.isFinite));
    if (hrvRecent != null && hrvBase) {
      const drop = (hrvBase - hrvRecent) / hrvBase;
      signals.push({ key: "hrv", score: Math.min(1, Math.max(0, drop / 0.15)), detail: "−" + Math.round(drop * 100) + "% vs your baseline" });
    }
    const shortSleep = recent.filter(function (r) { return r.sleep_minutes != null && r.sleep_minutes < 360; }).length;
    signals.push({ key: "sleep", score: shortSleep / 2, detail: shortSleep + " of the last 2 nights under 6h" });
    const highStress = recent.filter(function (r) { return (r.stress_self_report || 0) >= 4; }).length;
    signals.push({ key: "stress", score: highStress / 2, detail: highStress + " of the last 2 self-reports at 4+/5" });

    const avg = mean(signals.map(function (s) { return s.score; })) || 0;
    const coverage = Math.min(1, vals.length / 8); // more history → steadier read
    const confidence = Math.round((0.55 + 0.4 * coverage) * 100) / 100;
    let status = "steady_pattern";
    if (avg >= 0.6) status = "elevated_fatigue_pattern";
    else if (avg >= 0.42) status = "reduced_recovery_pattern";
    return { status: status, confidence: confidence, signals: signals, samples: vals.length };
  }

  async function runAnomalyDetection(user, opts) {
    opts = opts || {};
    if (!user) return null;
    const rows = await DB.byIndex("wellness_data", "user_id", user.id);
    const result = detectAnomalyLocal(rows);
    result.model = ANOMALY_MODEL;
    result.detected_at = new Date().toISOString();
    result.demo = true;
    // Full detail stays ON DEVICE (kv store) — only the minimal result leaves.
    await DB.kvSet("last-anomaly-" + user.id, result);
    if (result.status === "insufficient_local_data") return result;

    const minimal = { status: result.status, confidence: result.confidence, model: ANOMALY_MODEL };
    const online = navigator.onLine && !simulatedOffline;
    if (online && !opts.queueOnly) {
      try {
        await V.API.endpoints.anomalyRecord(minimal);
      } catch (e) {
        await enqueueSync("anomaly_event", minimal); // server hiccup — queue the minimal result
      }
    } else {
      await enqueueSync("anomaly_event", minimal); // offline: result waits in the queue
    }
    await refreshStatus();
    return result;
  }

  /* ---------------- pending transfers (store-and-forward) ---------------- */

  async function queueTransfer(transfer) {
    // transfer: {id, report_id, recipient_role, recipient_name, method, report_summary, payload_hash, state}
    const row = Object.assign({
      id: "xfr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      created_at: new Date().toISOString(),
      attempts: 0,
      last_error: "",
    }, transfer);
    await DB.put("pending_transfers", row);
    await refreshStatus();
    return row;
  }

  async function listPending() { return DB.all("pending_transfers"); }
  async function listReports() {
    const user = V.STORE.getState().user;
    if (!user) return [];
    const rows = await DB.byIndex("welfare_reports", "user_id", user.id);
    return rows.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  }
  async function removePending(id) { await DB.del("pending_transfers", id); return refreshStatus(); }
  async function updatePending(row) { await DB.put("pending_transfers", row); return refreshStatus(); }

  /* ---------------- status engine ---------------- */

  function setStatus(patch) {
    status = Object.assign({}, status, patch);
    statusListeners.forEach(function (fn) { try { fn(status); } catch (e) { /* listener error */ } });
  }

  function setSimulateOffline(on) {
    simulatedOffline = !!on;
    try { localStorage.setItem(SIM_KEY, simulatedOffline ? "1" : "0"); } catch (e) { /* private mode */ }
    refreshStatus();
  }

  async function refreshStatus() {
    const pending = (await DB.all("pending_transfers")).filter(function (p) { return p.state !== "sent" && p.state !== "failed"; }).length;
    setStatus({
      net: simulatedOffline ? "sim-offline" : (navigator.onLine ? "online" : "offline"),
      pending: pending,
      simulatedOffline: simulatedOffline,
    });
  }

  // Transfer availability: is ANY relay reachable on the current network?
  // A relay on the local Wi-Fi answers even when the internet is down — that
  // distinction is the whole point (No Internet ≠ No Channel).
  async function probeTransfer() {
    // No simulatedOffline short-circuit: the local relay lives on the Wi-Fi
    // network, not the internet — "offline" can still mean "transferable".
    // That distinction is the whole point (§1: No Internet ≠ No Channel).
    try {
      // Any HTTP response at all — even 401/404 — proves a server is reachable
      // on this network. That is the "Transfer Available" signal: the channel
      // exists even when the internet does not.
      await fetch("/api/health", { method: "GET", credentials: "same-origin", cache: "no-store" });
      setStatus({ transferAvailable: "available" });
      return true;
    } catch (e) {
      setStatus({ transferAvailable: "unavailable" });
      return false;
    }
  }

  function onChange(fn) { statusListeners.add(fn); return function () { statusListeners.delete(fn); }; }
  function getStatus() { return status; }

  /* ---------------- boot ---------------- */

  function init() {
    window.addEventListener("online", function () { refreshStatus().then(scheduleDrain); });
    window.addEventListener("offline", refreshStatus);
    refreshStatus();
    // Periodic sync drain (cheap when queue is empty; skip while hidden).
    setInterval(function () { if (!document.hidden) drainSync(); }, 60000);
    if (navigator.onLine) scheduleDrain();
  }

  V.Offline = {
    init: init, ready: open, DB: DB,
    identity: identity, signWithIdentity: signWithIdentity,
    b64: b64, unb64: unb64, sha256B64: sha256B64,
    cacheMine: cacheMine, cachedProfile: cachedProfile,
    generateReport: generateReport, listReports: listReports,
    queueTransfer: queueTransfer, listPending: listPending, removePending: removePending, updatePending: updatePending,
    enqueueSync: enqueueSync, drainSync: drainSync,
    runAnomalyDetection: runAnomalyDetection, detectAnomalyLocal: detectAnomalyLocal,
    probeTransfer: probeTransfer,
    setSimulateOffline: setSimulateOffline,
    getStatus: getStatus, onChange: onChange, refreshStatus: refreshStatus,
  };
})(window.VIGIL = window.VIGIL || {});
