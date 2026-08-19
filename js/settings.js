import { requireAuth, isAdmin } from "./auth.js";
import { renderSharedTopbar } from "./topbar.js";
import { PROGRAMME_GROUPS } from "./cie-data.js";
import {
  fetchCoordinators, setCoordinator,
  fetchFacultyDirectory, fetchDeadlines, setDeadlines,
  queueNotification, fetchRecentNotifications,
} from "./store.js";

async function main() {
  const user = await requireAuth();
  if (!user) return;

  if (!isAdmin(user.email)) {
    document.getElementById("loadingVeil").remove();
    document.getElementById("appRoot").innerHTML = `
      <div class="empty-state">
        <h3>Settings is for coordinators/admins</h3>
        <p>If you think you should have access here, ask a coordinator to add you as a programme coordinator, or contact the portal admin.</p>
      </div>`;
    renderSharedTopbar(user, { onRefresh: () => window.location.reload() });
    return;
  }

  const [coordinators, facultyDirectory, deadlines, notifications] = await Promise.all([
    fetchCoordinators(), fetchFacultyDirectory(), fetchDeadlines(), fetchRecentNotifications(),
  ]);

  renderSharedTopbar(user, { onRefresh: refreshAll });

  document.getElementById("loadingVeil").remove();
  document.getElementById("appRoot").innerHTML = shellHtml();

  renderCoordinatorPanel(coordinators);
  renderDeadlinesPanel(deadlines);
  renderNotifyPanel(facultyDirectory, deadlines);
  renderNotificationsLog(notifications);
  renderRecommendationsPanel();

  async function refreshAll() {
    const [c, f, d, n] = await Promise.all([
      fetchCoordinators(), fetchFacultyDirectory(), fetchDeadlines(), fetchRecentNotifications(),
    ]);
    renderCoordinatorPanel(c);
    renderDeadlinesPanel(d);
    renderNotifyPanel(f, d);
    renderNotificationsLog(n);
  }

  // ---------- Programme Coordinator Mapping ----------

  function renderCoordinatorPanel(coords) {
    const body = document.getElementById("coordTableBody");
    body.innerHTML = PROGRAMME_GROUPS.map((g) => {
      const c = coords[g] || {};
      return `
        <tr data-programme="${g}">
          <td><strong>${g}</strong></td>
          <td><input type="text" class="coord-name" value="${escapeAttr(c.name || "")}" placeholder="Full name" /></td>
          <td><input type="email" class="coord-email" value="${escapeAttr(c.email || "")}" placeholder="name@rvu.edu.in" /></td>
          <td><button type="button" class="btn btn--outline btn--sm coord-save-btn">Save</button></td>
        </tr>`;
    }).join("");

    body.querySelectorAll(".coord-save-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tr = btn.closest("tr");
        const g = tr.dataset.programme;
        const name = tr.querySelector(".coord-name").value.trim();
        const email = tr.querySelector(".coord-email").value.trim();
        btn.disabled = true;
        btn.textContent = "Saving\u2026";
        try {
          await setCoordinator(g, { name, email }, user);
          btn.textContent = "Saved \u2713";
        } catch (err) {
          console.error(err);
          alert("Could not save coordinator. Check your connection and try again.");
        } finally {
          setTimeout(() => { btn.textContent = "Save"; btn.disabled = false; }, 1000);
        }
      });
    });
  }

  // ---------- Deadlines ----------

  function renderDeadlinesPanel(d) {
    document.getElementById("dueMarksEntry").value = d.cieMarksEntryDue || "";
    document.getElementById("dueComponentSelection").value = d.cieComponentSelectionDue || "";
  }

  document.addEventListener("click", async (e) => {
    if (e.target.id !== "saveDeadlinesBtn") return;
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "Saving\u2026";
    try {
      await setDeadlines({
        cieMarksEntryDue: document.getElementById("dueMarksEntry").value || null,
        cieComponentSelectionDue: document.getElementById("dueComponentSelection").value || null,
      }, user);
      btn.textContent = "Saved \u2713";
    } catch (err) {
      console.error(err);
      alert("Could not save deadlines. Check your connection and try again.");
    } finally {
      setTimeout(() => { btn.textContent = "Save Deadlines"; btn.disabled = false; }, 1000);
    }
  });

  // ---------- Notifications ----------

  function renderNotifyPanel(facultyDirectory, d) {
    document.getElementById("loadAllFacultyBtn").onclick = () => {
      const emails = Object.values(facultyDirectory).map((f) => f.email).filter(Boolean);
      document.getElementById("notifyRecipients").value = emails.join(", ");
    };
    document.getElementById("quickMarksReminderBtn").onclick = () => {
      document.getElementById("notifySubject").value = "Reminder: CIE Marks Entry Due";
      document.getElementById("notifyMessage").value =
        `This is a reminder that CIE-1/2/3 marks entry (and question paper + answer key confirmation) is due ${d.cieMarksEntryDue ? `on ${d.cieMarksEntryDue}` : "soon"}. Please log in to the RVU CIE Tracker and complete any pending sections under "My Courses".`;
    };
    document.getElementById("quickComponentReminderBtn").onclick = () => {
      document.getElementById("notifySubject").value = "Reminder: CIE Component Selection Due";
      document.getElementById("notifyMessage").value =
        `This is a reminder that CIE component (evaluation method) selection for CIE-1/2/3 is due ${d.cieComponentSelectionDue ? `on ${d.cieComponentSelectionDue}` : "soon"}. Please log in to the RVU CIE Tracker and complete your entries under "CIE Components".`;
    };
  }

  document.addEventListener("click", async (e) => {
    if (e.target.id !== "sendNotifyBtn") return;
    const btn = e.target;
    const subject = document.getElementById("notifySubject").value.trim();
    const message = document.getElementById("notifyMessage").value.trim();
    const recipientsRaw = document.getElementById("notifyRecipients").value.trim();
    const recipients = recipientsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const status = document.getElementById("notifyStatus");

    if (!subject || !message || recipients.length === 0) {
      status.textContent = "Subject, message, and at least one recipient are required.";
      status.style.color = "var(--red)";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Queuing\u2026";
    try {
      await queueNotification({ type: "general", subject, message, recipients }, user);
      status.textContent = `Queued for ${recipients.length} recipient(s). It will be sent by the notification service shortly (see Recent Activity below).`;
      status.style.color = "var(--ink-soft)";
      const fresh = await fetchRecentNotifications();
      renderNotificationsLog(fresh);
    } catch (err) {
      console.error(err);
      status.textContent = "Could not queue notification. Check your connection and try again.";
      status.style.color = "var(--red)";
    } finally {
      btn.disabled = false;
      btn.textContent = "Send Notification";
    }
  });

  function renderNotificationsLog(notifications) {
    const body = document.getElementById("notifyLogBody");
    body.innerHTML = notifications.map((n) => `
      <tr>
        <td>${n.createdAt ? new Date(n.createdAt.seconds * 1000).toLocaleString() : "\u2014"}</td>
        <td>${escapeHtml(n.subject || "")}</td>
        <td>${(n.recipients || []).length}</td>
        <td><span class="cie-badge ${n.status === "sent" ? "cie-badge--ok" : n.status === "failed" ? "cie-badge--warn" : "cie-badge--progress"}">${escapeHtml(n.status || "pending")}</span></td>
        <td>${escapeHtml(n.createdBy || "")}</td>
      </tr>`).join("") || `<tr><td colspan="5" style="color:var(--ink-soft);">No notifications sent yet.</td></tr>`;
  }
}

// ---------- Expert recommendations (static, admin-only) ----------

function renderRecommendationsPanel() {
  const el = document.getElementById("recommendationsPanel");
  if (!el) return;
  const items = [
    "Lock marks after a course lead marks CIE-3 complete, with an explicit \u201crequest re-open\u201d flow through the coordinator — right now any edit is always allowed, so a completed course can be silently changed later with no trail visible to faculty.",
    "Surface `updatedBy`/`updatedAt` (already stored on every doc) directly on each card in Marks Entry and CIE Components, so faculty can see who last touched a course and when, without needing Firestore console access.",
    "The MTech tab's semester field is inconsistent (\u201cAll\u201d vs specific I/III) in the source workbook — worth cleaning up in the next data refresh so semester-wise filtering/reporting is fully accurate for MTech.",
    "Consider a simple CSV export of the section tracker's raw data (mirroring what CIE Components now has) for offline audit trails during NAAC/IQAC visits.",
    "The evaluation-method dropdown mixes assessment types and named tools; a short one-line description per method (tooltip) would reduce miscategorisation by faculty entering data for the first time.",
    "Email reminders (this Settings page) currently need a Cloud Function deployed with real SMTP/SendGrid credentials to actually send mail \u2014 see the functions/ folder and its README for the one-time setup.",
  ];
  el.innerHTML = `
    <div class="panel">
      <div class="panel__head"><h2>Portal Review Notes</h2>
        <span style="font-size:12px;color:var(--ink-soft);">A few things worth considering as the portal grows \u2014 not blocking, just flagged for you.</span>
      </div>
      <div class="panel__body">
        <ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.9;">
          ${items.map((i) => `<li>${i}</li>`).join("")}
        </ul>
      </div>
    </div>`;
}

function shellHtml() {
  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">Settings</span>
        <h1>Coordinators, Deadlines &amp; Notifications</h1>
        <p>Admin-only controls: assign programme coordinators, set due dates, and send reminder or general email notifications.</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>Programme Coordinator Mapping</h2>
        <span style="font-size:12px;color:var(--ink-soft);">A coordinator can edit every course in their programme across both trackers.</span>
      </div>
      <div class="panel__body" style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr><th>Programme</th><th>Coordinator Name</th><th>Email</th><th></th></tr></thead>
          <tbody id="coordTableBody"></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>Submission Deadlines</h2></div>
      <div class="panel__body">
        <div class="cie-single-row" style="max-width:520px;">
          <div><label>CIE Marks Entry Due</label><input type="date" id="dueMarksEntry" /></div>
          <div><label>CIE Component Selection Due</label><input type="date" id="dueComponentSelection" /></div>
        </div>
        <div class="cie-save-row">
          <button type="button" class="btn btn--primary btn--sm" id="saveDeadlinesBtn">Save Deadlines</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>Send Notification</h2>
        <span style="font-size:12px;color:var(--ink-soft);">Queues an email \u2014 actually delivered by the notification Cloud Function (see functions/README.md).</span>
      </div>
      <div class="panel__body">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button type="button" class="btn btn--outline btn--sm" id="quickMarksReminderBtn">Fill: CIE Marks Entry Reminder</button>
          <button type="button" class="btn btn--outline btn--sm" id="quickComponentReminderBtn">Fill: CIE Component Selection Reminder</button>
        </div>
        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);margin-bottom:3px;">Subject</label>
          <input type="text" id="notifySubject" style="width:100%;max-width:520px;padding:7px 9px;border:1px solid var(--line);border-radius:5px;" />
        </div>
        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);margin-bottom:3px;">Message</label>
          <textarea id="notifyMessage" style="width:100%;min-height:90px;padding:7px 9px;border:1px solid var(--line);border-radius:5px;font-family:inherit;"></textarea>
        </div>
        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);margin-bottom:3px;">Recipients (comma-separated emails)</label>
          <textarea id="notifyRecipients" style="width:100%;min-height:50px;padding:7px 9px;border:1px solid var(--line);border-radius:5px;font-family:inherit;" placeholder="name1@rvu.edu.in, name2@rvu.edu.in"></textarea>
          <button type="button" class="btn btn--outline btn--sm" id="loadAllFacultyBtn" style="margin-top:6px;">Load all faculty from directory</button>
        </div>
        <div class="cie-save-row">
          <button type="button" class="btn btn--primary btn--sm" id="sendNotifyBtn">Send Notification</button>
          <span class="cie-save-note" id="notifyStatus"></span>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>Recent Activity</h2></div>
      <div class="panel__body" style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr><th>When</th><th>Subject</th><th>Recipients</th><th>Status</th><th>Sent By</th></tr></thead>
          <tbody id="notifyLogBody"></tbody>
        </table>
      </div>
    </div>

    <div id="recommendationsPanel"></div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

main();
