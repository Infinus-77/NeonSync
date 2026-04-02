// chat.js — Groups only (no auto task rooms). Admins/super_admins can create groups.
import { db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications } from "./notifications.js";
import { checkDeadlineAlerts } from "./deadline-alert.js";
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
  arrayRemove,
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
  checkDeadlineAlerts(user);

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
        <div style="min-width:18px;height:18px;background:var(--rose);border-radius:999px;
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

  // Show/hide group action buttons
  const isGroup = icon === "group-room";
  const canManage = currentUser.role === "admin" || currentUser.role === "super_admin";

  const addMembersBtn = document.getElementById("add-members-btn");
  if (addMembersBtn) addMembersBtn.style.display = isGroup && canManage ? "flex" : "none";

  const exitGroupBtn = document.getElementById("exit-group-btn");
  if (exitGroupBtn) exitGroupBtn.style.display = isGroup ? "flex" : "none";

  // Show members icon on group name
  const membersIcon = document.getElementById("group-members-icon");
  if (membersIcon) membersIcon.style.display = isGroup ? "inline-flex" : "none";

  // Make group name clickable only for groups
  const nameEl2 = document.getElementById("chat-room-name-header");
  if (nameEl2) nameEl2.style.cursor = isGroup ? "pointer" : "default";

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
      <span style="width:5px;height:5px;border-radius:50%;background:var(--blue);animation:bounce 0.8s infinite;"></span>
      <span style="width:5px;height:5px;border-radius:50%;background:var(--blue);animation:bounce 0.8s 0.15s infinite;"></span>
      <span style="width:5px;height:5px;border-radius:50%;background:var(--blue);animation:bounce 0.8s 0.3s infinite;"></span>
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
        <div style="flex:1;height:1px;background:rgba(0,0,0,0.03);"></div>
        <div style="font-size:10px;color:var(--text-muted);font-weight:600;letter-spacing:0.06em;white-space:nowrap;">${dateStr}</div>
        <div style="flex:1;height:1px;background:rgba(0,0,0,0.03);"></div>
      </div>`;
      }

      return (
        dateDivider +
        (m.type === "system"
          ? `<div style="display:flex;align-items:center;gap:10px;margin:8px 0;" data-testid="chat-msg-${m.id}">
              <div style="flex:1;height:1px;background:var(--border-glass);"></div>
              <div style="font-size:11px;color:var(--text-muted);font-style:italic;white-space:nowrap;padding:0 6px;">${escapeHtml(m.message)}</div>
              <div style="flex:1;height:1px;background:var(--border-glass);"></div>
            </div>`
          : `
      <div class="message-item" data-testid="chat-msg-${m.id}" style="${isMe ? "flex-direction:row-reverse;" : ""}">
        <div class="message-avatar" style="${isMe ? "background:var(--gradient-brand);" : ""}">
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
            background:${isMe ? "rgba(79,110,247,0.12)" : "rgba(0,0,0,0.03)"};
            border-radius:${isMe ? "14px 4px 14px 14px" : "4px 14px 14px 14px"};
            border:1px solid ${isMe ? "rgba(79,110,247,0.20)" : "var(--border-glass)"};
            font-size:13px;line-height:1.5;
          ">${escapeHtml(m.message)}</div>
        </div>
      </div>`)
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
      onmouseover="this.style.background='rgba(0,0,0,0.03)'" onmouseout="this.style.background='transparent'">
      <div style="width:28px;height:28px;border-radius:50%;background:var(--gradient-brand);
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
      background:rgba(79,110,247,0.10);border:1px solid rgba(79,110,247,0.25);
      border-radius:999px;font-size:11px;color:var(--blue);">
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

// ─── Add Members to existing group ───────────────────────────────────────────
let addMemberSelected = [];

window.openAddMembersModal = () => {
  addMemberSelected = [];
  document.getElementById("add-member-search-input").value = "";
  document.getElementById("add-member-results").style.display = "none";
  document.getElementById("add-selected-members").innerHTML = "";
  document.getElementById("add-member-count").textContent = "";
  document.getElementById("add-members-modal").classList.add("active");
};

window.closeAddMembersModal = () => {
  document.getElementById("add-members-modal").classList.remove("active");
};

window.searchAddMembers = (query) => {
  const el = document.getElementById("add-member-results");
  const q = query.trim().toLowerCase();

  // Get current group members
  const currentRoom = chatRooms.find((r) => r.docId === activeChatId);
  const existingMembers = currentRoom?.members || [];

  const filtered = Object.values(allUsers).filter((u) => {
    if (u.role === "super_admin" && currentUser.role !== "super_admin") return false;
    if (existingMembers.includes(u.id)) return false; // already in group
    if (addMemberSelected.includes(u.id)) return false; // already selected
    if (!q) return true;
    return (
      (u.displayName || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q)
    );
  });

  if (!filtered.length) {
    el.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--text-muted);text-align:center;">No users found</div>`;
    el.style.display = "block";
    return;
  }

  el.innerHTML = filtered
    .map(
      (u) => `
    <div onclick="selectAddMember('${u.id}')" style="
      padding:8px 12px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;
      transition:background 0.15s;border-radius:6px;
    " onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background=''">
      <div style="width:26px;height:26px;border-radius:50%;background:var(--gradient-brand);
        display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#000;flex-shrink:0;">
        ${getInitials(u.displayName || "?")}
      </div>
      <div>
        <div style="font-weight:500;">${sanitizeHtml(u.displayName || "Unknown")}</div>
        <div style="font-size:11px;color:var(--text-muted);">${sanitizeHtml(u.email || "")}</div>
      </div>
    </div>`
    )
    .join("");
  el.style.display = "block";
};

window.selectAddMember = (uid) => {
  if (addMemberSelected.includes(uid)) return;
  addMemberSelected.push(uid);
  document.getElementById("add-member-search-input").value = "";
  document.getElementById("add-member-results").style.display = "none";
  renderAddSelectedChips();
};

function renderAddSelectedChips() {
  const el = document.getElementById("add-selected-members");
  const countEl = document.getElementById("add-member-count");
  countEl.textContent = addMemberSelected.length ? `(${addMemberSelected.length})` : "";
  el.innerHTML = addMemberSelected
    .map((uid) => {
      const u = allUsers[uid];
      const name = u?.displayName || uid;
      return `<div style="
        display:inline-flex;align-items:center;gap:5px;
        background:rgba(79,110,247,0.1);border:1px solid rgba(79,110,247,0.25);
        border-radius:999px;padding:3px 10px;font-size:12px;
      ">
        ${sanitizeHtml(name)}
        <span onclick="removeAddMember('${uid}')" style="cursor:pointer;color:var(--text-muted);font-size:14px;line-height:1;">&times;</span>
      </div>`;
    })
    .join("");
}

window.removeAddMember = (uid) => {
  addMemberSelected = addMemberSelected.filter((id) => id !== uid);
  renderAddSelectedChips();
};

window.submitAddMembers = async () => {
  if (!addMemberSelected.length) {
    showToast("Select at least one member to add", "error");
    return;
  }
  const btn = document.getElementById("add-members-submit-btn");
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "chats", activeChatId), {
      members: arrayUnion(...addMemberSelected),
    });
    // Post system messages for each added member
    const adderName = currentUser.displayName || "Admin";
    for (const uid of addMemberSelected) {
      const addedName = allUsers[uid]?.displayName || "Someone";
      await addDoc(collection(db, "messages"), {
        chatId: activeChatId,
        type: "system",
        message: `${adderName} added ${addedName} to the group`,
        timestamp: serverTimestamp(),
        senderId: "system",
      });
    }
    showToast("Members added successfully!", "success");
    closeAddMembersModal();
  } catch (err) {
    showToast("Failed to add members: " + err.message, "error");
  }
  btn.disabled = false;
};

// Close add-members results when clicking outside
document.addEventListener("click", (e) => {
  const input = document.getElementById("add-member-search-input");
  const results = document.getElementById("add-member-results");
  if (input && results && !input.contains(e.target) && !results.contains(e.target)) {
    results.style.display = "none";
  }
});

// ─── Members Panel ────────────────────────────────────────────────────────────
window.openMembersPanel = () => {
  const room = chatRooms.find((r) => r.docId === activeChatId);
  if (!room || room.type !== "group") return;

  const canManage = currentUser.role === "admin" || currentUser.role === "super_admin";
  const members = room.members || [];
  const listEl = document.getElementById("members-panel-list");

  listEl.innerHTML = members.map((uid) => {
    const u = allUsers[uid];
    const name = u?.displayName || "Unknown";
    const isMe = uid === currentUser.id;
    const removable = canManage && !isMe;

    return `<div style="
      display:flex;align-items:center;gap:10px;
      padding:8px 10px;border-radius:10px;
      background:rgba(0,0,0,0.02);
      border:1px solid var(--border-glass);
    ">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--gradient-brand);
        display:flex;align-items:center;justify-content:center;
        font-size:11px;font-weight:700;color:#000;flex-shrink:0;">
        ${getInitials(name)}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${sanitizeHtml(name)}${isMe ? ' <span style="color:var(--text-muted);font-weight:400;font-size:11px;">(you)</span>' : ""}
        </div>
        <div style="font-size:11px;color:var(--text-muted);">${sanitizeHtml(u?.role || "")}</div>
      </div>
      ${removable ? `<button onclick="confirmRemoveMember('${uid}','${sanitizeHtml(name).replace(/'/g,"\\'")}'); event.stopPropagation();"
        style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);
          border-radius:7px;color:#ef4444;font-size:11px;padding:4px 9px;cursor:pointer;
          display:flex;align-items:center;gap:4px;white-space:nowrap;flex-shrink:0;">
        <i class="ph ph-user-minus"></i> Remove
      </button>` : ""}
    </div>`;
  }).join("");

  document.getElementById("members-panel-overlay").style.display = "block";
  const panel = document.getElementById("members-panel");
  panel.style.display = "flex";
};

window.closeMembersPanel = () => {
  document.getElementById("members-panel-overlay").style.display = "none";
  document.getElementById("members-panel").style.display = "none";
};

// ─── Remove Member ────────────────────────────────────────────────────────────
let removeMemberTargetId = null;
let removeMemberTargetName = null;

window.confirmRemoveMember = (uid, name) => {
  removeMemberTargetId = uid;
  removeMemberTargetName = name;
  closeMembersPanel();
  if (confirm(`Remove "${name}" from this group?`)) {
    submitRemoveMember();
  }
};

async function submitRemoveMember() {
  if (!removeMemberTargetId) return;
  try {
    await updateDoc(doc(db, "chats", activeChatId), {
      members: arrayRemove(removeMemberTargetId),
    });
    const removerName = currentUser.displayName || "Admin";
    await addDoc(collection(db, "messages"), {
      chatId: activeChatId,
      type: "system",
      message: `${removerName} removed ${removeMemberTargetName} from the group`,
      timestamp: serverTimestamp(),
      senderId: "system",
    });
    showToast(`${removeMemberTargetName} removed from group`, "success");
  } catch (err) {
    showToast("Failed to remove member: " + err.message, "error");
  }
  removeMemberTargetId = null;
  removeMemberTargetName = null;
}

// ─── Exit Group ───────────────────────────────────────────────────────────────
window.confirmExitGroup = () => {
  document.getElementById("exit-group-modal").classList.add("active");
};

window.closeExitGroupModal = () => {
  document.getElementById("exit-group-modal").classList.remove("active");
};

window.submitExitGroup = async () => {
  try {
    await updateDoc(doc(db, "chats", activeChatId), {
      members: arrayRemove(currentUser.id),
    });
    const leaverName = currentUser.displayName || "Someone";
    await addDoc(collection(db, "messages"), {
      chatId: activeChatId,
      type: "system",
      message: `${leaverName} left the group`,
      timestamp: serverTimestamp(),
      senderId: "system",
    });
    closeExitGroupModal();
    // Remove from local list and reset chat view
    chatRooms = chatRooms.filter((r) => r.docId !== activeChatId);
    activeChatId = null;
    renderRooms();
    document.getElementById("chat-room-name-header").textContent = "Select a channel";
    document.getElementById("chat-room-desc-header").textContent = "Choose a room from the left";
    document.getElementById("messages-list").innerHTML = `<div class="empty-state"><i class="ph ph-chat-circle"></i><p>Select a chat room to start messaging</p></div>`;
    document.getElementById("chat-input-area").style.display = "none";
    document.getElementById("add-members-btn").style.display = "none";
    document.getElementById("exit-group-btn").style.display = "none";
    document.getElementById("group-members-icon").style.display = "none";
    showToast("You left the group", "success");
  } catch (err) {
    showToast("Failed to leave group: " + err.message, "error");
    closeExitGroupModal();
  }
};
