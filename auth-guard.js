// auth-guard.js — Loading overlay removed except on dashboard
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.style.opacity = "0";
  setTimeout(() => overlay.remove(), 320);
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
      window.location.href = "login.html";
      return;
    }

    try {
      const snap = await getDoc(doc(db, "users", firebaseUser.uid));
      if (!snap.exists()) {
        hideLoadingOverlay();
        window.location.href = "login.html";
        return;
      }

      const user = { id: firebaseUser.uid, ...snap.data() };

      // Role check
      if (allowedRoles.length && !allowedRoles.includes(user.role)) {
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
      // Change from silent redirect to showing an error so the user isn't stuck in a blind loop
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
