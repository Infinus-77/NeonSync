// profile.js — FIXED: heatmap aggregates activityLogs by date, loading skeletons, consistent lastActive writes
import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications } from "./notifications.js";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
  limit,
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
} from "./utils.js";

let currentUser;
let profileUser;

const uid = new URLSearchParams(location.search).get("uid");

requireAuth(async (user) => {
  // Hide the page-level loading overlay now that auth has resolved
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    loadingOverlay.style.transition = "opacity 0.3s ease";
    setTimeout(() => loadingOverlay.remove(), 320);
  }
  currentUser = user;
  // ✅ FIX: Store user id globally for markAllRead in notifications
  window._currentUserId = user.id;

  const targetUid = uid || user.id;
  renderSidebar("profile", user);
  initNotifications(user.id);

  showSkeletons();
  await loadProfile(targetUid);
});

function showSkeletons() {
  // Profile header skeleton
  document.getElementById("profile-header-inner").innerHTML = `
    <div class="skeleton-avatar" style="width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,0.06);animation:pulse 1.5s ease infinite;flex-shrink:0;"></div>
    <div style="flex:1;">
      <div class="skeleton" style="height:20px;width:200px;margin-bottom:10px;background:rgba(255,255,255,0.06);border-radius:6px;animation:pulse 1.5s ease infinite;"></div>
      <div class="skeleton" style="height:14px;width:120px;background:rgba(255,255,255,0.04);border-radius:6px;animation:pulse 1.5s ease 0.2s infinite;"></div>
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

  // ✅ FIX: Update lastActive when viewing own profile
  if (targetUid === currentUser.id) {
    await updateDoc(doc(db, "users", targetUid), {
      lastActive: serverTimestamp(),
    }).catch(() => {});
  }

  renderProfileHeader(profileUser);
  await Promise.all([
    loadStats(targetUid),
    loadHeatmap(targetUid),
    loadTimeline(targetUid),
    loadRecentRemarks(targetUid),
  ]);
}

function renderProfileHeader(u) {
  const isOwn = u.id === currentUser.id;

  document.getElementById("profile-header-inner").innerHTML = `
    <div style="position:relative;flex-shrink:0;">
      <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--accent-cyan),var(--accent-purple));display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;overflow:hidden;">
        ${u.photoURL ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">` : getInitials(u.displayName)}
      </div>
    </div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <h2 style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:700;">${sanitizeHtml(u.displayName || "User")}</h2>
        ${roleBadge(u.role || "member")}
      </div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">${sanitizeHtml(u.email || "")}</div>
      ${u.bio ? `<div style="font-size:13px;color:var(--text-secondary);margin-top:8px;line-height:1.5;">${sanitizeHtml(u.bio)}</div>` : ""}
      ${
        (u.skills || []).length
          ? `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
          ${u.skills.map((s) => `<span style="padding:3px 10px;background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.2);border-radius:999px;font-size:11px;color:var(--accent-cyan);">${sanitizeHtml(s)}</span>`).join("")}
        </div>`
          : ""
      }
      <div style="font-size:11px;color:var(--text-muted);margin-top:8px;">
        <i class="ph ph-calendar"></i> Joined ${u.createdAt ? new Date(u.createdAt.toDate?.() || u.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "Unknown"}
        ${u.lastActive ? ` · Last active ${timeAgo(u.lastActive)}` : ""}
      </div>
    </div>
    ${isOwn ? `<button class="btn btn-secondary" onclick="openEditProfile()" data-testid="edit-profile-btn" style="align-self:flex-start;flex-shrink:0;"><i class="ph ph-pencil"></i> Edit Profile</button>` : ""}
  `;
}

async function loadStats(targetUid) {
  const tasksSnap = await getDocs(
    query(
      collection(db, "tasks"),
      where("assignedTo", "array-contains", targetUid),
    ),
  );
  const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const completed = tasks.filter((t) => t.status === "completed").length;
  const active = tasks.filter((t) =>
    ["in-progress", "review"].includes(t.status),
  ).length;
  const rate = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  document.getElementById("stat-completed").textContent = completed;
  document.getElementById("stat-active").textContent = active;
  document.getElementById("stat-rate").textContent = `${rate}%`;

  const lastSnap = await getDocs(
    query(
      collection(db, "activityLogs"),
      where("userId", "==", targetUid),
      limit(1),
    ),
  );
  const lastActive = lastSnap.empty ? null : lastSnap.docs[0].data().timestamp;
  document.getElementById("stat-last-active").textContent = lastActive
    ? timeAgo(lastActive)
    : "Never";
}

// ✅ FIX: Heatmap correctly aggregates activityLogs by date with per-day counts
async function loadHeatmap(targetUid) {
  const el = document.getElementById("heatmap-grid");
  el.innerHTML =
    '<div style="color:var(--text-muted);font-size:12px;">Loading heatmap...</div>';

  const snap = await getDocs(
    query(collection(db, "activityLogs"), where("userId", "==", targetUid)),
  );

  // ✅ FIX: Aggregate by date (one log per action, we count all)
  const dateMap = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    const date =
      data.date || data.timestamp?.toDate?.()?.toISOString().split("T")[0];
    if (date) dateMap[date] = (dateMap[date] || 0) + 1;
  });

  const maxCount = Math.max(...Object.values(dateMap), 1);

  // Build 52 weeks × 7 days = 364 days
  const today = new Date();
  const cells = [];
  for (let i = 363; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const count = dateMap[dateStr] || 0;
    const intensity = count === 0 ? 0 : Math.ceil((count / maxCount) * 4);
    cells.push({ dateStr, count, intensity });
  }

  el.style.cssText = `
    display:grid;
    grid-template-columns:repeat(52,1fr);
    grid-template-rows:repeat(7,1fr);
    grid-auto-flow:column;
    gap:3px;
  `;

  el.innerHTML = cells
    .map(({ dateStr, count, intensity }) => {
      const colors = [
        "rgba(255,255,255,0.05)",
        "rgba(0,229,255,0.2)",
        "rgba(0,229,255,0.4)",
        "rgba(0,229,255,0.65)",
        "rgba(0,229,255,0.9)",
      ];
      const color = colors[intensity] || colors[0];
      return `<div title="${dateStr}: ${count} action${count !== 1 ? "s" : ""}"
      style="width:100%;aspect-ratio:1;border-radius:2px;background:${color};cursor:default;transition:transform 0.1s;"
      onmouseover="this.style.transform='scale(1.4)'" onmouseout="this.style.transform='scale(1)'">
    </div>`;
    })
    .join("");
}

async function loadTimeline(targetUid) {
  const el = document.getElementById("task-timeline");
  el.innerHTML =
    '<div style="color:var(--text-muted);font-size:12px;padding:12px;">Loading...</div>';

  const snap = await getDocs(
    query(
      collection(db, "tasks"),
      where("assignedTo", "array-contains", targetUid),
      limit(10),
    ),
  );
  const tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (!tasks.length) {
    el.innerHTML =
      '<div class="empty-state" style="padding:20px;"><i class="ph ph-list-bullets"></i><p>No task history yet</p></div>';
    return;
  }

  el.innerHTML = tasks
    .map(
      (t) => `
    <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="width:10px;height:10px;border-radius:50%;background:${getStatusColor(t.status)};margin-top:4px;flex-shrink:0;box-shadow:0 0 6px ${getStatusColor(t.status)};"></div>
      <div style="flex:1;min-width:0;">
        <a href="task-detail.html?id=${t.id}" style="font-size:13px;font-weight:600;color:var(--text-primary);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;"
          onmouseover="this.style.color='var(--accent-cyan)'" onmouseout="this.style.color='var(--text-primary)'">${sanitizeHtml(t.title)}</a>
        <div style="display:flex;gap:6px;margin-top:3px;align-items:center;">
          ${statusBadge(t.status)}
          <span style="font-size:10px;color:var(--text-muted);">${t.updatedAt ? timeAgo(t.updatedAt) : ""}</span>
        </div>
      </div>
    </div>
  `,
    )
    .join("");
}

async function loadRecentRemarks(targetUid) {
  const el = document.getElementById("recent-remarks");
  el.innerHTML =
    '<div style="color:var(--text-muted);font-size:12px;padding:12px;">Loading...</div>';

  const snap = await getDocs(
    query(
      collection(db, "tasks"),
      where("assignedTo", "array-contains", targetUid),
      limit(20),
    ),
  );

  const remarks = [];
  snap.docs.forEach((d) => {
    const t = d.data();
    (t.remarks || []).forEach((r) => {
      if (r.userId === targetUid)
        remarks.push({ ...r, taskTitle: t.title, taskId: d.id });
    });
  });

  remarks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (!remarks.length) {
    el.innerHTML =
      '<div class="empty-state" style="padding:20px;"><i class="ph ph-chat-circle"></i><p>No remarks yet</p></div>';
    return;
  }

  el.innerHTML = remarks
    .slice(0, 5)
    .map(
      (r) => `
    <div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <a href="task-detail.html?id=${r.taskId}" style="font-size:11px;color:var(--accent-cyan);text-decoration:none;">${sanitizeHtml(r.taskTitle)}</a>
      <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;line-height:1.5;">"${sanitizeHtml(r.message)}"</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">${timeAgo({ toDate: () => new Date(r.timestamp) })}</div>
    </div>
  `,
    )
    .join("");
}

// Edit Profile
window.openEditProfile = () => {
  if (!profileUser) return;
  document.getElementById("ep-name").value = profileUser.displayName || "";
  document.getElementById("ep-bio").value = profileUser.bio || "";
  document.getElementById("ep-skills").value = (profileUser.skills || []).join(
    ", ",
  );
  document.getElementById("ep-photo").value = profileUser.photoURL || "";
  document.getElementById("edit-profile-modal").classList.add("active");
};

window.saveProfile = async (e) => {
  e.preventDefault();
  const name = document.getElementById("ep-name").value.trim();
  const bio = document.getElementById("ep-bio").value.trim();
  const skills = document
    .getElementById("ep-skills")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const photoURL = document.getElementById("ep-photo").value.trim();
  const btn = document.getElementById("ep-save");

  btn.disabled = true;
  try {
    await updateDoc(doc(db, "users", currentUser.id), {
      displayName: name,
      bio,
      skills,
      photoURL,
      updatedAt: serverTimestamp(),
    });
    showToast("Profile updated!", "success");
    document.getElementById("edit-profile-modal").classList.remove("active");
    await loadProfile(currentUser.id);
  } catch (err) {
    showToast("Failed to save profile", "error");
  }
  btn.disabled = false;
};

function getStatusColor(status) {
  const m = {
    completed: "#22C55E",
    "in-progress": "#00E5FF",
    review: "#F59E0B",
    pending: "#52525B",
    overdue: "#EF4444",
  };
  return m[status] || m.pending;
}

window.closeModal = (id) =>
  document.getElementById(id)?.classList.remove("active");
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay"))
    e.target.classList.remove("active");
});

// ✅ Add pulse animation for skeletons
const style = document.createElement("style");
style.textContent = `@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`;
document.head.appendChild(style);
