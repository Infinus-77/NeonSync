// auth-guard.js — FIXED: shows loading overlay until auth resolves, prevents content flash
import { auth, db } from "firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ✅ Inject loading overlay immediately (before auth resolves)
injectLoadingOverlay();

function injectLoadingOverlay() {
  if (document.getElementById("auth-loading-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "auth-loading-overlay";
  overlay.style.cssText = `
    position:fixed;inset:0;background:#050505;z-index:9999;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
    transition:opacity 0.3s ease;
  `;
  overlay.innerHTML = `
    <div style="width:44px;height:44px;background:linear-gradient(135deg,#00E5FF,#BD00FF);border-radius:10px;display:flex;align-items:center;justify-content:center;animation:authPulse 1.2s ease infinite;">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="9" stroke="white" stroke-width="2" opacity="0.3"/>
        <path d="M11 2a9 9 0 0 1 9 9" stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
    <div style="font-size:12px;color:rgba(255,255,255,0.3);font-family:Inter,sans-serif;letter-spacing:0.08em;">LOADING</div>
    <style>
      @keyframes authPulse { 0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(0,229,255,0.3)} 50%{transform:scale(1.05);box-shadow:0 0 0 10px rgba(0,229,255,0)} }
      @keyframes authSpin { to{transform:rotate(360deg)} }
    </style>
  `;

  if (document.body) {
    document.body.appendChild(overlay);
  } else {
    document.addEventListener("DOMContentLoaded", () =>
      document.body.appendChild(overlay),
    );
  }
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("auth-loading-overlay");
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
      hideLoadingOverlay();
      window.location.href = "login.html";
    }
  });
}
