// analytics.js — Enhanced: productivity metrics, member stats, DoW chart, avg completion time, insights
import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications } from "./notifications.js";
import {
  collection, query, getDocs, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getInitials, showToast, timeAgo, sanitizeHtml } from "./utils.js";

let currentUser;
const charts = {};
let allTasks = [];
let allUsers = [];
let allLogs = [];

requireAuth(async (user) => {
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    loadingOverlay.style.transition = "opacity 0.3s ease";
    setTimeout(() => loadingOverlay.remove(), 320);
  }
  currentUser = user;

  if (user.role !== "super_admin" && user.role !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }

  renderSidebar("analytics", user);
  initNotifications(user.id);

  await fetchData();
  renderAnalytics();
}, ["super_admin", "admin"]);

async function fetchData() {
  const [tasksSnap, usersSnap, logsSnap] = await Promise.all([
    getDocs(collection(db, "tasks")),
    getDocs(collection(db, "users")),
    getDocs(query(collection(db, "taskLogs"), orderBy("timestamp", "desc"), limit(200))),
  ]);
  allTasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  allLogs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

window.loadAnalytics = () => renderAnalytics();

function renderAnalytics() {
  const days = parseInt(document.getElementById("analytics-range")?.value || "30");
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const tasks = allTasks.filter((t) => {
    const created = t.createdAt?.toDate?.();
    return created && created >= cutoff;
  });

  const prevCutoff = new Date(cutoff.getTime() - days * 24 * 60 * 60 * 1000);
  const prevTasks = allTasks.filter((t) => {
    const created = t.createdAt?.toDate?.();
    return created && created >= prevCutoff && created < cutoff;
  });

  renderKPIs(tasks, prevTasks, now);
  renderInsights(tasks, now);
  renderTimeline(tasks, days);
  renderStatusPie(tasks, now);
  renderPriorityBar(tasks);
  renderDayOfWeekChart(tasks);
  renderAvgTimeChart(tasks);
  renderLeaderboard(tasks, allUsers);
  renderMemberProductivity(tasks, allUsers, now);

  const filteredLogs = allLogs.filter((l) => {
    const ts = l.timestamp?.toDate?.();
    return ts && ts >= cutoff;
  });
  renderRecentActivity(filteredLogs, allUsers);
}

// ── KPIs ──────────────────────────────────────────────────────────────────────

function renderKPIs(tasks, prevTasks, now) {
  const completed = tasks.filter((t) => t.status === "completed").length;
  const prevCompleted = prevTasks.filter((t) => t.status === "completed").length;
  const active = tasks.filter((t) => ["in-progress", "review", "pending"].includes(t.status)).length;
  const overdue = tasks.filter((t) => {
    if (!t.deadline || t.status === "completed") return false;
    const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    return d < now;
  }).length;
  const prevOverdue = prevTasks.filter((t) => {
    if (!t.deadline || t.status === "completed") return false;
    const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    return d < now;
  }).length;
  const rate = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const members = allUsers.filter((u) => u.role !== "super_admin").length;
  const activeMembers = allUsers.filter((u) => {
    if (!u.lastActive) return false;
    const d = u.lastActive.toDate ? u.lastActive.toDate() : new Date(u.lastActive);
    return (now - d) < 7 * 24 * 60 * 60 * 1000;
  }).length;

  document.getElementById("a-total").textContent = tasks.length;
  document.getElementById("a-completed").textContent = completed;
  document.getElementById("a-rate").textContent = `${rate}%`;
  document.getElementById("a-rate-sub").textContent = tasks.length ? `${completed} of ${tasks.length} tasks` : "No tasks";
  document.getElementById("a-overdue").textContent = overdue;
  document.getElementById("a-active").textContent = active;
  document.getElementById("a-active-sub").textContent = `${tasks.filter(t=>t.status==="in-progress").length} in progress`;
  document.getElementById("a-users").textContent = members;
  document.getElementById("a-users-sub").textContent = `${activeMembers} active this week`;

  // Trends
  setTrend("a-total-trend", tasks.length, prevTasks.length, "tasks");
  setTrend("a-completed-trend", completed, prevCompleted, "completed");
  setTrend("a-overdue-trend", overdue, prevOverdue, "overdue", true);
}

function setTrend(elId, current, prev, label, invertColors = false) {
  const el = document.getElementById(elId);
  if (!el || prev === 0) return;
  const diff = current - prev;
  const pct = Math.round(Math.abs(diff / prev) * 100);
  if (diff === 0) {
    el.innerHTML = `<span class="trend-flat"><i class="ph ph-minus"></i> No change</span>`;
    return;
  }
  const up = diff > 0;
  const good = invertColors ? !up : up;
  const cls = good ? "trend-up" : "trend-down";
  const icon = up ? "ph-arrow-up" : "ph-arrow-down";
  el.innerHTML = `<span class="${cls}"><i class="ph ${icon}"></i> ${pct}% vs previous period</span>`;
}

// ── Insights ──────────────────────────────────────────────────────────────────

function renderInsights(tasks, now) {
  const el = document.getElementById("insights-row");
  const insights = [];

  const completed = tasks.filter((t) => t.status === "completed").length;
  const rate = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const overdue = tasks.filter((t) => {
    if (!t.deadline || t.status === "completed") return false;
    const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    return d < now;
  }).length;
  const critical = tasks.filter((t) => t.priority === "critical" && t.status !== "completed").length;
  const unassigned = tasks.filter((t) => !t.assignedTo?.length).length;
  const review = tasks.filter((t) => t.status === "review").length;

  if (rate >= 80) {
    insights.push({ icon: "ph-trophy", color: "var(--green)", bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.2)",
      title: "High Completion Rate", text: `${rate}% of tasks completed this period — excellent team performance!` });
  } else if (rate < 40 && tasks.length > 5) {
    insights.push({ icon: "ph-warning", color: "var(--amber)", bg: "rgba(245,163,10,0.08)", border: "rgba(245,163,10,0.2)",
      title: "Low Completion Rate", text: `Only ${rate}% completed. Consider reviewing workload distribution or deadlines.` });
  }
  if (overdue > 3) {
    insights.push({ icon: "ph-clock-countdown", color: "var(--danger)", bg: "rgba(255,69,96,0.08)", border: "rgba(255,69,96,0.2)",
      title: `${overdue} Overdue Tasks`, text: "Multiple tasks are past their deadlines. Prioritize or reschedule to maintain momentum." });
  }
  if (critical > 0) {
    insights.push({ icon: "ph-fire", color: "var(--pink)", bg: "rgba(244,63,94,0.08)", border: "rgba(244,63,94,0.2)",
      title: `${critical} Critical Task${critical > 1 ? "s" : ""} Pending`, text: "There are unresolved critical-priority tasks. These should be addressed immediately." });
  }
  if (unassigned > 0) {
    insights.push({ icon: "ph-user-plus", color: "var(--cyan)", bg: "rgba(14,165,233,0.08)", border: "rgba(14,165,233,0.2)",
      title: `${unassigned} Unassigned Task${unassigned > 1 ? "s" : ""}`, text: "Some tasks have no assignees. Assign them to team members to ensure accountability." });
  }
  if (review > 0) {
    insights.push({ icon: "ph-magnifying-glass", color: "var(--amber)", bg: "rgba(245,163,10,0.08)", border: "rgba(245,163,10,0.2)",
      title: `${review} Awaiting Review`, text: `${review} task${review > 1 ? "s are" : " is"} in review state. Complete reviews to unblock team progress.` });
  }

  if (!insights.length) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:10px;margin-bottom:20px;">
      ${insights.slice(0, 4).map((ins) => `
        <div style="background:${ins.bg};border:1px solid ${ins.border};border-radius:var(--radius-md);
          padding:14px 16px;display:flex;gap:12px;align-items:flex-start;">
          <div style="width:34px;height:34px;border-radius:var(--radius-sm);background:${ins.bg};
            border:1px solid ${ins.border};display:flex;align-items:center;justify-content:center;
            flex-shrink:0;color:${ins.color};font-size:16px;">
            <i class="ph ${ins.icon}"></i>
          </div>
          <div>
            <div style="font-size:12px;font-weight:700;color:${ins.color};margin-bottom:3px;">${ins.title}</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">${ins.text}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

// ── Charts ────────────────────────────────────────────────────────────────────

function renderTimeline(tasks, days) {
  const step = days <= 30 ? 1 : Math.ceil(days / 30);
  const points = Math.ceil(days / step);
  const labels = [], createdData = [], completedData = [];

  for (let i = points - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * step);
    const dayStr = d.toDateString();
    labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    createdData.push(tasks.filter((t) => t.createdAt?.toDate?.()?.toDateString() === dayStr).length);
    completedData.push(tasks.filter((t) =>
      t.status === "completed" && t.updatedAt?.toDate?.()?.toDateString() === dayStr
    ).length);
  }

  const ctx = document.getElementById("chart-timeline")?.getContext("2d");
  if (!ctx) return;
  if (charts.line) charts.line.destroy();

  charts.line = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Created", data: createdData, borderColor: "#8b5cf6", backgroundColor: "rgba(139,92,246,0.08)",
          tension: 0.4, fill: true, pointRadius: 2, pointHoverRadius: 5 },
        { label: "Completed", data: completedData, borderColor: "#10b981", backgroundColor: "rgba(16,185,129,0.08)",
          tension: 0.4, fill: true, pointRadius: 2, pointHoverRadius: 5 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#8888AA", font: { size: 11 }, boxWidth: 10 } },
        tooltip: { backgroundColor: "#fff", borderColor: "rgba(0,0,0,0.1)", borderWidth: 1 },
      },
      scales: {
        x: { ticks: { color: "#9ca3af", font: { size: 10 }, maxRotation: 45 }, grid: { color: "rgba(0,0,0,0.05)" } },
        y: { ticks: { color: "#9ca3af", stepSize: 1 }, grid: { color: "rgba(0,0,0,0.05)" }, beginAtZero: true },
      },
    },
  });
}

function renderStatusPie(tasks, now) {
  const counts = { pending: 0, "in-progress": 0, review: 0, completed: 0, overdue: 0 };
  tasks.forEach((t) => {
    if (t.deadline && t.status !== "completed") {
      const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
      if (d < now) { counts.overdue++; return; }
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
      datasets: [{ data: Object.values(counts),
        backgroundColor: ["#52525B", "#00DCFF", "#F5A30A", "#10b981", "#FF4560"],
        borderWidth: 0, hoverOffset: 8 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "58%",
      plugins: {
        legend: { position: "right", labels: { color: "#8888AA", font: { size: 11 }, boxWidth: 10, padding: 10 } },
        tooltip: { backgroundColor: "#fff", borderColor: "rgba(0,0,0,0.1)", borderWidth: 1 },
      },
    },
  });
}

function renderPriorityBar(tasks) {
  const counts = { low: 0, medium: 0, high: 0, critical: 0 };
  const completedCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  tasks.forEach((t) => {
    const p = t.priority;
    if (counts[p] !== undefined) {
      counts[p]++;
      if (t.status === "completed") completedCounts[p]++;
    }
  });

  const ctx = document.getElementById("chart-priority-bar")?.getContext("2d");
  if (!ctx) return;
  if (charts.bar) charts.bar.destroy();
  charts.bar = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Low", "Medium", "High", "Critical"],
      datasets: [
        { label: "Total", data: Object.values(counts),
          backgroundColor: ["rgba(107,114,128,0.5)", "rgba(245,158,11,0.5)", "rgba(244,63,94,0.5)", "rgba(239,68,68,0.5)"],
          borderColor: ["#52525B", "#F5A30A", "#FF2D8A", "#FF4560"],
          borderWidth: 1, borderRadius: 4 },
        { label: "Completed", data: Object.values(completedCounts),
          backgroundColor: ["rgba(16,185,129,0.4)", "rgba(16,185,129,0.4)", "rgba(16,185,129,0.4)", "rgba(16,185,129,0.4)"],
          borderColor: "#10b981", borderWidth: 1, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#8888AA", font: { size: 11 }, boxWidth: 10 } } },
      scales: {
        x: { ticks: { color: "#8888AA", font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: "#9ca3af", stepSize: 1 }, grid: { color: "rgba(0,0,0,0.05)" }, beginAtZero: true },
      },
    },
  });
}

function renderDayOfWeekChart(tasks) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const createdByDay = new Array(7).fill(0);
  const completedByDay = new Array(7).fill(0);

  tasks.forEach((t) => {
    const cd = t.createdAt?.toDate?.();
    if (cd) createdByDay[cd.getDay()]++;
    if (t.status === "completed") {
      const ud = t.updatedAt?.toDate?.();
      if (ud) completedByDay[ud.getDay()]++;
    }
  });

  const ctx = document.getElementById("chart-dow")?.getContext("2d");
  if (!ctx) return;
  if (charts.dow) charts.dow.destroy();
  charts.dow = new Chart(ctx, {
    type: "radar",
    data: {
      labels: days,
      datasets: [
        { label: "Tasks Created", data: createdByDay, borderColor: "#8b5cf6",
          backgroundColor: "rgba(139,92,246,0.1)", pointBackgroundColor: "#8b5cf6", pointRadius: 3 },
        { label: "Tasks Completed", data: completedByDay, borderColor: "#10b981",
          backgroundColor: "rgba(16,185,129,0.1)", pointBackgroundColor: "#10b981", pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#8888AA", font: { size: 11 }, boxWidth: 10 } } },
      scales: {
        r: {
          ticks: { color: "#9ca3af", backdropColor: "transparent", stepSize: 1 },
          grid: { color: "rgba(0,0,0,0.05)" },
          pointLabels: { color: "#8888AA", font: { size: 11 } },
          angleLines: { color: "rgba(0,0,0,0.06)" },
        },
      },
    },
  });
}

function renderAvgTimeChart(tasks) {
  // Calculate avg time from created to completed by priority
  const priorities = ["low", "medium", "high", "critical"];
  const avgTimes = priorities.map((p) => {
    const pTasks = tasks.filter((t) => t.priority === p && t.status === "completed"
      && t.createdAt && t.updatedAt);
    if (!pTasks.length) return 0;
    const totalDays = pTasks.reduce((sum, t) => {
      const created = t.createdAt.toDate?.() ?? new Date(t.createdAt);
      const updated = t.updatedAt.toDate?.() ?? new Date(t.updatedAt);
      return sum + (updated - created) / (1000 * 60 * 60 * 24);
    }, 0);
    return Math.round((totalDays / pTasks.length) * 10) / 10;
  });

  const ctx = document.getElementById("chart-avg-time")?.getContext("2d");
  if (!ctx) return;
  if (charts.avgTime) charts.avgTime.destroy();
  charts.avgTime = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Low", "Medium", "High", "Critical"],
      datasets: [{
        label: "Avg Days to Complete",
        data: avgTimes,
        backgroundColor: ["rgba(107,114,128,0.5)", "rgba(245,158,11,0.5)", "rgba(244,63,94,0.5)", "rgba(239,68,68,0.5)"],
        borderColor: ["#52525B", "#F5A30A", "#FF2D8A", "#FF4560"],
        borderWidth: 1, borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8888AA", font: { size: 11 } }, grid: { display: false } },
        y: {
          ticks: { color: "#9ca3af", callback: (v) => `${v}d` },
          grid: { color: "rgba(0,0,0,0.05)" }, beginAtZero: true,
        },
      },
    },
  });
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function renderLeaderboard(tasks, users) {
  const scores = {};
  tasks.forEach((t) => {
    if (t.status === "completed") {
      const pts = { critical: 4, high: 3, medium: 2, low: 1 }[t.priority] || 1;
      (t.assignedTo || []).forEach((uid) => {
        scores[uid] = (scores[uid] || 0) + pts;
      });
    }
  });

  const sorted = users
    .filter((u) => u.role !== "super_admin")
    .map((u) => ({ ...u, score: scores[u.id] || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const el = document.getElementById("leaderboard");
  if (!el) return;

  if (!sorted.length || sorted.every((u) => u.score === 0)) {
    el.innerHTML = '<div class="empty-state" style="padding:24px;"><i class="ph ph-trophy"></i><p>No data yet</p></div>';
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const podiumCfg = {
    0: { bg: "linear-gradient(135deg,#FFD700,#FFA500)", ring: "#FFD700", size: "60px", fs: "20px", h: "80px" },
    1: { bg: "linear-gradient(135deg,#C0C0C0,#9E9E9E)", ring: "#C0C0C0", size: "50px", fs: "17px", h: "60px" },
    2: { bg: "linear-gradient(135deg,#CD7F32,#A0522D)", ring: "#CD7F32", size: "50px", fs: "17px", h: "46px" },
  };

  const top3Order = [1, 0, 2].filter((i) => sorted[i]);
  const podiumHTML = top3Order.map((rank) => {
    const u = sorted[rank];
    if (!u) return "";
    const c = podiumCfg[rank];
    const inner = u.photoURL
      ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">`
      : getInitials(u.displayName || "?");
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:5px;flex:1;max-width:100px;">
        <div style="position:relative;">
          <div style="width:${c.size};height:${c.size};border-radius:50%;background:${c.bg};
            display:flex;align-items:center;justify-content:center;font-size:${c.fs};font-weight:700;color:#000;
            border:3px solid ${c.ring};box-shadow:0 0 18px ${c.ring}55;overflow:hidden;">${inner}</div>
          <div style="position:absolute;bottom:-4px;right:-4px;font-size:15px;line-height:1;">${medals[rank]}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px;">
            ${sanitizeHtml((u.displayName || "User").split(" ")[0])}</div>
          <div style="font-size:11px;color:${c.ring};font-weight:800;">${u.score}pts</div>
        </div>
        <div style="width:100%;height:${c.h};background:${c.bg};border-radius:6px 6px 0 0;opacity:0.2;margin-top:2px;"></div>
      </div>`;
  }).join("");

  const restHTML = sorted.slice(3).map((u, i) => {
    const inner = u.photoURL
      ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">`
      : getInitials(u.displayName || "?");
    return `
      <a href="profile.html?uid=${u.id}" style="text-decoration:none;display:flex;align-items:center;gap:10px;
        padding:8px 10px;border-radius:8px;background:var(--bg-input);
        border:1px solid var(--border-subtle);margin-bottom:5px;">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);width:20px;text-align:center;">#${i + 4}</div>
        <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--purple));
          display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#000;
          flex-shrink:0;overflow:hidden;">${inner}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;">${sanitizeHtml(u.displayName || "User")}</div>
          <div style="font-size:10px;color:var(--text-muted);">${u.role}</div>
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--cyan);">${u.score}pts</div>
      </a>`;
  }).join("");

  el.innerHTML = `
    <div style="display:flex;align-items:flex-end;justify-content:center;gap:6px;padding:12px 8px 0;">${podiumHTML}</div>
    ${sorted.length > 3 ? `<div style="height:1px;background:var(--border-subtle);margin:14px 0 10px;"></div>${restHTML}` : ""}
  `;
}

// ── Member Productivity ───────────────────────────────────────────────────────

function renderMemberProductivity(tasks, users, now) {
  const el = document.getElementById("member-productivity");
  if (!el) return;

  const members = users.filter((u) => u.role !== "super_admin");
  if (!members.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px;"><i class="ph ph-users"></i><p>No members yet</p></div>';
    return;
  }

  const memberStats = members.map((u) => {
    const assigned = tasks.filter((t) => (t.assignedTo || []).includes(u.id));
    const completed = assigned.filter((t) => t.status === "completed").length;
    const active = assigned.filter((t) => ["in-progress", "review"].includes(t.status)).length;
    const overdue = assigned.filter((t) => {
      if (!t.deadline || t.status === "completed") return false;
      const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
      return d < now;
    }).length;
    const rate = assigned.length ? Math.round((completed / assigned.length) * 100) : 0;
    const lastActive = u.lastActive
      ? (u.lastActive.toDate ? u.lastActive.toDate() : new Date(u.lastActive))
      : null;
    const isRecentlyActive = lastActive && (now - lastActive) < 7 * 24 * 60 * 60 * 1000;

    return { ...u, assigned: assigned.length, completed, active, overdue, rate, isRecentlyActive, lastActive };
  }).sort((a, b) => b.rate - a.rate || b.completed - a.completed);

  el.innerHTML = memberStats.map((u) => {
    const inner = u.photoURL
      ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">`
      : getInitials(u.displayName || "?");

    const rateColor = u.rate >= 70 ? "var(--green)" : u.rate >= 40 ? "var(--amber)" : "var(--danger)";

    return `
      <a href="profile.html?uid=${u.id}" style="text-decoration:none;">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 8px;
          border-bottom:1px solid var(--border-subtle);transition:background 0.15s;border-radius:var(--radius-sm);"
          onmouseover="this.style.background='var(--bg-input)'"
          onmouseout="this.style.background='transparent'">
          <div style="position:relative;flex-shrink:0;">
            <div style="width:36px;height:36px;border-radius:50%;
              background:linear-gradient(135deg,var(--cyan),var(--purple));
              display:flex;align-items:center;justify-content:center;
              font-size:13px;font-weight:700;color:#000;overflow:hidden;">${inner}</div>
            <div style="position:absolute;bottom:0;right:0;width:9px;height:9px;border-radius:50%;
              background:${u.isRecentlyActive ? "var(--green)" : "var(--text-muted)"};
              border:1.5px solid var(--bg-body);"></div>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);">
              ${sanitizeHtml(u.displayName || "User")}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:1px;">
              ${u.assigned} tasks · ${u.active} active
              ${u.overdue > 0 ? `· <span style="color:var(--danger);">${u.overdue} overdue</span>` : ""}
            </div>
            <div style="margin-top:5px;">
              <div class="progress-bar-wrap" style="height:3px;">
                <div class="progress-bar-fill" style="width:${u.rate}%;background:${rateColor};"></div>
              </div>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:14px;font-weight:800;color:${rateColor};">${u.rate}%</div>
            <div style="font-size:10px;color:var(--text-muted);">${u.completed}/${u.assigned}</div>
          </div>
        </div>
      </a>
    `;
  }).join("");
}

// ── Recent Activity ───────────────────────────────────────────────────────────

function renderRecentActivity(logs, users) {
  const userMap = {};
  users.forEach((u) => { userMap[u.id] = u; });

  const el = document.getElementById("recent-activity");
  const countEl = document.getElementById("activity-count");
  if (countEl) countEl.textContent = `${logs.length} events`;

  if (!logs.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px;"><i class="ph ph-activity"></i><p>No activity in this period</p></div>';
    return;
  }

  const icons = {
    status_change: "ph-arrows-clockwise", remark_added: "ph-chat-circle-text",
    percentage_update: "ph-chart-line", task_updated: "ph-pencil",
    task_created: "ph-plus-circle", task_viewed: "ph-eye", default: "ph-activity",
  };
  const colors = {
    status_change: "var(--cyan)", remark_added: "var(--purple)",
    percentage_update: "var(--amber)", task_updated: "var(--green)",
    task_created: "var(--pink)", default: "var(--text-muted)",
  };

  el.innerHTML = logs.slice(0, 40).map((l) => {
    const u = userMap[l.updatedBy];
    const inner = u?.photoURL
      ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">`
      : getInitials(u?.displayName || "?");
    const iconKey = l.actionType || "default";
    const color = colors[iconKey] || colors.default;

    return `
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-subtle);">
        <div style="width:32px;height:32px;border-radius:50%;
          background:linear-gradient(135deg,var(--cyan),var(--purple));
          display:flex;align-items:center;justify-content:center;
          font-size:11px;font-weight:700;color:#000;flex-shrink:0;overflow:hidden;">${inner}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;">
            <span style="font-weight:600;color:var(--text-primary);">${sanitizeHtml(u?.displayName || "User")}</span>
            <span style="color:var(--text-secondary);"> ${(l.actionType || "activity").replace(/_/g, " ")}</span>
            ${l.taskTitle ? `<span style="color:var(--text-muted);"> on <span style="color:var(--cyan);">${sanitizeHtml(l.taskTitle)}</span></span>` : ""}
          </div>
          ${l.previousValue !== undefined && l.newValue !== undefined && l.previousValue !== l.newValue
            ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                <span style="background:rgba(255,69,96,0.12);color:var(--danger);padding:1px 6px;border-radius:3px;">${sanitizeHtml(String(l.previousValue))}</span>
                <span style="margin:0 4px;color:var(--text-muted);">→</span>
                <span style="background:rgba(16,185,129,0.12);color:var(--green);padding:1px 6px;border-radius:3px;">${sanitizeHtml(String(l.newValue))}</span>
              </div>` : ""}
          <div style="font-size:10px;color:var(--text-muted);margin-top:3px;display:flex;align-items:center;gap:4px;">
            <i class="ph ${icons[iconKey] || icons.default}" style="color:${color};"></i>
            ${timeAgo(l.timestamp)}
          </div>
        </div>
      </div>
    `;
  }).join("");
}
