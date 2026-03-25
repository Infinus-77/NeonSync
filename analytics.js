// Analytics page — FIXED: date range now filters ALL stats, not just the timeline chart
import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications } from "./notifications.js";
import {
  collection,
  query,
  getDocs,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getInitials, showToast, timeAgo, sanitizeHtml } from "./utils.js";

// ── Podium leaderboard renderer ───────────────────────────────────────────────
let currentUser;
let charts = {};
let allTasks = [];
let allUsers = [];
let allLogs = [];

requireAuth(
  async (user) => {
    // Hide the page-level loading overlay now that auth has resolved
    const loadingOverlay = document.getElementById("loading-overlay");
    if (loadingOverlay) {
      loadingOverlay.style.opacity = "0";
      loadingOverlay.style.transition = "opacity 0.3s ease";
      setTimeout(() => loadingOverlay.remove(), 320);
    }
    currentUser = user;

    if (user.role !== "super_admin" && user.role !== "admin") {
      window.location.href = "../public/dashboard.html";
      return;
    }

    renderSidebar("analytics", user);
    initNotifications(user.id);

    // Load data once, then filter on range change
    await fetchData();
    renderAnalytics();
  },
  ["super_admin", "admin"],
);

async function fetchData() {
  const [tasksSnap, usersSnap, logsSnap] = await Promise.all([
    getDocs(collection(db, "tasks")),
    getDocs(collection(db, "users")),
    getDocs(
      query(
        collection(db, "taskLogs"),
        orderBy("timestamp", "desc"),
        limit(100),
      ),
    ),
  ]);

  allTasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  allLogs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ✅ FIX: Called on range change — now filters EVERYTHING by selected date range
window.loadAnalytics = () => renderAnalytics();

function renderAnalytics() {
  const days = parseInt(
    document.getElementById("analytics-range")?.value || "30",
  );
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // ✅ Filter tasks created within the selected date range
  const tasks = allTasks.filter((t) => {
    const created = t.createdAt?.toDate?.();
    return created && created >= cutoff;
  });

  // Stats — all scoped to date range
  const completed = tasks.filter((t) => t.status === "completed").length;
  const overdue = tasks.filter((t) => {
    if (!t.deadline || t.status === "completed") return false;
    const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    return d < now;
  }).length;

  document.getElementById("a-total").textContent = tasks.length;
  document.getElementById("a-completed").textContent = completed;
  document.getElementById("a-overdue").textContent = overdue;
  document.getElementById("a-users").textContent = allUsers.length;

  // Charts — all use filtered tasks
  renderStatusPie(tasks, now);
  renderPriorityBar(tasks);
  renderTimeline(tasks, days);
  renderLeaderboard(tasks, allUsers);

  // Logs — filter by date range too
  const filteredLogs = allLogs.filter((l) => {
    const ts = l.timestamp?.toDate?.();
    return ts && ts >= cutoff;
  });
  renderRecentActivity(filteredLogs, allUsers);
}

function renderStatusPie(tasks, now) {
  const counts = {
    pending: 0,
    "in-progress": 0,
    review: 0,
    completed: 0,
    overdue: 0,
  };
  tasks.forEach((t) => {
    if (t.deadline && t.status !== "completed") {
      const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
      if (d < now) {
        counts.overdue++;
        return;
      }
    }
    const s = t.status || "pending";
    if (counts[s] !== undefined) counts[s]++;
  });

  const ctx = document.getElementById("chart-status-pie")?.getContext("2d");
  if (!ctx) return;
  if (charts.pie) charts.pie.destroy();

  charts.pie = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Pending", "In Progress", "Review", "Completed", "Overdue"],
      datasets: [
        {
          data: Object.values(counts),
          backgroundColor: [
            "#52525B",
            "#00E5FF",
            "#F59E0B",
            "#22C55E",
            "#EF4444",
          ],
          borderWidth: 0,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#A1A1AA", font: { size: 11 }, boxWidth: 12 },
        },
      },
    },
  });
}

function renderPriorityBar(tasks) {
  const counts = { low: 0, medium: 0, high: 0, critical: 0 };
  tasks.forEach((t) => {
    if (counts[t.priority] !== undefined) counts[t.priority]++;
  });

  const ctx = document.getElementById("chart-priority-bar")?.getContext("2d");
  if (!ctx) return;
  if (charts.bar) charts.bar.destroy();

  charts.bar = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Low", "Medium", "High", "Critical"],
      datasets: [
        {
          data: Object.values(counts),
          backgroundColor: ["#52525B", "#F59E0B", "#FF007A", "#EF4444"],
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#A1A1AA", font: { size: 11 } },
          grid: { display: false },
        },
        y: {
          ticks: { color: "#52525B", stepSize: 1 },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
      },
    },
  });
}

function renderTimeline(tasks, days) {
  const labels = [];
  const completedData = [];
  const createdData = [];

  // Show at most 30 data points regardless of range, to keep chart readable
  const step = days <= 30 ? 1 : Math.ceil(days / 30);
  const points = Math.ceil(days / step);

  for (let i = points - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * step);
    const dayStr = d.toDateString();
    labels.push(
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    );

    createdData.push(
      tasks.filter((t) => t.createdAt?.toDate?.()?.toDateString() === dayStr)
        .length,
    );

    completedData.push(
      tasks.filter(
        (t) =>
          t.status === "completed" &&
          t.updatedAt?.toDate?.()?.toDateString() === dayStr,
      ).length,
    );
  }

  const ctx = document.getElementById("chart-timeline")?.getContext("2d");
  if (!ctx) return;
  if (charts.line) charts.line.destroy();

  charts.line = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Created",
          data: createdData,
          borderColor: "#BD00FF",
          backgroundColor: "rgba(189,0,255,0.06)",
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: "Completed",
          data: completedData,
          borderColor: "#22C55E",
          backgroundColor: "rgba(34,197,94,0.06)",
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#A1A1AA", font: { size: 11 }, boxWidth: 12 },
        },
      },
      scales: {
        x: {
          ticks: { color: "#52525B", font: { size: 10 }, maxRotation: 45 },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
        y: {
          ticks: { color: "#52525B", stepSize: 1 },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
      },
    },
  });
}

// ── Podium leaderboard renderer ───────────────────────────────────────────────
function buildPodiumHTML(sorted, subtitleFn) {
  if (!sorted.length || sorted.every((u) => (u.score || 0) === 0)) {
    return '<div class="empty-state" style="padding:24px;"><i class="ph ph-trophy"></i><p>No data yet</p></div>';
  }

  const cfg = {
    0: {
      bg: "linear-gradient(135deg,#FFD700,#FFA500)",
      ring: "#FFD700",
      size: "64px",
      fs: "22px",
      h: "90px",
    },
    1: {
      bg: "linear-gradient(135deg,#C0C0C0,#9E9E9E)",
      ring: "#C0C0C0",
      size: "52px",
      fs: "17px",
      h: "68px",
    },
    2: {
      bg: "linear-gradient(135deg,#CD7F32,#A0522D)",
      ring: "#CD7F32",
      size: "52px",
      fs: "17px",
      h: "52px",
    },
  };
  const medals = ["🥇", "🥈", "🥉"];
  // Display order: silver | gold | bronze
  const order = [1, 0, 2].filter((i) => sorted[i]);

  function avatar(u, size, fs) {
    var inner = u.photoURL
      ? '<img src="' +
        u.photoURL +
        '" style="width:100%;height:100%;object-fit:cover;">'
      : getInitials(u.displayName);
    return inner;
  }

  var podiumCols = order
    .map(function (rank) {
      var u = sorted[rank];
      if (!u) return "";
      var c = cfg[rank];
      return (
        '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;">' +
        '<div style="position:relative;">' +
        '<div style="width:' +
        c.size +
        ";height:" +
        c.size +
        ";border-radius:50%;" +
        "background:" +
        c.bg +
        ";display:flex;align-items:center;justify-content:center;" +
        "font-size:" +
        c.fs +
        ";font-weight:700;color:#000;" +
        "border:3px solid " +
        c.ring +
        ";box-shadow:0 0 20px " +
        c.ring +
        "44;" +
        'overflow:hidden;flex-shrink:0;">' +
        avatar(u, c.size, c.fs) +
        "</div>" +
        '<div style="position:absolute;bottom:-4px;right:-4px;font-size:16px;line-height:1;">' +
        medals[rank] +
        "</div>" +
        "</div>" +
        '<div style="text-align:center;">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text-primary);' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px;">' +
        sanitizeHtml(u.displayName || "User") +
        "</div>" +
        '<div style="font-size:11px;color:' +
        c.ring +
        ';font-weight:700;margin-top:2px;">' +
        u.score +
        "pts</div>" +
        '<div style="font-size:10px;color:var(--text-muted);margin-top:1px;">' +
        subtitleFn(u) +
        "</div>" +
        "</div>" +
        '<div style="width:100%;height:' +
        c.h +
        ";background:" +
        c.bg +
        ";" +
        'border-radius:8px 8px 0 0;opacity:0.2;margin-top:4px;"></div>' +
        "</div>"
      );
    })
    .join("");

  var restRows = sorted
    .slice(3)
    .map(function (u, i) {
      var inner = u.photoURL
        ? '<img src="' +
          u.photoURL +
          '" style="width:100%;height:100%;object-fit:cover;">'
        : getInitials(u.displayName);
      return (
        '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;' +
        "border-radius:8px;background:rgba(255,255,255,0.03);" +
        'border:1px solid rgba(255,255,255,0.05);" data-testid="leader-' +
        u.id +
        '">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text-muted);width:22px;text-align:center;">#' +
        (i + 4) +
        "</div>" +
        '<div style="width:30px;height:30px;border-radius:50%;' +
        "background:linear-gradient(135deg,var(--accent-cyan),var(--accent-purple));" +
        "display:flex;align-items:center;justify-content:center;" +
        'font-size:11px;font-weight:700;color:#000;flex-shrink:0;overflow:hidden;">' +
        inner +
        "</div>" +
        '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:12px;font-weight:600;">' +
        sanitizeHtml(u.displayName || "User") +
        "</div>" +
        '<div style="font-size:10px;color:var(--text-muted);">' +
        subtitleFn(u) +
        "</div>" +
        "</div>" +
        '<div style="font-size:12px;font-weight:700;color:var(--accent-cyan);">' +
        u.score +
        "pts</div>" +
        "</div>"
      );
    })
    .join("");

  var rest =
    sorted.length > 3
      ? '<div style="height:1px;background:rgba(255,255,255,0.06);margin:16px 0 12px;"></div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;">' +
        restRows +
        "</div>"
      : "";

  return (
    '<div style="display:flex;align-items:flex-end;justify-content:center;gap:8px;padding:16px 8px 0;">' +
    podiumCols +
    "</div>" +
    rest
  );
}

function renderLeaderboard(tasks, users) {
  // Score = number of tasks completed at 100%. Super admins excluded.
  const scores = {};
  tasks.forEach(function (t) {
    if (t.completionPercentage === 100 && t.status === "completed") {
      (t.assignedTo || []).forEach(function (uid) {
        scores[uid] = (scores[uid] || 0) + 1;
      });
    }
  });

  const sorted = users
    .filter(function (u) {
      return u.role !== "super_admin";
    })
    .map(function (u) {
      return Object.assign({}, u, { score: scores[u.id] || 0 });
    })
    .sort(function (a, b) {
      return b.score - a.score;
    })
    .slice(0, 10);

  const el = document.getElementById("leaderboard");
  if (!el) return;

  el.innerHTML = buildPodiumHTML(sorted, function (u) {
    var n = tasks.filter(function (t) {
      return (
        (t.assignedTo || []).includes(u.id) &&
        t.status === "completed" &&
        t.completionPercentage === 100
      );
    }).length;
    return u.role + " · " + n + " at 100%";
  });
}

function renderRecentActivity(logs, users) {
  const userMap = {};
  users.forEach((u) => {
    userMap[u.id] = u;
  });

  const el = document.getElementById("recent-activity");
  if (!logs.length) {
    el.innerHTML =
      '<div class="empty-state" style="padding:24px;"><i class="ph ph-activity"></i><p>No activity in this period</p></div>';
    return;
  }

  const icons = {
    status_change: "ph-arrows-clockwise",
    remark_added: "ph-chat-circle-text",
    percentage_update: "ph-chart-line",
    task_updated: "ph-pencil",
    task_created: "ph-plus-circle",
    default: "ph-activity",
  };

  el.innerHTML = logs
    .slice(0, 30)
    .map((l) => {
      const u = userMap[l.updatedBy];
      return `
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);" data-testid="log-${l.id}">
        <div style="width:32px;height:32px;border-radius:50%;background:rgba(0,229,255,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--accent-cyan);">
          <i class="ph ${icons[l.actionType] || icons.default}" style="font-size:15px;"></i>
        </div>
        <div style="flex:1;">
          <div style="font-size:12px;">
            <span style="font-weight:600;color:var(--text-primary);">${u?.displayName || "User"}</span>
            <span style="color:var(--text-secondary);"> ${(l.actionType || "activity").replace(/_/g, " ")}</span>
          </div>
          ${
            l.previousValue !== undefined &&
            l.newValue !== undefined &&
            l.previousValue !== l.newValue
              ? `<div style="font-size:11px;color:var(--text-muted);">${l.previousValue} → ${l.newValue}</div>`
              : ""
          }
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${timeAgo(l.timestamp)}</div>
        </div>
      </div>
    `;
    })
    .join("");
}
