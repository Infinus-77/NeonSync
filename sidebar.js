// sidebar.js — FIXED: notification bell binds after DOM ready, mobile close-on-navigate
import { auth, db } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { showToast } from "./utils.js";

export function renderSidebar(activeItem, user) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const navItems = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: "ph-squares-four",
      href: "../public/dashboard.html",
    },
    {
      id: "tasks",
      label: "Tasks",
      icon: "ph-check-square",
      href: "../public/tasks.html",
    },
    {
      id: "chat",
      label: "Chat",
      icon: "ph-chat-circle-dots",
      href: "../public/chat.html",
    },
    ...(user.role === "admin" || user.role === "super_admin"
      ? [
          {
            id: "users",
            label: "Users",
            icon: "ph-users",
            href: "../public/users.html",
          },
        ]
      : []),
    ...(user.role === "admin" || user.role === "super_admin"
      ? [
          {
            id: "analytics",
            label: "Analytics",
            icon: "ph-chart-bar",
            href: "../public/analytics.html",
          },
        ]
      : []),
    {
      id: "profile",
      label: "Profile",
      icon: "ph-user-circle",
      href: `../public/profile.html?uid=${user.id}`,
    },
  ];

  sidebar.innerHTML = `
    <div class="sidebar-header">
      <a href="../public/dashboard.html" class="sidebar-logo">
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
      <button class="sidebar-notif-btn" id="notif-bell-btn" aria-label="Notifications">
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
          data-testid="nav-${item.id}">
          <i class="ph ${item.icon}"></i>
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
    <div class="notif-panel" id="notif-panel" style="display:none;">
      <div class="notif-panel-header">
        <span>Notifications</span>
        <button onclick="markAllRead()" style="font-size:11px;color:var(--accent-cyan);background:none;border:none;cursor:pointer;">Mark all read</button>
      </div>
      <div class="notif-list" id="notif-list">
        <div class="empty-state" style="padding:24px;"><i class="ph ph-bell-slash"></i><p>No notifications</p></div>
      </div>
    </div>
  `;

  // ✅ FIX: Bind events after innerHTML is set — no race condition
  bindSidebarEvents(user);
}

function bindSidebarEvents(user) {
  // Logout
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "../public/login.html";
    } catch (err) {
      showToast("Failed to sign out", "error");
    }
  });

  // ✅ FIX: Mobile sidebar close button
  document
    .getElementById("sidebar-close-btn")
    ?.addEventListener("click", () => {
      document.getElementById("sidebar")?.classList.remove("open");
      document.getElementById("sidebar-overlay")?.classList.remove("active");
    });

  // Notification bell toggle
  document.getElementById("notif-bell-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = document.getElementById("notif-panel");
    if (!panel) return;
    const isOpen = panel.style.display !== "none";
    panel.style.display = isOpen ? "none" : "block";
  });

  // Close notif panel when clicking outside
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("notif-panel");
    const bell = document.getElementById("notif-bell-btn");
    if (
      panel &&
      !panel.contains(e.target) &&
      e.target !== bell &&
      !bell?.contains(e.target)
    ) {
      panel.style.display = "none";
    }
  });

  // ✅ FIX: Mobile — close sidebar when a nav link is clicked
  document.querySelectorAll(".sidebar-nav-item").forEach((link) => {
    link.addEventListener("click", () => {
      document.getElementById("sidebar")?.classList.remove("open");
      document.getElementById("sidebar-overlay")?.classList.remove("active");
    });
  });

  // Ensure mobile hamburger exists and works
  ensureMobileHamburger();
}

function ensureMobileHamburger() {
  // Only inject once
  if (document.getElementById("hamburger-btn")) return;

  const btn = document.createElement("button");
  btn.id = "hamburger-btn";
  btn.className = "hamburger-btn";
  btn.setAttribute("aria-label", "Open menu");
  btn.innerHTML = '<i class="ph ph-list"></i>';
  btn.style.cssText = `
    display:none;position:fixed;top:16px;left:16px;z-index:200;
    background:rgba(20,20,23,0.9);border:1px solid var(--border-glass);
    color:var(--text-primary);width:40px;height:40px;border-radius:var(--radius-md);
    cursor:pointer;font-size:20px;align-items:center;justify-content:center;
    backdrop-filter:blur(12px);
  `;

  // Show on mobile
  const style = document.createElement("style");
  style.textContent = `
    @media (max-width: 1024px) {
      #hamburger-btn { display: flex !important; }
    }
  `;
  document.head.appendChild(style);

  // Overlay
  let overlay = document.getElementById("sidebar-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "sidebar-overlay";
    overlay.style.cssText = `
      display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);
      z-index:149;backdrop-filter:blur(2px);
    `;
    overlay.addEventListener("click", () => {
      document.getElementById("sidebar")?.classList.remove("open");
      overlay.style.display = "none";
      overlay.classList.remove("active");
    });
    document.body.appendChild(overlay);
  }

  btn.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.add("open");
    overlay.style.display = "block";
    overlay.classList.add("active");
  });

  document.body.appendChild(btn);
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
