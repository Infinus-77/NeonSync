import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Redirect if already logged in
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) window.location.href = "dashboard.html";
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
    const usersSnap = await getDocs(collection(db, "users"));
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
