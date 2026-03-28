/**
 * sidebar.js — NeonSync
 *
 * Fix #1  — Navigation works reliably via standard href links (no JS page-switch override)
 * Fix #11 — Single centralized open/close API, no patched duplicate logic
 * Fix #13 — One event binding path, no scattered or duplicate listeners
 * Fix #15 — aria-expanded synced, Escape key, overlay, mobile menu all use same fns
 */
import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { showToast } from "./utils.js";

// ─── Centralized sidebar state ────────────────────────────────────────────────
// Single source of truth — no checking classList in multiple places

let _sidebarOpen = false;

function openSidebar() {
  _sidebarOpen = true;
  const sb = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const menuBtn = document.querySelector(".mobile-menu-btn");
  sb?.classList.add("open");
  overlay?.classList.add("active");
  document.body.classList.add("no-scroll");
  // Fix #15: sync aria state
  menuBtn?.setAttribute("aria-expanded", "true");
  sb?.setAttribute("aria-hidden", "false");
}

function closeSidebar() {
  _sidebarOpen = false;
  const sb = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const menuBtn = document.querySelector(".mobile-menu-btn");
  sb?.classList.remove("open");
  overlay?.classList.remove("active");
  document.body.classList.remove("no-scroll");
  // Fix #15: sync aria state
  menuBtn?.setAttribute("aria-expanded", "false");
  sb?.setAttribute("aria-hidden", "true");
}

export { openSidebar, closeSidebar };

export function renderSidebar(activeItem, user) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const navItems = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: "ph-squares-four",
      href: "dashboard.html",
    },
    {
      id: "tasks",
      label: "Tasks",
      icon: "ph-check-square",
      href: "tasks.html",
    },
    {
      id: "chat",
      label: "Chat",
      icon: "ph-chat-circle-dots",
      href: "chat.html",
    },
    ...(user.role === "admin" || user.role === "super_admin"
      ? [
          {
            id: "users",
            label: "Users",
            icon: "ph-users",
            href: "users.html",
          },
        ]
      : []),
    ...(user.role === "admin" || user.role === "super_admin"
      ? [
          {
            id: "analytics",
            label: "Analytics",
            icon: "ph-chart-bar",
            href: "analytics.html",
          },
        ]
      : []),
    {
      id: "profile",
      label: "Profile",
      icon: "ph-user-circle",
      href: `profile.html?uid=${user.id}`,
    },
  ];

  sidebar.innerHTML = `
    <div class="sidebar-header">
      <a href="dashboard.html" class="sidebar-logo">
        <div class="sidebar-logo-icon">
          <i class="ph ph-circles-four"></i>
        </div>
        <span class="sidebar-logo-text">NeonSync</span>
      </a>
      <button class="sidebar-close" id="sidebar-close-btn" aria-label="Close sidebar">
        <i class="ph ph-x"></i>
      </button>
    </div>

    <div class="sidebar-user">
      <div class="sidebar-avatar">
        ${
          user.photoURL
            ? `<img src="${user.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
            : `<span>${getInitialsFallback(user.displayName || user.name)}</span>`
        }
      </div>
      <div class="sidebar-user-info">
        <div class="sidebar-user-name">${user.displayName || user.name || "User"}</div>
        <div class="sidebar-user-role">${formatRole(user.role)}</div>
      </div>
      <button class="sidebar-notif-btn" id="notif-bell-btn" aria-label="Notifications" aria-expanded="false">
        <i class="ph ph-bell"></i>
        <span class="notif-badge" id="notif-badge" style="display:none;">0</span>
      </button>
    </div>

    <nav class="sidebar-nav">
      ${navItems
        .map(
          (item) => `
        <a href="${item.href}"
          class="sidebar-nav-item ${activeItem === item.id ? "active" : ""}"
          data-nav="${item.id}"
          data-testid="nav-${item.id}"
          ${activeItem === item.id ? 'aria-current="page"' : ""}>
          <i class="ph ${item.icon}" aria-hidden="true"></i>
          <span>${item.label}</span>
        </a>
      `,
        )
        .join("")}
    </nav>

    <div class="sidebar-footer">
      <button class="sidebar-logout-btn" id="logout-btn" data-testid="logout-btn">
        <i class="ph ph-sign-out"></i>
        <span>Sign Out</span>
      </button>
    </div>

    <!-- Notifications Panel -->
    <div class="notif-panel" id="notif-panel" hidden>
      <div class="notif-panel-header">
        <span>Notifications</span>
        <button id="mark-all-read-btn" style="font-size:11px;color:var(--cyan);background:none;border:none;cursor:pointer;">Mark all read</button>
      </div>
      <div class="notif-list" id="notif-list">
        <div class="empty-state" style="padding:24px;"><i class="ph ph-bell-slash"></i><p>No notifications</p></div>
      </div>
    </div>
  `;

  // ── Bind events after innerHTML is set ──────────────────────────────────────
  bindSidebarEvents(user);
}

function bindSidebarEvents(user) {
  // Close button
  document.getElementById("sidebar-close-btn")
    ?.addEventListener("click", closeSidebar);

  // Logout
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "login.html";
    } catch {
      showToast("Failed to sign out", "error");
    }
  });

  // Mark all read — bound via id, no inline onclick
  document.getElementById("mark-all-read-btn")
    ?.addEventListener("click", () => {
      if (typeof markAllRead === "function") markAllRead();
    });

  // Notification bell — toggle panel with proper aria state
  const bellBtn = document.getElementById("notif-bell-btn");
  const notifPanel = document.getElementById("notif-panel");
  bellBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!notifPanel) return;
    const opening = notifPanel.hasAttribute("hidden");
    if (opening) {
      notifPanel.removeAttribute("hidden");
      bellBtn.setAttribute("aria-expanded", "true");
    } else {
      notifPanel.setAttribute("hidden", "");
      bellBtn.setAttribute("aria-expanded", "false");
    }
  });

  // Fix #1: nav links use their natural href — only close sidebar on mobile
  document.querySelectorAll(".sidebar-nav-item").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.innerWidth <= 1024) closeSidebar();
    });
  });
}

function getInitialsFallback(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatRole(role) {
  const m = { super_admin: "Super Admin", admin: "Admin", member: "Member" };
  return m[role] || role || "Member";
}

// ─── Global listeners — attached once at module load, never duplicated ────────

document.addEventListener("DOMContentLoaded", () => {
  // Overlay click closes sidebar
  document.getElementById("sidebar-overlay")
    ?.addEventListener("click", closeSidebar);

  // Mobile hamburger opens sidebar
  document.querySelector(".mobile-menu-btn")
    ?.addEventListener("click", openSidebar);

  // Fix #13: notif panel outside-click lives here (once), not inside bindSidebarEvents
  // which would re-add it every time renderSidebar is called
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("notif-panel");
    const bell = document.getElementById("notif-bell-btn");
    if (panel && !panel.hidden && !panel.contains(e.target) && !bell?.contains(e.target)) {
      panel.setAttribute("hidden", "");
      bell?.setAttribute("aria-expanded", "false");
    }
  });
});

// Escape closes sidebar and notif panel
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeSidebar();
  const panel = document.getElementById("notif-panel");
  if (panel && !panel.hidden) {
    panel.setAttribute("hidden", "");
    document.getElementById("notif-bell-btn")?.setAttribute("aria-expanded", "false");
  }
});
