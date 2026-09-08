import { requireAuth, isAdmin, isEffectiveAdmin } from "./auth.js";
import { renderSharedTopbar, roleBadgeHtml } from "./topbar.js";
import { PROGRAMME_GROUPS, loadCieCourseData, flattenCieCourses } from "./cie-data.js";
import { loadCourseData, flattenCourses } from "./data.js";
import { uniqueSemesters } from "./section-reports.js";
import { WEEK_COUNT } from "./portion-data.js";
import {
  fetchCoordinators, setCoordinator,
  fetchFacultyDirectory, fetchDeadlines, setDeadlines,
  queueNotification, fetchRecentNotifications,
  fetchPortalAdmins, setPortalAdmins,
  fetchPortionWeeks, setPortionWeeks,
  fetchDriveConfig, setDriveConfig,
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

// Bump this string whenever settings.js changes — shown on-page so you can
// confirm the browser is actually running the new file, not a cached copy.
const SETTINGS_BUILD = "2026-09-01-diag1";

async function main() {
  const user = await requireAuth();
  if (!user) return;

  const admin = await isEffectiveAdmin(user.email);
  const hardcodedAdmin = isAdmin(user.email);

  // Fetch coordinators FIRST — a programme coordinator (not just a full
  // admin) needs access to Settings too, since Submission Deadlines and
  // Portion Coverage's Week Schedule are exactly what coordinators are
  // expected to maintain. The empty-state message below has always said
  // "coordinators/admins" — this makes that actually true.
  const coordinatorsForGate = await fetchCoordinators();
  const myCoordProgrammes = Object.entries(coordinatorsForGate)
    .filter(([, c]) => c && c.email && c.email.toLowerCase() === user.email.toLowerCase())
    .map(([g]) => g);
  const isCoordinator = myCoordProgrammes.length > 0;

  // Always-visible diagnostic — shows even if the access gate below blocks
  // the rest of the page, so "it's not working" becomes a checkable fact
  // instead of a guess. If any line here doesn't match what you expect,
  // the browser is very likely running an OLD cached version of this file
  // — hard refresh (Cmd+Shift+R / Ctrl+Shift+R) before reporting a bug.
  const diagnosticHtml = `
    <div class="panel" style="border-color:var(--brass);">
      <div class="panel__head"><h2>Access Diagnostic</h2>
        <span style="font-size:11px;color:var(--ink-soft);">settings.js build: ${SETTINGS_BUILD}</span>
      </div>
      <div class="panel__body" style="font-size:13px;line-height:1.9;">
        <div>Signed in as: <strong>${escapeHtml(user.email)}</strong></div>
        <div>Matches hardcoded admin list: <strong style="color:${hardcodedAdmin ? "var(--green)" : "var(--red)"};">${hardcodedAdmin ? "YES" : "NO"}</strong></div>
        <div>Full admin (hardcoded OR Portal Admins list): <strong style="color:${admin ? "var(--green)" : "var(--red)"};">${admin ? "YES" : "NO"}</strong></div>
        <div>Programme coordinator: <strong style="color:${isCoordinator ? "var(--green)" : "var(--ink-soft)"};">${isCoordinator ? myCoordProgrammes.join(", ") : "NO"}</strong></div>
        <div style="margin-top:8px;font-size:12px;color:var(--ink-soft);">If "Signed in as" shows the wrong email, or the YES/NO values look wrong for who you are, hard-refresh this page first. If they're still wrong after that, this is a real bug — screenshot this box and report it exactly as shown.</div>
      </div>
    </div>`;

  if (!admin && !isCoordinator) {
    document.getElementById("loadingVeil").remove();
    document.getElementById("appRoot").innerHTML = diagnosticHtml + `
      <div class="empty-state">
        <h3>Settings is for coordinators/admins</h3>
        <p>If you think you should have access here, ask a coordinator to add you as a programme coordinator, or contact the portal admin.</p>
      </div>`;
    renderSharedTopbar(user, { admin, roleBadge: roleBadgeHtml(admin, myCoordProgrammes), onRefresh: () => window.location.reload() });
    return;
  }

  const [coordinators, facultyDirectory, deadlines, notifications, courseData, cieCourseData, portalAdmins, portionWeeks, driveConfig] = await Promise.all([
    Promise.resolve(coordinatorsForGate), fetchFacultyDirectory(), fetchDeadlines(), fetchRecentNotifications(),
    loadCourseData(), loadCieCourseData(), fetchPortalAdmins(), fetchPortionWeeks(), fetchDriveConfig(),
  ]);

  // Union of every semester value used across both trackers (I/III/V/VII,
  // plus BCA/BSc/MTech/UE/Minors' "All" or batch-year labels).
  const semesters = uniqueSemesters([
    ...flattenCourses(courseData),
    ...flattenCieCourses(cieCourseData),
  ]);

  renderSharedTopbar(user, { admin, roleBadge: roleBadgeHtml(admin, myCoordProgrammes), onRefresh: refreshAll });

  document.getElementById("loadingVeil").remove();
  document.getElementById("appRoot").innerHTML = diagnosticHtml + shellHtml(semesters, admin, isCoordinator);

  renderCoordinatorPanel(coordinators);
  renderDeadlinesPanel(deadlines, semesters);
  renderNotifyPanel(facultyDirectory, deadlines, semesters);
  renderNotificationsLog(notifications);
  renderPortalAdminsPanel(portalAdmins);
  renderPortionWeeksPanel(portionWeeks, semesters);
  renderDriveConfigPanel(driveConfig);
  renderRecommendationsPanel();

  async function refreshAll() {
    const [c, f, d, n, pa, pw, dc] = await Promise.all([
      fetchCoordinators(), fetchFacultyDirectory(), fetchDeadlines(), fetchRecentNotifications(), fetchPortalAdmins(), fetchPortionWeeks(), fetchDriveConfig(),
    ]);
    renderCoordinatorPanel(c);
    renderDeadlinesPanel(d, semesters);
    renderNotifyPanel(f, d, semesters);
    renderNotificationsLog(n);
    renderPortalAdminsPanel(pa);
    renderPortionWeeksPanel(pw, semesters);
    renderDriveConfigPanel(dc);
  }

  // ---------- Drive Report Organization (Academic Year label) ----------

  function renderDriveConfigPanel(config) {
    const el = document.getElementById("driveConfigPanel");
    if (!el) return;
    document.getElementById("driveAcademicYearInput").value = config.academicYearLabel || "";

    document.getElementById("saveDriveConfigBtn").onclick = async (e) => {
      const btn = e.currentTarget;
      const label = document.getElementById("driveAcademicYearInput").value.trim();
      btn.disabled = true;
      btn.textContent = "Saving\u2026";
      try {
        await setDriveConfig(label, user);
        btn.textContent = "Saved \u2713";
      } catch (err) {
        console.error(err);
        alert("Could not save. Check your connection and try again.");
      } finally {
        setTimeout(() => { btn.textContent = "Save"; btn.disabled = false; }, 1000);
      }
    };
  }

  // ---------- Portion Coverage: per-semester week From/To dates ----------

  function renderPortionWeeksPanel(portionWeeks, semesterList) {
    const el = document.getElementById("portionWeeksPanel");
    if (!el) return;

    const bySemester = { ...(portionWeeks.bySemester || {}) };
    const selectEl = document.getElementById("pcWeekSemesterSelect");
    selectEl.innerHTML = semesterList.map((s) => `<option>${escapeHtml(String(s))}</option>`).join("");

    const drawGrid = (sem) => {
      const sched = bySemester[sem] || { academicYear: "", weeks: [] };
      const weeks = sched.weeks && sched.weeks.length === WEEK_COUNT
        ? sched.weeks
        : Array.from({ length: WEEK_COUNT }, () => ({ from: "", to: "" }));

      document.getElementById("pcAcademicYear").value = sched.academicYear || "";
      const grid = document.getElementById("pcWeekDatesGrid");
      grid.innerHTML = weeks.map((w, i) => `
        <div style="border:1px solid var(--line);border-radius:6px;padding:8px;">
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);margin-bottom:4px;">Week ${i + 1}</label>
          <div style="display:flex;gap:4px;">
            <input type="date" class="pc-week-from-input" data-week="${i}" value="${escapeAttr(w.from || "")}" style="flex:1;padding:5px 6px;border:1px solid var(--line);border-radius:4px;font-size:11.5px;" />
            <input type="date" class="pc-week-to-input" data-week="${i}" value="${escapeAttr(w.to || "")}" style="flex:1;padding:5px 6px;border:1px solid var(--line);border-radius:4px;font-size:11.5px;" />
          </div>
        </div>`).join("");
    };

    drawGrid(selectEl.value);
    selectEl.onchange = () => drawGrid(selectEl.value);

    document.getElementById("savePortionWeeksBtn").onclick = async (e) => {
      const btn = e.currentTarget;
      const sem = selectEl.value;
      const grid = document.getElementById("pcWeekDatesGrid");
      const froms = [...grid.querySelectorAll(".pc-week-from-input")].sort((a, b) => Number(a.dataset.week) - Number(b.dataset.week));
      const tos = [...grid.querySelectorAll(".pc-week-to-input")].sort((a, b) => Number(a.dataset.week) - Number(b.dataset.week));
      const weeks = froms.map((f, i) => ({ from: f.value, to: tos[i].value }));
      const academicYear = document.getElementById("pcAcademicYear").value.trim();

      bySemester[sem] = { academicYear, weeks };

      btn.disabled = true;
      btn.textContent = "Saving\u2026";
      try {
        await setPortionWeeks(bySemester, user);
        btn.textContent = "Saved \u2713";
      } catch (err) {
        console.error(err);
        alert("Could not save the week schedule. Check your connection and try again.");
      } finally {
        setTimeout(() => { btn.textContent = "Save Week Schedule"; btn.disabled = false; }, 1000);
      }
    };
  }

  // ---------- Portal Admins (full access, not programme-scoped) ----------

  function renderPortalAdminsPanel(admins) {
    const el = document.getElementById("portalAdminsPanel");
    if (!el) return;

    const statusEl = document.getElementById("portalAdminsStatus");

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
          btn.disabled = true;
          const idx = Number(btn.dataset.index);
          const nextEmails = (current.emails || []).filter((_, i) => i !== idx);
          try {
            await setPortalAdmins(nextEmails, user);
            current.emails = nextEmails;
            if (statusEl) statusEl.textContent = "";
            draw(current);
          } catch (err) {
            console.error(err);
            if (statusEl) { statusEl.textContent = "Could not remove that admin — check your connection (or that Firestore rules were deployed) and try again."; statusEl.style.color = "var(--red)"; }
            btn.disabled = false;
          }
        });
      });
    };

    draw(admins);
    if (!admins.emails || admins.emails.length === 0) {
      if (statusEl) { statusEl.textContent = "No portal admins on file yet — the list above will populate once you add one."; statusEl.style.color = "var(--ink-soft)"; }
    }

    document.getElementById("addPortalAdminBtn").onclick = async () => {
      const btn = document.getElementById("addPortalAdminBtn");
      const input = document.getElementById("newPortalAdminInput");
      const email = input.value.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        if (statusEl) { statusEl.textContent = "Enter a valid email address."; statusEl.style.color = "var(--red)"; }
        return;
      }
      const current = admins.emails || [];
      if (current.includes(email)) {
        input.value = "";
        if (statusEl) { statusEl.textContent = `${email} is already a portal admin.`; statusEl.style.color = "var(--ink-soft)"; }
        return;
      }
      const nextEmails = [...current, email];
      btn.disabled = true;
      btn.textContent = "Adding\u2026";
      try {
        await setPortalAdmins(nextEmails, user);
        admins.emails = nextEmails;
        input.value = "";
        if (statusEl) { statusEl.textContent = `Added ${email}. They'll see admin access next time they load any page.`; statusEl.style.color = "var(--green)"; }
        draw(admins);
      } catch (err) {
        console.error(err);
        if (statusEl) { statusEl.textContent = "Could not save — check your connection (or that Firestore rules were deployed) and try again."; statusEl.style.color = "var(--red)"; }
      } finally {
        btn.disabled = false;
        btn.textContent = "+ Add Admin";
      }
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
        <div id="portalAdminsStatus" style="font-size:12px;margin-top:8px;"></div>
      </div>
    </div>
    <div id="portalAdminsPanel"></div>

    <div class="panel">
      <div class="panel__head"><h2>Portion Coverage &mdash; Week Schedule (per Semester)</h2>
        <span style="font-size:12px;color:var(--ink-soft);">From/To dates for each of the 16 weeks, set separately per semester &mdash; e.g. Semester I's academic calendar can differ from Semester III's.</span>
      </div>
      <div class="panel__body">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:14px;">
          <div>
            <label style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);margin-bottom:3px;">Semester</label>
            <select id="pcWeekSemesterSelect" style="padding:7px 9px;border:1px solid var(--line);border-radius:5px;"></select>
          </div>
          <div style="flex:1;min-width:220px;max-width:360px;">
            <label style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);margin-bottom:3px;">Academic Year</label>
            <input type="text" id="pcAcademicYear" placeholder="e.g. 2025-26 (ODD SEM)" style="width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:5px;" />
          </div>
        </div>
        <div id="pcWeekDatesGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:14px;"></div>
        <div class="cie-save-row">
          <button type="button" class="btn btn--primary btn--sm" id="savePortionWeeksBtn">Save Week Schedule</button>
          <span class="cie-save-note">Saves only the selected semester &mdash; other semesters' schedules are untouched.</span>
        </div>
      </div>
    </div>
    <div id="portionWeeksPanel"></div>

    <div class="panel">
      <div class="panel__head"><h2>Drive Report Organization</h2>
        <span style="font-size:12px;color:var(--ink-soft);">The top-level folder name for TLP report uploads &mdash; e.g. "Even 2026". Change this once per term; no redeploy needed.</span>
      </div>
      <div class="panel__body">
        <div style="max-width:320px;margin-bottom:12px;">
          <label style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);margin-bottom:3px;">Academic Year Label</label>
          <input type="text" id="driveAcademicYearInput" placeholder="e.g. Even 2026" style="width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:5px;" />
        </div>
        <div class="cie-save-row">
          <button type="button" class="btn btn--primary btn--sm" id="saveDriveConfigBtn">Save</button>
          <span class="cie-save-note">Folder structure: this label &rarr; Programme &rarr; Semester (e.g. "1 sem") &rarr; files.</span>
        </div>
      </div>
    </div>
    <div id="driveConfigPanel"></div>

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
