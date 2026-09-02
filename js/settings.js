import { requireAuth, isEffectiveAdmin } from "./auth.js";
import { renderSharedTopbar } from "./topbar.js";
import { PROGRAMME_GROUPS, loadCieCourseData, flattenCieCourses } from "./cie-data.js";
import { loadCourseData, flattenCourses } from "./data.js";
import { uniqueSemesters } from "./section-reports.js";
import {
  fetchCoordinators, setCoordinator,
  fetchFacultyDirectory, fetchDeadlines, setDeadlines,
  queueNotification, fetchRecentNotifications,
  fetchPortalAdmins, setPortalAdmins,
} from "./store.js";

// The six fields tracked per semester: separate QP-submission and
// marks-entry-confirmation deadlines for each of CIE-1/2/3.
const DEADLINE_FIELDS = [
  { key: "cie1Qp", label: "CIE-1 QP Submission" },
  { key: "cie1Marks", label: "CIE-1 Marks Entry" },
  { key: "cie2Qp", label: "CIE-2 QP Submission" },
  { key: "cie2Marks", label: "CIE-2 Marks Entry" },
  { key: "cie3Qp", label: "CIE-3 QP Submission" },
  { key: "cie3Marks", label: "CIE-3 Marks Entry" },
];

async function main() {
  const user = await requireAuth();
  if (!user) return;

  const admin = await isEffectiveAdmin(user.email);

  if (!admin) {
    document.getElementById("loadingVeil").remove();
    document.getElementById("appRoot").innerHTML = `
      <div class="empty-state">
        <h3>Settings is for coordinators/admins</h3>
        <p>If you think you should have access here, ask a coordinator to add you as a programme coordinator, or contact the portal admin.</p>
      </div>`;
    renderSharedTopbar(user, { admin, onRefresh: () => window.location.reload() });
    return;
  }

  const [coordinators, facultyDirectory, deadlines, notifications, courseData, cieCourseData, portalAdmins] = await Promise.all([
    fetchCoordinators(), fetchFacultyDirectory(), fetchDeadlines(), fetchRecentNotifications(),
    loadCourseData(), loadCieCourseData(), fetchPortalAdmins(),
  ]);

  // Union of every semester value used across both trackers (I/III/V/VII,
  // plus BCA/BSc/MTech/UE/Minors' "All" or batch-year labels).
  const semesters = uniqueSemesters([
    ...flattenCourses(courseData),
    ...flattenCieCourses(cieCourseData),
  ]);

  renderSharedTopbar(user, { admin, onRefresh: refreshAll });

  document.getElementById("loadingVeil").remove();
  document.getElementById("appRoot").innerHTML = shellHtml(semesters);

  renderCoordinatorPanel(coordinators);
  renderDeadlinesPanel(deadlines, semesters);
  renderNotifyPanel(facultyDirectory, deadlines, semesters);
  renderNotificationsLog(notifications);
  renderPortalAdminsPanel(portalAdmins);
  renderRecommendationsPanel();

  async function refreshAll() {
    const [c, f, d, n, pa] = await Promise.all([
      fetchCoordinators(), fetchFacultyDirectory(), fetchDeadlines(), fetchRecentNotifications(), fetchPortalAdmins(),
    ]);
    renderCoordinatorPanel(c);
    renderDeadlinesPanel(d, semesters);
    renderNotifyPanel(f, d, semesters);
    renderNotificationsLog(n);
    renderPortalAdminsPanel(pa);
  }

  // ---------- Portal Admins (full access, not programme-scoped) ----------

  function renderPortalAdminsPanel(admins) {
    const el = document.getElementById("portalAdminsPanel");
    if (!el) return;

    const draw = (current) => {
      const emails = current.emails || [];
      const listEl = document.getElementById("portalAdminsChips");
      listEl.innerHTML = emails.length
        ? emails.map((email, i) => `
            <span style="display:inline-flex;align-items:center;gap:6px;background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12.5px;margin:0 6px 6px 0;">
              ${escapeHtml(email)}
              <button type="button" class="portal-admin-remove" data-index="${i}" style="border:none;background:none;color:var(--red);cursor:pointer;font-weight:700;line-height:1;padding:0;">&times;</button>
            </span>`).join("")
        : `<span style="font-size:12.5px;color:var(--ink-soft);">None added yet &mdash; only the built-in admins have full access.</span>`;

      listEl.querySelectorAll(".portal-admin-remove").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const idx = Number(btn.dataset.index);
          const nextEmails = (current.emails || []).filter((_, i) => i !== idx);
          await setPortalAdmins(nextEmails, user);
          current.emails = nextEmails;
          draw(current);
        });
      });
    };

    draw(admins);

    document.getElementById("addPortalAdminBtn").onclick = async () => {
      const input = document.getElementById("newPortalAdminInput");
      const email = input.value.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        alert("Enter a valid email address.");
        return;
      }
      const current = admins.emails || [];
      if (current.includes(email)) {
        input.value = "";
        return;
      }
      const nextEmails = [...current, email];
      await setPortalAdmins(nextEmails, user);
      admins.emails = nextEmails;
      input.value = "";
      draw(admins);
    };
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

  // ---------- Deadlines (per semester, per CIE stage, QP vs Marks) ----------

  let deadlinesState = { bySemester: {} };

  function renderDeadlinesPanel(deadlines, semesterList) {
    deadlinesState = { bySemester: { ...(deadlines.bySemester || {}) } };
    const body = document.getElementById("deadlinesTableBody");
    body.innerHTML = semesterList.map((sem) => {
      const row = deadlinesState.bySemester[sem] || {};
      return `
        <tr data-semester="${escapeAttr(sem)}">
          <td><strong>${escapeHtml(sem)}</strong></td>
          ${DEADLINE_FIELDS.map((f) => `<td><input type="date" class="deadline-input" data-field="${f.key}" value="${row[f.key] || ""}" /></td>`).join("")}
          <td><button type="button" class="btn btn--outline btn--sm deadline-save-btn">Save</button></td>
        </tr>`;
    }).join("");

    body.querySelectorAll(".deadline-save-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tr = btn.closest("tr");
        const sem = tr.dataset.semester;
        const row = {};
        tr.querySelectorAll(".deadline-input").forEach((inp) => { row[inp.dataset.field] = inp.value || null; });
        deadlinesState.bySemester[sem] = row;
        btn.disabled = true;
        btn.textContent = "Saving\u2026";
        try {
          // Write the whole map (not a dotted field path) — setDoc(merge)
          // treats a key containing a "." as a literal field name, not a
          // nested path, so we merge client-side and send the full object.
          await setDeadlines({ bySemester: deadlinesState.bySemester }, user);
          btn.textContent = "Saved \u2713";
        } catch (err) {
          console.error(err);
          alert("Could not save deadlines for this semester. Check your connection and try again.");
        } finally {
          setTimeout(() => { btn.textContent = "Save"; btn.disabled = false; }, 1000);
        }
      });
    });
  }

  // ---------- Notifications ----------

  function renderNotifyPanel(facultyDirectory, deadlines, semesterList) {
    document.getElementById("loadAllFacultyBtn").onclick = () => {
      const emails = Object.values(facultyDirectory).map((f) => f.email).filter(Boolean);
      document.getElementById("notifyRecipients").value = emails.join(", ");
    };

    document.getElementById("insertDeadlineSummaryBtn").onclick = () => {
      const sem = document.getElementById("notifySemesterSelect").value;
      const row = (deadlines.bySemester || {})[sem] || {};
      const lines = DEADLINE_FIELDS
        .filter((f) => row[f.key])
        .map((f) => `- ${f.label}: ${row[f.key]}`);

      document.getElementById("notifySubject").value = `Reminder: Semester ${sem} CIE Deadlines`;
      document.getElementById("notifyMessage").value = lines.length
        ? `The following CIE deadlines are coming up for Semester ${sem}:\n\n${lines.join("\n")}\n\nPlease log in to the RVU CIE Tracker and complete any pending items under "My Courses" (marks entry, QP/answer-key confirmation) or "CIE Components" (evaluation method + marks selection).`
        : `No deadlines are currently set for Semester ${sem} on the Settings page \u2014 set them above first, then re-click this button.`;
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

function shellHtml(semesters) {
  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">Settings</span>
        <h1>Coordinators, Deadlines &amp; Notifications</h1>
        <p>Admin-only controls: assign programme coordinators, set due dates per semester, and send reminder or general email notifications.</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>Portal Admins &mdash; Full Access</h2>
        <span style="font-size:12px;color:var(--ink-soft);">Separate from programme coordinators below &mdash; a Portal Admin has full access everywhere (all programmes, seeding, Settings), not just one programme. Any existing admin can add/remove others here &mdash; no code changes or redeploy needed.</span>
      </div>
      <div class="panel__body">
        <div id="portalAdminsChips" style="margin-bottom:10px;"></div>
        <div style="display:flex;gap:6px;">
          <input type="email" id="newPortalAdminInput" placeholder="name@rvu.edu.in" style="flex:1;max-width:320px;padding:6px 9px;border:1px solid var(--line);border-radius:5px;font-size:13px;" />
          <button type="button" class="btn btn--outline btn--sm" id="addPortalAdminBtn">+ Add Admin</button>
        </div>
      </div>
    </div>
    <div id="portalAdminsPanel"></div>

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
      <div class="panel__head"><h2>Submission Deadlines &mdash; by Semester</h2>
        <span style="font-size:12px;color:var(--ink-soft);">Separate QP-submission and marks-entry deadlines for each of CIE-1/2/3, per semester. Save each row independently.</span>
      </div>
      <div class="panel__body" style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Semester</th>
              ${DEADLINE_FIELDS.map((f) => `<th>${f.label}</th>`).join("")}
              <th></th>
            </tr>
          </thead>
          <tbody id="deadlinesTableBody"></tbody>
        </table>
        ${semesters.length === 0 ? `<p style="color:var(--ink-soft);font-size:13px;">No semesters found in the course data yet.</p>` : ""}
      </div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>Send Notification</h2>
        <span style="font-size:12px;color:var(--ink-soft);">Queues an email \u2014 actually delivered by the notification Cloud Function (see functions/README.md).</span>
      </div>
      <div class="panel__body">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
          <select id="notifySemesterSelect" style="padding:7px 9px;border:1px solid var(--line);border-radius:5px;">
            ${semesters.map((s) => `<option>${escapeHtml(String(s))}</option>`).join("")}
          </select>
          <button type="button" class="btn btn--outline btn--sm" id="insertDeadlineSummaryBtn">Insert deadline summary for selected semester</button>
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
