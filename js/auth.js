// ============================================================
// Shared Firebase app / auth helpers, used by every page.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ALLOWED_DOMAIN, ADMIN_EMAILS } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: ALLOWED_DOMAIN }); // hints Google's account picker; not a hard restriction on its own

export function isAllowedEmail(email) {
  return !!email && email.toLowerCase().endsWith("@" + ALLOWED_DOMAIN.toLowerCase());
}

export function isAdmin(email) {
  return !!email && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

/** Sign in with Google, then enforce the domain restriction client-side.
 *  Firestore rules enforce it again server-side — this is just for a fast, friendly error. */
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, provider);
  const email = result.user.email || "";
  if (!isAllowedEmail(email)) {
    await fbSignOut(auth);
    const err = new Error(
      `"${email}" is not an @${ALLOWED_DOMAIN} account. Sign in with your RVU email address.`
    );
    err.code = "domain-not-allowed";
    throw err;
  }
  return result.user;
}

export function signOutUser() {
  return fbSignOut(auth);
}

/** Resolves with the current user (or null) once Firebase has checked the session. */
export function waitForUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

/** Guards a page: redirects to index.html if not signed in / wrong domain.
 *  Returns the signed-in user otherwise. Call this at the top of faculty.js / admin.js. */
export async function requireAuth() {
  const user = await waitForUser();
  if (!user || !isAllowedEmail(user.email || "")) {
    window.location.href = "index.html";
    return null;
  }
  return user;
}

export function initials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}
