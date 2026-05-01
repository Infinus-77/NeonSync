/**
 * sidebar.js — NeonSync
 *
 * Fix #1  — Mobile nav: close sidebar first, then navigate (prevents open-class bleed)
 * Fix #11 — Single centralized open/close API, no patched duplicate logic
 * Fix #13 — Event delegation for overlay/menu — works regardless of render timing
 * Fix #15 — aria-expanded synced, Escape key, overlay, mobile menu all use same fns
 */
import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { showToast } from "./utils.js";

// ─── Centralized sidebar state ────────────────────────────────────────────────

let _sidebarOpen = false;

function openSidebar() {
  _sidebarOpen = true;
  const sb      = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const menuBtn = document.querySelector(".mobile-menu-btn");
  sb?.classList.add("open");
  overlay?.classList.add("active");
  document.body.classList.add("no-scroll");
  menuBtn?.setAttribute("aria-expanded", "true");
  sb?.setAttribute("aria-hidden", "false");
}

function closeSidebar() {
  _sidebarOpen = false;
  const sb      = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const menuBtn = document.querySelector(".mobile-menu-btn");
  sb?.classList.remove("open");
  overlay?.classList.remove("active");
  document.body.classList.remove("no-scroll");
  menuBtn?.setAttribute("aria-expanded", "false");
  sb?.setAttribute("aria-hidden", "true");
}

export { openSidebar, closeSidebar };

// ─── Render ───────────────────────────────────────────────────────────────────

export function renderSidebar(activeItem, user) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const isAdmin = user.role === "admin" || user.role === "super_admin";

  const navItems = [
    { id: "dashboard",  label: "Dashboard",  icon: "ph-squares-four",    href: "dashboard.html" },
    { id: "tasks",      label: "Tasks",       icon: "ph-check-square",    href: "tasks.html"     },
    { id: "chat",       label: "Chat",        icon: "ph-chat-circle-dots",href: "chat.html"      },
    ...(isAdmin ? [
      { id: "users",     label: "Users",     icon: "ph-users",     href: "users.html"     },
      { id: "analytics", label: "Analytics", icon: "ph-chart-bar", href: "analytics.html" },
    ] : []),
    { id: "profile", label: "Profile", icon: "ph-user-circle", href: `profile.html?uid=${user.id}` },
  ];

  const avatarHTML = user.photoURL
    ? `<img src="${user.photoURL}" alt="${user.displayName || "User"}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none'; this.nextElementSibling.style.display='';"><span style="display:none;">${_initials(user.displayName || user.name)}</span>`
    : `<span>${_initials(user.displayName || user.name)}</span>`;

  sidebar.innerHTML = `
    <div class="sidebar-header">
      <a href="dashboard.html" class="sidebar-logo" aria-label="NeonSync home">
        <div class="sidebar-logo-icon"><i class="ph ph-circles-four"></i></div>
        <span class="sidebar-logo-text">NeonSync</span>
      </a>
      <button class="sidebar-close" id="sidebar-close-btn" aria-label="Close sidebar">
        <i class="ph ph-x"></i>
      </button>
    </div>

    <nav class="sidebar-nav" aria-label="Main navigation" style="margin-top: 16px;">
      ${navItems.map((item) => `
        <a href="${item.href}"
          class="sidebar-nav-item${activeItem === item.id ? " active" : ""}"
          data-nav="${item.id}"
          data-testid="nav-${item.id}"
          ${activeItem === item.id ? 'aria-current="page"' : ""}>
          <i class="ph ${item.icon}" aria-hidden="true"></i>
          <span>${item.label}</span>
        </a>
      `).join("")}
    </nav>
  `;

  // ── Inject Action Bar ──
  let actionBar = document.getElementById("action-bar");
  if (!actionBar) {
    actionBar = document.createElement("div");
    actionBar.id = "action-bar";
    actionBar.className = "action-bar";
    document.body.appendChild(actionBar);
  }
  
  actionBar.innerHTML = `
    <a href="profile.html?uid=${user.id}" class="action-bar-avatar" title="Profile">
      ${avatarHTML}
    </a>
    <div class="action-bar-spacer"></div>
    <button class="action-bar-btn" id="theme-toggle-btn" title="Toggle Theme">
      <i class="ph ${_getCurrentTheme() === 'light' ? 'ph-moon' : 'ph-sun'}"></i>
    </button>
    <button class="action-bar-btn" id="notif-bell-btn" title="Notifications">
      <i class="ph ph-bell"></i>
      <span class="notif-badge" id="notif-badge" style="display:none;">0</span>
    </button>
    <button class="action-bar-btn danger" id="logout-btn" title="Sign Out">
      <i class="ph ph-sign-out"></i>
    </button>
  `;

  // ── Inject Notification Panel ──
  let notifPanel = document.getElementById("notif-panel");
  if (!notifPanel) {
    notifPanel = document.createElement("div");
    notifPanel.id = "notif-panel";
    notifPanel.className = "notif-panel";
    notifPanel.hidden = true;
    document.body.appendChild(notifPanel);
  }
  notifPanel.innerHTML = `
    <div class="notif-panel-header">
      <span>Notifications</span>
      <div style="display:flex;gap:4px;align-items:center;">
        <button id="notif-resize-btn" class="notif-resize-btn" aria-label="Resize panel">
          <i class="ph ph-arrows-out-simple"></i>
        </button>
        <button id="mark-all-read-btn" style="font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;font-weight:600;padding:2px 6px;border-radius:4px;">
          Mark all read
        </button>
        <button id="notif-close-btn" style="background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;padding:4px;display:none;">
          <i class="ph ph-x"></i>
        </button>
      </div>
    </div>
    <div class="notif-list" id="notif-list" style="overflow-y:auto;flex:1;">
      <div class="empty-state" style="padding:24px;">
        <i class="ph ph-bell-slash"></i><p>No notifications</p>
      </div>
    </div>
  `;

  _bindSidebarEvents(user);
}

// ─── Event binding (runs after each renderSidebar) ────────────────────────────

function _bindSidebarEvents(user) {
  // Close button (inside sidebar — re-bound after every innerHTML replace)
  document.getElementById("sidebar-close-btn")
    ?.addEventListener("click", closeSidebar);

  // Theme toggle
  document.getElementById("theme-toggle-btn")
    ?.addEventListener("click", _toggleTheme);

  // Notification resize
  document.getElementById("notif-resize-btn")
    ?.addEventListener("click", () => {
      const panel = document.getElementById("notif-panel");
      if (panel) {
        panel.classList.toggle("large-size");
        const isLarge = panel.classList.contains("large-size");
        const icon = document.querySelector("#notif-resize-btn i");
        if (icon) {
          icon.className = isLarge ? "ph ph-arrows-in-simple" : "ph ph-arrows-out-simple";
        }
      }
    });

  // Notification close
  document.getElementById("notif-close-btn")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = document.getElementById("notif-panel");
      const bell = document.getElementById("notif-bell-btn");
      if (panel) panel.setAttribute("hidden", "");
      if (bell) {
        bell.setAttribute("aria-expanded", "false");
        bell.classList.remove("active");
      }
    });

  // Logout
  document.getElementById("logout-btn")
    ?.addEventListener("click", async () => {
      try {
        sessionStorage.removeItem("deadlineAlertShown"); // allow deadline popup to show on next login
        await signOut(auth);
        window.location.href = "login.html";
      } catch {
        showToast("Failed to sign out", "error");
      }
    });

  // Mark all read
  document.getElementById("mark-all-read-btn")
    ?.addEventListener("click", () => {
      if (typeof window.markAllRead === "function") window.markAllRead();
    });

  // Notification bell toggle
  const bellBtn    = document.getElementById("notif-bell-btn");
  const notifPanel = document.getElementById("notif-panel");
  bellBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!notifPanel) return;
    const isHidden = notifPanel.hasAttribute("hidden");
    if (isHidden) {
      notifPanel.removeAttribute("hidden");
      bellBtn.setAttribute("aria-expanded", "true");
    } else {
      notifPanel.setAttribute("hidden", "");
      bellBtn.setAttribute("aria-expanded", "false");
    }
  });

  // ── Fix #1: Mobile nav routing ──────────────────────────────────────────────
  // On small screens the sidebar slides over content. Clicking a nav link must:
  //   1. Close the sidebar (removes open class + overlay + no-scroll)
  //   2. Then let the browser navigate via the natural href
  //
  // The bug before: closeSidebar() fired synchronously but the page load also
  // started — on the NEW page the sidebar had no open class so it was fine,
  // but the overlay and no-scroll were sometimes left behind causing a frozen UI.
  //
  // Fix: on mobile, prevent the default immediately, close sidebar cleanly,
  // then navigate after the CSS transition completes (280ms matches transition).
  document.querySelectorAll(".sidebar-nav-item").forEach((link) => {
    link.addEventListener("click", (e) => {
      if (window.innerWidth > 1024) return; // desktop: normal href, no intervention

      const href = link.getAttribute("href");
      if (!href || href === "#") return;

      e.preventDefault(); // stop immediate navigation

      closeSidebar();

      // Wait for sidebar slide-out transition (280ms in CSS) then navigate
      setTimeout(() => {
        window.location.href = href;
      }, 280);
    });
  });
}

// ─── Global listeners via event delegation ───────────────────────────────────
// Using delegation on document means these work regardless of when elements
// are added to the DOM — no DOMContentLoaded timing dependency.

document.addEventListener("click", (e) => {
  // Overlay → close sidebar
  if (e.target.closest("#sidebar-overlay")) {
    closeSidebar();
    return;
  }

  // Mobile hamburger → open sidebar
  if (e.target.closest(".mobile-menu-btn")) {
    openSidebar();
    return;
  }

  // Outside-click → close notif panel
  const panel   = document.getElementById("notif-panel");
  const bellBtn = document.getElementById("notif-bell-btn");
  if (panel && !panel.hidden && !panel.contains(e.target) && !bellBtn?.contains(e.target)) {
    panel.setAttribute("hidden", "");
    bellBtn?.setAttribute("aria-expanded", "false");
  }
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _initials(name) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
}

function _formatRole(role) {
  const map = { super_admin: "Super Admin", admin: "Admin", member: "Member" };
  return map[role] || role || "Member";
}

// ─── Theme management ─────────────────────────────────────────────────────────

function _getCurrentTheme() {
  return localStorage.getItem("neonsync-theme") || "dark";
}

function _applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("neonsync-theme", theme);
}

function _toggleTheme() {
  const current = _getCurrentTheme();
  const next = current === "dark" ? "light" : "dark";
  _applyTheme(next);

  // Update button icon and label
  const btn = document.getElementById("theme-toggle-btn");
  if (btn) {
    const icon = btn.querySelector("i");
    const label = btn.querySelector("span");
    if (icon) {
      icon.className = next === "light" ? "ph ph-moon" : "ph ph-sun";
    }
    if (label) {
      label.textContent = next === "light" ? "Dark Mode" : "Light Mode";
    }
  }

  // Dispatch a custom event so other scripts (e.g. charts) can react
  window.dispatchEvent(new CustomEvent("neonsync-theme-change", { detail: { theme: next } }));
}

// Apply saved theme on module load
_applyTheme(_getCurrentTheme());
