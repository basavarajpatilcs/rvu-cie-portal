// ============================================================
// Firebase project configuration
// ------------------------------------------------------------
// Replace every value below with the config object from your own
// Firebase project (Project settings → General → Your apps → Web app).
// This file is safe to keep public — it only identifies which
// Firebase project to talk to. Actual access control happens in
// firestore.rules and in Firebase Authentication settings.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyDRQI4BfC4dwE8DnJJEf2bVuktpGLQFpTE",
  authDomain: "rvu-cie-tracker.firebaseapp.com",
  projectId: "rvu-cie-tracker",
  storageBucket: "rvu-cie-tracker.firebasestorage.app",
  messagingSenderId: "119163774442",
  appId: "1:119163774442:web:371aa12698331230813e93",
  measurementId: "G-B82ESDYQ67"
};


// Only Google accounts on this domain are allowed to sign in.
// This must match the email domain your faculty actually use.
export const ALLOWED_DOMAIN ="rvu.edu.in";

// Emails allowed to see admin-only controls (seed/reset data).
// Everyone signed in with an @rvu.edu.in account can already VIEW
// the tracking dashboard read-only — this list only gates the
// destructive "seed database" action. Add your coordinators here.
export const ADMIN_EMAILS = [
  "basavarajp@rvu.edu.in",
  "bbpatilcs@gmail.com"
];
