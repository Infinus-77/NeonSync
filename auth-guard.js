// auth-guard.js — Multi-tenant with automatic migration
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  collection,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.style.opacity = "0";
  setTimeout(() => overlay.remove(), 320);
}

/**
 * One-time migration: creates the "Syntax Syndicate" company and stamps
 * companyId on every existing document that lacks one.
 * Only runs for admins/super_admins to avoid permission issues.
 */
async function migrateToMultiTenant(user) {
  const COMPANY_CODE = "SYNTAX";
  const COMPANY_NAME = "Syntax Syndicate";

  // 1. Ensure company document exists
  const companyRef = doc(db, "companies", COMPANY_CODE);
  const companySnap = await getDoc(companyRef);
  if (!companySnap.exists()) {
    await setDoc(companyRef, {
      name: COMPANY_NAME,
      code: COMPANY_CODE,
      createdAt: serverTimestamp(),
      createdBy: user.id,
    });
  }

  // 2. Stamp companyId on the current user
  await updateDoc(doc(db, "users", user.id), {
    companyId: COMPANY_CODE,
  });

  // 3. For admin/super_admin — batch-stamp all collections
  if (user.role === "super_admin" || user.role === "admin") {
    const collectionsToMigrate = [
      "users",
      "tasks",
      "chats",
      "messages",
      "events",
      "ideas",
      "notifications",
      "taskLogs",
      "activityLogs",
    ];

    for (const colName of collectionsToMigrate) {
      try {
        const snap = await getDocs(collection(db, colName));
        const docsToUpdate = snap.docs.filter(
          (d) => !d.data().companyId
        );

        // Firestore batches support max 500 ops
        for (let i = 0; i < docsToUpdate.length; i += 450) {
          const batch = writeBatch(db);
          const chunk = docsToUpdate.slice(i, i + 450);
          chunk.forEach((d) => {
            batch.update(doc(db, colName, d.id), {
              companyId: COMPANY_CODE,
            });
          });
          await batch.commit();
        }
      } catch (err) {
        // Some collections may fail due to rules — that's fine, skip
        console.warn(`Migration skipped for ${colName}:`, err.message);
      }
    }
  }

  return COMPANY_CODE;
}

/**
 * Require authentication before rendering a page.
 * @param {Function} callback - Called with the user object once authenticated
 * @param {string[]} [allowedRoles] - Optional role allowlist. Redirects to dashboard if role not allowed.
 */
export function requireAuth(callback, allowedRoles = []) {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      hideLoadingOverlay();
      window.location.href = "index.html";
      return;
    }

    try {
      const snap = await getDoc(doc(db, "users", firebaseUser.uid));
      if (!snap.exists()) {
        hideLoadingOverlay();
        window.location.href = "index.html";
        return;
      }

      let user = { id: firebaseUser.uid, ...snap.data() };

      // ── Multi-tenant migration: auto-assign companyId if missing ──
      if (!user.companyId) {
        try {
          const companyId = await migrateToMultiTenant(user);
          user.companyId = companyId;
        } catch (migErr) {
          console.error("Migration error:", migErr);
          // Non-fatal — continue with the user as-is
        }
      }

      // Treat undefined/null/empty roles as 'member' by default
      const effectiveRole = user.role || "member";

      // Role check
      if (allowedRoles.length && !allowedRoles.includes(effectiveRole)) {
        hideLoadingOverlay();
        window.location.href = "dashboard.html";
        return;
      }

      // ✅ Store globally for notifications module
      window._currentUserId = user.id;
      window.currentUser = user;

      // ✅ Update lastActive silently
      updateDoc(doc(db, "users", firebaseUser.uid), {
        lastActive: serverTimestamp(),
      }).catch(() => {});

      hideLoadingOverlay();
      callback(user);
    } catch (err) {
      console.error("Auth guard error:", err);
      document.body.innerHTML = `
        <div style="padding:40px; text-align:center; font-family:'Manrope',sans-serif; background:#0b0e14; color:#ecedf6; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;">
          <h2 style="color:#ff716c; font-family:'Space Grotesk',sans-serif;">Database Error</h2>
          <p style="color:#a9abb3; margin-top:12px;">We authenticated you, but we couldn't load your user profile from the database.</p>
          <p style="color:#626673; margin-top:8px;">This usually means your Firestore security rules are blocking access, or your profile was never fully created.</p>
          <p style="color:#626673; margin-top:8px;"><i>Technical details: ${err.message}</i></p>
          <br/>
          <button onclick="window.location.href='login.html'" style="padding:10px 20px; cursor:pointer; background:linear-gradient(135deg,#99f7ff,#00f1fe); color:#003538; border:none; border-radius:9px; font-weight:700; font-family:'Manrope',sans-serif;">Go Back to Login</button>
        </div>
      `;
      hideLoadingOverlay();
    }
  });
}
