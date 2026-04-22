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
    background:var(--loading-bg, rgba(11, 14, 20, 0.92));backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
    z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
    transition:opacity 0.4s ease;
  `;
  overlay.innerHTML = `
    <div style="width:40px;height:40px;border:3px solid rgba(0,242,255,0.12);border-top-color:#00F2FF;border-right-color:#BF00FF;border-radius:50%;animation:spin 0.8s linear infinite;box-shadow:0 0 20px rgba(0,242,255,0.25);"></div>
    <div style="font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:700;background:linear-gradient(135deg, #00F2FF 0%, #BF00FF 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:pulse-text 1.5s ease-in-out infinite;">Authenticating...</div>
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
