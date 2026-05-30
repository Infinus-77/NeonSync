// Users management page
import { auth, db } from "./firebase-config.js";
import { requireAuth } from "./auth-guard.js";
import { renderSidebar } from "./sidebar.js";
import { initNotifications, createNotification } from "./notifications.js";
import { checkDeadlineAlerts } from "./deadline-alert.js";
import {
  collection,
  query,
  where,
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
let allTasks = [];
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
    loadTasks();
  },
  ["super_admin", "admin"],
);

function loadUsers() {
  const q = query(collection(db, "users"), where("companyId", "==", currentUser.companyId));
  onSnapshot(q, (snap) => {
    allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    updateUserAnalytics();
    filterUsers();
  });
}

function loadTasks() {
  onSnapshot(query(collection(db, "tasks"), where("companyId", "==", currentUser.companyId)), (snap) => {
    allTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (allUsers.length) filterUsers();
  });
}

function updateUserAnalytics() {
  const container = document.getElementById("users-analytics");
  if (!container) return;
  
  let total = allUsers.length;
  let superAdmins = 0;
  let admins = 0;
  let members = 0;
  
  allUsers.forEach(u => {
    if (u.role === 'super_admin') superAdmins++;
    else if (u.role === 'admin') admins++;
    else members++;
  });
  
  document.getElementById("stat-total-users").textContent = total;
  document.getElementById("stat-super-admins").textContent = superAdmins;
  document.getElementById("stat-admins").textContent = admins;
  document.getElementById("stat-members").textContent = members;
  
  container.style.display = "grid";
}

window.filterUsers = () => {
  const search =
    document.getElementById("user-search")?.value?.toLowerCase() || "";
  const roleFilter = document.getElementById("role-filter")?.value || "";
  const sortOption = document.getElementById("sort-users")?.value || "role";

  let users = [...allUsers];
  if (search)
    users = users.filter(
      (u) =>
        (u.displayName || "").toLowerCase().includes(search) ||
        (u.email || "").toLowerCase().includes(search),
    );
  if (roleFilter) users = users.filter((u) => u.role === roleFilter);

  // Sorting logic
  if (sortOption === "role") {
    const roleWeight = { super_admin: 1, admin: 2, member: 3 };
    users.sort((a, b) => {
      const wA = roleWeight[a.role] || 4;
      const wB = roleWeight[b.role] || 4;
      if (wA !== wB) return wA - wB;
      return (a.displayName || "").localeCompare(b.displayName || "");
    });
  } else if (sortOption === "az") {
    users.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
  } else if (sortOption === "za") {
    users.sort((a, b) => (b.displayName || "").localeCompare(a.displayName || ""));
  } else if (sortOption === "newest") {
    users.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  } else if (sortOption === "oldest") {
    users.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
  } else if (sortOption === "active") {
    users.sort((a, b) => (b.lastActive?.toMillis?.() ?? 0) - (a.lastActive?.toMillis?.() ?? 0));
  }

  // Always pin current user to the top
  const meIndex = users.findIndex((u) => u.id === currentUser.id);
  if (meIndex > -1) {
    const [me] = users.splice(meIndex, 1);
    users.unshift(me);
  }

  renderUsers(users);
};

function renderUsers(users) {
  const container = document.getElementById("users-grid");
  if (!users.length) {
    container.innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column: 1 / -1;">No users found</div>';
    return;
  }

  container.innerHTML = users
    .map((u) => {
      const isMe = u.id === currentUser.id;
      const canManage =
        !isMe &&
        ((currentUser.role === "super_admin" && u.role !== "super_admin") ||
          (currentUser.role === "admin" && u.role === "member"));

      const assignedCount = allTasks.filter(t => t.isCommonTask || (t.assignedTo || []).includes(u.id)).length;
      const completedCount = allTasks.filter(t => {
        if (t.isCommonTask) return t.status === "completed";
        if ((t.assignedTo || []).includes(u.id)) {
          const uStat = (t.userProgress && t.userProgress[u.id]?.status) || t.status || "pending";
          return uStat === "completed";
        }
        return false;
      }).length;

      return `
      <div class="card" style="display:flex;flex-direction:column;align-items:center;padding:24px;text-align:center;position:relative;border:1px solid var(--border-glass);" data-testid="user-card-${u.id}">
        ${isMe ? '<div style="position:absolute;top:12px;right:12px;font-size:10px;font-weight:700;color:var(--cyan);background:rgba(0,242,255,0.1);padding:4px 8px;border-radius:999px;">YOU</div>' : ""}
        <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--purple));display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;overflow:hidden;margin-bottom:12px;border:2px solid rgba(0,242,255,0.25);">
          ${u.photoURL ? `<img src="${u.photoURL}" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span style="display:none;">${getInitials(u.displayName)}</span>` : getInitials(u.displayName)}
        </div>
        
        <div style="font-size:16px;font-weight:800;color:var(--text-primary);margin-bottom:2px;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'Space Grotesk', sans-serif;">
          ${sanitizeHtml(u.displayName || "User")}
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${sanitizeHtml(u.email)}
        </div>
        
        <div style="margin-bottom:20px;">
          ${roleBadge(u.role || "member")}
        </div>

        <div style="display:flex;width:100%;font-size:11px;color:var(--text-muted);margin-bottom:20px;background:var(--bg-input);padding:10px 0;border-radius:var(--radius-md);">
          <div style="flex:1;text-align:center;">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:2px;font-size:14px;">${assignedCount}</div>
            <div>Assigned</div>
          </div>
          <div style="width:1px;background:var(--border-subtle);flex-shrink:0;"></div>
          <div style="flex:1;text-align:center;">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:2px;font-size:14px;">${completedCount}</div>
            <div>Completed</div>
          </div>
          <div style="width:1px;background:var(--border-subtle);flex-shrink:0;"></div>
          <div style="flex:1;text-align:center;">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:2px;font-size:14px;">${u.lastActive ? timeAgo(u.lastActive).replace('ago','') : "---"}</div>
            <div>Active</div>
          </div>
        </div>
        
        <div style="display:flex;gap:8px;width:100%;">
          <a href="profile.html?uid=${u.id}" class="btn btn-secondary btn-sm" style="display:flex;align-items:center;justify-content:center;flex:1;gap:6px;" title="View profile"><i class="ph ph-user"></i> Profile</a>
          ${
            canManage
              ? `
            <button class="btn btn-secondary btn-sm" style="padding:0 12px;" onclick="openRoleModal('${u.id}','${sanitizeHtml(u.displayName).replace(/'/g, "\\'")}','${u.role}')" title="Change role"><i class="ph ph-shield"></i></button>
            <button class="btn btn-outline btn-sm" style="padding:0 12px;color:var(--danger);border-color:rgba(220,38,38,0.3);background:rgba(220,38,38,0.05);" onclick="confirmDeleteUser('${u.id}','${sanitizeHtml(u.displayName).replace(/'/g, "\\'")}')" title="Delete user"><i class="ph ph-trash"></i></button>
          `
              : ""
          }
        </div>
      </div>`;
    })
    .join("");
}

// ─── FIX: Create user using secondary app - does NOT sign out current admin ───
window.openCreateUser = () => {
  document.getElementById("user-modal-title").textContent = "Add New User";
  document.getElementById("cu-submit-label").textContent = "Create User";
  document.getElementById("create-user-form").reset();
  const googleCheckbox = document.getElementById("cu-google-only");
  if (googleCheckbox) googleCheckbox.checked = false;
  document.getElementById("cu-password-group").style.display = "block";
  document.getElementById("cu-password").required = true;
  openModal("create-user-modal");
};

window.togglePasswordRequirement = () => {
  const isGoogleOnly = document.getElementById("cu-google-only")?.checked;
  const pwGroup = document.getElementById("cu-password-group");
  const pwInput = document.getElementById("cu-password");
  
  if (isGoogleOnly) {
    if (pwGroup) pwGroup.style.display = "none";
    if (pwInput) {
      pwInput.required = false;
      pwInput.value = "";
    }
  } else {
    if (pwGroup) pwGroup.style.display = "block";
    if (pwInput) pwInput.required = true;
  }
};

window.submitUser = async (e) => {
  e.preventDefault();
  const name = document.getElementById("cu-name").value.trim();
  const email = document.getElementById("cu-email").value.trim();
  const isGoogleOnly = document.getElementById("cu-google-only")?.checked;
  let password = document.getElementById("cu-password").value;
  
  if (isGoogleOnly) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+";
    password = Array.from(crypto.getRandomValues(new Uint32Array(16)))
      .map((x) => chars[x % chars.length])
      .join("");
  }
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

  const targetUser = allUsers.find((u) => u.id === roleChangeUserId);
  if (
    targetUser &&
    targetUser.role === "super_admin" &&
    newRole !== "super_admin"
  ) {
    showToast("Super Admins cannot be demoted", "error");
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
