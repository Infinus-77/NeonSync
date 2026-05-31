// profile.js — Enhanced: full analytics section, charts, priority performance, tag analysis
import { db, auth } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { signOut, updateEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications } from "./notifications.js";
import { checkDeadlineAlerts } from "./deadline-alert.js";
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
  checkDeadlineAlerts(user);

  showSkeletons();
  await loadProfile(targetUid);
});

function showSkeletons() {
  document.getElementById("profile-header-inner").innerHTML = `
    <div style="width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.06);animation:pulse 1.5s ease infinite;flex-shrink:0;"></div>
    <div style="flex:1;">
      <div style="height:20px;width:200px;margin-bottom:10px;background:rgba(255,255,255,0.06);border-radius:6px;animation:pulse 1.5s ease infinite;"></div>
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
  const isOwnProfile = targetUid === currentUser.id;

  if (isOwnProfile) {
    updateDoc(doc(db, "users", targetUid), { lastActive: serverTimestamp() }).catch(() => {});
  }

  renderProfileHeader(profileUser, isOwnProfile).then(html => {
    document.getElementById("profile-header-inner").innerHTML = html;
  });
  renderCompanyCard(profileUser, isOwnProfile);

  // Apply privacy restrictions for viewing other users
  if (!isOwnProfile) {
    document.getElementById("stat-card-assigned").style.display = "none";
    document.getElementById("stat-card-completed").style.display = "none";
    document.getElementById("stat-card-active").style.display = "none";
    document.getElementById("stat-card-overdue").style.display = "none";
    
    document.getElementById("charts-row").style.display = "none";
    document.getElementById("card-top-tags").style.display = "none";
    document.getElementById("timeline-remarks-row").style.display = "none";
  }

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
  if (currentUser.role === "admin" || currentUser.role === "super_admin") {
    const snap = await getDocs(query(collection(db, "tasks"), where("companyId", "==", currentUser.companyId)));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => t.isCommonTask || (t.assignedTo && t.assignedTo.includes(targetUid)));
  } else {
    try {
      const [assignedSnap, commonSnap] = await Promise.all([
        getDocs(query(collection(db, "tasks"), where("companyId", "==", currentUser.companyId), where("assignedTo", "array-contains", targetUid))),
        getDocs(query(collection(db, "tasks"), where("companyId", "==", currentUser.companyId), where("isCommonTask", "==", true)))
      ]);
      const tasksMap = new Map();
      assignedSnap.docs.forEach((d) => tasksMap.set(d.id, { id: d.id, ...d.data() }));
      commonSnap.docs.forEach((d) => tasksMap.set(d.id, { id: d.id, ...d.data() }));
      return Array.from(tasksMap.values());
    } catch (e) {
      console.warn("Index missing for task queries.", e);
      return [];
    }
  }
}

async function renderProfileHeader(u, isOwn) {
  const avatarHTML = u.photoURL
    ? `<img src="${u.photoURL}" alt="${u.displayName || "User"}" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='';"><span style="display:none;">${getInitials(u.displayName || u.name || "?")}</span>`
    : `<span>${getInitials(u.displayName || u.name || "?")}</span>`;

  let html = `
    <div class="avatar-large" style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--purple));display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;overflow:hidden;border:2px solid rgba(0,242,255,0.25);">
      ${avatarHTML}
    </div>
    <div class="profile-info-main" style="flex:1; min-width:200px; padding-left: 20px;">
      <h2 style="margin-bottom:6px; font-size:24px; color:var(--text-primary); font-family:'Space Grotesk',sans-serif;">${sanitizeHtml(u.displayName || u.name || "Unknown User")}</h2>
      <div style="color:var(--text-secondary); margin-bottom:12px; font-size:14px; display:flex; align-items:center; gap:6px;">
        <i class="ph ph-envelope-simple"></i> ${sanitizeHtml(u.email || "No email")}
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:12px; color:var(--text-muted); align-items:center;">
        ${u.role ? `<span class="tag-pill" style="margin:0; padding:2px 8px; border:1px solid var(--border-glass); border-radius:4px;"><i class="ph ph-shield"></i> ${u.role}</span>` : ""}
        ${u.createdAt ? `<span><i class="ph ph-calendar"></i> Joined ${new Date((u.createdAt.toDate?.() || u.createdAt)).toLocaleDateString("en-US",{month:"long",year:"numeric"})}</span>` : ""}
        ${u.lastActive ? `<span><i class="ph ph-clock"></i> Last active ${timeAgo(u.lastActive)}</span>` : ""}
      </div>
    </div>
    ${isOwn ? `
    <div class="profile-actions" style="display:flex; flex-direction:column; gap:8px; flex-shrink:0; min-width:115px;">
      <button class="btn btn-secondary btn-sm" onclick="openEditProfile()" style="width:100%;"><i class="ph ph-pencil"></i> Edit Profile</button>
      <button class="btn btn-outline btn-sm" onclick="logoutFromProfile()" style="width:100%;color:var(--rose);border-color:rgba(244,63,94,0.3);background:rgba(244,63,94,0.04);"><i class="ph ph-sign-out"></i> Sign Out</button>
    </div>
    ` : ""}
  `;
  return html;
}

async function renderCompanyCard(u, isOwnProfile = true) {
  const card = document.getElementById("company-card");
  const inner = document.getElementById("company-details-inner");
  if (!card || !inner) return;

  card.style.display = "flex";

  // Fetch company details
  let companyData = null;
  if (u.companyId) {
    try {
      const snap = await getDoc(doc(db, "companies", u.companyId));
      if (snap.exists()) {
        companyData = snap.data();
      }
    } catch (e) {
      console.error(e);
    }
  }

  let html = `<div style="display:flex; gap: 16px; align-items: center;">`;
  
  // Render logo if available
  if (companyData && companyData.logoUrl) {
    html += `<div style="width: 50px; height: 50px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: var(--bg-input);">
               <img src="${sanitizeHtml(companyData.logoUrl)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='';">
               <div style="display:none; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 24px; color: var(--cyan);"><i class="ph ph-buildings"></i></div>
             </div>`;
  } else {
    html += `<div style="width: 50px; height: 50px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: var(--bg-input); display:flex; align-items: center; justify-content: center; font-size: 24px; color: var(--cyan);">
               <i class="ph ph-buildings"></i>
             </div>`;
  }

  html += `<div style="flex: 1; font-size: 14px; color: var(--text-secondary);">`;
  
  if (companyData) {
    html += `<div style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${sanitizeHtml(companyData.name || "Unknown")}</div>`;
    if (companyData.industry) {
      html += `<div style="margin-bottom: 2px;"><strong>Industry:</strong> ${sanitizeHtml(companyData.industry)}</div>`;
    }
    if (companyData.website) {
      html += `<div><strong>Website:</strong> <a href="${sanitizeHtml(companyData.website)}" target="_blank" style="color:var(--blue);text-decoration:none;">${sanitizeHtml(companyData.website)}</a></div>`;
    }
  } else {
    html += `<div style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Company ID: ${sanitizeHtml(u.companyId || "None")}</div>`;
    html += `<div>No additional details provided.</div>`;
  }
  
  html += `</div></div>`;
  inner.innerHTML = html;
}

window.copyCompanyCode = (code) => {
  navigator.clipboard.writeText(code).then(() => {
    showToast("Company code copied to clipboard!", "success");
  }).catch(() => {
    showToast("Failed to copy code", "error");
  });
};

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

  document.getElementById("stat-assigned").textContent = tasks.length;
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
    query(collection(db, "activityLogs"), where("companyId", "==", currentUser.companyId), where("userId", "==", targetUid))
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
      "rgba(0,242,255,0.20)",
      "rgba(0,242,255,0.45)",
      "rgba(0,242,255,0.70)",
      "rgba(0,242,255,0.95)",
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
          backgroundColor: "rgba(176,64,255,0.40)",
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
        y: { ticks: { color: "#9ca3af", stepSize: 1 }, grid: { color: "rgba(255,255,255,0.06)" } },
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
        <span style="background:rgba(0,242,255,0.15);color:var(--cyan);
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
  document.getElementById("ep-email").value = profileUser.email || "";
  document.getElementById("ep-bio").value = profileUser.bio || "";
  document.getElementById("ep-skills").value = (profileUser.skills || []).join(", ");
  document.getElementById("ep-photo").value = profileUser.photoURL || "";
  document.getElementById("edit-profile-modal").classList.add("active");
};

window.saveProfile = async (e) => {
  if (e && e.preventDefault) e.preventDefault();
  const name = document.getElementById("ep-name").value.trim();
  const email = document.getElementById("ep-email").value.trim();
  const bio = document.getElementById("ep-bio").value.trim();
  const skills = document.getElementById("ep-skills").value
    .split(",").map((s) => s.trim()).filter(Boolean);
  let photoURL = document.getElementById("ep-photo").value.trim();

  // Automatically convert Google Drive links to direct image links
  if (photoURL && photoURL.includes("drive.google.com")) {
    const match = photoURL.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?export=view&id=)([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      // Use lh3.googleusercontent.com which bypasses redirect blocks and serves raw images directly
      photoURL = `https://lh3.googleusercontent.com/d/${match[1]}`;
    }
  }

  const btn = document.getElementById("ep-save");

  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner" style="animation:spin 0.7s linear infinite"></i> Saving...';
  try {
    if (email && email !== currentUser.email && auth.currentUser) {
      await updateEmail(auth.currentUser, email);
    }

    await updateDoc(doc(db, "users", currentUser.id), {
      displayName: name, bio, skills, photoURL, email,
      updatedAt: serverTimestamp(),
    });
    
    currentUser.displayName = name;
    currentUser.email = email;
    currentUser.bio = bio;
    currentUser.skills = skills;
    currentUser.photoURL = photoURL;
    
    showToast("Profile updated!", "success");
    document.getElementById("edit-profile-modal").classList.remove("active");
    await loadProfile(currentUser.id);
    renderSidebar("profile", currentUser);
  } catch (err) {
    if (err.code === "auth/requires-recent-login") {
      showToast("Security: Please sign out and log back in to change your email.", "error");
    } else {
      showToast("Failed to save profile", "error");
    }
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

window.logoutFromProfile = async () => {
  try {
    const btn = document.querySelector('button[onclick="logoutFromProfile()"]');
    if (btn) btn.innerHTML = '<i class="ph ph-spinner" style="animation:spin 0.7s linear infinite"></i> Signing Out...';
    await signOut(auth);
    window.location.href = "index.html";
  } catch (err) {
    if (typeof showToast === "function") showToast("Failed to sign out", "error");
  }
};
