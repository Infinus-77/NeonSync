// Task Detail page — FIXED: consistent activityLog writes, overdue auto-detect, all actions logged
import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications, createNotification } from "./notifications.js";
import { checkDeadlineAlerts } from "./deadline-alert.js";
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
  arrayRemove,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  statusBadge,
  priorityBadge,
  formatDate,
  formatDateTime,
  timeAgo,
  getInitials,
  roleBadge,
  showToast,
  sanitizeHtml,
  showConfirm,
  avatarHTML,
} from "./utils.js";

const taskId = new URLSearchParams(location.search).get("id");
let taskData = null;
let currentUser;
let allUsers = {};
let taskChatId = null;
let editSelectedUsers = [];
let pendingEditReferenceLinks = [];

if (!taskId) window.location.href = "tasks.html";

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
  checkDeadlineAlerts(user);

  const usersSnap = await getDocs(query(collection(db, "users"), where("companyId", "==", user.companyId)));
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
      window.location.href = "tasks.html";
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
    ${t.isCommonTask ? '<span class="badge" style="background:rgba(139,92,246,0.14);color:var(--purple);border:1px solid rgba(139,92,246,0.30);">Common Task</span>' : ""}
  `;

  const isAssignedInit = (t.assignedTo || []).includes(currentUser.id) || (t.isCommonTask && t.status === "pending");
  const myProgInit = isAssignedInit && t.userProgress && t.userProgress[currentUser.id] ? t.userProgress[currentUser.id] : null;
  
  const statusSel = document.getElementById("status-select");
  statusSel.value = myProgInit ? (myProgInit.status || "pending") : (t.status || "pending");

  if (currentUser.role === "member" || currentUser.role === "college_ambassador") {
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
    ? `<span class="${overdue ? "text-danger" : ""}">${formatDateTime(t.deadline)}${overdue ? " (Overdue)" : ""}</span>`
    : "No deadline";

  const displayAssignees = [...(t.assignedTo || [])];
  const roleWeight = { super_admin: 1, admin: 2, member: 3, college_ambassador: 3 };
  displayAssignees.sort((a, b) => {
    const roleA = allUsers[a]?.role || "member";
    const roleB = allUsers[b]?.role || "member";
    const wA = roleWeight[roleA] || 4;
    const wB = roleWeight[roleB] || 4;
    if (wA !== wB) return wA - wB;
    const nameA = (allUsers[a]?.displayName || "").toLowerCase();
    const nameB = (allUsers[b]?.displayName || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const canEdit =
    currentUser.role === "super_admin" ||
    currentUser.role === "admin" ||
    t.createdBy === currentUser.id;

  document.getElementById("task-assignees").innerHTML = displayAssignees
    .map((uid) => {
      const u = allUsers[uid];
      const isLegacy = !t.userProgress;
      const uProg = (t.userProgress && t.userProgress[uid]) || {};
      const uStat = uProg.status || (isLegacy ? (t.status || "pending") : "pending");
      const uPct = uProg.completionPercentage ?? (isLegacy ? (t.completionPercentage || 0) : 0);
      
      const canOverride = canEdit;
      const tagType = canOverride ? "div" : "a";
      const tagHref = canOverride ? "" : `href="profile.html?uid=${uid}"`;
      const clickAction = canOverride ? `onclick="window.openUserProgressModal('${uid}', '${(u?.displayName || "User").replace(/'/g, "\\'")}', ${uPct})"` : "";
      
      const isCompleted = uPct === 100;
      const borderColor = isCompleted ? 'var(--green)' : 'var(--border-glass)';
      const bgStyle = isCompleted ? 'background:rgba(0, 230, 118, 0.08);' : 'background:var(--bg-input);';
      const textColor = isCompleted ? 'color:var(--green);' : 'color:var(--text-muted);';

      return `<${tagType} ${tagHref} ${clickAction} style="display:flex;align-items:center;gap:6px;padding:4px 10px;${bgStyle}border:1px solid ${borderColor};border-radius:999px;font-size:12px;text-decoration:none;color:var(--text-primary);transition:var(--transition);cursor:pointer;"
      onmouseover="this.style.borderColor='var(--blue)'" onmouseout="this.style.borderColor='${borderColor}'" ${canOverride ? 'title="Click to update progress"' : ''}>
      <div style="width:22px;height:22px;border-radius:50%;background:var(--gradient-brand);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;overflow:hidden;flex-shrink:0;">${avatarHTML(u, 22)}</div>
      <span style="font-weight:500;">${sanitizeHtml(u?.displayName || "Unknown")}</span>
      <span style="font-size:10px;${textColor}display:flex;align-items:center;gap:4px;">${uPct}% - ${statusBadge(uStat).replace(/class="badge badge-[^"]*"/, `style="display:inline;font-size:9px;padding:0;background:none;border:none;${textColor}"`)}</span>
      </${tagType}>`;
    })
    .join("");

  const isAssigned = (t.assignedTo || []).includes(currentUser.id) || (t.isCommonTask && t.status === "pending");
  const myProg = isAssigned && t.userProgress && t.userProgress[currentUser.id] ? t.userProgress[currentUser.id] : null;
  const pct = myProg ? (myProg.completionPercentage || 0) : (t.completionPercentage || 0);
  
  updateRing(pct);
  document.getElementById("completion-slider").value = pct;
  
  const totalSection = document.getElementById("total-progress-section");
  const pTitle = document.getElementById("personal-progress-title");
  if (isAssigned) {
    if (totalSection) totalSection.style.display = "flex";
    if (pTitle) pTitle.textContent = "Your Progress";
    updateTotalRing(t.completionPercentage || 0, t.status);
  } else {
    if (totalSection) totalSection.style.display = "none";
    if (pTitle) pTitle.textContent = "Progress";
  }

  if (isAssigned || (currentUser.role !== "member" && currentUser.role !== "college_ambassador")) {
    document.getElementById("completion-control").style.display = "block";
  }


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
          `<span style="padding:4px 12px;background:rgba(0,242,255,0.10);border:1px solid rgba(0,242,255,0.20);border-radius:999px;font-size:12px;color:var(--blue);">${sanitizeHtml(tag)}</span>`,
      )
      .join("");
  }

  renderRemarks(t.remarks || []);
  renderReferenceLinks(t.referenceLinks || []);
  renderAttachments(t.attachments || []);
}

function renderReferenceLinks(links) {
  const listEl = document.getElementById("reference-links-list");
  const sectionEl = document.getElementById("reference-links-section");
  if (!listEl || !sectionEl) return;
  
  if (!links || !links.length) {
    sectionEl.style.display = "none";
    return;
  }

  sectionEl.style.display = "block";
  listEl.innerHTML = links
    .map(
      (l) => `
    <div style="display:flex;align-items:center;gap:8px;">
      <i class="ph ph-link" style="color:var(--cyan);"></i>
      <a href="${l.url}" target="_blank" style="font-size:13px;color:var(--cyan);text-decoration:none;">${sanitizeHtml(l.title)}</a>
    </div>
  `
    )
    .join("");
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
      const canDelete = r.userId === currentUser.id || currentUser.role === "super_admin" || currentUser.role === "admin";
      return `
      <div class="remark-item" data-testid="remark-${r.userId}">
        <div class="remark-avatar" style="overflow:hidden;">${avatarHTML(u, 36)}</div>
        <div class="remark-content">
          <div class="remark-header" style="display:flex;align-items:center;width:100%;gap:8px;">
            <span class="remark-author">${sanitizeHtml(u?.displayName || "User")}</span>
            <span class="remark-time">${timeAgo({ toDate: () => new Date(r.timestamp) })}</span>
            ${canDelete ? `
            <button class="remark-delete-btn" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;transition:color 0.15s;margin-left:auto;"
              onmouseover="this.style.color='var(--danger)'"
              onmouseout="this.style.color='var(--text-muted)'"
              onclick="window.deleteRemark('${r.timestamp}', '${r.userId}')"
              title="Delete remark">
              <i class="ph ph-trash"></i>
            </button>
            ` : ""}
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
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg-input);border:1px solid var(--border-glass);border-radius:var(--radius-md);margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <i class="ph ph-link" style="color:var(--blue);"></i>
        <a href="${a.fileURL}" target="_blank" style="font-size:12px;color:var(--blue);">${a.fileName}</a>
      </div>
      <span style="font-size:10px;color:var(--text-muted);">${timeAgo({ toDate: () => new Date(a.timestamp) })}</span>
    </div>
  `,
    )
    .join("");
}

// Status update — writes activity log every time
window.updateStatus = async (newStatus) => {
  if (!taskData) return;
  let isAssigned = (taskData.assignedTo || []).includes(currentUser.id);
  const isCommonPending = !isAssigned && taskData.isCommonTask && taskData.status === "pending";
  const myProg = (isAssigned || isCommonPending) && taskData.userProgress && taskData.userProgress[currentUser.id] ? taskData.userProgress[currentUser.id] : null;
  const old = myProg ? myProg.status : taskData.status;
  if (old === newStatus) return;

  try {
    let updates = { updatedAt: serverTimestamp() };
    
    if (isCommonPending) {
      updates.assignedTo = arrayUnion(currentUser.id);
      taskData.assignedTo = [...(taskData.assignedTo || []), currentUser.id];
      isAssigned = true;
    }
    
    if (isAssigned) {
      updates[`userProgress.${currentUser.id}.status`] = newStatus;
      updates[`userProgress.${currentUser.id}.updatedAt`] = serverTimestamp();
      
      // Compute aggregates
      const assignees = taskData.assignedTo || [];
      const isLegacy = !taskData.userProgress;
      const userProgress = { ...taskData.userProgress };
      if (!userProgress[currentUser.id]) userProgress[currentUser.id] = {};
      userProgress[currentUser.id].status = newStatus;
      
      let allCompleted = assignees.length > 0;
      for (const uid of assignees) {
        const fallbackStatus = isLegacy ? (taskData.status || "pending") : "pending";
        if ((userProgress[uid]?.status || fallbackStatus) !== "completed") {
          allCompleted = false;
          break;
        }
      }
      
      updates.status = allCompleted ? "completed" : "in-progress";
      // If someone marks review, maybe bump overall to review? Keep it simple for now: "completed" or "in-progress" unless original was pending.
      if (!allCompleted && taskData.status === "pending" && newStatus !== "pending") updates.status = "in-progress";
      
    } else {
      updates.status = newStatus;
    }

    await updateDoc(doc(db, "tasks", taskId), updates);
    await addTaskLog("status_change", old || "pending", newStatus);
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

// Ring helper: updates SVG ring offset, label, input, and stroke color
function updateRing(pct) {
  pct = Math.max(0, Math.min(100, pct));
  const circumference = 326.73;
  const offset = circumference * (1 - pct / 100);
  const ring = document.getElementById("completion-ring-fill");
  if (ring) {
    ring.style.strokeDashoffset = offset;
    if (pct >= 100) ring.style.stroke = "var(--green)";
    else if (pct >= 50) ring.style.stroke = "var(--cyan)";
    else if (pct >= 25) ring.style.stroke = "var(--amber)";
    else ring.style.stroke = "var(--rose)";
  }
  document.getElementById("completion-pct-label").textContent = `${pct}%`;
  const input = document.getElementById("completion-input");
  if (input && document.activeElement !== input) input.value = pct;
}

window.updateOverridePreview = (val) => {
  let pct = Math.max(0, Math.min(100, parseInt(val) || 0));
  const circumference = 326.73;
  const offset = circumference * (1 - pct / 100);
  const ring = document.getElementById("override-ring-fill");
  if (ring) {
    ring.style.strokeDashoffset = offset;
    if (pct >= 100) ring.style.stroke = "var(--green)";
    else if (pct >= 50) ring.style.stroke = "var(--cyan)";
    else if (pct >= 25) ring.style.stroke = "var(--amber)";
    else ring.style.stroke = "var(--rose)";
  }
  document.getElementById("override-pct-label").textContent = `${pct}%`;
};

window.openUserProgressModal = (uid, name, pct) => {
  document.getElementById("override-user-id").value = uid;
  document.getElementById("override-user-name").textContent = name;
  document.getElementById("override-completion-input").value = pct;
  window.updateOverridePreview(pct);
  openModal("user-progress-modal");
};

window.saveUserProgressOverride = async () => {
  const uid = document.getElementById("override-user-id").value;
  const pct = parseInt(document.getElementById("override-completion-input").value) || 0;
  
  try {
    const isAssigned = (taskData.assignedTo || []).includes(uid);
    if (!isAssigned) {
      showToast("User is not assigned to this task", "error");
      return;
    }
    
    let updates = { updatedAt: serverTimestamp() };
    updates[`userProgress.${uid}.completionPercentage`] = pct;
    updates[`userProgress.${uid}.updatedAt`] = serverTimestamp();
    
    const newStatus = pct === 100 ? "completed" : "in-progress";
    updates[`userProgress.${uid}.status`] = newStatus;
    
    const assignees = taskData.assignedTo || [];
    const isFirstTimeProgress = !taskData.userProgress;
    const userProgress = { ...(taskData.userProgress || {}) };
    
    // If this is the very first time we are creating the userProgress map (e.g. migrating a legacy task),
    // we MUST seed all current assignees with the task's overall legacy progress, 
    // so they don't default to 0% in the future.
    if (isFirstTimeProgress) {
      const fallbackPct = taskData.completionPercentage || 0;
      const fallbackStatus = taskData.status || "pending";
      for (const id of assignees) {
        userProgress[id] = { completionPercentage: fallbackPct, status: fallbackStatus };
        updates[`userProgress.${id}.completionPercentage`] = fallbackPct;
        updates[`userProgress.${id}.status`] = fallbackStatus;
        updates[`userProgress.${id}.updatedAt`] = serverTimestamp();
      }
    }
    
    if (!userProgress[uid]) userProgress[uid] = {};
    userProgress[uid].completionPercentage = pct;
    userProgress[uid].status = newStatus;
    
    // Now explicitly overwrite the targeted user's progress in the database updates
    updates[`userProgress.${uid}.completionPercentage`] = pct;
    updates[`userProgress.${uid}.status`] = newStatus;
    updates[`userProgress.${uid}.updatedAt`] = serverTimestamp();
    
    let totalPct = 0;
    let allCompleted = assignees.length > 0;
    
    for (const id of assignees) {
      // If a user was somehow added later and still missing, default to 0
      const currPct = userProgress[id]?.completionPercentage || 0;
      const currStat = userProgress[id]?.status || "pending";
      
      totalPct += currPct;
      if (currStat !== "completed") {
        allCompleted = false;
      }
    }
    
    updates.completionPercentage = assignees.length > 0 ? Math.round(totalPct / assignees.length) : pct;
    updates.status = allCompleted ? "completed" : (taskData.status === "pending" && pct > 0 ? "in-progress" : taskData.status);
    
    await updateDoc(doc(db, "tasks", taskId), updates);
    closeModal("user-progress-modal");
    showToast("Progress updated successfully", "success");
    
    // Log activity using the standard helper methods
    await addTaskLog(
      "percentage_update",
      "override",
      `${pct}% (${document.getElementById("override-user-name").textContent})`
    );
    await writeActivityLog("percentage_update");
    
  } catch(e) {
    console.error(e);
    showToast("Failed to update progress", "error");
  }
};

function updateTotalRing(pct, status) {
  pct = Math.max(0, Math.min(100, pct));
  const circumference = 326.73;
  const offset = circumference * (1 - pct / 100);
  const ring = document.getElementById("total-ring-fill");
  if (ring) {
    ring.style.strokeDashoffset = offset;
    if (pct >= 100) ring.style.stroke = "var(--green)";
    else if (pct >= 50) ring.style.stroke = "var(--cyan)";
    else if (pct >= 25) ring.style.stroke = "var(--amber)";
    else ring.style.stroke = "var(--rose)";
  }
  const label = document.getElementById("total-pct-label");
  if (label) label.textContent = `${pct}%`;
  
  const statusLabel = document.getElementById("total-status-label");
  if (statusLabel) {
    statusLabel.textContent = status || "Pending";
    if (status === "completed") statusLabel.style.color = "var(--green)";
    else if (status === "in-progress") statusLabel.style.color = "var(--cyan)";
    else statusLabel.style.color = "var(--text-muted)";
  }
}

window.updateCompletionPreview = (val) => {
  updateRing(parseInt(val) || 0);
};

// Stepper: +/- buttons increment by 5
window.stepCompletion = async (delta) => {
  const current = parseInt(document.getElementById("completion-slider").value) || 0;
  const next = Math.max(0, Math.min(100, current + delta));
  updateRing(next);
  document.getElementById("completion-slider").value = next;
  await saveCompletion();
};

// Direct input: live preview while typing
window.previewFromInput = (val) => {
  const pct = Math.max(0, Math.min(100, parseInt(val) || 0));
  updateRing(pct);
};

// Direct input: save on blur/enter
window.commitFromInput = async (val) => {
  const pct = Math.max(0, Math.min(100, parseInt(val) || 0));
  updateRing(pct);
  document.getElementById("completion-slider").value = pct;
  await saveCompletion();
};

// ✅ FIX: Saves completion AND writes activity log
window.saveCompletion = async () => {
  const pct = parseInt(document.getElementById("completion-slider").value);
  try {
    let isAssigned = (taskData.assignedTo || []).includes(currentUser.id);
    const isCommonPending = !isAssigned && taskData.isCommonTask && taskData.status === "pending";
    let updates = { updatedAt: serverTimestamp() };
    
    if (isCommonPending) {
      updates.assignedTo = arrayUnion(currentUser.id);
      taskData.assignedTo = [...(taskData.assignedTo || []), currentUser.id];
      isAssigned = true;
    }
    
    if (isAssigned) {
      updates[`userProgress.${currentUser.id}.completionPercentage`] = pct;
      updates[`userProgress.${currentUser.id}.updatedAt`] = serverTimestamp();
      
      const newStatus = pct === 100 ? "completed" : "in-progress";
      updates[`userProgress.${currentUser.id}.status`] = newStatus;
      
      const assignees = taskData.assignedTo || [];
      const isFirstTimeProgress = !taskData.userProgress;
      const userProgress = { ...(taskData.userProgress || {}) };
      
      if (isFirstTimeProgress) {
        const fallbackPct = taskData.completionPercentage || 0;
        const fallbackStatus = taskData.status || "pending";
        for (const id of assignees) {
          userProgress[id] = { completionPercentage: fallbackPct, status: fallbackStatus };
          updates[`userProgress.${id}.completionPercentage`] = fallbackPct;
          updates[`userProgress.${id}.status`] = fallbackStatus;
          updates[`userProgress.${id}.updatedAt`] = serverTimestamp();
        }
      }
      
      if (!userProgress[currentUser.id]) userProgress[currentUser.id] = {};
      userProgress[currentUser.id].completionPercentage = pct;
      userProgress[currentUser.id].status = newStatus;
      
      let totalPct = 0;
      let allCompleted = assignees.length > 0;
      for (const uid of assignees) {
        const currPct = userProgress[uid]?.completionPercentage || 0;
        const currStat = userProgress[uid]?.status || "pending";
        
        totalPct += currPct;
        if (currStat !== "completed") {
          allCompleted = false;
        }
      }
      
      updates.completionPercentage = assignees.length > 0 ? Math.round(totalPct / assignees.length) : pct;
      updates.status = allCompleted ? "completed" : (taskData.status === "pending" && pct > 0 ? "in-progress" : taskData.status);
      
    } else {
      updates.completionPercentage = pct;
      if (pct === 100) updates.status = "completed";
    }

    await updateDoc(doc(db, "tasks", taskId), updates);
    
    const oldPct = isAssigned && taskData.userProgress ? (taskData.userProgress[currentUser.id]?.completionPercentage || 0) : (taskData.completionPercentage || 0);
    
    await addTaskLog(
      "percentage_update",
      String(oldPct),
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

window.deleteRemark = async (timestamp, userId) => {
  const confirmed = await showConfirm("Are you sure you want to delete this remark?");
  if (!confirmed) return;

  try {
    const remarkToDelete = taskData.remarks.find((r) => r.timestamp === timestamp && r.userId === userId);
    if (!remarkToDelete) {
      showToast("Remark not found", "error");
      return;
    }

    await updateDoc(doc(db, "tasks", taskId), {
      remarks: arrayRemove(remarkToDelete),
      updatedAt: serverTimestamp(),
    });

    await addTaskLog("remark_deleted", "", remarkToDelete.message);
    showToast("Remark deleted", "success");
  } catch (err) {
    console.error("Delete remark error:", err);
    showToast("Failed to delete remark", "error");
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
        <div class="message-avatar">${avatarHTML(u, 26)}</div>
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
      companyId: currentUser.companyId,
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
      <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:12px;">
        <div style="width:28px;height:28px;border-radius:50%;background:rgba(0,242,255,0.10);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--blue);">
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
      companyId: currentUser.companyId,
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
      companyId: currentUser?.companyId,
      updatedBy: currentUser?.id,
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
    const dStr = d.toISOString().slice(0, 16);
    document.getElementById("edit-deadline").value = dStr;
    if (document.getElementById("edit-deadline")._flatpickr) {
      document.getElementById("edit-deadline")._flatpickr.setDate(dStr);
    }
  }
  editSelectedUsers = [...(taskData.assignedTo || [])];
  pendingEditReferenceLinks = taskData.referenceLinks ? [...taskData.referenceLinks] : [];
  renderEditSelectedAssignees();
  renderEditFormReferenceLinks();
  openModal("edit-task-modal");
};

window.submitEditTask = async (e) => {
  e.preventDefault();
  const title = document.getElementById("edit-title").value.trim();
  const desc = document.getElementById("edit-desc").value.trim();
  const priority = document.getElementById("edit-priority").value;
  const dl = document.getElementById("edit-deadline").value;
  const assignedTo = editSelectedUsers.length ? [...editSelectedUsers] : [currentUser.id];

  try {
    await updateDoc(doc(db, "tasks", taskId), {
      title,
      description: desc,
      priority,
      assignedTo,
      referenceLinks: pendingEditReferenceLinks,
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
    setTimeout(() => (window.location.href = "tasks.html"), 1000);
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

window.searchEditAssignees = (val = "") => {
  const resultsEl = document.getElementById("edit-assignee-results");
  if (!resultsEl) return;
  const q = val.toLowerCase();
  const usersArray = Object.values(allUsers);
  const filtered = usersArray.filter((u) => {
    if (editSelectedUsers.includes(u.id)) return false;
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
    <div onclick="selectEditAssignee('${u.id}')"
      style="padding:9px 13px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:9px;"
      onmouseover="this.style.background='rgba(255,255,255,0.04)'"
      onmouseout="this.style.background='transparent'">
      <div style="width:26px;height:26px;border-radius:50%;background:var(--gradient-brand);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;overflow:hidden;flex-shrink:0;">${avatarHTML(u, 26)}</div>
      <div>
        <div style="font-weight:500;">${sanitizeHtml(u.displayName)}</div>
        <div style="font-size:10px;color:var(--text-muted);">${sanitizeHtml(u.role)}</div>
      </div>
    </div>`
    )
    .join("");
};

window.selectEditAssignee = (uid) => {
  if (!editSelectedUsers.includes(uid)) {
    editSelectedUsers.push(uid);
    renderEditSelectedAssignees();
  }
  document.getElementById("edit-assign-search").value = "";
  document.getElementById("edit-assignee-results").style.display = "none";
};

window.removeEditAssignee = (uid) => {
  editSelectedUsers = editSelectedUsers.filter((id) => id !== uid);
  renderEditSelectedAssignees();
};

window.addEditFormReferenceLink = () => {
  const title = document.getElementById("edit-tf-ref-title").value.trim();
  const url = document.getElementById("edit-tf-ref-url").value.trim();
  if (!title || !url) {
    showToast("Title and URL required", "error");
    return;
  }
  pendingEditReferenceLinks.push({
    title,
    url,
    addedBy: currentUser.id,
    timestamp: new Date().toISOString()
  });
  document.getElementById("edit-tf-ref-title").value = "";
  document.getElementById("edit-tf-ref-url").value = "";
  renderEditFormReferenceLinks();
};

window.removeEditFormReferenceLink = (index) => {
  pendingEditReferenceLinks.splice(index, 1);
  renderEditFormReferenceLinks();
};

window.renderEditFormReferenceLinks = () => {
  const container = document.getElementById("edit-tf-reference-links-list");
  if (!container) return;
  container.innerHTML = pendingEditReferenceLinks.map((l, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:rgba(255,255,255,0.03);border:1px solid var(--border-glass);border-radius:6px;font-size:12px;">
      <div style="display:flex;align-items:center;gap:6px;overflow:hidden;">
        <i class="ph ph-link" style="color:var(--cyan);flex-shrink:0;"></i>
        <span style="color:var(--cyan);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${sanitizeHtml(l.title)}">${sanitizeHtml(l.title)}</span>
      </div>
      <button type="button" onclick="removeEditFormReferenceLink(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;flex-shrink:0;"><i class="ph ph-trash"></i></button>
    </div>
  `).join("");
};

function renderEditSelectedAssignees() {
  const el = document.getElementById("edit-selected-assignees");
  if (!el) return;
  el.innerHTML = editSelectedUsers
    .map((uid) => {
      const u = allUsers[uid];
      return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;background:rgba(0,242,255,0.10);border:1px solid rgba(0,242,255,0.20);border-radius:999px;font-size:11px;">
      ${sanitizeHtml(u?.displayName || uid)}
      <button type="button" onclick="removeEditAssignee('${uid}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px;">×</button>
    </span>`;
    })
    .join("");
}

document.addEventListener("click", (e) => {
  const input = document.getElementById("edit-assign-search");
  const results = document.getElementById("edit-assignee-results");
  if (!input || !results) return;
  if (!input.contains(e.target) && !results.contains(e.target))
    results.style.display = "none";
});

// Initialize flatpickr for deadline input
if (typeof flatpickr !== "undefined") {
  flatpickr("#edit-deadline", {
    enableTime: true,
    dateFormat: "Y-m-d\\TH:i",
    altInput: true,
    altFormat: "d/m/Y h:i K"
  });
}

// Share Task Detail Link
window.shareTaskLink = async () => {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link copied to clipboard!", "success");
  } catch (err) {
    showToast("Failed to copy link", "error");
  }
};
