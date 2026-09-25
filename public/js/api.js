/**
 * VIGIL AI — API client (classic script).
 * Demo mode talks to the local Python adapter. In live mode, INTEGRATIONS maps
 * endpoints to remote bases without touching UI code.
 */
(function (V) {
  const INTEGRATIONS = window.VIGIL_INTEGRATIONS || { apiBase: "", aiBase: "/api/ai", mode: "demo" };

  function url(path) {
    if (path.indexOf("/api/ai") === 0) {
      return (INTEGRATIONS.aiBase || "/api/ai") + path.slice("/api/ai".length);
    }
    return (INTEGRATIONS.apiBase || "") + path;
  }

  function ApiError(status, payload) {
    const e = new Error((payload && payload.error) || "Request failed (" + status + ")");
    e.status = status;
    e.payload = payload || {};
    return e;
  }

  async function request(method, path, body, opts) {
    opts = opts || {};
    const init = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url(path), init);
    } catch (err) {
      const e = new Error("Cannot reach the VIGIL AI server. Check your connection and try again.");
      e.network = true;
      throw e;
    }
    let payload = {};
    try { payload = await res.json(); } catch (e) { /* 204 or empty */ }
    if (!res.ok) throw ApiError(res.status, payload);
    return payload;
  }

  const api = {
    get: function (path, opts) { return request("GET", path, undefined, opts); },
    post: function (path, body, opts) { return request("POST", path, body, opts); },
    patch: function (path, body, opts) { return request("PATCH", path, body, opts); },
    del: function (path, opts) { return request("DELETE", path, undefined, opts); },
  };

  const auth = {
    login: function (email, password) { return api.post("/api/auth/login", { email: email, password: password }); },
    register: function (data) { return api.post("/api/auth/register", data); },
    logout: function () { return api.post("/api/auth/logout", {}); },
    session: function () { return api.get("/api/auth/session"); },
    forgot: function (email) { return api.post("/api/auth/forgot-password", { email: email }); },
    reset: function (token, password) { return api.post("/api/auth/reset-password", { token: token, password: password }); },
    demoAccounts: function () { return api.get("/api/demo-accounts"); },
  };

  const endpoints = {
    me: function () { return api.get("/api/me"); },
    updateMe: function (patch) { return api.patch("/api/me", patch); },
    changePassword: function (current, next) { return api.post("/api/me/password", { current_password: current, new_password: next }); },
    notifications: function () { return api.get("/api/notifications"); },
    markRead: function (ids) { return api.post("/api/notifications/read", { ids: ids }); },
    markAllRead: function () { return api.post("/api/notifications/read", { all: true }); },
    myTeam: function () { return api.get("/api/my/team"); },
    myDashboard: function () { return api.get("/api/my/dashboard"); },
    myContext: function () { return api.get("/api/my/context"); },
    myTimeline: function () { return api.get("/api/my/timeline"); },
    recoveryChange: function () { return api.get("/api/my/recovery/change"); },
    myShifts: function () { return api.get("/api/my/shifts"); },
    teamShifts: function () { return api.get("/api/team/shifts"); },
    myTasks: function (qs) { return api.get("/api/my/tasks" + (qs ? "?" + qs : "")); },
    task: function (id) { return api.get("/api/tasks/" + id); },
    createTask: function (data) { return api.post("/api/tasks", data); },
    updateTask: function (id, patch) { return api.patch("/api/tasks/" + id, patch); },
    myWellness: function () { return api.get("/api/my/wellness"); },
    myRecovery: function () { return api.get("/api/my/recovery"); },
    stress: function () { return api.get("/api/my/stress"); },
    stressHistory: function () { return api.get("/api/my/stress/history"); },
    myReport: function () { return api.get("/api/my/report"); },
    saveReflection: function (weekStart, text) { return api.post("/api/my/report/reflection", { week_start: weekStart, reflection: text }); },
    aiChat: function (message, conversationId) { return api.post("/api/ai/chat", { message: message, conversation_id: conversationId }); },
    aiConversations: function () { return api.get("/api/ai/conversations"); },
    aiConversation: function (id) { return api.get("/api/ai/conversations/" + id); },
    aiDeleteConversation: function (id) { return api.del("/api/ai/conversations/" + id); },
    musicTracks: function (category) { return api.get("/api/music/tracks" + (category ? "?category=" + encodeURIComponent(category) : "")); },
    recordPlay: function (trackId) { return api.post("/api/music/history", { track_id: trackId }); },
    musicHistory: function () { return api.get("/api/music/history"); },
    videos: function (category) { return api.get("/api/videos" + (category ? "?category=" + encodeURIComponent(category) : "")); },
    buddyStatus: function () { return api.get("/api/buddy"); },
    buddyInvite: function (email) { return api.post("/api/buddy/invite", { email: email }); },
    buddyRespond: function (connectionId, action) { return api.post("/api/buddy/respond", { connection_id: connectionId, action: action }); },
    buddyRemove: function (connectionId) { return api.post("/api/buddy/remove", { connection_id: connectionId }); },
    buddyShare: function (patch) { return api.patch("/api/buddy/share", patch); },
    buddyMessages: function (connectionId) { return api.get("/api/buddy/messages?connection_id=" + encodeURIComponent(connectionId)); },
    buddySend: function (connectionId, body) { return api.post("/api/buddy/messages", { connection_id: connectionId, body: body }); },
    homeStatus: function () { return api.get("/api/home"); },
    homeAddContact: function (name, relationship) { return api.post("/api/home/contacts", { name: name, relationship: relationship }); },
    homeRemoveContact: function (id) { return api.del("/api/home/contacts/" + encodeURIComponent(id)); },
    homeWatch: function (id) { return api.post("/api/home/videos/watch", { video_id: id }); },
    homeHide: function (id) { return api.post("/api/home/videos/hide", { video_id: id }); },
    homeDelete: function (id) { return api.post("/api/home/videos/delete", { video_id: id }); },
    homeUpload: function (inviteCode, title, message) { return api.post("/api/home/upload", { invite_code: inviteCode, title: title, message: message }); },
    medicMy: function () { return api.get("/api/medic/my"); },
    medicCreate: function (category, description) { return api.post("/api/medic/requests", { category: category, description: description }); },
    medicAuthorization: function () { return api.get("/api/medic/authorization"); },
    medicAuthorize: function (on) { return api.post("/api/medic/authorization", { authorized: !!on }); },
    medicThread: function (id) { return api.get("/api/medic/requests/" + encodeURIComponent(id)); },
    medicReply: function (id, body) { return api.post("/api/medic/requests/" + encodeURIComponent(id), { body: body }); },
    medicQueue: function () { return api.get("/api/medic/queue"); },
    medicAuthorized: function () { return api.get("/api/medic/authorized"); },
    medicPersonWellness: function (personnelId) { return api.get("/api/medic/queue/" + encodeURIComponent(personnelId)); },
    medicSetStatus: function (id, status) { return api.patch("/api/medic/queue/" + encodeURIComponent(id), { status: status }); },
    // Offline welfare transfer (relay + sync)
    transferRecipients: function () { return api.get("/api/transfer/recipients"); },
    transferPreview: function (body) { return api.post("/api/transfer/preview", body); },
    transferSessionCreate: function (body) { return api.post("/api/transfer/sessions", body); },
    transferSessionsMine: function () { return api.get("/api/transfer/sessions"); },
    transferSessionJoin: function (body) { return api.post("/api/transfer/sessions/join", body); },
    transferSessionStatus: function (id) { return api.get("/api/transfer/sessions/" + encodeURIComponent(id)); },
    transferSessionClose: function (id) { return api.post("/api/transfer/sessions/" + encodeURIComponent(id) + "/close", {}); },
    transferEnvelopePush: function (sessionId, body) { return api.post("/api/transfer/sessions/" + encodeURIComponent(sessionId) + "/envelopes", body); },
    transferEnvelopesPull: function (sessionId) { return api.get("/api/transfer/envelopes" + (sessionId ? "?session_id=" + encodeURIComponent(sessionId) : "")); },
    transferEnvelopeAck: function (id, body) { return api.post("/api/transfer/envelopes/" + encodeURIComponent(id) + "/ack", body); },
    transferHistory: function () { return api.get("/api/transfer/history"); },
    transferReportRegister: function (body) { return api.post("/api/transfer/reports", body); },
    transferSync: function (records) { return api.post("/api/transfer/sync", { records: records }); },
    // Intelligence layer — forecast, closed-loop interventions, wellbeing, roster
    forecast: function () { return api.get("/api/intelligence/forecast"); },
    interventions: function () { return api.get("/api/intelligence/interventions"); },
    interventionEngage: function (interventionId, source) { return api.post("/api/intelligence/interventions", { intervention_id: interventionId, source: source }); },
    interventionFollowup: function (eventId, helpfulness) { return api.post("/api/intelligence/interventions/followup", { event_id: eventId, helpfulness: helpfulness }); },
    anomalyRecord: function (body) { return api.post("/api/intelligence/anomalies", body); },
    anomalies: function () { return api.get("/api/intelligence/anomalies"); },
    wellbeingCheckins: function () { return api.get("/api/wellbeing/checkins"); },
    wellbeingCheckin: function (answers) { return api.post("/api/wellbeing/checkin", { answers: answers }); },
    teamIntel: function () { return api.get("/api/intelligence/team"); },
    teamRoster: function () { return api.get("/api/intelligence/team/roster"); },
    rosterSimulate: function (body) { return api.post("/api/intelligence/roster/simulate", body); },
    rosterScenarios: function () { return api.get("/api/intelligence/roster/scenarios"); },
    rosterSaveScenario: function (body) { return api.post("/api/intelligence/roster/scenarios", body); },
    interventionEfficacy: function () { return api.get("/api/intelligence/efficacy"); },
    medicInbox: function () { return api.get("/api/medic/inbox"); },
    medicInboxReview: function (id, body) { return api.post("/api/medic/inbox/" + encodeURIComponent(id), body); },
    supervisorMy: function () { return api.get("/api/supervisor/my"); },
    supervisorCreate: function (category, description) { return api.post("/api/supervisor/requests", { category: category, description: description }); },
    supervisorThread: function (id) { return api.get("/api/supervisor/requests/" + encodeURIComponent(id)); },
    supervisorReply: function (id, body) { return api.post("/api/supervisor/requests/" + encodeURIComponent(id), { body: body }); },
    supervisorQueue: function () { return api.get("/api/supervisor/queue"); },
    supervisorSetStatus: function (id, status) { return api.patch("/api/supervisor/queue/" + encodeURIComponent(id), { status: status }); },
    incidentList: function () { return api.get("/api/incidents"); },
    incidentGet: function (id) { return api.get("/api/incidents/" + encodeURIComponent(id)); },
    incidentCreate: function (body) { return api.post("/api/incidents", body); },
    incidentAddNote: function (id, body) { return api.post("/api/incidents/" + encodeURIComponent(id), { body: body }); },
    incidentSetStatus: function (id, status, resolution) { return api.patch("/api/incidents/" + encodeURIComponent(id), { status: status, resolution: resolution }); },
    incidentAssign: function (id, assigneeId) { return api.patch("/api/incidents/" + encodeURIComponent(id) + "/assign", { assignee_id: assigneeId }); },
    integrationStatus: function () { return api.get("/api/admin/integrations"); },
    resetDemo: function () { return api.post("/api/admin/reset-demo", {}); },
    lookupUsers: function (q) { return api.get("/api/users/lookup?q=" + encodeURIComponent(q)); },
    adminOverview: function () { return api.get("/api/admin/overview"); },
    adminUsers: function (q, role) {
      q = q || ""; role = role || "";
      return api.get("/api/admin/users?q=" + encodeURIComponent(q) + "&role=" + encodeURIComponent(role));
    },
    adminCreateUser: function (data) { return api.post("/api/admin/users", data); },
    adminUpdateUser: function (id, patch) { return api.patch("/api/admin/users/" + id, patch); },
    adminBroadcast: function (data) { return api.post("/api/admin/notifications", data); },
    adminAudit: function (action) { return api.get("/api/admin/audit?action=" + encodeURIComponent(action || "")); },
  };

  V.API = { api: api, auth: auth, endpoints: endpoints, ApiError: ApiError, MODE: INTEGRATIONS.mode };
})(window.VIGIL = window.VIGIL || {});
