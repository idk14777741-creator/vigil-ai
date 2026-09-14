/**
 * VIGIL AI — Task Management (Phase 4).
 * Personnel: own tasks with search/filters, detail modal, progress updates.
 * Supervisor/admin: create + assign tasks, edit own-created ones.
 */
(function (V) {
  const esc = V.UI.esc;
  const fmtTime = V.UI.fmtTime;
  const timeAgo = V.UI.timeAgo;
  const avatarHtml = V.UI.avatarHtml;
  const toast = V.UI.toast;
  const openModal = V.UI.openModal;

  V.ROUTER.register("/tasks", render, { title: "Tasks", nav: "/tasks", roles: ["personnel", "supervisor"] });

  let FILTERS = { q: "", status: "open", priority: "", scope: "mine" };

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="page-header"><div><h1>Tasks</h1>' +
      '<p class="sub">Everything assigned to you, in one calm list. Update progress as you go — small steps count.</p></div>' +
      '<div id="task-actions" class="row gap-2"></div></div>' +
      '<div class="card"><div class="task-filterbar" id="task-filterbar"></div><div id="task-list" class="stack-list mt-4">' +
      '<div class="card"><div class="skeleton skeleton-line title"></div><div class="skeleton skeleton-line" style="width:60%"></div></div>' +
      "</div></div></div>";
    load(el);
  }

  async function load(el) {
    const user = V.STORE.getState().user;
    const query = [];
    if (FILTERS.q) query.push("q=" + encodeURIComponent(FILTERS.q));
    if (FILTERS.status) query.push("status=" + FILTERS.status);
    if (FILTERS.priority) query.push("priority=" + FILTERS.priority);
    if (FILTERS.scope !== "mine") query.push("scope=" + FILTERS.scope);
    const result = await V.UI.safe(function () {
      return V.API.endpoints.myTasks(query.join("&"));
    });
    if (!result) {
      document.getElementById("task-list").innerHTML =
        '<div class="empty-state"><div class="icon">☑</div><h3>Couldn&#39;t load tasks</h3><p>Please try again.</p>' +
        '<button class="btn primary" id="tasks-retry">Try again</button></div>';
      document.getElementById("tasks-retry")?.addEventListener("click", function () { load(el); });
      return;
    }
    const tasks = result.tasks;

    renderFilterbar();
    renderActions(user);

    const list = document.getElementById("task-list");
    if (!tasks.length) {
      const emptyCopy = FILTERS.q || FILTERS.status !== "open" || FILTERS.priority
        ? ["🔍", "No tasks match", "Try clearing the search or filters."]
        : ["☑", "No open tasks", "When your supervisor assigns work, it shows up here. Meanwhile, the De-stress Zone is a good place to unwind."];
      list.innerHTML = '<div class="empty-state"><div class="icon">' + emptyCopy[0] + "</div><h3>" + emptyCopy[1] + "</h3><p>" + emptyCopy[2] + "</p></div>";
      return;
    }
    list.innerHTML = tasks.map(taskCard).join("");
    list.querySelectorAll("[data-task]").forEach(function (card) {
      card.addEventListener("click", function () {
        openDetail(card.getAttribute("data-task"), el);
      });
    });
  }

  function renderFilterbar() {
    const bar = document.getElementById("task-filterbar");
    const user = V.STORE.getState().user;
    const isSup = user.role === "supervisor" || user.role === "admin";
    bar.innerHTML =
      '<input id="task-q" class="task-search" type="search" placeholder="Search your tasks…" value="' + esc(FILTERS.q) + '" aria-label="Search tasks">' +
      '<div class="tabs" role="tablist" aria-label="Status filter">' +
      [["", "All"], ["open", "Open"], ["pending", "Pending"], ["completed", "Done"]].map(function (t) {
        return '<button role="tab" data-status="' + t[0] + '" aria-selected="' + (FILTERS.status === t[0]) + '" class="' + (FILTERS.status === t[0] ? "active" : "") + '">' + t[1] + "</button>";
      }).join("") + "</div>" +
      '<select id="task-priority" class="task-select" aria-label="Priority filter">' +
      [["", "Any priority"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]].map(function (p) {
        return '<option value="' + p[0] + '"' + (FILTERS.priority === p[0] ? " selected" : "") + ">" + p[1] + "</option>";
      }).join("") + "</select>" +
      (isSup
        ? '<div class="tabs" role="tablist" aria-label="Task scope">' +
          [["mine", "My tasks"], ["assigned", "Assigned by me"]].map(function (s) {
            return '<button role="tab" data-scope="' + s[0] + '" class="' + (FILTERS.scope === s[0] ? "active" : "") + '">' + s[1] + "</button>";
          }).join("") + "</div>"
        : "");

    let debounce;
    bar.querySelector("#task-q").addEventListener("input", function (e) {
      clearTimeout(debounce);
      debounce = setTimeout(function () { FILTERS.q = e.target.value.trim(); load(getPageEl()); }, 250);
    });
    bar.querySelectorAll("[data-status]").forEach(function (btn) {
      btn.addEventListener("click", function () { FILTERS.status = btn.getAttribute("data-status"); load(getPageEl()); });
    });
    bar.querySelectorAll("[data-scope]").forEach(function (btn) {
      btn.addEventListener("click", function () { FILTERS.scope = btn.getAttribute("data-scope"); load(getPageEl()); });
    });
    bar.querySelector("#task-priority").addEventListener("change", function (e) {
      FILTERS.priority = e.target.value; load(getPageEl());
    });
  }

  function renderActions(user) {
    const wrap = document.getElementById("task-actions");
    if (user.role !== "supervisor" && user.role !== "admin") { wrap.innerHTML = ""; return; }
    wrap.innerHTML = '<button class="btn primary" id="new-task-btn">＋ New task</button>';
    document.getElementById("new-task-btn").addEventListener("click", openCreate);
  }

  function getPageEl() {
    return document.getElementById("page-content");
  }

  /* ---------- task card ---------- */

  function taskCard(t) {
    const prio = { critical: "tone-danger", high: "tone-warning", medium: "", low: "" }[t.priority] || "";
    const assigneeChip = FILTERS.scope === "assigned" && t.assignee
      ? '<span class="badge">→ ' + esc(t.assignee.full_name.split(" ")[0]) + "</span>" : "";
    const statusBadge = t.status === "completed"
      ? '<span class="badge tone-success">Done</span>'
      : t.status === "cancelled" ? '<span class="badge">Cancelled</span>'
      : t.status === "blocked" ? '<span class="badge tone-danger">Blocked</span>'
      : t.overdue ? '<span class="badge tone-danger">Overdue</span>'
      : '<span class="badge tone-brand">{open-badge}</span>';
    const openBadge = t.status === "in_progress" ? "In progress" : t.status === "pending" ? "Pending" : t.status;
    return '<article class="task-card' + (t.overdue ? " overdue" : "") + '" data-task="' + t.id + '" tabindex="0" role="button" aria-label="Open task: ' + esc(t.title) + '">' +
      '<div class="tc-top"><div class="tc-title">' + esc(t.title) +
      (t.priority === "high" || t.priority === "critical" ? ' <span class="badge ' + prio + '">' + esc(t.priority) + "</span>" : "") + "</div>" +
      '<span class="row gap-2">' + assigneeChip + statusBadge.replace("{open-badge}", openBadge) + "</span></div>" +
      (t.description ? '<p class="tc-desc">' + esc(t.description) + "</p>" : "") +
      '<div class="tc-bottom"><div class="grow">' +
      '<div class="progress-track"><div class="progress-fill' + progressTone(t.progress) + '" style="width:' + t.progress + '%"></div></div></div>' +
      '<span class="tc-pct">' + t.progress + "%</span>" +
      '<span class="tc-due meta">' + dueLabel(t) + "</span></div></article>";
  }

  function progressTone(p) {
    return p === 100 ? " tone-success" : "";
  }

  function dueLabel(t) {
    if (!t.due_at) return "No due date";
    const d = new Date(t.due_at);
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const prefix = t.overdue ? "Overdue · was due " : (d <= today ? "Due today " : "Due ");
    if (d <= today) return prefix + d.toLocaleDateString(undefined, { weekday: "short" }) + " " + fmtTime(t.due_at);
    if (d <= today.getTime() + 86400000) return "Due tomorrow " + fmtTime(t.due_at);
    return prefix + d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + fmtTime(t.due_at);
  }

  /* ---------- detail modal ---------- */

  async function openDetail(taskId, el) {
    const res = await V.UI.safe(function () { return V.API.endpoints.task(taskId); });
    if (!res) { toast("Couldn't load that task.", "error"); return; }
    const t = res.task;
    const user = V.STORE.getState().user;
    const canWork = t.assignee && t.assignee.id === user.id || user.role === "admin";
    const canEdit = user.role === "admin" || user.role === "supervisor"; // server enforces creator; UI allows attempt

    const prio = { critical: "tone-danger", high: "tone-warning", medium: "", low: "" }[t.priority] || "";
    const body =
      '<div class="task-detail">' +
      '<div class="row gap-2 wrap mb-4">' +
      '<span class="badge ' + prio + '">' + esc(t.priority) + "</span>" +
      '<span class="badge">' + esc(t.status.replace("_", " ")) + "</span>" +
      (t.due_at ? '<span class="badge">' + dueLabel(Object.assign({}, t, { overdue: false })) + "</span>" : "") +
      "</div>" +
      (t.description ? '<p class="muted">' + esc(t.description) + "</p>" : "") +
      '<div class="detail-grid mt-4">' +
      "<div><div class='meta'>Assignee</div>" + (t.assignee ? "<div class='row gap-2 mt-2'>" + avatarHtml(t.assignee, "sm") + esc(t.assignee.full_name) + "</div>" : "—") + "</div>" +
      "<div><div class='meta'>Assigned by</div><div class='mt-2'>" + esc(t.created_by_name) + "</div></div>" +
      "<div><div class='meta'>Created</div><div class='mt-2'>" + esc(timeAgo(t.created_at)) + "</div></div>" +
      "<div><div class='meta'>Last update</div><div class='mt-2'>" + esc(timeAgo(t.updated_at)) + "</div></div>" +
      "</div>" +
      '<div class="mt-6">' +
      '<div class="row-between mb-2"><div class="eyebrow">Progress</div><div class="f-pts">' + t.progress + "%</div></div>" +
      '<div class="progress-track"><div class="progress-fill" style="width:' + t.progress + '%"></div></div>' +
      (canWork ? progressEditor(t) : "") +
      "</div>" +
      '<div class="mt-6 field"><label>Remarks</label>' +
      (canWork
        ? '<textarea id="task-remarks" placeholder="Anything worth noting for your supervisor… (optional)">' + esc(t.remarks || "") + "</textarea>"
        : "<p class='muted'>" + (t.remarks ? esc(t.remarks) : "No remarks yet.") + "</p>") +
      "</div></div>";

    const m = openModal({ title: t.title, size: "lg", body: body });

    if (canWork) {
      const apply = m.el.querySelector("#task-apply");
      apply?.addEventListener("click", async function () {
        const progress = parseInt(m.el.querySelector("#task-progress-range").value, 10);
        const status = m.el.querySelector("#task-status-select").value;
        const remarks = m.el.querySelector("#task-remarks")?.value || "";
        apply.disabled = true;
        try {
          await V.API.endpoints.updateTask(taskId, { progress: progress, status: status, remarks: remarks });
          toast("Task updated. Nice progress.", "success");
          m.close();
          load(getPageEl());
        } catch (e) {
          toast(e.message, "error");
          apply.disabled = false;
        }
      });
      const range = m.el.querySelector("#task-progress-range");
      range?.addEventListener("input", function () {
        m.el.querySelector("#task-progress-val").textContent = range.value + "%";
      });
    }
  }

  function progressEditor(t) {
    const opts = ["pending", "in_progress", "blocked", "completed"].map(function (s) {
      return '<option value="' + s + '"' + (t.status === s ? " selected" : "") + ">" + s.replace("_", " ") + "</option>";
    }).join("");
    return '<div class="task-editor mt-4">' +
      '<div class="field"><label>Set progress</label>' +
      '<div class="row gap-3"><input type="range" id="task-progress-range" min="0" max="100" step="5" value="' + t.progress + '" aria-label="Progress percent">' +
      '<span id="task-progress-val" class="f-pts">' + t.progress + "%</span></div></div>" +
      '<div class="field"><label>Status</label><select id="task-status-select">' + opts + "</select></div>" +
      '<button class="btn primary" id="task-apply">Save update</button>' +
      "</div>";
  }

  /* ---------- create modal (supervisor/admin) ---------- */

  async function openCreate() {
    const team = await V.UI.safe(function () { return V.API.endpoints.myTeam(); });
    const personnel = (team && team.members ? team.members : []).filter(function (m) { return m.role === "personnel"; });
    const options = personnel.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.full_name) + "</option>";
    }).join("");
    const m = openModal({
      title: "Assign a new task",
      size: "lg",
      body:
        '<div class="field"><label>Title *</label><input id="nt-title" maxlength="160" placeholder="e.g. Verify patrol route map">' +
        '<span class="hint">Short and specific works best.</span></div>' +
        '<div class="field"><label>Description</label><textarea id="nt-desc" placeholder="What done looks like, links, anything helpful…"></textarea></div>' +
        '<div class="field-row">' +
        '<div class="field"><label>Assign to *</label><select id="nt-assignee">' + (options || "<option value=''>No personnel in your unit</option>") + "</select></div>" +
        '<div class="field"><label>Priority</label><select id="nt-priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>' +
        "</div>" +
        '<div class="field"><label>Due</label><input id="nt-due" type="datetime-local"></div>',
      footer:
        '<button class="btn ghost" data-act="cancel">Cancel</button>' +
        '<button class="btn primary" data-act="create">Assign task</button>',
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-act="create"]').addEventListener("click", async function () {
      const btn = m.el.querySelector('[data-act="create"]');
      const title = m.el.querySelector("#nt-title").value.trim();
      const assignee = m.el.querySelector("#nt-assignee").value;
      if (title.length < 2) { toast("Give the task a title.", "warning"); return; }
      if (!assignee) { toast("Choose someone to assign it to.", "warning"); return; }
      const dueRaw = m.el.querySelector("#nt-due").value;
      btn.disabled = true;
      try {
        await V.API.endpoints.createTask({
          title: title,
          description: m.el.querySelector("#nt-desc").value.trim(),
          assignee_id: assignee,
          priority: m.el.querySelector("#nt-priority").value,
          due_at: dueRaw ? new Date(dueRaw).toISOString() : null,
        });
        toast("Task assigned — they'll get a notification.", "success");
        m.close();
        load(getPageEl());
      } catch (e) {
        toast(e.message, "error");
        btn.disabled = false;
      }
    });
  }
})(window.VIGIL = window.VIGIL || {});
