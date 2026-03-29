// profile.js — Enhanced: full analytics section, charts, priority performance, tag analysis
import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications } from "./notifications.js";
import {
  doc, getDoc, updateDoc, collection, query,
  where, getDocs, serverTimestamp, limit, orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  statusBadge, priorityBadge, formatDate, timeAgo,
  getInitials, roleBadge, showToast, sanitizeHtml,
} from "./utils.js";

let currentUser;
let profileUser;
let profileChartStatus = null;
let profileChartMonthly = null;

const uid = new URLSearchParams(location.search).get("uid");

requireAuth(async (user) => {
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    loadingOverlay.style.transition = "opacity 0.3s ease";
    setTimeout(() => loadingOverlay.remove(), 320);
  }
  currentUser = user;
  window._currentUserId = user.id;

  const targetUid = uid || user.id;
  renderSidebar("profile", user);
  initNotifications(user.id);

  showSkeletons();
  await loadProfile(targetUid);
});

function showSkeletons() {
  document.getElementById("profile-header-inner").innerHTML = `
    <div style="width:80px;height:80px;border-radius:50%;background:rgba(0,0,0,0.03);animation:pulse 1.5s ease infinite;flex-shrink:0;"></div>
    <div style="flex:1;">
      <div style="height:20px;width:200px;margin-bottom:10px;background:rgba(0,0,0,0.03);border-radius:6px;animation:pulse 1.5s ease infinite;"></div>
      <div style="height:14px;width:120px;background:var(--bg-input);border-radius:6px;animation:pulse 1.5s ease 0.2s infinite;"></div>
    </div>
  `;
}

async function loadProfile(targetUid) {
  const snap = await getDoc(doc(db, "users", targetUid));
  if (!snap.exists()) {
    document.getElementById("profile-header-inner").innerHTML =
      '<p style="color:var(--text-muted);">User not found.</p>';
    return;
  }

  profileUser = { id: snap.id, ...snap.data() };

  if (targetUid === currentUser.id) {
    updateDoc(doc(db, "users", targetUid), { lastActive: serverTimestamp() }).catch(() => {});
  }

  renderProfileHeader(profileUser);

  // Load all analytics in parallel
  const tasks = await loadUserTasks(targetUid);
  await Promise.all([
    renderStats(targetUid, tasks, profileUser),
    renderHeatmap(targetUid),
    renderStatusChart(tasks),
    renderMonthlyChart(tasks),
    renderPriorityPerformance(tasks),
    renderTopTags(tasks),
    renderTimeline(tasks),
    renderRecentRemarks(targetUid, tasks),
  ]);
}

async function loadUserTasks(targetUid) {
  const snap = await getDocs(
    query(collection(db, "tasks"), where("assignedTo", "array-contains", targetUid))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function renderProfileHeader(u) {
  const isOwn = u.id === currentUser.id;
  const canEdit = isOwn || currentUser.role === "admin" || currentUser.role === "super_admin";

  document.getElementById("profile-header-inner").innerHTML = `
    <div style="position:relative;flex-shrink:0;">
      <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--purple));display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;overflow:hidden;border:2px solid rgba(79,110,247,0.25);">
        ${u.photoURL
          ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">`
          : `<span>${getInitials(u.displayName || u.name || "?")}</span>`}
      </div>
      <div style="position:absolute;bottom:0;right:0;width:16px;height:16px;background:var(--green);border-radius:50%;border:2px solid var(--bg-body);"></div>
    </div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <h2 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;">${sanitizeHtml(u.displayName || u.name || "User")}</h2>
        ${roleBadge(u.role || "member")}
      </div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">${sanitizeHtml(u.email || "")}</div>
      ${u.bio ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:8px;line-height:1.6;">${sanitizeHtml(u.bio)}</div>` : ""}
      ${(u.skills || []).length ? `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
          ${u.skills.map((s) => `<span style="padding:3px 10px;background:rgba(79,110,247,0.08);border:1px solid rgba(79,110,247,0.18);border-radius:999px;font-size:11px;color:var(--cyan);">${sanitizeHtml(s)}</span>`).join("")}
        </div>` : ""}
      <div style="font-size:11px;color:var(--text-muted);margin-top:10px;display:flex;flex-wrap:wrap;gap:12px;">
        ${u.createdAt ? `<span><i class="ph ph-calendar"></i> Joined ${new Date((u.createdAt.toDate?.() || u.createdAt)).toLocaleDateString("en-US",{month:"long",year:"numeric"})}</span>` : ""}
        ${u.lastActive ? `<span><i class="ph ph-clock"></i> Last active ${timeAgo(u.lastActive)}</span>` : ""}
      </div>
    </div>
    ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="openEditProfile()" style="align-self:flex-start;flex-shrink:0;"><i class="ph ph-pencil"></i> Edit Profile</button>` : ""}
  `;
}

async function renderStats(targetUid, tasks, user) {
  const now = new Date();
  const completed = tasks.filter((t) => t.status === "completed").length;
  const active = tasks.filter((t) => ["in-progress", "review"].includes(t.status)).length;
  const overdue = tasks.filter((t) => {
    if (!t.deadline || t.status === "completed") return false;
    const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    return d < now;
  }).length;
  const rate = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  // Productivity score: weighted formula
  const score = Math.min(100, Math.round(
    (completed * 10) +
    (rate * 0.5) +
    (active * 3) -
    (overdue * 8)
  ));

  document.getElementById("stat-completed").textContent = completed;
  document.getElementById("stat-active").textContent = active;
  document.getElementById("stat-rate").textContent = `${rate}%`;
  document.getElementById("stat-overdue").textContent = overdue;
  document.getElementById("stat-score").textContent = score > 0 ? score : 0;

  // Last active
  const lastActive = user.lastActive;
  document.getElementById("stat-last-active").textContent = lastActive
    ? timeAgo(lastActive)
    : "Never";
}

async function renderHeatmap(targetUid) {
  const el = document.getElementById("heatmap-grid");
  el.innerHTML = "";

  const snap = await getDocs(
    query(collection(db, "activityLogs"), where("userId", "==", targetUid))
  );

  const dateMap = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    const date = data.date || data.timestamp?.toDate?.()?.toISOString().split("T")[0];
    if (date) dateMap[date] = (dateMap[date] || 0) + 1;
  });

  const maxCount = Math.max(...Object.values(dateMap), 1);
  const today = new Date();

  for (let i = 363; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const count = dateMap[dateStr] || 0;
    const intensity = count === 0 ? 0 : Math.ceil((count / maxCount) * 4);
    const colors = [
      "var(--bg-input)",
      "rgba(79,110,247,0.20)",
      "rgba(79,110,247,0.45)",
      "rgba(79,110,247,0.70)",
      "rgba(79,110,247,0.95)",
    ];
    const cell = document.createElement("div");
    cell.className = "heatmap-cell";
    cell.style.background = colors[intensity];
    cell.title = `${dateStr}: ${count} action${count !== 1 ? "s" : ""}`;
    el.appendChild(cell);
  }
}

function renderStatusChart(tasks) {
  const ctx = document.getElementById("profile-chart-status")?.getContext("2d");
  if (!ctx) return;
  if (profileChartStatus) profileChartStatus.destroy();

  const now = new Date();
  const counts = { pending: 0, "in-progress": 0, review: 0, completed: 0, overdue: 0 };
  tasks.forEach((t) => {
    if (t.deadline && t.status !== "completed") {
      const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
      if (d < now) { counts.overdue++; return; }
    }
    const s = t.status || "pending";
    if (counts[s] !== undefined) counts[s]++;
  });

  profileChartStatus = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Pending", "In Progress", "Review", "Completed", "Overdue"],
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ["#52525B", "#00DCFF", "#F5A30A", "#1FCC7A", "#FF4560"],
        borderWidth: 0,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#8888AA", font: { size: 11 }, boxWidth: 10, padding: 10 },
        },
      },
    },
  });
}

function renderMonthlyChart(tasks) {
  const ctx = document.getElementById("profile-chart-monthly")?.getContext("2d");
  if (!ctx) return;
  if (profileChartMonthly) profileChartMonthly.destroy();

  const months = [];
  const createdData = [];
  const completedData = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(d.toLocaleDateString("en-US", { month: "short" }));

    createdData.push(tasks.filter((t) => {
      const cd = t.createdAt?.toDate?.();
      if (!cd) return false;
      return `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, "0")}` === monthKey;
    }).length);

    completedData.push(tasks.filter((t) => {
      if (t.status !== "completed") return false;
      const ud = t.updatedAt?.toDate?.();
      if (!ud) return false;
      return `${ud.getFullYear()}-${String(ud.getMonth() + 1).padStart(2, "0")}` === monthKey;
    }).length);
  }

  profileChartMonthly = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        {
          label: "Assigned",
          data: createdData,
          backgroundColor: "rgba(139,92,246,0.40)",
          borderColor: "#B040FF",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "Completed",
          data: completedData,
          backgroundColor: "rgba(16,185,129,0.40)",
          borderColor: "#1FCC7A",
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#8888AA", font: { size: 11 }, boxWidth: 10 } },
      },
      scales: {
        x: { ticks: { color: "#9ca3af", font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: "#9ca3af", stepSize: 1 }, grid: { color: "rgba(0,0,0,0.05)" } },
      },
    },
  });
}

function renderPriorityPerformance(tasks) {
  const el = document.getElementById("priority-performance");
  if (!tasks.length) return;

  const priorities = ["critical", "high", "medium", "low"];
  const colors = {
    critical: "var(--danger)", high: "var(--pink)",
    medium: "var(--amber)", low: "var(--text-muted)",
  };
  const icons = {
    critical: "ph-fire", high: "ph-arrow-up",
    medium: "ph-minus", low: "ph-arrow-down",
  };

  el.innerHTML = priorities.map((p) => {
    const pTasks = tasks.filter((t) => t.priority === p);
    const done = pTasks.filter((t) => t.status === "completed").length;
    const total = pTasks.length;
    const rate = total ? Math.round((done / total) * 100) : 0;

    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <i class="ph ${icons[p]}" style="color:${colors[p]};font-size:14px;"></i>
            <span style="font-size:13px;font-weight:600;text-transform:capitalize;">${p}</span>
          </div>
          <span style="font-size:12px;color:var(--text-muted);">${done}/${total} · <span style="color:${colors[p]};font-weight:700;">${rate}%</span></span>
        </div>
        <div class="progress-bar-wrap" style="height:5px;">
          <div class="progress-bar-fill" style="width:${rate}%;background:${colors[p]};"></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderTopTags(tasks) {
  const el = document.getElementById("top-tags");
  const tagCount = {};
  tasks.forEach((t) => {
    (t.tags || []).forEach((tag) => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });

  const sorted = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (!sorted.length) {
    el.innerHTML = '<div class="empty-state"><i class="ph ph-tag"></i><p>No tags on your tasks</p></div>';
    return;
  }

  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:4px;">
    ${sorted.map(([tag, count]) => `
      <div style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;
        background:var(--bg-input);border:1px solid var(--border-glass);
        border-radius:999px;font-size:11px;color:var(--text-secondary);">
        ${sanitizeHtml(tag)}
        <span style="background:rgba(79,110,247,0.15);color:var(--cyan);
          border-radius:999px;padding:1px 5px;font-size:10px;font-weight:700;">${count}</span>
      </div>
    `).join("")}
  </div>`;
}

async function renderTimeline(tasks) {
  const el = document.getElementById("task-timeline");
  if (!tasks.length) return;

  const sorted = [...tasks].sort((a, b) => {
    const ta = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
    const tb = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  }).slice(0, 10);

  const colors = {
    completed: "#1FCC7A", "in-progress": "#00DCFF",
    review: "#F5A30A", pending: "#52525B", overdue: "#FF4560",
  };

  el.innerHTML = sorted.map((t) => `
    <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-subtle);">
      <div style="width:10px;height:10px;border-radius:50%;background:${colors[t.status] || "#52525B"};
        margin-top:4px;flex-shrink:0;box-shadow:0 0 6px ${colors[t.status] || "#52525B"}40;"></div>
      <div style="flex:1;min-width:0;">
        <a href="task-detail.html?id=${t.id}"
          style="font-size:13px;font-weight:600;color:var(--text-primary);text-decoration:none;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;
          transition:color 0.15s;"
          onmouseover="this.style.color='var(--cyan)'"
          onmouseout="this.style.color='var(--text-primary)'">${sanitizeHtml(t.title)}</a>
        <div style="display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap;">
          ${statusBadge(t.status)}
          ${priorityBadge(t.priority || "medium")}
          <span style="font-size:10px;color:var(--text-muted);">${t.updatedAt ? timeAgo(t.updatedAt) : ""}</span>
        </div>
      </div>
    </div>
  `).join("");
}

async function renderRecentRemarks(targetUid, tasks) {
  const el = document.getElementById("recent-remarks");
  const remarks = [];

  tasks.forEach((t) => {
    (t.remarks || []).forEach((r) => {
      if (r.userId === targetUid) {
        remarks.push({ ...r, taskTitle: t.title, taskId: t.id });
      }
    });
  });

  remarks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (!remarks.length) {
    el.innerHTML = '<div class="empty-state"><i class="ph ph-chat-circle"></i><p>No remarks yet</p></div>';
    return;
  }

  el.innerHTML = remarks.slice(0, 6).map((r) => `
    <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle);">
      <a href="task-detail.html?id=${r.taskId}"
        style="font-size:11px;color:var(--cyan);text-decoration:none;font-weight:600;">
        ${sanitizeHtml(r.taskTitle)}</a>
      <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;line-height:1.5;">
        "${sanitizeHtml(r.message)}"</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">
        ${timeAgo({ toDate: () => new Date(r.timestamp) })}</div>
    </div>
  `).join("");
}

// ── Edit Profile ──────────────────────────────────────────────────────────────

window.openEditProfile = () => {
  if (!profileUser) return;
  document.getElementById("ep-name").value = profileUser.displayName || "";
  document.getElementById("ep-bio").value = profileUser.bio || "";
  document.getElementById("ep-skills").value = (profileUser.skills || []).join(", ");
  document.getElementById("ep-photo").value = profileUser.photoURL || "";
  document.getElementById("edit-profile-modal").classList.add("active");
};

window.saveProfile = async (e) => {
  if (e && e.preventDefault) e.preventDefault();
  const name = document.getElementById("ep-name").value.trim();
  const bio = document.getElementById("ep-bio").value.trim();
  const skills = document.getElementById("ep-skills").value
    .split(",").map((s) => s.trim()).filter(Boolean);
  const photoURL = document.getElementById("ep-photo").value.trim();
  const btn = document.getElementById("ep-save");

  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner" style="animation:spin 0.7s linear infinite"></i> Saving...';
  try {
    await updateDoc(doc(db, "users", currentUser.id), {
      displayName: name, bio, skills, photoURL,
      updatedAt: serverTimestamp(),
    });
    showToast("Profile updated!", "success");
    document.getElementById("edit-profile-modal").classList.remove("active");
    await loadProfile(currentUser.id);
  } catch (err) {
    showToast("Failed to save profile", "error");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ph ph-check"></i> Save Changes';
};

window.closeModal = (id) => document.getElementById(id)?.classList.remove("active");

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    e.target.classList.remove("active");
  }
});
