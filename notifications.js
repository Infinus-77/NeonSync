// notifications.js — FIXED: role_changed type, badge updates reliably after sidebar render
import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  writeBatch,
  getDocs,
  serverTimestamp,
  limit,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { timeAgo, showToast, sanitizeHtml } from "./utils.js";

let unsubNotifications = null;

// ✅ FIX: Uses a retry mechanism to bind to bell badge — handles sidebar render timing
export function initNotifications(userId) {
  if (unsubNotifications) unsubNotifications();

  const q = query(
    collection(db, "notifications"),
    where("userId", "==", userId),
    limit(50),
  );

  unsubNotifications = onSnapshot(q, (snap) => {
    const notifs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort(
        (a, b) =>
          (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0),
      );
    updateBadge(notifs);
    renderNotifList(notifs, userId);

    // Toast for new unread
    const newest = notifs[0];
    if (newest && !newest.isRead) {
      const lastSeen = parseInt(sessionStorage.getItem("lastNotifTime") || "0");
      const ts = newest.timestamp?.toMillis?.() || 0;
      if (ts > lastSeen && lastSeen > 0) {
        showToast(newest.message, "info");
      }
      sessionStorage.setItem("lastNotifTime", Date.now().toString());
    }
  });
}

function updateBadge(notifs) {
  const unread = notifs.filter((n) => !n.isRead).length;

  // ✅ FIX: Poll for badge element — sidebar may not be rendered yet
  const tryUpdate = (attempts = 0) => {
    const badge = document.getElementById("notif-badge");
    if (badge) {
      badge.textContent = unread > 9 ? "9+" : unread;
      badge.style.display = unread > 0 ? "flex" : "none";
    } else if (attempts < 10) {
      setTimeout(() => tryUpdate(attempts + 1), 150);
    }
  };
  tryUpdate();
}

function renderNotifList(notifs, userId) {
  const tryRender = (attempts = 0) => {
    const el = document.getElementById("notif-list");
    if (!el) {
      if (attempts < 10) setTimeout(() => tryRender(attempts + 1), 150);
      return;
    }

    if (!notifs.length) {
      el.innerHTML =
        '<div class="empty-state" style="padding:24px;"><i class="ph ph-bell-slash"></i><p>No notifications</p></div>';
      return;
    }

    el.innerHTML = notifs
      .map(
        (n) => `
      <div class="notif-item ${n.isRead ? "" : "unread"}"
        data-testid="notif-${n.id}"
        onclick="handleNotifClick('${n.id}','${n.relatedTaskId || ""}','${userId}')">
        <div class="notif-icon ${getNotifIconClass(n.type)}">
          <i class="ph ${getNotifIcon(n.type)}"></i>
        </div>
        <div class="notif-content">
          <div class="notif-message">${sanitizeHtml(n.message)}</div>
          <div class="notif-time">${timeAgo(n.timestamp)}</div>
        </div>
        ${!n.isRead ? '<div class="notif-dot"></div>' : ""}
      </div>
    `,
      )
      .join("");
  };
  tryRender();
}

window.handleNotifClick = async (notifId, taskId, userId) => {
  await markRead(notifId);
  if (taskId) window.location.href = `task-detail.html?id=${taskId}`;
};

window.markAllRead = async () => {
  const userId = window._currentUserId;
  if (!userId) return;

  const q = query(
    collection(db, "notifications"),
    where("userId", "==", userId),
    where("isRead", "==", false),
  );
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { isRead: true }));
  await batch.commit().catch(() => {});

  document.getElementById("notif-panel").style.display = "none";
};

async function markRead(notifId) {
  try {
    await updateDoc(doc(db, "notifications", notifId), { isRead: true });
  } catch (_) {}
}

// ✅ FIX: Added role_changed type
export async function createNotification(
  userId,
  type,
  message,
  relatedTaskId = null,
) {
  try {
    await addDoc(collection(db, "notifications"), {
      userId,
      type,
      message,
      relatedTaskId,
      isRead: false,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.error("createNotification failed:", err);
  }
}

function getNotifIcon(type) {
  const m = {
    task_assigned: "ph-check-square",
    status_update: "ph-arrows-clockwise",
    remark_added: "ph-chat-circle-text",
    deadline_near: "ph-calendar-check",
    overdue: "ph-warning",
    mention: "ph-at",
    profile_created: "ph-user-circle",
    role_changed: "ph-shield", // ✅ NEW
  };
  return m[type] || "ph-bell";
}

function getNotifIconClass(type) {
  const m = {
    task_assigned: "cyan",
    status_update: "purple",
    remark_added: "cyan",
    deadline_near: "warning",
    overdue: "danger",
    mention: "cyan",
    profile_created: "green",
    role_changed: "purple", // ✅ NEW
  };
  return m[type] || "cyan";
}
