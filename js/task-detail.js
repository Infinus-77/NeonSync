// Task Detail page — FIXED: consistent activityLog writes, overdue auto-detect, all actions logged
import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications, createNotification } from "./notifications.js";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  statusBadge,
  priorityBadge,
  formatDate,
  timeAgo,
  getInitials,
  roleBadge,
  showToast,
  sanitizeHtml,
  showConfirm,
} from "./utils.js";

const taskId = new URLSearchParams(location.search).get("id");
let taskData = null;
let currentUser;
let allUsers = {};
let taskChatId = null;

if (!taskId) window.location.href = "../public/tasks.html";

requireAuth(async (user) => {
  // Hide the page-level loading overlay now that auth has resolved
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    loadingOverlay.style.transition = "opacity 0.3s ease";
    setTimeout(() => loadingOverlay.remove(), 320);
  }
  currentUser = user;
  renderSidebar("tasks", user);
  initNotifications(user.id);

  const usersSnap = await getDocs(collection(db, "users"));
  usersSnap.docs.forEach((d) => {
    allUsers[d.id] = { id: d.id, ...d.data() };
  });

  loadTask();
  loadTaskChat();
  loadTaskLogs();

  // ✅ FIX: Write activity log on page visit (contributes to heatmap)
  await writeActivityLog("task_viewed");
});

function loadTask() {
  const ref = doc(db, "tasks", taskId);
  onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      window.location.href = "../public/tasks.html";
      return;
    }
    taskData = { id: snap.id, ...snap.data() };

    // ✅ FIX: Auto-mark overdue on load
    autoMarkOverdueSingle(taskData);
    renderTask(taskData);
  });
}

async function autoMarkOverdueSingle(t) {
  if (!t.deadline || t.status === "completed" || t.status === "overdue") return;
  const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
  if (d < new Date()) {
    await updateDoc(doc(db, "tasks", taskId), {
      status: "overdue",
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
}

function renderTask(t) {
  const now = new Date();
  const deadline = t.deadline
    ? t.deadline.toDate
      ? t.deadline.toDate()
      : new Date(t.deadline)
    : null;
  const overdue = deadline && t.status !== "completed" && deadline < now;

  document.title = `${sanitizeHtml(t.title)} - NeonSync`;
  document.getElementById("task-title-display").textContent = t.title;
  document.getElementById("task-meta-display").textContent =
    `Created ${t.createdAt ? timeAgo(t.createdAt) : ""} · ${(t.assignedTo || []).length} assignee(s)`;
  document.getElementById("task-description").textContent =
    t.description || "No description provided.";

  document.getElementById("task-badges").innerHTML = `
    ${statusBadge(overdue ? "overdue" : t.status)}
    ${priorityBadge(t.priority || "medium")}
    ${t.isCommonTask ? '<span class="badge" style="background:rgba(189,0,255,0.14);color:var(--accent-purple);border:1px solid rgba(189,0,255,0.3);">Common Task</span>' : ""}
  `;

  const statusSel = document.getElementById("status-select");
  statusSel.value = t.status || "pending";

  if (currentUser.role === "member") {
    const flow = ["pending", "in-progress", "review", "completed"];
    const current = flow.indexOf(t.status);
    Array.from(statusSel.options).forEach((opt) => {
      opt.disabled = flow.indexOf(opt.value) < current;
    });
  }

  const creator = allUsers[t.createdBy];
  document.getElementById("task-creator").textContent = creator
    ? creator.displayName
    : "Unknown";

  const dlEl = document.getElementById("task-deadline-display");
  dlEl.innerHTML = deadline
    ? `<span class="${overdue ? "text-danger" : ""}">${formatDate(t.deadline)}${overdue ? " (Overdue)" : ""}</span>`
    : "No deadline";

  document.getElementById("task-assignees").innerHTML = (t.assignedTo || [])
    .map((uid) => {
      const u = allUsers[uid];
      return `<a href="../public/profile.html?uid=${uid}" style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(255,255,255,0.05);border:1px solid var(--border-glass);border-radius:999px;font-size:12px;text-decoration:none;color:var(--text-primary);transition:var(--transition);"
      onmouseover="this.style.borderColor='var(--accent-cyan)'" onmouseout="this.style.borderColor='var(--border-glass)'">
      <div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,var(--accent-cyan),var(--accent-purple));display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;">${getInitials(u?.displayName)}</div>
      ${u?.displayName || uid}
    </a>`;
    })
    .join("");

  const pct = t.completionPercentage || 0;
  document.getElementById("completion-pct-label").textContent = `${pct}%`;
  document.getElementById("completion-bar").style.width = `${pct}%`;
  document.getElementById("completion-slider").value = pct;

  const isAssigned = (t.assignedTo || []).includes(currentUser.id);
  if (isAssigned || currentUser.role !== "member") {
    document.getElementById("completion-control").style.display = "block";
  }

  const canEdit =
    currentUser.role === "super_admin" ||
    currentUser.role === "admin" ||
    t.createdBy === currentUser.id;
  document.getElementById("edit-task-btn").style.display = canEdit
    ? "flex"
    : "none";
  document.getElementById("delete-task-btn").style.display =
    currentUser.role === "super_admin" ? "flex" : "none";

  if ((t.tags || []).length) {
    document.getElementById("tags-card").style.display = "block";
    document.getElementById("task-tags-display").innerHTML = t.tags
      .map(
        (tag) =>
          `<span style="padding:4px 12px;background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.2);border-radius:999px;font-size:12px;color:var(--accent-cyan);">${sanitizeHtml(tag)}</span>`,
      )
      .join("");
  }

  renderRemarks(t.remarks || []);
  renderAttachments(t.attachments || []);
}

function renderRemarks(remarks) {
  const el = document.getElementById("remarks-list");
  document.getElementById("remarks-count").textContent = remarks.length
    ? `(${remarks.length})`
    : "";

  if (!remarks.length) {
    el.innerHTML =
      '<div class="empty-state" style="padding:16px;"><i class="ph ph-chat-circle"></i><p>No remarks yet</p></div>';
    return;
  }

  el.innerHTML = [...remarks]
    .reverse()
    .map((r) => {
      const u = allUsers[r.userId];
      return `
      <div class="remark-item" data-testid="remark-${r.userId}">
        <div class="remark-avatar">${getInitials(u?.displayName)}</div>
        <div class="remark-content">
          <div class="remark-header">
            <span class="remark-author">${sanitizeHtml(u?.displayName || "User")}</span>
            <span class="remark-time">${timeAgo({ toDate: () => new Date(r.timestamp) })}</span>
          </div>
          <div class="remark-text">${sanitizeHtml(r.message)}</div>
        </div>
      </div>
    `;
    })
    .join("");
}

function renderAttachments(attachments) {
  const el = document.getElementById("attachments-list");
  if (!attachments.length) {
    el.innerHTML =
      '<div style="font-size:12px;color:var(--text-muted);">No attachments</div>';
    return;
  }

  el.innerHTML = attachments
    .map(
      (a) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.03);border:1px solid var(--border-glass);border-radius:var(--radius-md);margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <i class="ph ph-link" style="color:var(--accent-cyan);"></i>
        <a href="${a.fileURL}" target="_blank" style="font-size:12px;color:var(--accent-cyan);">${a.fileName}</a>
      </div>
      <span style="font-size:10px;color:var(--text-muted);">${timeAgo({ toDate: () => new Date(a.timestamp) })}</span>
    </div>
  `,
    )
    .join("");
}

// ✅ FIX: Status update — writes activity log every time
window.updateStatus = async (newStatus) => {
  if (!taskData) return;
  const old = taskData.status;
  if (old === newStatus) return;

  try {
    await updateDoc(doc(db, "tasks", taskId), {
      status: newStatus,
      updatedAt: serverTimestamp(),
    });
    await addTaskLog("status_change", old, newStatus);
    await writeActivityLog("status_change"); // ✅ feeds heatmap

    if (taskData.createdBy !== currentUser.id) {
      await createNotification(
        taskData.createdBy,
        "status_update",
        `Task "${taskData.title}" status changed to ${newStatus} by ${currentUser.displayName}`,
        taskId,
      );
    }

    showToast("Status updated", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to update status", "error");
  }
};

window.updateCompletionPreview = (val) => {
  document.getElementById("completion-pct-label").textContent = `${val}%`;
  document.getElementById("completion-bar").style.width = `${val}%`;
};

// ✅ FIX: Saves completion AND writes activity log
window.saveCompletion = async () => {
  const pct = parseInt(document.getElementById("completion-slider").value);
  try {
    const updates = { completionPercentage: pct, updatedAt: serverTimestamp() };
    if (pct === 100) updates.status = "completed";

    await updateDoc(doc(db, "tasks", taskId), updates);
    await addTaskLog(
      "percentage_update",
      String(taskData?.completionPercentage || 0),
      String(pct),
    );
    await writeActivityLog("percentage_update"); // ✅ feeds heatmap

    if (
      pct === 100 &&
      taskData?.createdBy &&
      taskData.createdBy !== currentUser.id
    ) {
      await createNotification(
        taskData.createdBy,
        "status_update",
        `Task "${taskData.title}" was marked 100% complete by ${currentUser.displayName}`,
        taskId,
      );
    }

    showToast("Progress saved", "success");
  } catch (err) {
    showToast("Failed to save progress", "error");
  }
};

// ✅ FIX: Remark add — writes activity log
window.addRemark = async () => {
  const msg = document.getElementById("remark-text").value.trim();
  if (!msg) return;

  try {
    const remark = {
      userId: currentUser.id,
      message: msg,
      timestamp: new Date().toISOString(),
    };
    await updateDoc(doc(db, "tasks", taskId), {
      remarks: arrayUnion(remark),
      updatedAt: serverTimestamp(),
    });
    await addTaskLog("remark_added", "", msg);
    await writeActivityLog("remark_added"); // ✅ feeds heatmap

    for (const uid of taskData?.assignedTo || []) {
      if (uid !== currentUser.id) {
        await createNotification(
          uid,
          "remark_added",
          `${currentUser.displayName} added a remark on "${taskData?.title}"`,
          taskId,
        );
      }
    }
    if (
      taskData?.createdBy &&
      taskData.createdBy !== currentUser.id &&
      !(taskData?.assignedTo || []).includes(taskData.createdBy)
    ) {
      await createNotification(
        taskData.createdBy,
        "remark_added",
        `${currentUser.displayName} added a remark on "${taskData?.title}"`,
        taskId,
      );
    }

    document.getElementById("remark-text").value = "";
    showToast("Remark added", "success");
  } catch (err) {
    showToast("Failed to add remark", "error");
  }
};

window.addAttachment = async () => {
  const name = document.getElementById("attach-name").value.trim();
  const url = document.getElementById("attach-url").value.trim();
  if (!name || !url) {
    showToast("Name and URL required", "error");
    return;
  }

  try {
    const att = {
      fileName: name,
      fileURL: url,
      uploadedBy: currentUser.id,
      timestamp: new Date().toISOString(),
    };
    await updateDoc(doc(db, "tasks", taskId), {
      attachments: arrayUnion(att),
      updatedAt: serverTimestamp(),
    });
    await writeActivityLog("attachment_added"); // ✅ feeds heatmap
    document.getElementById("attach-name").value = "";
    document.getElementById("attach-url").value = "";
    showToast("Attachment added", "success");
  } catch (err) {
    showToast("Failed to add attachment", "error");
  }
};

// Task Chat — no longer auto-creates a chat room on task view.
// Chat rooms are only created explicitly by admins via the Chat page.
async function loadTaskChat() {
  const q = query(
    collection(db, "chats"),
    where("type", "==", "task"),
    where("relatedId", "==", taskId),
  );
  const snap = await getDocs(q);

  if (!snap.empty) {
    taskChatId = snap.docs[0].id;
    listenMessages(taskChatId);
  } else {
    // No chat room yet — show a placeholder; admins can create one from Chat page
    const el = document.getElementById("task-messages");
    if (el) {
      el.innerHTML =
        '<div class="empty-state" style="padding:16px;"><i class="ph ph-chat-circle-dashed"></i><p style="margin-top:8px;">No discussion yet</p><p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Admins can create a group for this task from the Chat page.</p></div>';
    }
  }
}

function listenMessages(chatId) {
  const q = query(collection(db, "messages"), where("chatId", "==", chatId));
  onSnapshot(
    q,
    (snap) => {
      const msgs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0),
        );
      renderMessages(msgs);
    },
    (err) => console.error("Messages listener:", err.code, err.message),
  );
}

function renderMessages(msgs) {
  const el = document.getElementById("task-messages");
  if (!msgs.length) {
    el.innerHTML =
      '<div class="empty-state" style="padding:16px;"><i class="ph ph-chat-circle"></i><p>No messages yet</p></div>';
    return;
  }

  el.innerHTML = msgs
    .map((m) => {
      const u = allUsers[m.senderId];
      return `
      <div class="message-item" data-testid="msg-${m.id}">
        <div class="message-avatar"><span style="font-size:12px;">${getInitials(u?.displayName)}</span></div>
        <div class="message-content">
          <div class="message-header">
            <span class="message-sender">${sanitizeHtml(u?.displayName || "User")}</span>
            <span class="message-time">${timeAgo(m.timestamp)}</span>
          </div>
          <div class="message-text">${sanitizeHtml(m.message)}</div>
        </div>
      </div>
    `;
    })
    .join("");

  el.scrollTop = el.scrollHeight;
}

window.sendTaskMessage = async () => {
  if (!taskChatId) return;
  const input = document.getElementById("task-chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";

  try {
    await addDoc(collection(db, "messages"), {
      chatId: taskChatId,
      senderId: currentUser.id,
      message: msg,
      timestamp: serverTimestamp(),
    });
    await writeActivityLog("message_sent"); // ✅ feeds heatmap
  } catch (err) {
    showToast("Failed to send message", "error");
  }
};

// Task Logs
function loadTaskLogs() {
  const q = query(collection(db, "taskLogs"), where("taskId", "==", taskId));
  onSnapshot(
    q,
    (snap) => {
      const logs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0),
        );
      renderLogs(logs);
    },
    (err) => console.error("TaskLogs listener:", err.code, err.message),
  );
}

function renderLogs(logs) {
  const el = document.getElementById("task-logs");
  if (!logs.length) {
    el.innerHTML =
      '<div class="empty-state" style="padding:12px;"><i class="ph ph-list-bullets"></i><p>No activity yet</p></div>';
    return;
  }

  const icons = {
    status_change: "ph-arrows-clockwise",
    remark_added: "ph-chat-circle-text",
    percentage_update: "ph-chart-line",
    task_updated: "ph-pencil",
    default: "ph-activity",
  };

  el.innerHTML = logs
    .slice(0, 20)
    .map((l) => {
      const u = allUsers[l.updatedBy];
      return `
      <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;">
        <div style="width:28px;height:28px;border-radius:50%;background:rgba(0,229,255,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--accent-cyan);">
          <i class="ph ${icons[l.actionType] || icons.default}"></i>
        </div>
        <div style="flex:1;">
          <div style="color:var(--text-primary);">${u?.displayName || "User"} · <span style="color:var(--text-muted);">${(l.actionType || "").replace(/_/g, " ")}</span></div>
          ${
            l.previousValue !== undefined &&
            l.newValue !== undefined &&
            l.previousValue !== l.newValue
              ? `<div style="color:var(--text-muted);font-size:11px;">${l.previousValue} → ${l.newValue}</div>`
              : ""
          }
          <div style="color:var(--text-muted);font-size:10px;margin-top:2px;">${timeAgo(l.timestamp)}</div>
        </div>
      </div>
    `;
    })
    .join("");
}

// ✅ FIX: Centralized activity log writer — used by ALL actions
async function writeActivityLog(type) {
  try {
    await addDoc(collection(db, "activityLogs"), {
      userId: currentUser.id,
      date: new Date().toISOString().split("T")[0],
      activityCount: 1,
      type,
      taskId,
      timestamp: serverTimestamp(),
    });
  } catch (_) {}
}

async function addTaskLog(actionType, previousValue, newValue) {
  try {
    await addDoc(collection(db, "taskLogs"), {
      taskId,
      updatedBy: currentUser.id,
      actionType,
      previousValue,
      newValue,
      timestamp: serverTimestamp(),
    });
  } catch (_) {}
}

// Edit modal
window.openEditModal = () => {
  if (!taskData) return;
  document.getElementById("edit-title").value = taskData.title;
  document.getElementById("edit-desc").value = taskData.description || "";
  document.getElementById("edit-priority").value =
    taskData.priority || "medium";
  if (taskData.deadline) {
    const d = taskData.deadline.toDate
      ? taskData.deadline.toDate()
      : new Date(taskData.deadline);
    document.getElementById("edit-deadline").value = d
      .toISOString()
      .slice(0, 16);
  }
  openModal("edit-task-modal");
};

window.submitEditTask = async (e) => {
  e.preventDefault();
  const title = document.getElementById("edit-title").value.trim();
  const desc = document.getElementById("edit-desc").value.trim();
  const priority = document.getElementById("edit-priority").value;
  const dl = document.getElementById("edit-deadline").value;

  try {
    await updateDoc(doc(db, "tasks", taskId), {
      title,
      description: desc,
      priority,
      ...(dl ? { deadline: Timestamp.fromDate(new Date(dl)) } : {}),
      updatedAt: serverTimestamp(),
    });
    await addTaskLog("task_updated", "", "");
    await writeActivityLog("task_updated"); // ✅ feeds heatmap
    showToast("Task updated!", "success");
    closeModal("edit-task-modal");
  } catch (err) {
    showToast("Failed to update task", "error");
  }
};

window.deleteTask = async () => {
  const confirmed = await showConfirm(
    "Delete this task permanently? This cannot be undone.",
    "Delete",
  );
  if (!confirmed) return;
  try {
    await deleteDoc(doc(db, "tasks", taskId));
    showToast("Task deleted", "success");
    setTimeout(() => (window.location.href = "../public/tasks.html"), 1000);
  } catch (err) {
    showToast("Failed to delete", "error");
  }
};

function openModal(id) {
  document.getElementById(id)?.classList.add("active");
}
window.closeModal = (id) =>
  document.getElementById(id)?.classList.remove("active");
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay"))
    e.target.classList.remove("active");
});
