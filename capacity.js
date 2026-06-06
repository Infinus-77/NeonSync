import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications } from "./notifications.js";
import { checkDeadlineAlerts } from "./deadline-alert.js";
import {
  collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getInitials, sanitizeHtml } from "./utils.js";

let currentUser;
let chartInstance = null;
let allTasks = [];
let allUsers = [];

requireAuth(async (user) => {
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    loadingOverlay.style.transition = "opacity 0.3s ease";
    setTimeout(() => loadingOverlay.remove(), 320);
  }
  currentUser = user;

  // Must be admin or super_admin
  if (user.role !== "super_admin" && user.role !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }

  renderSidebar("capacity", user);
  initNotifications(user.id);
  checkDeadlineAlerts(user);

  setupListeners();
}, ["super_admin", "admin"]);

let tasksLoaded = false;
let usersLoaded = false;

function setupListeners() {
  onSnapshot(query(collection(db, "tasks"), where("companyId", "==", currentUser.companyId)), (snap) => {
    allTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    tasksLoaded = true;
    if (tasksLoaded && usersLoaded) renderCapacityDashboard();
  });

  onSnapshot(query(collection(db, "users"), where("companyId", "==", currentUser.companyId)), (snap) => {
    allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    usersLoaded = true;
    if (tasksLoaded && usersLoaded) renderCapacityDashboard();
  });
}

function renderCapacityDashboard() {
  // 1. Process Data
  const members = allUsers;
  const memberStats = members.map(user => {
    const activeTasks = allTasks.filter(t => {
      // Must not be completed
      if (t.status === "completed") return false;
      // Must be assigned to user, or be a common task
      if ((t.assignedTo && t.assignedTo.includes(user.id)) || (t.isCommonTask && t.status === "pending")) {
        const uProg = t.userProgress && t.userProgress[user.id];
        if (uProg && (uProg.status === "completed" || uProg.completionPercentage === 100)) return false;
        return true;
      }
      return false;
    });

    const capacity = user.weeklyCapacity || 20;
    
    // Group active points by priority
    const priorityPoints = { low: 0, medium: 0, high: 0, critical: 0 };
    let totalPoints = 0;

    activeTasks.forEach(t => {
      const w = t.weight || 3;
      totalPoints += w;
      const p = t.priority || "medium";
      if (priorityPoints[p] !== undefined) {
        priorityPoints[p] += w;
      } else {
        priorityPoints["medium"] += w;
      }
    });

    const utilization = capacity > 0 ? Math.round((totalPoints / capacity) * 100) : 0;

    return {
      user,
      capacity,
      totalPoints,
      priorityPoints,
      utilization,
      activeTasks: activeTasks.sort((a, b) => {
        const pMap = { critical: 4, high: 3, medium: 2, low: 1 };
        return (pMap[b.priority] || 2) - (pMap[a.priority] || 2);
      })
    };
  });

  // 2. Render KPIs
  let teamCapacity = 0;
  let teamWorkload = 0;
  let overloaded = 0;
  let underutilized = 0;

  memberStats.forEach(m => {
    teamCapacity += m.capacity;
    teamWorkload += m.totalPoints;
    if (m.utilization > 100) overloaded++;
    if (m.utilization < 50) underutilized++;
  });

  document.getElementById("c-capacity").textContent = teamCapacity;
  document.getElementById("c-workload").textContent = teamWorkload;
  document.getElementById("c-overloaded").textContent = overloaded;
  document.getElementById("c-underutilized").textContent = underutilized;

  const utilPct = teamCapacity > 0 ? Math.round((teamWorkload / teamCapacity) * 100) : 0;
  document.getElementById("c-workload-sub").textContent = `${utilPct}% of total capacity used`;

  // 3. Render Chart
  renderChart(memberStats);

  // 4. Render Grid
  renderGrid(memberStats);
}

function renderChart(memberStats) {
  const ctx = document.getElementById("chart-capacity")?.getContext("2d");
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();

  // Sort by utilization descending for the chart
  const sortedStats = [...memberStats].sort((a, b) => b.utilization - a.utilization);

  const labels = sortedStats.map(m => m.user.displayName ? m.user.displayName.split(" ")[0] : "User");
  const lowData = sortedStats.map(m => m.priorityPoints.low);
  const mediumData = sortedStats.map(m => m.priorityPoints.medium);
  const highData = sortedStats.map(m => m.priorityPoints.high);
  const criticalData = sortedStats.map(m => m.priorityPoints.critical);
  const capacityData = sortedStats.map(m => m.capacity);

  // We use a custom plugin or line dataset for the "Max Capacity" indicator
  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Critical",
          data: criticalData,
          backgroundColor: "rgba(239,68,68,0.8)",
          stack: "Stack 0",
          barPercentage: 0.6
        },
        {
          label: "High",
          data: highData,
          backgroundColor: "rgba(244,63,94,0.8)",
          stack: "Stack 0",
          barPercentage: 0.6
        },
        {
          label: "Medium",
          data: mediumData,
          backgroundColor: "rgba(245,158,11,0.8)",
          stack: "Stack 0",
          barPercentage: 0.6
        },
        {
          label: "Low",
          data: lowData,
          backgroundColor: "rgba(107,114,128,0.8)",
          stack: "Stack 0",
          barPercentage: 0.6
        },
        {
          label: "Capacity",
          data: capacityData,
          type: "line",
          borderColor: "#10b981", // var(--green)
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 4,
          pointBackgroundColor: "#10b981",
          fill: false,
          tension: 0
        }
      ]
    },
    options: {
      animation: { duration: 1200, easing: "easeOutQuart" },
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1a1f2e",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          titleColor: "#ecedf6",
          bodyColor: "#a9abb3",
          callbacks: {
            footer: (tooltipItems) => {
              let total = 0;
              let cap = 0;
              tooltipItems.forEach(item => {
                const idx = item.dataIndex;
                cap = capacityData[idx];
                if (item.dataset.type !== 'line') {
                  // Only sum the stacked bars for the footer
                  // Actually, just calculating it from the raw stats is easier
                  total = sortedStats[idx].totalPoints;
                }
              });
              const util = cap > 0 ? Math.round((total/cap)*100) : 0;
              return `Total Workload: ${total} / ${cap} pts (${util}%)`;
            }
          }
        }
      },
      scales: {
        x: { 
          stacked: true, 
          ticks: { color: "#8888AA", font: { size: 11 }, maxRotation: 90, minRotation: 90, autoSkip: false },
          grid: { display: false }
        },
        y: { 
          stacked: true, 
          ticks: { color: "#9ca3af", stepSize: 5 },
          grid: { color: (document.documentElement.getAttribute("data-theme") === "light" ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.15)") },
          beginAtZero: true
        }
      }
    }
  });
}

function renderGrid(memberStats) {
  const el = document.getElementById("capacity-grid");
  if (!el) return;

  if (!memberStats.length) {
    el.innerHTML = '<div class="empty-state" style="padding:40px;"><i class="ph ph-users"></i><p>No team members found.</p></div>';
    return;
  }

  // Sort by utilization descending
  const sortedStats = [...memberStats].sort((a, b) => b.utilization - a.utilization);

  const priorityColors = {
    critical: "color:var(--danger); border-color:var(--danger); background:rgba(255,69,96,0.1);",
    high: "color:var(--pink); border-color:var(--pink); background:rgba(244,63,94,0.1);",
    medium: "color:var(--amber); border-color:var(--amber); background:rgba(245,163,10,0.1);",
    low: "color:var(--text-secondary); border-color:var(--border-subtle); background:var(--bg-input);"
  };

  const priorityIcons = {
    critical: "ph-warning-octagon",
    high: "ph-arrow-up",
    medium: "ph-minus",
    low: "ph-arrow-down"
  };

  el.innerHTML = sortedStats.map(m => {
    const u = m.user;
    const inner = u.photoURL
      ? `<img src="${u.photoURL}" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;">`
      : getInitials(u.displayName || "?");

    const utilColor = m.utilization > 100 ? "var(--danger)" : (m.utilization < 50 ? "var(--green)" : "var(--amber)");

    const taskPills = m.activeTasks.map(t => {
      const pColor = priorityColors[t.priority] || priorityColors.medium;
      const pIcon = priorityIcons[t.priority] || priorityIcons.medium;
      return `
        <div class="mini-task-pill" style="${pColor}" title="Weight: ${t.weight || 3} pts">
          <i class="ph ${pIcon}"></i>
          <span>${sanitizeHtml(t.title)}</span>
          <span style="opacity:0.7;font-size:9px;margin-left:4px;">${t.weight || 3}p</span>
        </div>
      `;
    }).join("") || `<span style="font-size:12px; color:var(--text-muted); font-style:italic;">No active tasks</span>`;

    return `
      <div class="member-capacity-row">
        <!-- Member Info -->
        <div class="member-info-col">
          <a href="profile.html?uid=${u.id}" style="text-decoration:none; display:flex; align-items:center; gap:10px;">
            <div style="width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg,var(--cyan),var(--purple)); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:#000; overflow:hidden; flex-shrink:0;">
              ${inner}
            </div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:14px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${sanitizeHtml(u.displayName || "User")}</div>
              <div style="font-size:11px; color:var(--text-muted);">${u.role}</div>
            </div>
          </a>
          
          <div style="margin-top:8px;">
            <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:600; margin-bottom:4px;">
              <span style="color:var(--text-secondary)">Workload</span>
              <span style="color:${utilColor}">${m.totalPoints} / ${m.capacity} pts (${m.utilization}%)</span>
            </div>
            <div class="progress-bar-wrap" style="height:6px; background:var(--bg-input);">
              <div class="progress-bar-fill" style="width:${Math.min(m.utilization, 100)}%; background:${utilColor};"></div>
            </div>
          </div>
        </div>

        <!-- Member Tasks -->
        <div class="member-tasks-col">
          <div style="font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">
            Active Tasks (${m.activeTasks.length})
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${taskPills}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// Watch for theme changes and redraw charts
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.attributeName === "data-theme") {
      if (tasksLoaded && usersLoaded) {
        renderCapacityDashboard();
      }
    }
  });
});
observer.observe(document.documentElement, { attributes: true });
