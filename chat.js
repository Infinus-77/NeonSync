// chat.js — Groups only (no auto task rooms). Admins/super_admins can create groups.
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
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getInitials, timeAgo, showToast, sanitizeHtml } from "./utils.js";

let currentUser;
let activeChatId = null;
let unsubMessages = null;
let unsubTyping = null;
let allUsers = {};
let chatRooms = [];
let lastSeenMap = {};
let roomUnsubMap = {};
let roomUnreadMap = {};
let typingTimeout = null;
let selectedGroupMembers = [];

requireAuth(async (user) => {
  const loadingOverlay = document.getElementById("loading-overlay");
  if (loadingOverlay) {
    loadingOverlay.style.opacity = "0";
    loadingOverlay.style.transition = "opacity 0.3s ease";
    setTimeout(() => loadingOverlay.remove(), 320);
  }

  currentUser = user;
  renderSidebar("chat", user);
  initNotifications(user.id);

  // Load all users for display
  const snap = await getDocs(collection(db, "users"));
  snap.docs.forEach((d) => {
    allUsers[d.id] = { id: d.id, ...d.data() };
  });

  // Load cross-device last-seen
  try {
    const lsSnap = await getDoc(doc(db, "lastSeen", user.id));
    lastSeenMap = lsSnap.exists() ? lsSnap.data() || {} : {};
  } catch (_) {
    lastSeenMap = {};
  }

  // Show "Create Group" button for admin+
  if (user.role === "admin" || user.role === "super_admin") {
    const btn = document.getElementById("create-group-btn");
    if (btn) btn.style.display = "flex";
  }

  await loadRooms(user);
  subscribeToAllRoomCounts();
});

// ─── Load rooms ───────────────────────────────────────────────────────────────
async function loadRooms(user) {
  const rooms = [];

  // 1. Static system rooms
  const staticRooms = [
    {
      docId: "chat_global",
      id: "global",
      type: "global",
      name: "General",
      description: "Everyone",
      icon: "global",
    },
  ];
  if (user.role === "admin" || user.role === "super_admin") {
    staticRooms.push({
      docId: "chat_admin",
      id: "admin",
      type: "role",
      name: "Admin Channel",
      description: "Admins only",
      icon: "admin-room",
    });
  }
  if (user.role === "super_admin") {
    staticRooms.push({
      docId: "chat_superadmin",
      id: "super_admin",
      type: "role",
      name: "Super Admin",
      description: "Super Admins only",
      icon: "superadmin-room",
    });
  }

  // Ensure static docs exist in Firestore
  for (const r of staticRooms) {
    const ref = doc(db, "chats", r.docId);
    const s = await getDoc(ref);
    if (!s.exists()) {
      await setDoc(ref, {
        type: r.type,
        relatedId: r.id,
        name: r.name,
        createdAt: serverTimestamp(),
      });
    }
    rooms.push(r);
  }

  // 2. Groups the user is a member of
  const groupSnap = await getDocs(
    query(collection(db, "chats"), where("type", "==", "group")),
  );
  groupSnap.docs.forEach((d) => {
    const data = d.data();
    const members = data.members || [];
    // Super admin sees all groups; others only see groups they're in
    if (user.role === "super_admin" || members.includes(user.id)) {
      rooms.push({
        docId: d.id,
        id: d.id,
        type: "group",
        name: data.name || "Group",
        description: members.length + " members",
        icon: "group-room",
        members,
      });
    }
  });

  chatRooms = rooms;
  renderRooms();
}

// ─── Real-time unread count per room ─────────────────────────────────────────
function subscribeToAllRoomCounts() {
  Object.values(roomUnsubMap).forEach((fn) => fn());
  roomUnsubMap = {};

  chatRooms.forEach((room) => {
    const q = query(
      collection(db, "messages"),
      where("chatId", "==", room.docId),
      limit(50),
    );
    roomUnsubMap[room.docId] = onSnapshot(q, (snap) => {
      const lastSeen = lastSeenMap[room.docId] || 0;
      const unread = snap.docs.filter((d) => {
        const ts = d.data().timestamp?.toMillis?.() || 0;
        return ts > lastSeen && d.data().senderId !== currentUser.id;
      }).length;
      roomUnreadMap[room.docId] = unread;
      renderRooms();
    });
  });
}

// ─── Render room list ─────────────────────────────────────────────────────────
function renderRooms() {
  const el = document.getElementById("chat-rooms-list");
  if (!el) return;

  // Section: System channels
  const systemRooms = chatRooms.filter((r) => r.type !== "group");
  const groupRooms = chatRooms.filter((r) => r.type === "group");

  let html = "";

  if (systemRooms.length) {
    html += '<div class="room-section-label">CHANNELS</div>';
    html += systemRooms.map(roomItem).join("");
  }
  if (groupRooms.length) {
    html +=
      '<div class="room-section-label" style="margin-top:16px;">GROUPS</div>';
    html += groupRooms.map(roomItem).join("");
  }

  el.innerHTML = html;
}

function roomItem(room) {
  const unread = roomUnreadMap[room.docId] || 0;
  const isActive = activeChatId === room.docId;
  return `
    <div class="chat-room-item ${isActive ? "active" : ""}"
      data-testid="chat-room-${room.id}"
      onclick="selectRoom('${room.docId}','${sanitizeHtml(room.name).replace(/'/g, "\\'")}','${room.icon}')">
      <div class="chat-room-icon ${room.icon}">
        <i class="ph ${getRoomIcon(room.icon)}"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <div class="chat-room-name">${sanitizeHtml(room.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizeHtml(room.description)}</div>
      </div>
      ${
        unread > 0 && !isActive
          ? `
        <div style="min-width:18px;height:18px;background:var(--accent-pink);border-radius:999px;
          font-size:10px;font-weight:700;color:#fff;display:flex;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0;">
          ${unread > 9 ? "9+" : unread}
        </div>`
          : ""
      }
    </div>`;
}

function getRoomIcon(type) {
  return (
    {
      global: "ph-globe",
      "admin-room": "ph-shield",
      "superadmin-room": "ph-crown",
      "group-room": "ph-users-three",
      "task-room": "ph-check-square",
    }[type] || "ph-chat-circle"
  );
}

// ─── Select + open room ───────────────────────────────────────────────────────
window.selectRoom = (chatId, name, icon) => {
  activeChatId = chatId;

  // Mark seen
  lastSeenMap[chatId] = Date.now();
  setDoc(doc(db, "lastSeen", currentUser.id), lastSeenMap, {
    merge: true,
  }).catch(() => {});
  roomUnreadMap[chatId] = 0;
  renderRooms();

  // Header
  const nameEl = document.getElementById("chat-room-name-header");
  const iconEl = document.getElementById("chat-room-icon-header");
  const descEl = document.getElementById("chat-room-desc-header");
  if (nameEl) nameEl.textContent = name;
  if (iconEl) iconEl.className = "ph " + getRoomIcon(icon);
  if (descEl)
    descEl.textContent =
      chatRooms.find((r) => r.docId === chatId)?.description || "";

  // Show input
  const inputArea = document.getElementById("chat-input-area");
  if (inputArea) inputArea.style.display = "flex";

  // Unsubscribe previous message listener
  if (unsubMessages) unsubMessages();

  const q = query(
    collection(db, "messages"),
    where("chatId", "==", chatId),
    limit(100),
  );
  unsubMessages = onSnapshot(
    q,
    (snap) => {
      const msgs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0),
        );
      renderMessages(msgs);

      // Keep seen updated
      lastSeenMap[chatId] = Date.now();
      setDoc(doc(db, "lastSeen", currentUser.id), lastSeenMap, {
        merge: true,
      }).catch(() => {});
      roomUnreadMap[chatId] = 0;
      renderRooms();
    },
    (err) => console.error("Messages listener:", err.code),
  );

  // Typing
  if (unsubTyping) unsubTyping();
  unsubTyping = onSnapshot(doc(db, "typing", chatId), (snap) => {
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
    others.length ? showTyping(others) : hideTyping();
  });
};

// ─── Typing indicator ─────────────────────────────────────────────────────────
function showTyping(names) {
  let el = document.getElementById("typing-indicator");
  if (!el) {
    el = document.createElement("div");
    el.id = "typing-indicator";
    el.style.cssText =
      "padding:6px 16px;font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;flex-shrink:0;";
    document.getElementById("messages-list")?.after(el);
  }
  el.innerHTML = `
    <span style="display:flex;gap:3px;align-items:center;">
      <span style="width:5px;height:5px;border-radius:50%;background:var(--accent-cyan);animation:bounce 0.8s infinite;"></span>
      <span style="width:5px;height:5px;border-radius:50%;background:var(--accent-cyan);animation:bounce 0.8s 0.15s infinite;"></span>
      <span style="width:5px;height:5px;border-radius:50%;background:var(--accent-cyan);animation:bounce 0.8s 0.3s infinite;"></span>
    </span>
    ${sanitizeHtml(names.join(", "))} ${names.length === 1 ? "is" : "are"} typing...`;
}
function hideTyping() {
  document.getElementById("typing-indicator")?.remove();
}

// Broadcast typing
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("msg-input")?.addEventListener("input", async () => {
    if (!activeChatId || !currentUser) return;
    try {
      await setDoc(
        doc(db, "typing", activeChatId),
        { [currentUser.id]: serverTimestamp() },
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

// ─── Render messages ──────────────────────────────────────────────────────────
function renderMessages(msgs) {
  const el = document.getElementById("messages-list");
  if (!msgs.length) {
    el.innerHTML =
      '<div class="empty-state"><i class="ph ph-chat-circle"></i><p>No messages yet. Say hello!</p></div>';
    return;
  }

  let lastDate = "";
  el.innerHTML = msgs
    .map((m) => {
      const u = allUsers[m.senderId];
      const isMe = m.senderId === currentUser.id;
      const ts = m.timestamp?.toDate ? m.timestamp.toDate() : new Date();
      const dateStr = ts.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      let dateDivider = "";
      if (dateStr !== lastDate) {
        lastDate = dateStr;
        dateDivider = `<div style="display:flex;align-items:center;gap:10px;margin:12px 0;">
        <div style="flex:1;height:1px;background:rgba(255,255,255,0.06);"></div>
        <div style="font-size:10px;color:var(--text-muted);font-weight:600;letter-spacing:0.06em;white-space:nowrap;">${dateStr}</div>
        <div style="flex:1;height:1px;background:rgba(255,255,255,0.06);"></div>
      </div>`;
      }

      return (
        dateDivider +
        `
      <div class="message-item" data-testid="chat-msg-${m.id}" style="${isMe ? "flex-direction:row-reverse;" : ""}">
        <div class="message-avatar" style="${isMe ? "background:linear-gradient(135deg,var(--accent-pink),var(--accent-purple));" : ""}">
          ${u?.photoURL ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">` : `<span style="font-size:11px;font-weight:700;">${getInitials(u?.displayName)}</span>`}
        </div>
        <div class="message-content" style="${isMe ? "align-items:flex-end;" : "align-items:flex-start;"}">
          <div class="message-header" style="${isMe ? "flex-direction:row-reverse;" : ""}">
            <span class="message-sender">${isMe ? "You" : sanitizeHtml(u?.displayName || "User")}</span>
            <span class="message-time">${timeAgo(m.timestamp)}</span>
          </div>
          <div class="message-text" style="
            max-width:420px;word-break:break-word;
            padding:9px 13px;
            background:${isMe ? "rgba(0,229,255,0.12)" : "rgba(255,255,255,0.06)"};
            border-radius:${isMe ? "14px 4px 14px 14px" : "4px 14px 14px 14px"};
            border:1px solid ${isMe ? "rgba(0,229,255,0.2)" : "rgba(255,255,255,0.08)"};
            font-size:13px;line-height:1.5;
          ">${escapeHtml(m.message)}</div>
        </div>
      </div>`
      );
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

// ─── Send message ─────────────────────────────────────────────────────────────
window.sendMessage = async () => {
  if (!activeChatId) {
    showToast("Select a chat room first", "warning");
    return;
  }
  const input = document.getElementById("msg-input");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";

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

// ─── Group creation ───────────────────────────────────────────────────────────
window.openCreateGroup = () => {
  selectedGroupMembers = [];
  const form = document.getElementById("group-form");
  if (form) form.reset();
  renderGroupMemberChips();
  renderGroupMemberSearch("");
  document.getElementById("group-modal")?.classList.add("active");
};

window.closeGroupModal = () => {
  document.getElementById("group-modal")?.classList.remove("active");
  selectedGroupMembers = [];
};

window.searchGroupMembers = (val) => {
  renderGroupMemberSearch(val);
};

function renderGroupMemberSearch(val) {
  const el = document.getElementById("group-member-results");
  if (!el) return;
  const q = (val || "").toLowerCase();

  // Admins can add members + other admins; super_admins can add anyone except other super_admins (or include them)
  const eligible = Object.values(allUsers).filter((u) => {
    if (u.id === currentUser.id) return false;
    if (selectedGroupMembers.includes(u.id)) return false;
    if (q && !(u.displayName || "").toLowerCase().includes(q)) return false;
    // admins cannot add super_admins
    if (currentUser.role === "admin" && u.role === "super_admin") return false;
    return true;
  });

  if (!eligible.length) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.innerHTML = eligible
    .slice(0, 8)
    .map(
      (u) => `
    <div onclick="addGroupMember('${u.id}')"
      style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:9px;font-size:13px;border-radius:6px;transition:background 0.15s;"
      onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='transparent'">
      <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--accent-cyan),var(--accent-purple));
        display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#000;flex-shrink:0;">
        ${getInitials(u.displayName)}
      </div>
      <div>
        <div style="font-weight:500;">${sanitizeHtml(u.displayName || "User")}</div>
        <div style="font-size:10px;color:var(--text-muted);">${sanitizeHtml(u.role)}</div>
      </div>
    </div>`,
    )
    .join("");
}

window.addGroupMember = (uid) => {
  if (!selectedGroupMembers.includes(uid)) selectedGroupMembers.push(uid);
  renderGroupMemberChips();
  document.getElementById("group-search-input").value = "";
  document.getElementById("group-member-results").style.display = "none";
};

window.removeGroupMember = (uid) => {
  selectedGroupMembers = selectedGroupMembers.filter((id) => id !== uid);
  renderGroupMemberChips();
};

function renderGroupMemberChips() {
  const el = document.getElementById("group-selected-members");
  if (!el) return;
  el.innerHTML = selectedGroupMembers
    .map((uid) => {
      const u = allUsers[uid];
      return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;
      background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.25);
      border-radius:999px;font-size:11px;color:var(--accent-cyan);">
      ${sanitizeHtml(u?.displayName || uid)}
      <button onclick="removeGroupMember('${uid}')"
        style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px;line-height:1;padding:0;">×</button>
    </span>`;
    })
    .join("");
}

window.submitCreateGroup = async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("group-name-input");
  const name = nameInput?.value?.trim();
  if (!name) {
    showToast("Enter a group name", "error");
    return;
  }
  if (selectedGroupMembers.length === 0) {
    showToast("Add at least one member", "error");
    return;
  }

  const btn = document.getElementById("group-submit-btn");
  btn.disabled = true;

  try {
    const members = [currentUser.id, ...selectedGroupMembers];
    const ref = await addDoc(collection(db, "chats"), {
      type: "group",
      name,
      members,
      createdBy: currentUser.id,
      createdAt: serverTimestamp(),
    });

    // Add to local rooms list and re-render
    chatRooms.push({
      docId: ref.id,
      id: ref.id,
      type: "group",
      name,
      description: members.length + " members",
      icon: "group-room",
      members,
    });
    subscribeToAllRoomCounts();
    renderRooms();

    showToast(`Group "${name}" created!`, "success");
    closeGroupModal();
    // Auto-select the new group
    selectRoom(ref.id, name, "group-room");
  } catch (err) {
    console.error(err);
    showToast("Failed to create group: " + err.message, "error");
  }

  btn.disabled = false;
};

// Close results when clicking outside
document.addEventListener("click", (e) => {
  const input = document.getElementById("group-search-input");
  const results = document.getElementById("group-member-results");
  if (
    input &&
    results &&
    !input.contains(e.target) &&
    !results.contains(e.target)
  ) {
    results.style.display = "none";
  }
});

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    e.target.classList.remove("active");
  }
});

// Bounce keyframe
const style = document.createElement("style");
style.textContent = `@keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }`;
document.head.appendChild(style);
