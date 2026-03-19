// Chat page — FIXED: unread counts, typing indicator, live task room updates
import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications } from "./notifications.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  getDocs,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  limit,
  updateDoc,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getInitials, timeAgo, showToast, sanitizeHtml } from "./utils.js";

let currentUser;
let activeChatId = null;
let activeRoomName = "";
let unsubMessages = null;
let unsubRooms = null;
let allUsers = {};
let chatRooms = [];
let typingTimeout = null;
// ✅ FIX: Track last-seen message timestamps per room for unread counts
let lastSeenMap = {};
// ✅ FIX: Track message counts per room for unread badge
let roomMessageCounts = {};
let roomUnsubMap = {};

requireAuth(async (user) => {
  // Hide the page-level loading overlay now that auth has resolved
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    loadingOverlay.style.transition = "opacity 0.3s ease";
    setTimeout(() => loadingOverlay.remove(), 320);
  }
  currentUser = user;
  renderSidebar("chat", user);
  initNotifications(user.id);

  const snap = await getDocs(collection(db, "users"));
  snap.docs.forEach((d) => {
    allUsers[d.id] = { id: d.id, ...d.data() };
  });

  // Load last-seen from Firestore (cross-device sync)
  try {
    const lsSnap = await getDoc(doc(db, "lastSeen", user.id));
    lastSeenMap = lsSnap.exists() ? lsSnap.data() || {} : {};
  } catch (_) {
    lastSeenMap = {};
  }

  await setupChatRooms(user);
  renderRooms();

  // ✅ FIX: Listen for new tasks in real-time and add task chat rooms dynamically
  listenForNewTaskRooms(user);
});

async function setupChatRooms(user) {
  const staticRooms = [
    {
      id: "global",
      type: "global",
      name: "General",
      description: "Everyone",
      icon: "global",
      docId: "chat_global",
    },
  ];

  if (user.role === "admin" || user.role === "super_admin") {
    staticRooms.push({
      id: "admin",
      type: "role",
      name: "Admin Channel",
      description: "Admins only",
      icon: "admin-room",
      docId: "chat_admin",
    });
  }
  if (user.role === "super_admin") {
    staticRooms.push({
      id: "super_admin",
      type: "role",
      name: "Super Admin",
      description: "Super Admins only",
      icon: "superadmin-room",
      docId: "chat_superadmin",
    });
  }

  for (const room of staticRooms) {
    const ref = doc(db, "chats", room.docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        type: room.type,
        relatedId: room.id,
        name: room.name,
        createdAt: serverTimestamp(),
      });
    }
  }

  const taskChatsSnap = await getDocs(
    query(collection(db, "chats"), where("type", "==", "task")),
  );
  const taskChats = [];

  for (const d of taskChatsSnap.docs) {
    const chat = { ...d.data(), docId: d.id };
    if (chat.relatedId) {
      const taskSnap = await getDoc(doc(db, "tasks", chat.relatedId));
      if (taskSnap.exists()) {
        const t = taskSnap.data();
        if (user.role !== "member" || (t.assignedTo || []).includes(user.id)) {
          taskChats.push({
            id: chat.relatedId,
            type: "task",
            name: `Task: ${t.title.slice(0, 25)}${t.title.length > 25 ? "..." : ""}`,
            description: "Task discussion",
            icon: "task-room",
            docId: d.id,
          });
        }
      }
    }
  }

  chatRooms = [...staticRooms, ...taskChats];

  // ✅ FIX: Subscribe to message counts for each room for unread badges
  subscribeToRoomCounts();
}

// ✅ FIX: Listen for new task rooms being created while on chat page
function listenForNewTaskRooms(user) {
  const q = query(collection(db, "chats"), where("type", "==", "task"));
  unsubRooms = onSnapshot(q, async (snap) => {
    const existingDocIds = chatRooms.map((r) => r.docId);
    const newRooms = [];

    for (const d of snap.docs) {
      if (existingDocIds.includes(d.id)) continue;
      const chat = { ...d.data(), docId: d.id };
      if (chat.relatedId) {
        const taskSnap = await getDoc(doc(db, "tasks", chat.relatedId));
        if (taskSnap.exists()) {
          const t = taskSnap.data();
          if (
            user.role !== "member" ||
            (t.assignedTo || []).includes(user.id)
          ) {
            newRooms.push({
              id: chat.relatedId,
              type: "task",
              name: `Task: ${t.title.slice(0, 25)}${t.title.length > 25 ? "..." : ""}`,
              description: "Task discussion",
              icon: "task-room",
              docId: d.id,
            });
          }
        }
      }
    }

    if (newRooms.length) {
      chatRooms = [...chatRooms, ...newRooms];
      subscribeToRoomCounts();
      renderRooms();
    }
  });
}

// ✅ FIX: Subscribe to latest message per room for unread counts
function subscribeToRoomCounts() {
  // Unsubscribe old listeners
  Object.values(roomUnsubMap).forEach((fn) => fn());
  roomUnsubMap = {};

  chatRooms.forEach((room) => {
    const q = query(
      collection(db, "messages"),
      where("chatId", "==", room.docId),
      limit(1),
    );

    roomUnsubMap[room.docId] = onSnapshot(q, (snap) => {
      if (snap.empty) {
        roomMessageCounts[room.docId] = 0;
        renderRooms();
        return;
      }

      const latest = snap.docs[0].data();
      const latestTs = latest.timestamp?.toMillis?.() || 0;
      const lastSeen = lastSeenMap[room.docId] || 0;

      // Count unread = how many messages after last seen
      const unreadQ = query(
        collection(db, "messages"),
        where("chatId", "==", room.docId),
        limit(99),
      );

      getDocs(unreadQ)
        .then((unreadSnap) => {
          const unread = unreadSnap.docs.filter((d) => {
            const ts = d.data().timestamp?.toMillis?.() || 0;
            return ts > lastSeen;
          }).length;
          roomMessageCounts[room.docId] = unread;
          renderRooms();
        })
        .catch(() => {
          // Fallback: just show dot if latest is newer than last seen
          roomMessageCounts[room.docId] =
            latestTs > lastSeen && latest.senderId !== currentUser.id ? 1 : 0;
          renderRooms();
        });
    });
  });
}

function renderRooms() {
  const el = document.getElementById("chat-rooms-list");
  el.innerHTML = chatRooms
    .map((room) => {
      const unread = roomMessageCounts[room.docId] || 0;
      return `
      <div class="chat-room-item ${activeChatId === room.docId ? "active" : ""}"
        data-testid="chat-room-${room.id}"
        onclick="selectRoom('${room.docId}','${room.name.replace(/'/g, "\\'")}','${room.icon}', this)">
        <div class="chat-room-icon ${room.icon}">
          <i class="ph ${getRoomIcon(room.icon)}"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div class="chat-room-name">${sanitizeHtml(room.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${sanitizeHtml(room.description)}</div>
        </div>
        ${
          unread > 0 && activeChatId !== room.docId
            ? `
          <div style="min-width:18px;height:18px;background:var(--accent-pink);border-radius:999px;font-size:10px;font-weight:700;color:white;display:flex;align-items:center;justify-content:center;padding:0 4px;">
            ${unread > 9 ? "9+" : unread}
          </div>`
            : ""
        }
      </div>
    `;
    })
    .join("");
}

function getRoomIcon(type) {
  const m = {
    global: "ph-globe",
    "admin-room": "ph-shield",
    "superadmin-room": "ph-crown",
    "task-room": "ph-check-square",
  };
  return m[type] || "ph-chat-circle";
}

window.selectRoom = (chatId, name, icon, el) => {
  activeChatId = chatId;
  activeRoomName = name;

  // Mark room as seen (Firestore for cross-device sync)
  lastSeenMap[chatId] = Date.now();
  setDoc(doc(db, "lastSeen", currentUser.id), lastSeenMap, {
    merge: true,
  }).catch(() => {});
  roomMessageCounts[chatId] = 0;

  if (unsubMessages) unsubMessages();

  renderRooms();

  document.getElementById("chat-room-name-header").textContent = name;
  document.getElementById("chat-room-icon-header").className =
    `ph ${getRoomIcon(icon)}`;
  document.getElementById("chat-room-desc-header").textContent =
    chatRooms.find((r) => r.docId === chatId)?.description || "";

  // Show typing area
  document.getElementById("chat-input-area").style.display = "flex";

  const q = query(
    collection(db, "messages"),
    where("chatId", "==", chatId),
    limit(100),
  );

  unsubMessages = onSnapshot(q, (snap) => {
    const msgs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0));
    renderMessages(msgs);

    // Keep last-seen updated as messages arrive (persist cross-device)
    lastSeenMap[chatId] = Date.now();
    setDoc(doc(db, "lastSeen", currentUser.id), lastSeenMap, {
      merge: true,
    }).catch(() => {});
    roomMessageCounts[chatId] = 0;
    renderRooms();
  });

  // ✅ FIX: Listen for typing indicators
  listenTyping(chatId);
};

// ✅ FIX: Typing indicator system
function listenTyping(chatId) {
  const typingRef = doc(db, "typing", chatId);
  onSnapshot(typingRef, (snap) => {
    if (!snap.exists()) {
      hideTyping();
      return;
    }
    const data = snap.data();
    const others = Object.entries(data)
      .filter(
        ([uid, ts]) =>
          uid !== currentUser.id && ts?.toMillis?.() > Date.now() - 4000,
      )
      .map(([uid]) => allUsers[uid]?.displayName || "Someone");

    if (others.length) {
      showTyping(others);
    } else {
      hideTyping();
    }
  });
}

function showTyping(names) {
  let el = document.getElementById("typing-indicator");
  if (!el) {
    el = document.createElement("div");
    el.id = "typing-indicator";
    el.style.cssText =
      "padding:6px 16px;font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;";
    document.getElementById("messages-list")?.after(el);
  }
  el.innerHTML = `
    <span style="display:flex;gap:3px;align-items:center;">
      <span style="width:5px;height:5px;border-radius:50%;background:var(--accent-cyan);animation:bounce 0.8s infinite;"></span>
      <span style="width:5px;height:5px;border-radius:50%;background:var(--accent-cyan);animation:bounce 0.8s 0.15s infinite;"></span>
      <span style="width:5px;height:5px;border-radius:50%;background:var(--accent-cyan);animation:bounce 0.8s 0.3s infinite;"></span>
    </span>
    ${sanitizeHtml(names.join(", "))} ${names.length === 1 ? "is" : "are"} typing...
  `;
}

function hideTyping() {
  document.getElementById("typing-indicator")?.remove();
}

// ✅ FIX: Send typing events on keypress
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("msg-input")?.addEventListener("input", async () => {
    if (!activeChatId || !currentUser) return;
    try {
      await setDoc(
        doc(db, "typing", activeChatId),
        {
          [currentUser.id]: serverTimestamp(),
        },
        { merge: true },
      );

      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(async () => {
        try {
          await updateDoc(doc(db, "typing", activeChatId), {
            [currentUser.id]: null,
          });
        } catch (_) {}
      }, 3000);
    } catch (_) {}
  });
});

function renderMessages(msgs) {
  const el = document.getElementById("messages-list");
  if (!msgs.length) {
    el.innerHTML =
      '<div class="empty-state"><i class="ph ph-chat-circle"></i><p>No messages yet. Say hello!</p></div>';
    return;
  }

  el.innerHTML = msgs
    .map((m) => {
      const u = allUsers[m.senderId];
      const isMe = m.senderId === currentUser.id;
      return `
      <div class="message-item" data-testid="chat-msg-${m.id}" style="${isMe ? "flex-direction:row-reverse;" : ""}">
        <div class="message-avatar" style="${isMe ? "background:linear-gradient(135deg,var(--accent-pink),var(--accent-purple));" : ""}">
          ${u?.photoURL ? `<img src="${u.photoURL}">` : `<span style="font-size:12px;">${getInitials(u?.displayName)}</span>`}
        </div>
        <div class="message-content" style="${isMe ? "text-align:right;" : ""}">
          <div class="message-header" style="${isMe ? "flex-direction:row-reverse;" : ""}">
            <span class="message-sender">${isMe ? "You" : u?.displayName || "User"}</span>
            <span class="message-time">${timeAgo(m.timestamp)}</span>
          </div>
          <div class="message-text" style="display:inline-block;padding:8px 12px;background:${isMe ? "rgba(0,229,255,0.12)" : "rgba(255,255,255,0.05)"};border-radius:${isMe ? "12px 4px 12px 12px" : "4px 12px 12px 12px"};border:1px solid ${isMe ? "rgba(0,229,255,0.2)" : "var(--border-glass)"};">${escapeHtml(m.message)}</div>
        </div>
      </div>
    `;
    })
    .join("");

  el.scrollTop = el.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.sendMessage = async () => {
  if (!activeChatId) {
    showToast("Select a chat room first", "warning");
    return;
  }

  const input = document.getElementById("msg-input");
  const msg = input.value.trim();
  if (!msg) return;

  input.value = "";

  // Clear typing indicator
  try {
    await updateDoc(doc(db, "typing", activeChatId), {
      [currentUser.id]: null,
    });
  } catch (_) {}

  try {
    await addDoc(collection(db, "messages"), {
      chatId: activeChatId,
      senderId: currentUser.id,
      message: msg,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.error(err);
    showToast("Failed to send message", "error");
    input.value = msg;
  }
};

// Add bounce keyframe for typing dots
const style = document.createElement("style");
style.textContent = `@keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }`;
document.head.appendChild(style);
