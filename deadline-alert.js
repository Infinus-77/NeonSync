// deadline-alert.js — Universal login-time deadline popup for all pages
// Shows a popup once per session when tasks are due within 24 hours.
// Also creates/deduplicates Firestore "deadline_near" notifications.

import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { sanitizeHtml } from "./utils.js";

const SESSION_KEY = "deadlineAlertShown";

/**
 * Call this once per page after auth resolves.
 * Fetches the user's assigned tasks, finds those due within 24h,
 * shows the popup (once per session), and creates Firestore notifications.
 *
 * @param {{ id: string, role: string }} user
 */
export async function checkDeadlineAlerts(user) {
  // Only show the popup once per browser session
  if (sessionStorage.getItem(SESSION_KEY)) return;

  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Fetch tasks assigned to this user (or common tasks for members)
    let tasks = [];

    if (user.role === "member") {
      // Assigned tasks
      const assignedSnap = await getDocs(
        query(
          collection(db, "tasks"),
          where("assignedTo", "array-contains", user.id)
        )
      );
      // Common tasks
      const commonSnap = await getDocs(
        query(collection(db, "tasks"), where("isCommonTask", "==", true))
      );

      const seen = new Set();
      [...assignedSnap.docs, ...commonSnap.docs].forEach((d) => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          tasks.push({ id: d.id, ...d.data() });
        }
      });
    } else {
      // Admins see all tasks
      const allSnap = await getDocs(collection(db, "tasks"));
      tasks = allSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    // Filter: due within 24h, not completed
    const urgentTasks = tasks.filter((t) => {
      if (!t.deadline || t.status === "completed") return false;
      const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
      return d > now && d <= in24h;
    });

    if (!urgentTasks.length) return;

    // Mark session so popup doesn't re-show on navigation
    sessionStorage.setItem(SESSION_KEY, "true");

    // Create Firestore notifications (deduplicated per task per calendar day)
    const today = now.toISOString().split("T")[0];
    for (const t of urgentTasks) {
      const storageKey = `notif_deadline_${t.id}_${today}`;
      if (!localStorage.getItem(storageKey)) {
        try {
          await addDoc(collection(db, "notifications"), {
            userId: user.id,
            type: "deadline_near",
            message: `⏰ Urgent: "${t.title}" is due in less than 24 hours!`,
            relatedTaskId: t.id,
            isRead: false,
            timestamp: serverTimestamp(),
          });
          localStorage.setItem(storageKey, "true");
        } catch (_) {}
      }
    }

    // Show the popup
    showDeadlinePopup(urgentTasks, now);
  } catch (err) {
    console.error("deadline-alert: failed to check deadlines", err);
  }
}

// ─── Inject popup into the page ───────────────────────────────────────────────
function showDeadlinePopup(tasks, now) {
  // Inject styles once
  if (!document.getElementById("deadline-alert-styles")) {
    const style = document.createElement("style");
    style.id = "deadline-alert-styles";
    style.textContent = `
      #deadline-alert-overlay {
        position: fixed; inset: 0; z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.55);
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        animation: da-fade-in 0.22s ease both;
      }
      @keyframes da-fade-in { from { opacity:0 } to { opacity:1 } }

      #deadline-alert-modal {
        background: var(--bg-card, #1a1a24);
        border: 1px solid rgba(239,108,0,0.35);
        border-radius: 18px;
        box-shadow: 0 8px 48px rgba(239,108,0,0.18), 0 2px 16px rgba(0,0,0,0.5);
        width: 92%; max-width: 460px;
        padding: 0;
        animation: da-slide-up 0.25s cubic-bezier(0.22,1,0.36,1) both;
        overflow: hidden;
      }
      @keyframes da-slide-up {
        from { transform: translateY(28px); opacity:0 }
        to   { transform: translateY(0);    opacity:1 }
      }

      .da-header {
        display: flex; align-items: center; gap: 12px;
        padding: 20px 22px 0;
      }
      .da-icon-wrap {
        width: 44px; height: 44px; border-radius: 12px; flex-shrink:0;
        background: rgba(239,108,0,0.15);
        border: 1px solid rgba(239,108,0,0.3);
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; color: #ef6c00;
      }
      .da-title {
        flex: 1;
        font-size: 16px; font-weight: 700;
        color: var(--text-primary, #f0f0f8);
      }
      .da-close-btn {
        width: 32px; height: 32px; border-radius: 8px;
        border: none; cursor: pointer;
        background: var(--bg-input, rgba(255,255,255,0.06));
        color: var(--text-muted, #888);
        display: flex; align-items: center; justify-content: center;
        font-size: 16px; transition: background 0.15s, color 0.15s;
      }
      .da-close-btn:hover {
        background: rgba(239,68,68,0.12); color: #ef4444;
      }

      .da-subtitle {
        margin: 10px 22px 0;
        font-size: 12.5px; color: var(--text-muted, #888); line-height: 1.6;
      }

      .da-task-list {
        margin: 14px 22px 0;
        display: flex; flex-direction: column; gap: 8px;
        max-height: 280px; overflow-y: auto;
      }
      .da-task-list::-webkit-scrollbar { width: 4px; }
      .da-task-list::-webkit-scrollbar-track { background: transparent; }
      .da-task-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius:4px; }

      .da-task-item {
        display: flex; align-items: center; gap: 12px;
        padding: 11px 14px;
        background: rgba(239,108,0,0.07);
        border: 1px solid rgba(239,108,0,0.18);
        border-radius: 10px;
        cursor: pointer; transition: background 0.15s, border-color 0.15s;
        text-decoration: none;
      }
      .da-task-item:hover {
        background: rgba(239,108,0,0.14);
        border-color: rgba(239,108,0,0.35);
      }
      .da-task-dot {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink:0;
        background: #ef6c00;
        box-shadow: 0 0 6px rgba(239,108,0,0.7);
        animation: da-pulse 1.6s ease-in-out infinite;
      }
      @keyframes da-pulse {
        0%,100% { box-shadow: 0 0 4px rgba(239,108,0,0.5); }
        50%      { box-shadow: 0 0 10px rgba(239,108,0,0.9); }
      }
      .da-task-info { flex: 1; min-width: 0; }
      .da-task-name {
        font-size: 13px; font-weight: 600;
        color: var(--text-primary, #f0f0f8);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .da-task-time {
        font-size: 11px; margin-top: 2px;
        color: #ef6c00; font-weight: 600;
      }
      .da-task-arrow {
        color: var(--text-muted, #888); font-size: 14px; flex-shrink:0;
      }

      .da-footer {
        padding: 18px 22px 22px;
        display: flex; gap: 10px; justify-content: flex-end;
      }
      .da-btn-dismiss {
        padding: 9px 18px; border-radius: 9px; font-size: 13px; font-weight: 600;
        border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
        background: var(--bg-input, rgba(255,255,255,0.06));
        color: var(--text-muted, #888); cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .da-btn-dismiss:hover { background: rgba(255,255,255,0.1); color: var(--text-primary, #f0f0f8); }
      .da-btn-tasks {
        padding: 9px 20px; border-radius: 9px; font-size: 13px; font-weight: 700;
        border: none; cursor: pointer;
        background: linear-gradient(135deg, #ef6c00 0%, #f4a234 100%);
        color: #fff;
        box-shadow: 0 2px 12px rgba(239,108,0,0.35);
        transition: opacity 0.15s, transform 0.15s;
        display: flex; align-items: center; gap: 6px;
      }
      .da-btn-tasks:hover { opacity: 0.9; transform: translateY(-1px); }
    `;
    document.head.appendChild(style);
  }

  // Build task list HTML
  const listHTML = tasks
    .map((t) => {
      const d = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);
      const diff = d - now;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const timeLabel =
        hours > 0 ? `Due in ${hours}h ${mins}m` : `Due in ${mins} minutes`;

      return `
        <div class="da-task-item" onclick="window.location.href='task-detail.html?id=${t.id}'">
          <div class="da-task-dot"></div>
          <div class="da-task-info">
            <div class="da-task-name">${sanitizeHtml(t.title)}</div>
            <div class="da-task-time">${timeLabel}</div>
          </div>
          <i class="ph ph-caret-right da-task-arrow"></i>
        </div>`;
    })
    .join("");

  const count = tasks.length;
  const subtitle =
    count === 1
      ? "1 task assigned to you is due within the next 24 hours. Act now to stay on track!"
      : `${count} tasks assigned to you are due within the next 24 hours. Act now to stay on track!`;

  // Create overlay element
  const overlay = document.createElement("div");
  overlay.id = "deadline-alert-overlay";
  overlay.innerHTML = `
    <div id="deadline-alert-modal" role="dialog" aria-modal="true" aria-labelledby="da-title">
      <div class="da-header">
        <div class="da-icon-wrap"><i class="ph-fill ph-warning-octagon"></i></div>
        <span class="da-title" id="da-title">⏰ Deadline Alert</span>
        <button class="da-close-btn" onclick="window.__closeDaModal()" aria-label="Close">
          <i class="ph ph-x"></i>
        </button>
      </div>
      <p class="da-subtitle">${subtitle}</p>
      <div class="da-task-list">${listHTML}</div>
      <div class="da-footer">
        <button class="da-btn-dismiss" onclick="window.__closeDaModal()">Dismiss</button>
        <button class="da-btn-tasks" onclick="window.location.href='tasks.html'">
          <i class="ph ph-check-square"></i>
          View My Tasks
        </button>
      </div>
    </div>`;

  // Close helpers
  window.__closeDaModal = () => {
    const el = document.getElementById("deadline-alert-overlay");
    if (el) {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.2s ease";
      setTimeout(() => el.remove(), 220);
    }
  };

  // Click outside to close
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) window.__closeDaModal();
  });

  document.body.appendChild(overlay);
}
