// Dashboard page
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
  getDocs,
  doc,
  serverTimestamp,
  Timestamp,
  limit,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  statusBadge,
  priorityBadge,
  formatDate,
  getInitials,
  showToast,
  isOverdue,
  timeAgo,
  progressBar,
  sanitizeHtml,
} from "./utils.js";

let currentUser;
let allTasks = [];
let allUsers = [];
let assigneeMap = {};
let selectedAssignees = [];
let pieChart = null;
let lineChart = null;

requireAuth(async (user) => {
  currentUser = user;

  // Hide the page-level loading overlay now that auth has resolved
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    loadingOverlay.style.transition = "opacity 0.3s ease";
    setTimeout(() => loadingOverlay.remove(), 320);
  }

  renderSidebar("dashboard", user);
  initNotifications(user.id);

  // Personalize greeting
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  document.getElementById("dash-greeting").textContent =
    `${greeting}, ${(user.displayName || user.name || "User").split(" ")[0]}!`;
  document.getElementById("dash-subtitle").textContent =
    user.role === "super_admin"
      ? "Here's your system overview."
      : user.role === "admin"
        ? "Here's your team overview."
        : "Here's your personal task overview.";

  // Show create task button for non-members
  if (user.role !== "member") {
    document.getElementById("create-task-btn").style.display = "flex";
    document.getElementById("charts-row").style.display = "grid";
    document.getElementById("leaderboard-card").style.display = "block";
  }

  // Load users
  const usersSnap = await getDocs(collection(db, "users"));
  allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  allUsers.forEach((u) => {
    assigneeMap[u.id] = u;
  });

  // Real-time tasks listener — scoped by role so Firestore rules don't
  // silently drop tasks that a member is assigned to.
  if (user.role === "member") {
    let assignedTasks = [];
    let commonTasks = [];

    const mergeAndRender = () => {
      const seen = new Set();
      allTasks = [...assignedTasks, ...commonTasks].filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      allTasks.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0;
        const tb = b.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      });
      renderDashboard(allTasks, user);
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
    );

    onSnapshot(
      query(collection(db, "tasks"), where("isCommonTask", "==", true)),
      (snap) => {
        commonTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeAndRender();
      },
    );
  } else {
    onSnapshot(
      collection(db, "tasks"),
      (snap) => {
        allTasks = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort(
            (a, b) =>
              (b.createdAt?.toMillis?.() ?? 0) -
              (a.createdAt?.toMillis?.() ?? 0),
          );
        renderDashboard(allTasks, user);
      },
      (err) => {
        console.error("Dashboard tasks error:", err.code, err.message);
      },
    );
  }
});

function renderDashboard(tasks, user) {
  const now = new Date();

  // Filter tasks based on role
  let myTasks = tasks;
  if (user.role === "member") {
    myTasks = tasks.filter(
      (t) => (t.assignedTo || []).includes(user.id) || t.isCommonTask,
    );
  }

  // Stats
  const total = myTasks.length;
  const active = myTasks.filter((t) =>
    ["in-progress", "review"].includes(t.status),
  ).length;
  const overdue = myTasks.filter((t) => {
    if (!t.deadline || t.status === "completed") return false;
    const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
    return d < now;
  }).length;
  const completed = myTasks.filter((t) => t.status === "completed").length;

  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-active").textContent = active;
  document.getElementById("stat-overdue").textContent = overdue;
  document.getElementById("stat-completed").textContent = completed;

  // Recent tasks (top 5)
  renderRecentTasks(myTasks.slice(0, 5), now);

  // Upcoming deadlines (next 7 days, not completed)
  renderUpcomingDeadlines(myTasks, now);

  // Charts and leaderboard for admins
  if (user.role !== "member") {
    renderCharts(tasks, now);
    renderLeaderboard(tasks);
  }
}

function renderRecentTasks(tasks, now) {
  const el = document.getElementById("recent-tasks");
  if (!tasks.length) {
    el.innerHTML =
      '<div class="empty-state"><i class="ph ph-check-square"></i><p>No tasks yet</p></div>';
    return;
  }

  el.innerHTML = tasks
    .map((t) => {
      const deadline = t.deadline
        ? t.deadline.toDate
          ? t.deadline.toDate()
          : new Date(t.deadline)
        : null;
      const overdue = deadline && t.status !== "completed" && deadline < now;
      const pct = t.completionPercentage || 0;

      return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;"
        onclick="window.location.href='../public/task-detail.html?id=${t.id}'"
        data-testid="dash-task-${t.id}"
        onmouseover="this.style.background='rgba(255,255,255,0.02)'"
        onmouseout="this.style.background='transparent'">
        <div style="width:36px;height:36px;border-radius:var(--radius-md);background:${getPriorityBg(t.priority)};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="ph ${getStatusIcon(t.status)}" style="font-size:16px;color:${getPriorityColor(t.priority)};"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizeHtml(t.title)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:3px;">
            ${statusBadge(overdue ? "overdue" : t.status || "pending")}
            <span style="font-size:10px;color:var(--text-muted);">${deadline ? formatDate(t.deadline) : "No deadline"}</span>
          </div>
          <div style="margin-top:5px;">${progressBar(pct)}</div>
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--accent-cyan);flex-shrink:0;">${pct}%</div>
      </div>
    `;
    })
    .join("");
}

function renderUpcomingDeadlines(tasks, now) {
  const el = document.getElementById("upcoming-deadlines");
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const upcoming = tasks
    .filter((t) => {
      if (!t.deadline || t.status === "completed") return false;
      const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
      return d >= now && d <= sevenDays;
    })
    .sort((a, b) => {
      const da = a.deadline.toDate ? a.deadline.toDate() : new Date(a.deadline);
      const db2 = b.deadline.toDate
        ? b.deadline.toDate()
        : new Date(b.deadline);
      return da - db2;
    })
    .slice(0, 5);

  if (!upcoming.length) {
    el.innerHTML =
      '<div class="empty-state" style="padding:20px;"><i class="ph ph-calendar"></i><p>No upcoming deadlines</p></div>';
    return;
  }

  el.innerHTML = upcoming
    .map((t) => {
      const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
      const daysLeft = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
      const urgentColor =
        daysLeft <= 1
          ? "var(--danger)"
          : daysLeft <= 3
            ? "var(--warning)"
            : "var(--accent-cyan)";

      return `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;"
        onclick="window.location.href='../public/task-detail.html?id=${t.id}'"
        data-testid="deadline-${t.id}">
        <div style="width:4px;height:36px;border-radius:2px;background:${urgentColor};flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizeHtml(t.title)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${formatDate(t.deadline)}</div>
        </div>
        <div style="font-size:11px;font-weight:700;color:${urgentColor};flex-shrink:0;">${daysLeft === 0 ? "Today!" : daysLeft === 1 ? "Tomorrow" : `${daysLeft}d left`}</div>
      </div>
    `;
    })
    .join("");
}

function renderCharts(tasks, now) {
  const statusCounts = {
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
        statusCounts.overdue++;
        return;
      }
    }
    const s = t.status || "pending";
    if (statusCounts[s] !== undefined) statusCounts[s]++;
  });

  // Pie chart
  const pieCtx = document.getElementById("chart-pie")?.getContext("2d");
  if (pieCtx) {
    if (pieChart) pieChart.destroy();
    pieChart = new Chart(pieCtx, {
      type: "doughnut",
      data: {
        labels: ["Pending", "In Progress", "Review", "Completed", "Overdue"],
        datasets: [
          {
            data: Object.values(statusCounts),
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
        cutout: "65%",
        plugins: {
          legend: {
            position: "right",
            labels: { color: "#A1A1AA", font: { size: 11 }, boxWidth: 10 },
          },
        },
      },
    });
  }

  // Line chart - last 14 days
  const lineCtx = document.getElementById("chart-line")?.getContext("2d");
  if (lineCtx) {
    const labels = [];
    const createdData = [];
    const completedData = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
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

    if (lineChart) lineChart.destroy();
    lineChart = new Chart(lineCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Created",
            data: createdData,
            borderColor: "#BD00FF",
            backgroundColor: "rgba(189,0,255,0.08)",
            tension: 0.4,
            fill: true,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
          {
            label: "Completed",
            data: completedData,
            borderColor: "#22C55E",
            backgroundColor: "rgba(34,197,94,0.08)",
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
            labels: { color: "#A1A1AA", font: { size: 11 }, boxWidth: 10 },
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

function renderLeaderboard(tasks) {
  // Score = number of tasks completed at 100%. Super admins excluded.
  const scores = {};
  tasks.forEach(function (t) {
    if (t.completionPercentage === 100 && t.status === "completed") {
      (t.assignedTo || []).forEach(function (uid) {
        scores[uid] = (scores[uid] || 0) + 1;
      });
    }
  });

  const sorted = allUsers
    .filter(function (u) {
      return u.role !== "super_admin";
    })
    .map(function (u) {
      return Object.assign({}, u, { score: scores[u.id] || 0 });
    })
    .sort(function (a, b) {
      return b.score - a.score;
    })
    .slice(0, 8);

  const el = document.getElementById("leaderboard-list");
  if (!el) return;

  const fullCount = function (u) {
    return tasks.filter(function (t) {
      return (
        (t.assignedTo || []).includes(u.id) &&
        t.status === "completed" &&
        t.completionPercentage === 100
      );
    }).length;
  };

  el.innerHTML = buildPodiumHTML(sorted, function (u) {
    return fullCount(u) + " tasks at 100%";
  });
}

// Helpers
function getStatusIcon(status) {
  const m = {
    pending: "ph-clock",
    "in-progress": "ph-arrows-clockwise",
    review: "ph-eye",
    completed: "ph-check-circle",
  };
  return m[status] || "ph-clock";
}

function getPriorityBg(p) {
  const m = {
    low: "rgba(161,161,170,0.1)",
    medium: "rgba(245,158,11,0.12)",
    high: "rgba(255,0,122,0.12)",
    critical: "rgba(239,68,68,0.12)",
  };
  return m[p] || m.medium;
}

function getPriorityColor(p) {
  const m = {
    low: "#52525B",
    medium: "#F59E0B",
    high: "#FF007A",
    critical: "#EF4444",
  };
  return m[p] || m.medium;
}

// Create Task Modal (same logic as tasks.js)
window.openCreateTaskModal = () => {
  selectedAssignees = [];
  document.getElementById("create-task-form").reset();
  renderSelectedDashAssignees();
  document.getElementById("create-task-modal").classList.add("active");
};

window.submitCreateTask = async (e) => {
  e.preventDefault();
  const title = document.getElementById("task-title").value.trim();
  const desc = document.getElementById("task-desc").value.trim();
  const priority = document.getElementById("task-priority").value;
  const deadlineVal = document.getElementById("task-deadline").value;
  const tags = document
    .getElementById("task-tags")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const isCommon = document.getElementById("task-common").checked;
  const assignedTo = selectedAssignees.length
    ? [...selectedAssignees]
    : [currentUser.id];

  if (!title || !deadlineVal) {
    showToast("Title and deadline required", "error");
    return;
  }

  const btn = document.querySelector('[data-testid="create-task-submit"]');
  btn.disabled = true;

  try {
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

    showToast("Task created successfully!", "success");
    document.getElementById("create-task-modal").classList.remove("active");
    selectedAssignees = [];

    // Log activity
    await addDoc(collection(db, "activityLogs"), {
      userId: currentUser.id,
      date: new Date().toISOString().split("T")[0],
      activityCount: 1,
      type: "task_created",
      taskId: ref.id,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.error(err);
    showToast("Failed to create task", "error");
  }

  btn.disabled = false;
};

window.searchAssignees = (val) => {
  const resultsEl = document.getElementById("assignee-results");
  if (!val.trim()) {
    resultsEl.style.display = "none";
    return;
  }

  const filtered = allUsers.filter((u) => {
    if (selectedAssignees.includes(u.id)) return false;
    return u.displayName?.toLowerCase().includes(val.toLowerCase());
  });

  if (!filtered.length) {
    resultsEl.style.display = "none";
    return;
  }
  resultsEl.style.display = "block";
  resultsEl.innerHTML = filtered
    .map(
      (u) => `
    <div onclick="selectDashAssignee('${u.id}')"
      style="padding:9px 13px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:9px;"
      onmouseover="this.style.background='rgba(255,255,255,0.06)'"
      onmouseout="this.style.background='transparent'">
      <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--accent-cyan),var(--accent-purple));display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;">${getInitials(u.displayName)}</div>
      <div>
        <div style="font-weight:500;">${sanitizeHtml(u.displayName)}</div>
        <div style="font-size:10px;color:var(--text-muted);">${sanitizeHtml(u.role)}</div>
      </div>
    </div>
  `,
    )
    .join("");
};

window.selectDashAssignee = (uid) => {
  if (!selectedAssignees.includes(uid)) {
    selectedAssignees.push(uid);
    renderSelectedDashAssignees();
  }
  document.getElementById("task-assign-search").value = "";
  document.getElementById("assignee-results").style.display = "none";
};

window.removeDashAssignee = (uid) => {
  selectedAssignees = selectedAssignees.filter((id) => id !== uid);
  renderSelectedDashAssignees();
};

function renderSelectedDashAssignees() {
  const el = document.getElementById("selected-assignees");
  if (!el) return;
  el.innerHTML = selectedAssignees
    .map((uid) => {
      const u = assigneeMap[uid];
      return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.2);border-radius:999px;font-size:11px;">
      ${sanitizeHtml(u?.displayName || uid)}
      <button onclick="removeDashAssignee('${uid}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px;line-height:1;">×</button>
    </span>`;
    })
    .join("");
}

// Modal helpers
window.closeModal = (id) =>
  document.getElementById(id)?.classList.remove("active");
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay"))
    e.target.classList.remove("active");
});
