// auth-guard.js — FIXED: shows loading overlay until auth resolves, prevents content flash
import { auth, db } from "./firebase-config.js";
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
    position:fixed;inset:0;
    background:rgba(245, 246, 250, 0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
    transition:opacity 0.4s ease;
  `;
  overlay.innerHTML = `
    <div style="width:40px;height:40px;border:3px solid rgba(79,110,247,0.15);border-top-color:#4f6ef7;border-right-color:#8b5cf6;border-radius:50%;animation:spin 0.8s linear infinite;box-shadow:0 0 15px rgba(79,110,247,0.3);"></div>
    <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;font-weight:700;background:linear-gradient(135deg, #4f6ef7 0%, #8b5cf6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:pulse-text 1.5s ease-in-out infinite;">Authenticating...</div>
    <style>
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes pulse-text { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
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
