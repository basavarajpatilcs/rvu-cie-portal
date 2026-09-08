// ============================================================
// Shared topbar chrome (role badge, avatar, name, Refresh, Sign
// out) used by faculty.js, admin.js, cie-components.js, and
// settings.js — so all four pages behave identically.
// ============================================================

import { signOutUser, isAdmin } from "./auth.js";

/** Consistent role badge across every page — used to be computed
 *  ad-hoc only on the CIE Components page, which is why "Coordinator
 *  (Admin)" only ever showed up there. Every page controller now
 *  fetches coordinators and passes the result through the same
 *  function, so the badge (and its wording) matches everywhere. */
export function roleBadgeHtml(admin, coordProgrammes) {
  if (admin) return `<span class="badge-role">Coordinator (Admin)</span>`;
  if (coordProgrammes && coordProgrammes.length) {
    return `<span class="badge-role">${escapeHtml(coordProgrammes.join(", "))} Coordinator</span>`;
  }
  return "";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** onRefresh: called when the Refresh button is clicked. Defaults to a
 *  full reload, which is always correct even if a page doesn't wire up
 *  anything smarter.
 *  admin: pass the already-resolved isEffectiveAdmin() result so the
 *  topbar/nav reflect Firestore-backed "Portal Admins" too, not just the
 *  hardcoded list. Falls back to the sync (hardcoded-only) check if omitted. */
export function renderSharedTopbar(user, { admin, roleBadge, onRefresh, showAdminNav, showSettingsNav } = {}) {
  const isAdminUser = admin !== undefined ? admin : isAdmin(user.email);
  const badge = roleBadge !== undefined ? roleBadge : (isAdminUser ? `<span class="badge-role">Coordinator</span>` : "");

  const el = document.getElementById("topbarUser");
  if (!el) return;

  el.innerHTML = `
    ${badge}
    <button class="btn btn--ghost btn--sm" id="refreshBtn" type="button" title="Reload the latest data">&#8635; Refresh</button>
    ${user.photoURL ? `<img src="${user.photoURL}" alt="" />` : ""}
    <span>${escapeHtml(user.displayName || user.email)}</span>
    <button class="btn btn--ghost btn--sm" id="signOutBtn" type="button">Sign out</button>
  `;

  el.querySelector("#signOutBtn").addEventListener("click", async () => {
    await signOutUser();
    window.location.href = "index.html";
  });

  el.querySelector("#refreshBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (onRefresh) {
      btn.disabled = true;
      const original = btn.innerHTML;
      btn.innerHTML = "&#8635; Refreshing\u2026";
      try {
        await onRefresh();
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    } else {
      window.location.reload();
    }
  });

  if (showAdminNav !== false && (isAdminUser || showAdminNav)) {
    const adminLink = document.getElementById("adminNavLink");
    if (adminLink) adminLink.style.display = "inline-block";
  }
  if (showSettingsNav !== false && (isAdminUser || showSettingsNav)) {
    const settingsLink = document.getElementById("settingsNavLink");
    if (settingsLink) settingsLink.style.display = "inline-block";
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
