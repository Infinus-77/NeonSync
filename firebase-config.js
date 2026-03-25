import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCOgeLPhp7V6gKwlGxp4yL88tCYJQiOdc0",
  authDomain: "neonsync.firebaseapp.com",
  projectId: "neonsync",
  storageBucket: "neonsync.firebasestorage.app",
  messagingSenderId: "1089447630600",
  appId: "1:1089447630600:web:008cbfecea7f9f2fca7ebd",
  measurementId: "G-1THMJ9V7W7",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
