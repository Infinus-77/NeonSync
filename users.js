// Users management page
import { auth, db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications, createNotification } from "./notifications.js";
import { checkDeadlineAlerts } from "./deadline-alert.js";
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  orderBy,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getInitials,
  roleBadge,
  timeAgo,
  showToast,
  sanitizeHtml,
  showConfirm,
} from "./utils.js";

// ─── FIX: Use a secondary Firebase app to create users without signing out current admin ───
import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as secondarySignOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

let secondaryApp = null;
let secondaryAuth = null;

function getSecondaryAuth() {
  if (!secondaryApp) {
    // Create a secondary app instance specifically for user creation
    const existingApps = getApps();
    const alreadyExists = existingApps.find((a) => a.name === "secondary");
    secondaryApp = alreadyExists || initializeApp(firebaseConfig, "secondary");
    secondaryAuth = getAuth(secondaryApp);
  }
  return secondaryAuth;
}

let allUsers = [];
let currentUser;
let roleChangeUserId = null;

requireAuth(
  async (user) => {
    // Hide the page-level loading overlay now that auth has resolved
    const loadingOverlay = document.getElementById("loading-overlay");
    if (loadingOverlay) {
      loadingOverlay.style.opacity = "0";
      loadingOverlay.style.transition = "opacity 0.3s ease";
      setTimeout(() => loadingOverlay.remove(), 320);
    }
    currentUser = user;

    if (user.role !== "super_admin" && user.role !== "admin") {
      window.location.href = "dashboard.html";
      return;
    }

    renderSidebar("users", user);
    initNotifications(user.id);
    checkDeadlineAlerts(user);

    document.getElementById("users-subtitle").textContent =
      user.role === "super_admin"
        ? "Manage all team members and roles"
        : "Manage your team members";

    // Hide Super Admin role option for regular admins
    if (user.role === "admin") {
      document.getElementById("cu-super-admin-opt")?.remove();
      document.getElementById("role-super-admin-opt")?.remove();
    }

    loadUsers();
  },
  ["super_admin", "admin"],
);

function loadUsers() {
  const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    filterUsers();
  });
}

window.filterUsers = () => {
  const search =
    document.getElementById("user-search")?.value?.toLowerCase() || "";
  const roleFilter = document.getElementById("role-filter")?.value || "";

  let users = [...allUsers];
  if (search)
    users = users.filter(
      (u) =>
        (u.displayName || "").toLowerCase().includes(search) ||
        (u.email || "").toLowerCase().includes(search),
    );
  if (roleFilter) users = users.filter((u) => u.role === roleFilter);

  // Admins can't see super admins (except themselves)
  if (currentUser.role === "admin") {
    users = users.filter(
      (u) => u.role !== "super_admin" || u.id === currentUser.id,
    );
  }

  renderUsers(users);
};

function renderUsers(users) {
  const tbody = document.getElementById("users-tbody");
  if (!users.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">No users found</td></tr>';
    return;
  }

  tbody.innerHTML = users
    .map((u) => {
      const isMe = u.id === currentUser.id;
      const canManage =
        !isMe &&
        (currentUser.role === "super_admin" ||
          (currentUser.role === "admin" && u.role === "member"));

      return `<tr data-testid="user-row-${u.id}">
      <td>
        <div class="user-cell">
          <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--accent-cyan),var(--accent-purple));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0;overflow:hidden;">
            ${u.photoURL ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;">` : getInitials(u.displayName)}
          </div>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);">
              ${sanitizeHtml(u.displayName || "User")} ${isMe ? '<span style="font-size:10px;color:var(--accent-cyan);">(you)</span>' : ""}
            </div>
            <div style="font-size:11px;color:var(--text-muted);">${sanitizeHtml(u.email)}</div>
          </div>
        </div>
      </td>
      <td>${roleBadge(u.role || "member")}</td>
      <td style="font-size:12px;">${u.totalTasksCompleted || 0} completed</td>
      <td style="font-size:12px;">${u.lastActive ? timeAgo(u.lastActive) : "---"}</td>
      <td><span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:600;background:rgba(34,197,94,0.14);color:var(--accent-green);border:1px solid rgba(34,197,94,0.3);">Active</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <a href="profile.html?uid=${u.id}" class="btn btn-secondary btn-sm" title="View profile"><i class="ph ph-eye"></i></a>
          ${
            canManage
              ? `
            <button class="btn btn-secondary btn-sm" onclick="openRoleModal('${u.id}','${u.displayName}','${u.role}')" title="Change role"><i class="ph ph-shield"></i></button>
            <button class="btn btn-danger btn-sm" onclick="confirmDeleteUser('${u.id}','${u.displayName}')" title="Delete user"><i class="ph ph-trash"></i></button>
          `
              : ""
          }
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

// ─── FIX: Create user using secondary app - does NOT sign out current admin ───
window.openCreateUser = () => {
  document.getElementById("user-modal-title").textContent = "Add New User";
  document.getElementById("cu-submit-label").textContent = "Create User";
  document.getElementById("create-user-form").reset();
  document.getElementById("cu-password-group").style.display = "block";
  document.getElementById("cu-password").required = true;
  openModal("create-user-modal");
};

window.submitUser = async (e) => {
  e.preventDefault();
  const name = document.getElementById("cu-name").value.trim();
  const email = document.getElementById("cu-email").value.trim();
  const password = document.getElementById("cu-password").value;
  const role = document.getElementById("cu-role").value;
  const bio = document.getElementById("cu-bio").value.trim();
  const btn = document.getElementById("cu-submit");

  btn.disabled = true;
  btn.innerHTML =
    '<i class="ph ph-circle-notch" style="animation:spin 0.8s linear infinite;"></i> Creating...';

  try {
    if (currentUser.role === "admin" && role === "super_admin") {
      showToast("Admins cannot create Super Admins", "error");
      btn.disabled = false;
      btn.innerHTML =
        '<i class="ph ph-user-plus"></i> <span id="cu-submit-label">Create User</span>';
      return;
    }

    // ✅ Use secondary auth instance — current admin stays signed in
    const sAuth = getSecondaryAuth();
    const cred = await createUserWithEmailAndPassword(sAuth, email, password);

    // Sign out from secondary app immediately (we don't need the session)
    await secondarySignOut(sAuth);

    // Write user profile to Firestore
    await setDoc(doc(db, "users", cred.user.uid), {
      displayName: name,
      email,
      role,
      bio,
      skills: [],
      photoURL: "",
      createdAt: serverTimestamp(),
      lastActive: serverTimestamp(),
      totalTasksCompleted: 0,
      productivityScore: 0,
    });

    await createNotification(
      cred.user.uid,
      "profile_created",
      `Welcome to NeonSync, ${name}! Your account has been created as ${role}.`,
      null,
    );

    showToast(`User "${name}" created successfully!`, "success");
    closeModal("create-user-modal");
  } catch (err) {
    const msgs = {
      "auth/email-already-in-use": "Email already registered.",
      "auth/weak-password": "Password must be 6+ characters.",
      "auth/invalid-email": "Invalid email address.",
    };
    showToast(msgs[err.code] || `Failed: ${err.message}`, "error");
  }

  btn.disabled = false;
  btn.innerHTML =
    '<i class="ph ph-user-plus"></i> <span id="cu-submit-label">Create User</span>';
};

// Role change
window.openRoleModal = (uid, name, currentRole) => {
  roleChangeUserId = uid;
  document.getElementById("role-modal-user").textContent = name;
  document.getElementById("new-role-select").value = currentRole;
  openModal("role-modal");
};

window.confirmRoleChange = async () => {
  const newRole = document.getElementById("new-role-select").value;
  if (!roleChangeUserId) return;

  if (currentUser.role === "admin" && newRole === "super_admin") {
    showToast("Admins cannot assign Super Admin role", "error");
    return;
  }

  try {
    await updateDoc(doc(db, "users", roleChangeUserId), {
      role: newRole,
      updatedAt: serverTimestamp(),
    });
    await createNotification(
      roleChangeUserId,
      "role_changed",
      `Your role has been updated to ${newRole} by ${currentUser.displayName}`,
      null,
    );
    showToast("Role updated successfully", "success");
    closeModal("role-modal");
  } catch (err) {
    showToast("Failed to update role", "error");
  }
};

// Delete user
window.confirmDeleteUser = async (uid, name) => {
  const confirmed = await showConfirm(
    `Remove "${name}"? Their tasks will remain but their profile will be deleted.`,
    "Remove User",
  );
  if (confirmed) deleteUserProfile(uid);
};

async function deleteUserProfile(uid) {
  try {
    await deleteDoc(doc(db, "users", uid));
    showToast("User removed", "success");
  } catch (err) {
    showToast("Failed to remove user", "error");
  }
}

function openModal(id) {
  document.getElementById(id)?.classList.add("active");
}
window.closeModal = (id) =>
  document.getElementById(id)?.classList.remove("active");
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay"))
    e.target.classList.remove("active");
});
