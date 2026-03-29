// Utility functions

/**
 * Escape user-supplied text before injecting into innerHTML.
 * Use this wherever task titles, descriptions, messages, or any
 * user-controlled strings are rendered via innerHTML.
 */
export function sanitizeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Replace browser confirm() with a styled modal.
 * Returns a Promise<boolean> that resolves when the user clicks confirm or cancel.
 */
export function showConfirm(message, confirmLabel = "Delete", danger = true) {
  return new Promise((resolve) => {
    // Remove any stale instance
    document.getElementById("ns-confirm-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "ns-confirm-overlay";
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;
      display:flex;align-items:center;justify-content:center;
      animation:fadeIn 0.15s ease;
    `;

    overlay.innerHTML = `
      <div style="
        background:#ffffff;border:1px solid var(--border-glass);
        border-radius:12px;padding:24px 28px;max-width:380px;width:90%;
        box-shadow:0 8px 40px rgba(0,0,0,0.10);
      ">
        <div style="font-size:13.5px;color:var(--text-primary);line-height:1.6;margin-bottom:20px;">
          ${sanitizeHtml(message)}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="ns-confirm-cancel" style="
            padding:7px 16px;border-radius:8px;border:1px solid var(--border-glass);
            background:var(--bg-input);color:var(--text-secondary);cursor:pointer;font-size:13px;
          ">Cancel</button>
          <button id="ns-confirm-ok" style="
            padding:7px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;
            background:${danger ? "var(--danger,#ef4444)" : "var(--blue,#4f6ef7)"};
            color:#fff;
          ">${sanitizeHtml(confirmLabel)}</button>
        </div>
      </div>
      <style>@keyframes fadeIn{from{opacity:0}to{opacity:1}}</style>
    `;

    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };

    document.getElementById("ns-confirm-ok").onclick = () => cleanup(true);
    document.getElementById("ns-confirm-cancel").onclick = () => cleanup(false);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(false);
    });
  });
}

export function formatDate(timestamp) {
  if (!timestamp) return "N/A";
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(timestamp) {
  if (!timestamp) return "";
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(timestamp) {
  if (!timestamp) return "";
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(timestamp);
}

export function getInitials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function statusBadge(status) {
  const labels = {
    pending: "Pending",
    "in-progress": "In Progress",
    in_progress: "In Progress",
    review: "Review",
    completed: "Completed",
    overdue: "Overdue",
  };
  return `<span class=\"badge badge-${status}\">${labels[status] || status}</span>`;
}

export function priorityBadge(priority) {
  return `<span class=\"badge badge-${priority}\">${priority.charAt(0).toUpperCase() + priority.slice(1)}</span>`;
}

export function roleBadge(role) {
  const labels = {
    super_admin: "Super Admin",
    admin: "Admin",
    member: "Member",
  };
  return `<span class=\"badge badge-${role}\">${labels[role] || role}</span>`;
}

export function isOverdue(deadline, status) {
  if (!deadline || status === "completed") return false;
  const d = deadline.toDate ? deadline.toDate() : new Date(deadline);
  return d < new Date();
}

export function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const icons = {
    success: "ph-check-circle",
    error: "ph-x-circle",
    info: "ph-info",
    warning: "ph-warning",
  };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="ph ${icons[type] || "ph-info"} toast-icon"></i>
    <span class="toast-msg">${sanitizeHtml(message)}</span>
    <i class="ph ph-x toast-close" onclick="this.parentElement.remove()"></i>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 4000);
}

export function avatarHTML(user, size = 34) {
  if (user?.photoURL) {
    return `<img src=\"${user.photoURL}\" alt=\"${user.displayName || ""}\" style=\"width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;\">`;
  }
  return `<span style=\"font-size:${Math.floor(size * 0.4)}px;\">${getInitials(user?.displayName || user?.name || "?")}</span>`;
}

export function avatarStyle(size = 34) {
  return `width:${size}px;height:${size}px;border-radius:50%;background:var(--gradient-brand);display:flex;align-items:center;justify-content:center;font-size:${Math.floor(size * 0.38)}px;font-weight:600;flex-shrink:0;overflow:hidden;`;
}

export function progressBar(pct) {
  return `<div class=\"progress-bar-wrap\"><div class=\"progress-bar-fill\" style=\"width:${pct}%\"></div></div>`;
}

export function deadlineClass(deadline, status) {
  if (!deadline || status === "completed") return "";
  const d = deadline.toDate ? deadline.toDate() : new Date(deadline);
  return d < new Date() ? "overdue" : "";
}
