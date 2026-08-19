// ============================================================
// Shared topbar chrome (role badge, avatar, name, Refresh, Sign
// out) used by faculty.js, admin.js, cie-components.js, and
// settings.js — so all four pages behave identically.
// ============================================================

import { signOutUser, isAdmin } from "./auth.js";

/** onRefresh: called when the Refresh button is clicked. Defaults to a
 *  full reload, which is always correct even if a page doesn't wire up
 *  anything smarter. */
export function renderSharedTopbar(user, { roleBadge, onRefresh, showAdminNav, showSettingsNav } = {}) {
  const admin = isAdmin(user.email);
  const badge = roleBadge !== undefined ? roleBadge : (admin ? `<span class="badge-role">Coordinator</span>` : "");

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

  if (showAdminNav !== false && (admin || showAdminNav)) {
    const adminLink = document.getElementById("adminNavLink");
    if (adminLink) adminLink.style.display = "inline-block";
  }
  if (showSettingsNav !== false && (admin || showSettingsNav)) {
    const settingsLink = document.getElementById("settingsNavLink");
    if (settingsLink) settingsLink.style.display = "inline-block";
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
