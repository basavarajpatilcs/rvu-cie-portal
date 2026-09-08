// ============================================================
// RVU CIE Tracker — notification email sender.
//
// Two triggers:
//   1. onNotificationCreated — fires the moment the Settings page
//      (or the daily reminder job below) writes a doc to
//      `notifications/{id}` with status "pending". Sends the email
//      via SMTP (Nodemailer) and flips status to "sent"/"failed".
//   2. dailyDeadlineCheck — runs once a day. If either deadline in
//      `settings/deadlines` is within REMINDER_LEAD_DAYS, queues one
//      reminder notification to every programme coordinator + admin
//      (so a human decides whether/how to forward it to faculty —
//      see functions/README.md for why this stays deliberately simple).
//
// Setup required before this does anything — see functions/README.md.
// ============================================================

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString, defineSecret } = require("firebase-functions/params");
const nodemailer = require("nodemailer");

initializeApp();
const db = getFirestore();

const SMTP_HOST = defineString("SMTP_HOST");
const SMTP_PORT = defineString("SMTP_PORT", { default: "587" });
const SMTP_USER = defineString("SMTP_USER");
const SMTP_FROM = defineString("SMTP_FROM", { default: "" });
const SMTP_PASS = defineSecret("SMTP_PASS");

const REMINDER_LEAD_DAYS = 3;

function buildTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST.value(),
    port: Number(SMTP_PORT.value()),
    secure: Number(SMTP_PORT.value()) === 465,
    auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
  });
}

exports.onNotificationCreated = onDocumentCreated(
  { document: "notifications/{id}", secrets: [SMTP_PASS] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data || data.status !== "pending") return;

    const recipients = (data.recipients || []).filter(Boolean);
    if (recipients.length === 0) {
      await snap.ref.update({ status: "failed", error: "No recipients", sentAt: FieldValue.serverTimestamp() });
      return;
    }

    try {
      const transport = buildTransport();
      await transport.sendMail({
        from: SMTP_FROM.value() || SMTP_USER.value(),
        to: recipients.join(","),
        subject: data.subject || "RVU CIE Tracker Notification",
        text: data.message || "",
      });
      await snap.ref.update({ status: "sent", sentAt: FieldValue.serverTimestamp() });
    } catch (err) {
      console.error("Failed to send notification", event.params.id, err);
      await snap.ref.update({ status: "failed", error: String(err), sentAt: FieldValue.serverTimestamp() });
    }
  }
);

exports.dailyDeadlineCheck = onSchedule(
  { schedule: "every day 08:00", timeZone: "Asia/Kolkata", secrets: [SMTP_PASS] },
  async () => {
    const deadlinesSnap = await db.doc("settings/deadlines").get();
    if (!deadlinesSnap.exists) return;
    const bySemester = deadlinesSnap.data().bySemester || {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fields = [
      { key: "cie1Qp", label: "CIE-1 QP Submission" },
      { key: "cie1Marks", label: "CIE-1 Marks Entry" },
      { key: "cie2Qp", label: "CIE-2 QP Submission" },
      { key: "cie2Marks", label: "CIE-2 Marks Entry" },
      { key: "cie3Qp", label: "CIE-3 QP Submission" },
      { key: "cie3Marks", label: "CIE-3 Marks Entry" },
    ];

    const dueSoonLines = [];
    for (const [semester, row] of Object.entries(bySemester)) {
      for (const { key, label } of fields) {
        const val = row[key];
        if (!val) continue;
        const due = new Date(val);
        const daysLeft = Math.round((due - today) / 86400000);
        if (daysLeft >= 0 && daysLeft <= REMINDER_LEAD_DAYS) {
          dueSoonLines.push(`- Semester ${semester} \u2014 ${label}: due ${val}`);
        }
      }
    }

    if (dueSoonLines.length === 0) return;

    // Recipients: every programme coordinator. Kept deliberately simple
    // (one digest to coordinators, not a per-faculty incomplete-items
    // scan) — see functions/README.md.
    const coordSnap = await db.collection("coordinators").get();
    const emails = new Set();
    coordSnap.forEach((d) => { const e = d.data().email; if (e) emails.add(e); });

    if (emails.size === 0) return;

    await db.collection("notifications").add({
      type: "reminder",
      subject: "RVU CIE Tracker — upcoming deadline(s)",
      message:
        `The following CIE Tracker deadline(s) are coming up:\n\n${dueSoonLines.join("\n")}\n\n` +
        `Please follow up with faculty in your programme who still have pending items ` +
        `(check the Report tab on My Courses / CIE Components for exact status), or forward this reminder as needed.`,
      recipients: [...emails],
      status: "pending",
      createdBy: "system:dailyDeadlineCheck",
      createdAt: FieldValue.serverTimestamp(),
    });
  }
);

// ============================================================
// Organize TLP report uploads into Google Drive, sorted into
// <Programme>/<Semester ...> subfolders under one shared root
// folder. Fires whenever a facultyReports doc is updated with a
// new report whose kind is "upload" and that hasn't been copied
// to Drive yet.
//
// ONE-TIME SETUP REQUIRED (cannot be done from code):
//   1. Enable the Google Drive API for this Firebase project:
//      https://console.cloud.google.com/apis/library/drive.googleapis.com
//   2. Share the destination Drive folder with this project's Cloud
//      Functions service account (Editor access) — find the service
//      account email at Firebase Console → Project Settings → Service
//      Accounts (usually <project-id>@appspot.gserviceaccount.com).
//   3. Set the root folder ID below via:
//      firebase functions:config:set ... — see functions/README.md,
//      "Drive upload organization" section, for the exact commands.
// ============================================================

const { google } = require("googleapis");
const { getStorage: getAdminStorage } = require("firebase-admin/storage");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineString: defineStr2 } = require("firebase-functions/params");

const DRIVE_ROOT_FOLDER_ID = defineStr2("DRIVE_ROOT_FOLDER_ID", {
  default: "1QojV35v88NL8I9Ochgdogs0rNmDBs5dT",
});
// Top-level folder under the root — e.g. "Even 2026", "Odd 2026-27". Set
// once per term from Settings → "Drive Report Organization" (falls back
// to this default if that hasn't been set yet).
const DRIVE_ACADEMIC_YEAR_LABEL = defineStr2("DRIVE_ACADEMIC_YEAR_LABEL", {
  default: "Odd 2026",
});

/** BTech's odd semesters (I/III/V/VII) become "1 sem"/"3 sem"/etc, matching
 *  the requested folder naming. Anything else (BCA/BSc/MTech/UE/Minors'
 *  batch-year or "All" labels) is used as-is — there's no equivalent
 *  roman-numeral convention for those. */
function semesterFolderName(semester) {
  const map = { I: "1 sem", III: "3 sem", V: "5 sem", VII: "7 sem" };
  return map[semester] || String(semester || "Unknown Semester");
}

/** <Code>_Sec<Section>_<Title>_<YYYYMMDD>.<ext> — sanitized so the file is
 *  identifiable from its name alone inside a shared Drive folder, without
 *  needing to open it. Falls back to the original filename's extension. */
function driveFileName(report, sectionFacts) {
  const sanitize = (s) => String(s || "").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-");
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const ext = (report.fileName || "").includes(".") ? report.fileName.slice(report.fileName.lastIndexOf(".")) : "";
  return `${sanitize(sectionFacts.code)}_Sec${sanitize(sectionFacts.section)}_${sanitize(report.title)}_${date}${ext}`;
}

async function getDriveClient() {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/drive"] });
  const client = await auth.getClient();
  return google.drive({ version: "v3", auth: client });
}

async function findOrCreateFolder(drive, name, parentId) {
  const safeName = name.replace(/'/g, "\\'");
  const q = `name = '${safeName}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await drive.files.list({ q, fields: "files(id, name)", spaces: "drive" });
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id;

  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
  });
  return created.data.id;
}

/** Prefers the admin-set label from Settings (settings/driveConfig,
 *  { academicYearLabel: "Even 2026" }) over the deploy-time default, so
 *  changing terms doesn't require a redeploy. */
async function resolveAcademicYearLabel() {
  try {
    const snap = await db.doc("settings/driveConfig").get();
    const label = snap.exists ? snap.data().academicYearLabel : null;
    return label || DRIVE_ACADEMIC_YEAR_LABEL.value();
  } catch {
    return DRIVE_ACADEMIC_YEAR_LABEL.value();
  }
}

exports.organizeTlpReportToDrive = onDocumentUpdated("facultyReports/{sectionId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after) return;

  const beforeIds = new Set((before?.reports || []).map((r) => r.id));
  const newUploads = (after.reports || []).filter(
    (r) => !beforeIds.has(r.id) && r.kind === "upload" && !r.driveFileId && r.storagePath
  );
  if (newUploads.length === 0) return;

  let drive;
  try {
    drive = await getDriveClient();
  } catch (err) {
    console.error("Could not authenticate to Google Drive — has the API been enabled and the folder shared with the service account?", err);
    return;
  }

  const bucket = getAdminStorage().bucket();
  const rootId = DRIVE_ROOT_FOLDER_ID.value();
  const academicYearLabel = await resolveAcademicYearLabel();

  const updatedReports = [...(after.reports || [])];

  for (const report of newUploads) {
    try {
      // Even 2026 -> BTech/BSc/BCA/MTech/Minors/UE -> 1 sem/3 sem/... ,
      // exactly as requested.
      const yearFolderId = await findOrCreateFolder(drive, academicYearLabel, rootId);
      const programmeFolderId = await findOrCreateFolder(drive, after.programme || "Unassigned Programme", yearFolderId);
      const semesterFolderId = await findOrCreateFolder(drive, semesterFolderName(after.semester), programmeFolderId);

      const fileName = driveFileName(report, after);
      const [fileBuffer] = await bucket.file(report.storagePath).download();
      const driveFile = await drive.files.create({
        requestBody: { name: fileName, parents: [semesterFolderId] },
        media: { mimeType: "application/octet-stream", body: require("stream").Readable.from(fileBuffer) },
        fields: "id, webViewLink",
      });

      const idx = updatedReports.findIndex((r) => r.id === report.id);
      if (idx !== -1) {
        updatedReports[idx] = {
          ...updatedReports[idx],
          driveFileId: driveFile.data.id,
          driveUrl: driveFile.data.webViewLink,
          driveFileName: fileName,
          url: driveFile.data.webViewLink,
        };
      }
    } catch (err) {
      console.error(`Failed to copy report ${report.id} to Drive`, err);
    }
  }

  await event.data.after.ref.update({ reports: updatedReports });
});

// ============================================================
// listDriveReports — HTTPS callable used by TLP's Admin Tools tab to
// show a summary of every file actually sitting in the shared Drive
// folder (Academic Year -> Programme -> Semester -> files), so admins
// can verify uploads landed correctly without leaving the portal.
// Requires the same one-time Drive setup as organizeTlpReportToDrive.
// ============================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");

exports.listDriveReports = onCall({}, async (request) => {
  if (!request.auth || !request.auth.token.email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  let drive;
  try {
    drive = await getDriveClient();
  } catch (err) {
    console.error(err);
    throw new HttpsError("internal", "Could not authenticate to Google Drive — check the one-time setup in functions/README.md.");
  }

  const rootId = DRIVE_ROOT_FOLDER_ID.value();
  const results = [];

  async function listChildren(folderId) {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, webViewLink, modifiedTime)",
      spaces: "drive",
      pageSize: 200,
    });
    return res.data.files || [];
  }

  try {
    const yearFolders = await listChildren(rootId);
    for (const yearFolder of yearFolders.filter((f) => f.mimeType === "application/vnd.google-apps.folder")) {
      const programmeFolders = await listChildren(yearFolder.id);
      for (const progFolder of programmeFolders.filter((f) => f.mimeType === "application/vnd.google-apps.folder")) {
        const semesterFolders = await listChildren(progFolder.id);
        for (const semFolder of semesterFolders.filter((f) => f.mimeType === "application/vnd.google-apps.folder")) {
          const files = await listChildren(semFolder.id);
          for (const file of files.filter((f) => f.mimeType !== "application/vnd.google-apps.folder")) {
            results.push({
              academicYear: yearFolder.name,
              programme: progFolder.name,
              semester: semFolder.name,
              fileName: file.name,
              webViewLink: file.webViewLink,
              modifiedTime: file.modifiedTime,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("listDriveReports failed", err);
    throw new HttpsError("internal", "Could not list Drive contents. Check Functions logs for details.");
  }

  return { rootFolderUrl: `https://drive.google.com/drive/folders/${rootId}`, files: results };
});

