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
    const deadlines = deadlinesSnap.data();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checks = [
      { key: "cieMarksEntryDue", label: "CIE Marks Entry" },
      { key: "cieComponentSelectionDue", label: "CIE Component Selection" },
    ];

    const dueSoon = checks.filter(({ key }) => {
      const val = deadlines[key];
      if (!val) return false;
      const due = new Date(val);
      const daysLeft = Math.round((due - today) / 86400000);
      return daysLeft >= 0 && daysLeft <= REMINDER_LEAD_DAYS;
    });

    if (dueSoon.length === 0) return;

    // Recipients: every programme coordinator + this project's admins.
    // Kept deliberately simple (one digest to coordinators, not a
    // per-faculty incomplete-items scan) — see functions/README.md.
    const coordSnap = await db.collection("coordinators").get();
    const emails = new Set();
    coordSnap.forEach((d) => { const e = d.data().email; if (e) emails.add(e); });

    if (emails.size === 0) return;

    const lines = dueSoon.map(({ key, label }) => `- ${label}: due ${deadlines[key]}`);
    await db.collection("notifications").add({
      type: "reminder",
      subject: "RVU CIE Tracker — upcoming deadline(s)",
      message:
        `The following CIE Tracker deadline(s) are coming up:\n\n${lines.join("\n")}\n\n` +
        `Please follow up with faculty in your programme who still have pending items ` +
        `(check the Report tab on My Courses / CIE Components for exact status), or forward this reminder as needed.`,
      recipients: [...emails],
      status: "pending",
      createdBy: "system:dailyDeadlineCheck",
      createdAt: FieldValue.serverTimestamp(),
    });
  }
);
