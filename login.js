import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  collection,
  query,
  where,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Redirect if already logged in
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) window.location.href = "dashboard.html";
    } catch (error) {
      console.error("Error fetching user profile:", error);
      // We don't redirect here, allowing the user to see the error or re-authenticate if needed.
    }
  }
});

function switchTab(tab) {
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  document.getElementById("tc-" + tab).classList.add("active");
}

function showResetPanel() {
  document.getElementById("auth-container").style.display = "none";
  document.getElementById("reset-panel").classList.add("visible");
  document.getElementById("reset-success").classList.remove("visible");
  document.getElementById("reset-error").classList.remove("visible");
  document.getElementById("reset-email").value =
    document.getElementById("signin-email").value || "";
}

function hideResetPanel() {
  document.getElementById("auth-container").style.display = "block";
  document.getElementById("reset-panel").classList.remove("visible");
}

async function handleLogin() {
  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;
  const errEl = document.getElementById("signin-error");
  const errText = document.getElementById("signin-error-text");
  const btn = document.getElementById("signin-btn");

  if (!email || !password) {
    errText.textContent = "Please fill in all fields.";
    errEl.classList.add("visible");
    return;
  }

  errEl.classList.remove("visible");
  btn.disabled = true;
  btn.innerHTML =
    '<i class="ph ph-circle-notch" style="animation:spin 0.8s linear infinite;"></i> Signing in...';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "dashboard.html";
  } catch (err) {
    const msgs = {
      "auth/user-not-found": "No account found with this email.",
      "auth/wrong-password": "Incorrect password.",
      "auth/invalid-credential": "Invalid email or password.",
      "auth/too-many-requests": "Too many attempts. Try again later.",
      "auth/invalid-email": "Invalid email address.",
    };
    errText.textContent = msgs[err.code] || err.message;
    errEl.classList.add("visible");
    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-sign-in"></i> Sign In';
  }
}

async function handleRegister() {
  const name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const errEl = document.getElementById("register-error");
  const errText = document.getElementById("register-error-text");
  const btn = document.getElementById("register-btn");

  if (!name || !email || !password) {
    errText.textContent = "Please fill in all fields.";
    errEl.classList.add("visible");
    return;
  }
  if (password.length < 6) {
    errText.textContent = "Password must be at least 6 characters.";
    errEl.classList.add("visible");
    return;
  }

  errEl.classList.remove("visible");
  btn.disabled = true;
  btn.innerHTML =
    '<i class="ph ph-circle-notch" style="animation:spin 0.8s linear infinite;"></i> Creating account...';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // First user becomes Super Admin
    const q = query(collection(db, "users"), limit(1));
    const usersSnap = await getDocs(q);
    const role = usersSnap.empty ? "super_admin" : "member";

    await setDoc(doc(db, "users", cred.user.uid), {
      displayName: name,
      email,
      role,
      bio: "",
      skills: [],
      photoURL: "",
      createdAt: serverTimestamp(),
      lastActive: serverTimestamp(),
      totalTasksCompleted: 0,
      productivityScore: 0,
      weeklyCapacity: 20,
    });

    window.location.href = "dashboard.html";
  } catch (err) {
    const msgs = {
      "auth/email-already-in-use": "An account with this email already exists.",
      "auth/weak-password": "Password must be at least 6 characters.",
      "auth/invalid-email": "Invalid email address.",
    };
    errText.textContent = msgs[err.code] || err.message;
    errEl.classList.add("visible");
    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-user-plus"></i> Create Account';
  }
}

// ✅ FIX: Password reset handler
async function handlePasswordReset() {
  const email = document.getElementById("reset-email").value.trim();
  const errEl = document.getElementById("reset-error");
  const errText = document.getElementById("reset-error-text");
  const successEl = document.getElementById("reset-success");
  const btn = document.getElementById("reset-btn");

  errEl.classList.remove("visible");
  successEl.classList.remove("visible");

  if (!email) {
    errText.textContent = "Please enter your email address.";
    errEl.classList.add("visible");
    return;
  }

  btn.disabled = true;
  btn.innerHTML =
    '<i class="ph ph-circle-notch" style="animation:spin 0.8s linear infinite;"></i> Sending...';

  try {
    await sendPasswordResetEmail(auth, email);
    successEl.classList.add("visible");
    btn.innerHTML = '<i class="ph ph-check"></i> Email sent!';

    // Auto-redirect back after 4s
    setTimeout(() => {
      hideResetPanel();
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-paper-plane-tilt"></i> Send Reset Email';
    }, 4000);
  } catch (err) {
    const msgs = {
      "auth/user-not-found": "No account found with this email.",
      "auth/invalid-email": "Invalid email address.",
      "auth/too-many-requests": "Too many requests. Try again later.",
    };
    errText.textContent = msgs[err.code] || err.message;
    errEl.classList.add("visible");
    btn.disabled = false;
    btn.innerHTML = '<i class="ph ph-paper-plane-tilt"></i> Send Reset Email';
  }
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

async function handleGoogleSignIn() {
  // Grab whichever Google button is currently visible to show loading
  const btns = document.querySelectorAll(".btn-google");
  btns.forEach((b) => {
    b.disabled = true;
    b.innerHTML =
      '<i class="ph ph-circle-notch" style="animation:spin 0.8s linear infinite;"></i> Connecting...';
  });

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;

    // Check if user profile already exists in Firestore
    const snap = await getDoc(doc(db, "users", user.uid));

    if (!snap.exists()) {
      // First-time Google user — create profile
      const q = query(collection(db, "users"), limit(1));
      const usersSnap = await getDocs(q);
      const role = usersSnap.empty ? "super_admin" : "member";

      await setDoc(doc(db, "users", user.uid), {
        displayName: user.displayName || "Google User",
        email: user.email || "",
        role,
        bio: "",
        skills: [],
        photoURL: user.photoURL || "",
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp(),
        totalTasksCompleted: 0,
        productivityScore: 0,
        weeklyCapacity: 20,
      });
    }

    window.location.href = "dashboard.html";
  } catch (err) {
    // User closed popup or other error
    if (err.code !== "auth/popup-closed-by-user") {
      console.error("Google sign-in error:", err);
      // Show error on whichever tab is active
      const signinErr = document.getElementById("signin-error");
      const signinErrText = document.getElementById("signin-error-text");
      if (signinErr && signinErrText) {
        signinErrText.textContent =
          err.code === "auth/account-exists-with-different-credential"
            ? "An account already exists with this email using a different sign-in method."
            : "Google sign-in failed. Please try again.";
        signinErr.classList.add("visible");
      }
    }
    btns.forEach((b) => {
      b.disabled = false;
      b.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continue with Google';
    });
  }
}

// ── All event bindings go here — after every function is defined
document
  .getElementById("tab-signin")
  .addEventListener("click", () => switchTab("signin"));
document
  .getElementById("tab-register")
  .addEventListener("click", () => switchTab("register"));
document.getElementById("signin-btn").addEventListener("click", handleLogin);
document
  .getElementById("register-btn")
  .addEventListener("click", handleRegister);
document
  .getElementById("forgot-password-btn")
  .addEventListener("click", showResetPanel);
document
  .getElementById("back-to-signin-btn")
  .addEventListener("click", hideResetPanel);
document
  .getElementById("reset-btn")
  .addEventListener("click", handlePasswordReset);
["signin-email", "signin-password"].forEach((id) => {
  document.getElementById(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLogin();
  });
});
document.getElementById("reset-email").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handlePasswordReset();
});

// Google sign-in buttons (one per tab)
document.querySelectorAll(".btn-google").forEach((btn) => {
  btn.addEventListener("click", handleGoogleSignIn);
});
