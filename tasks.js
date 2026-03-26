// tasks.js — FIXED: onSnapshot error callbacks, role-scoped queries, overdue detection
import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications, createNotification } from "./notifications.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  getDocs,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  statusBadge,
  priorityBadge,
  formatDate,
  getInitials,
  showToast,
  sanitizeHtml,
  showConfirm,
} from "./utils.js";

let allTasks = [];
let allUsers = [];
let assigneeMap = {};
let selectedAssignees = [];
let currentFilter = "all";
let currentUser;

// ─── Shared onSnapshot error handler ─────────────────────────────────────────
function handleSnapshotError(err) {
  console.error("Tasks listener error:", err.code, err.message);
  const container = document.getElementById("tasks-container");
  if (container) {
    let hint = err.message;
    if (err.code === "permission-denied") {
      hint =
        "Permission denied — your Firestore role field may not be set to 'super_admin', 'admin', or 'member'. Open Firebase Console → Firestore → users → your UID and verify the role field.";
    } else if (err.code === "failed-precondition") {
      hint =
        "A required Firestore index is missing. Check the browser console — Firestore prints a direct link to create it.";
    }
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <i class="ph ph-warning-circle" style="font-size:32px;margin-bottom:8px;color:var(--danger);"></i>
        <p style="font-weight:600;color:var(--danger);">Failed to load tasks</p>
        <p style="font-size:12px;color:var(--text-muted);margin-top:6px;max-width:480px;text-align:center;line-height:1.6;">${sanitizeHtml(hint)}</p>
      </div>`;
  }
  showToast("Tasks error: " + err.code, "error");
}

requireAuth(async (user) => {
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    loadingOverlay.style.transition = "opacity 0.3s ease";
    setTimeout(() => loadingOverlay.remove(), 320);
  }

  currentUser = user;
  renderSidebar("tasks", user);
  initNotifications(user.id);

  // Safety net: if nothing renders within 8s, show a diagnostic message
  // instead of leaving the user on "Loading tasks..." forever.
  const loadTimeoutId = setTimeout(() => {
    const placeholder = document.getElementById("tasks-loading-placeholder");
    if (placeholder) {
      placeholder.innerHTML = `
        <i class="ph ph-warning-circle" style="font-size:32px;color:var(--danger);"></i>
        <p style="font-weight:600;color:var(--danger);">Tasks failed to load</p>
        <p style="font-size:12px;color:var(--text-muted);margin-top:6px;max-width:420px;text-align:center;line-height:1.6;">
          Open browser DevTools (F12) → Console tab and look for a red Firestore error.<br>
          Common causes: Firestore rules not deployed, or missing index. 
        </p>`;
    }
  }, 8000);

  // Cancel timeout as soon as the first snapshot arrives
  window._cancelTasksTimeout = () => clearTimeout(loadTimeoutId);

  if (user.role !== "member") {
    const newTaskBtn = document.getElementById("new-task-btn");
    const createdBtn = document.getElementById("filter-created-btn");
    if (newTaskBtn) newTaskBtn.style.display = "flex";
    if (createdBtn) createdBtn.style.display = "block";
  }

  const subtitleEl = document.getElementById("tasks-subtitle");
  if (subtitleEl)
    subtitleEl.textContent =
      user.role === "member"
        ? "Your assigned tasks"
        : "Manage and assign tasks";

  // Load users for assignee display
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allUsers.forEach((u) => {
      assigneeMap[u.id] = u;
    });
  } catch (err) {
    console.error("Failed to load users:", err);
  }

  // ── Role-scoped real-time task listeners ───────────────────────────────────
  // IMPORTANT: We do NOT use orderBy() in any query below.
  // orderBy() on a field combined with where() requires a composite Firestore
  // index. Without deploying those indexes, the query throws failed-precondition
  // and the onSnapshot callback never fires — causing the eternal "Loading..."
  // state. Instead we sort client-side after every snapshot update.
  const sortByNewest = (arr) =>
    arr.sort(
      (a, b) =>
        (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0),
    );

  if (user.role === "member") {
    let assignedTasks = [];
    let commonTasks = [];

    const mergeAndRender = () => {
      const seen = new Set();
      allTasks = sortByNewest(
        [...assignedTasks, ...commonTasks].filter((t) => {
          if (seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        }),
      );
      applyFilters();
    };

    onSnapshot(
      query(
        collection(db, "tasks"),
        where("assignedTo", "array-contains", user.id),
      ),
      (snap) => {
        assignedTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeAndRender();
      },
      handleSnapshotError,
    );

    onSnapshot(
      query(collection(db, "tasks"), where("isCommonTask", "==", true)),
      (snap) => {
        commonTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeAndRender();
      },
      handleSnapshotError,
    );
  } else {
    // Admin / Super Admin — listen to the full collection with no filters
    onSnapshot(
      collection(db, "tasks"),
      (snap) => {
        window._cancelTasksTimeout?.();
        allTasks = sortByNewest(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        );
        autoMarkOverdue(allTasks);
        applyFilters();
      },
      handleSnapshotError,
    );
  }
});

// ─── Overdue auto-detection (admin+ only) ────────────────────────────────────
let _overdueRunning = false;
async function autoMarkOverdue(tasks) {
  if (!currentUser || currentUser.role === "member") return;
  if (_overdueRunning) return;
  _overdueRunning = true;
  const now = new Date();
  const stale = tasks.filter((t) => {
    if (!t.deadline || t.status === "completed" || t.status === "overdue")
      return false;
    const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    return d < now;
  });
  for (const t of stale) {
    try {
      await updateDoc(doc(db, "tasks", t.id), {
        status: "overdue",
        updatedAt: serverTimestamp(),
      });
    } catch (_) {}
  }
  _overdueRunning = false;
}

// ─── Filter buttons ───────────────────────────────────────────────────────────
window.setViewFilter = (btn, filter) => {
  document
    .querySelectorAll(".filter-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentFilter = filter;
  applyFilters();
};

// ─── Apply all active filters ─────────────────────────────────────────────────
window.applyFilters = () => {
  if (!currentUser) return;
  // Remove the initial loading placeholder on first successful data arrival
  document.getElementById("tasks-loading-placeholder")?.remove();
  window._cancelTasksTimeout?.();
  let tasks = [...allTasks];

  if (currentFilter === "mine")
    tasks = tasks.filter((t) => t.assignedTo?.includes(currentUser.id));
  else if (currentFilter === "common")
    tasks = tasks.filter((t) => t.isCommonTask);
  else if (currentFilter === "created")
    tasks = tasks.filter((t) => t.createdBy === currentUser.id);
  // "all" — no extra filter needed; allTasks is already role-scoped by the query

  const search = document.getElementById("search-input")?.value?.toLowerCase();
  if (search)
    tasks = tasks.filter(
      (t) =>
        t.title?.toLowerCase().includes(search) ||
        t.description?.toLowerCase().includes(search),
    );

  const status = document.getElementById("filter-status")?.value;
  if (status) {
    const now = new Date();
    if (status === "overdue") {
      tasks = tasks.filter((t) => {
        if (!t.deadline || t.status === "completed") return false;
        const d = t.deadline.toDate
          ? t.deadline.toDate()
          : new Date(t.deadline);
        return d < now;
      });
    } else {
      tasks = tasks.filter((t) => t.status === status);
    }
  }

  const priority = document.getElementById("filter-priority")?.value;
  if (priority) tasks = tasks.filter((t) => t.priority === priority);

  renderTasks(tasks);
};

// ─── Render task cards ────────────────────────────────────────────────────────
function renderTasks(tasks) {
  const container = document.getElementById("tasks-container");
  if (!tasks.length) {
    container.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1;"><i class="ph ph-check-square"></i><p>No tasks found</p></div>';
    return;
  }

  const now = new Date();
  container.innerHTML = tasks
    .map((t) => {
      const deadline = t.deadline
        ? t.deadline.toDate
          ? t.deadline.toDate()
          : new Date(t.deadline)
        : null;
      const isOverdue = deadline && t.status !== "completed" && deadline < now;
      const displayStatus = isOverdue ? "overdue" : t.status || "pending";
      const pct = t.completionPercentage || 0;

      // Assignee avatars (max 3 shown + overflow count)
      const assigneeList = t.assignedTo || [];
      const shownAssignees = assigneeList.slice(0, 3);
      const extraCount = assigneeList.length - shownAssignees.length;

      const avatars = shownAssignees
        .map((uid) => {
          const name = assigneeMap[uid]?.displayName || "?";
          return `<div style="
        width:26px;height:26px;border-radius:50%;flex-shrink:0;
        background:linear-gradient(135deg,var(--accent-cyan),var(--accent-purple));
        display:flex;align-items:center;justify-content:center;
        font-size:9px;font-weight:700;color:#000;
        margin-left:-6px;border:2px solid rgba(20,20,25,0.9);
        title='${sanitizeHtml(name)}'
      ">${getInitials(name)}</div>`;
        })
        .join("");

      const overflowBubble =
        extraCount > 0
          ? `<div style="
          width:26px;height:26px;border-radius:50%;flex-shrink:0;
          background:rgba(255,255,255,0.1);
          display:flex;align-items:center;justify-content:center;
          font-size:9px;font-weight:600;color:var(--text-muted);
          margin-left:-6px;border:2px solid rgba(20,20,25,0.9);
        ">+${extraCount}</div>`
          : "";

      // Tags (max 2)
      const tagChips = (t.tags || [])
        .slice(0, 2)
        .map(
          (tag) =>
            `<span style="
        font-size:10px;padding:2px 8px;
        background:rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.1);
        border-radius:999px;color:var(--text-muted);
        white-space:nowrap;
      ">${sanitizeHtml(tag)}</span>`,
        )
        .join("");

      // Format deadline
      const deadlineStr = deadline
        ? deadline.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "No deadline";

      // Admin action buttons
      const adminBtns =
        currentUser.role !== "member"
          ? `<div style="display:flex;gap:6px;margin-top:4px;" onclick="event.stopPropagation()">
          <button class="btn btn-secondary btn-sm" style="flex:1;font-size:11px;justify-content:center;"
            onclick="openEditTask('${t.id}')" data-testid="edit-task-${t.id}">
            <i class="ph ph-pencil"></i> Edit
          </button>
          <button class="btn btn-danger btn-sm" style="font-size:11px;"
            onclick="confirmDeleteTask('${t.id}')" data-testid="delete-task-${t.id}">
            <i class="ph ph-trash"></i>
          </button>
        </div>`
          : "";

      return `
      <div class="task-card" onclick="window.location.href='task-detail.html?id=${t.id}'"
        data-testid="task-card-${t.id}">

        <!-- Header: title + priority -->
        <div class="task-card-header">
          <div class="task-card-title">${sanitizeHtml(t.title)}</div>
          ${priorityBadge(t.priority || "medium")}
        </div>

        <!-- Description snippet — flex:1 makes this grow to fill space, pushing footer down -->
        <div style="flex:1;min-height:0;">
          ${
            t.description
              ? `
            <div style="font-size:12px;color:var(--text-muted);line-height:1.55;
              display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
              ${sanitizeHtml(t.description)}
            </div>`
              : ""
          }
        </div>

        <!-- Status + tags -->
        <div class="task-card-meta">
          ${statusBadge(displayStatus)}
          ${tagChips}
        </div>

        <!-- Progress bar -->
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:5px;
            font-size:11px;color:var(--text-muted);">
            <span>Progress</span>
            <span style="color:var(--accent-cyan);font-weight:600;">${pct}%</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>

        <!-- Footer: deadline + avatars -->
        <div class="task-card-footer">
          <div class="task-deadline ${isOverdue ? "overdue" : ""}">
            <i class="ph ph-calendar-blank"></i>
            ${deadlineStr}
          </div>
          <div style="display:flex;align-items:center;padding-left:6px;">
            ${avatars}${overflowBubble}
          </div>
        </div>

        ${adminBtns}
      </div>`;
    })
    .join("");
}

// ─── Modal: open new task ─────────────────────────────────────────────────────
window.openTaskModal = () => {
  document.getElementById("edit-task-id").value = "";
  document.getElementById("task-modal-title").textContent = "Create New Task";
  document.getElementById("task-form").reset();
  selectedAssignees = [];
  renderSelectedAssigneesEl();
  openModal("task-modal");
};

// ─── Modal: open edit task ────────────────────────────────────────────────────
window.openEditTask = async (taskId) => {
  const snap = await getDoc(doc(db, "tasks", taskId));
  if (!snap.exists()) return;
  const t = snap.data();

  document.getElementById("edit-task-id").value = taskId;
  document.getElementById("task-modal-title").textContent = "Edit Task";
  document.getElementById("tf-title").value = t.title;
  document.getElementById("tf-desc").value = t.description || "";
  document.getElementById("tf-priority").value = t.priority || "medium";
  document.getElementById("tf-status").value = t.status || "pending";

  if (t.deadline) {
    const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    document.getElementById("tf-deadline").value = d.toISOString().slice(0, 16);
  }

  document.getElementById("tf-tags").value = (t.tags || []).join(", ");
  document.getElementById("tf-common").checked = t.isCommonTask || false;
  selectedAssignees = [...(t.assignedTo || [])];
  renderSelectedAssigneesEl();
  openModal("task-modal");
};

// ─── Modal: submit (create or edit) ──────────────────────────────────────────
window.submitTask = async (e) => {
  e.preventDefault();
  const taskId = document.getElementById("edit-task-id").value;
  const title = document.getElementById("tf-title").value.trim();
  const desc = document.getElementById("tf-desc").value.trim();
  const priority = document.getElementById("tf-priority").value;
  const status = document.getElementById("tf-status").value;
  const deadlineVal = document.getElementById("tf-deadline").value;
  const deadlineInput = document.getElementById("tf-deadline");
  const tags = document
    .getElementById("tf-tags")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const isCommon = document.getElementById("tf-common").checked;
  const assignedTo = selectedAssignees.length
    ? [...selectedAssignees]
    : [currentUser.id];

  if (!title || !deadlineInput.checkValidity()) {
    showToast("Enter valid title and deadline", "error");
    return;
  }

  const btn = document.getElementById("task-form-submit");
  btn.disabled = true;

  try {
    if (taskId) {
      await updateDoc(doc(db, "tasks", taskId), {
        title,
        description: desc,
        priority,
        status,
        tags,
        isCommonTask: isCommon,
        visibility: isCommon ? "global" : "team",
        assignedTo,
        deadline: Timestamp.fromDate(new Date(deadlineVal)),
        updatedAt: serverTimestamp(),
      });
      await logTaskAction(
        taskId,
        "task_updated",
        "",
        "",
        "Task details updated",
      );
      showToast("Task updated!", "success");
    } else {
      const ref = await addDoc(collection(db, "tasks"), {
        title,
        description: desc,
        priority,
        status: "pending",
        assignedTo,
        createdBy: currentUser.id,
        deadline: Timestamp.fromDate(new Date(deadlineVal)),
        tags,
        isCommonTask: isCommon,
        visibility: isCommon ? "global" : "team",
        completionPercentage: 0,
        remarks: [],
        attachments: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const uid of assignedTo) {
        if (uid !== currentUser.id) {
          await createNotification(
            uid,
            "task_assigned",
            `You've been assigned: "${title}"`,
            ref.id,
          );
        }
      }

      await addDoc(collection(db, "activityLogs"), {
        userId: currentUser.id,
        date: new Date().toISOString().split("T")[0],
        activityCount: 1,
        type: "task_created",
        taskId: ref.id,
        timestamp: serverTimestamp(),
      });

      showToast("Task created!", "success");
    }

    closeModal("task-modal");
    selectedAssignees = [];
  } catch (err) {
    console.error("submitTask error:", err);
    showToast("Failed to save task: " + (err.code || err.message), "error");
  }

  btn.disabled = false;
};

// ─── Delete task ──────────────────────────────────────────────────────────────
window.confirmDeleteTask = async (taskId) => {
  const task = allTasks.find((t) => t.id === taskId);
  const confirmed = await showConfirm(
    `Delete "${task?.title || "this task"}"? This cannot be undone.`,
    "Delete",
  );
  if (confirmed) {
    try {
      await deleteDoc(doc(db, "tasks", taskId));
      showToast("Task deleted", "success");
    } catch (err) {
      showToast("Failed to delete task", "error");
    }
  }
};

// ─── Assignee search ──────────────────────────────────────────────────────────
window.searchAssignees = (val = "") => {
  const resultsEl = document.getElementById("tf-assignee-results");
  if (!resultsEl) return;
  const q = val.toLowerCase();
  const filtered = allUsers.filter((u) => {
    if (selectedAssignees.includes(u.id)) return false;
    if (q && !(u.displayName || "").toLowerCase().includes(q)) return false;
    if (currentUser.role === "admin" && u.role === "super_admin") return false;
    return true;
  });

  if (!filtered.length) {
    resultsEl.style.display = "none";
    return;
  }

  resultsEl.style.display = "block";
  resultsEl.innerHTML = filtered
    .map(
      (u) => `
    <div onclick="selectAssignee('${u.id}')"
      style="padding:9px 13px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:9px;"
      onmouseover="this.style.background='rgba(255,255,255,0.06)'"
      onmouseout="this.style.background='transparent'">
      <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--accent-cyan),var(--accent-purple));display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;">${getInitials(u.displayName)}</div>
      <div>
        <div style="font-weight:500;">${sanitizeHtml(u.displayName)}</div>
        <div style="font-size:10px;color:var(--text-muted);">${sanitizeHtml(u.role)}</div>
      </div>
    </div>`,
    )
    .join("");
};

window.selectAssignee = (uid) => {
  if (!selectedAssignees.includes(uid)) {
    selectedAssignees.push(uid);
    renderSelectedAssigneesEl();
  }
  document.getElementById("tf-assign-search").value = "";
  document.getElementById("tf-assignee-results").style.display = "none";
};

window.removeAssignee = (uid) => {
  selectedAssignees = selectedAssignees.filter((id) => id !== uid);
  renderSelectedAssigneesEl();
};

function renderSelectedAssigneesEl() {
  const el = document.getElementById("tf-selected-assignees");
  if (!el) return;
  el.innerHTML = selectedAssignees
    .map((uid) => {
      const u = assigneeMap[uid];
      return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;background:rgba(0,220,255,0.1);border:1px solid rgba(0,220,255,0.2);border-radius:999px;font-size:11px;">
      ${sanitizeHtml(u?.displayName || uid)}
      <button onclick="removeAssignee('${uid}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px;">×</button>
    </span>`;
    })
    .join("");
}

// ─── Task audit log ───────────────────────────────────────────────────────────
async function logTaskAction(taskId, actionType, prev, next, desc) {
  try {
    await addDoc(collection(db, "taskLogs"), {
      taskId,
      updatedBy: currentUser?.id,
      actionType,
      previousValue: prev,
      newValue: next,
      description: desc,
      timestamp: serverTimestamp(),
    });
  } catch (_) {}
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id)?.classList.add("active");
}
window.closeModal = (id) =>
  document.getElementById(id)?.classList.remove("active");
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay"))
    e.target.classList.remove("active");
});
document.addEventListener("click", (e) => {
  const input = document.getElementById("tf-assign-search");
  const results = document.getElementById("tf-assignee-results");
  if (!input || !results) return;
  if (!input.contains(e.target) && !results.contains(e.target))
    results.style.display = "none";
});
