// ============================================================
// Firestore data layer.
//
// Collections:
//   sections/{id}      one doc per section-faculty assignment
//                       { tab, programme, semester, code, name, section, faculty,
//                         cie1, cie2, cie3,  <- each "Completed" | "Not Completed"
//                         updatedBy, updatedAt }
//   qpTracking/{id}    one doc per course
//                       { tab, programme, semester, code, name, lead,
//                         status,  <- "Completed" | "Not Completed"
//                         updatedBy, updatedAt }
//   facultyLinks/{uid} { email, name, linkedAt }  -- "which faculty member is this login"
// ============================================================

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  writeBatch,
  serverTimestamp,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, app } from "./auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { flattenSections, flattenCourses } from "./data.js";
import { flattenCieCourses, emptyCieDoc } from "./cie-data.js";

const NOT_COMPLETED = "Not Completed";
const COMPLETED = "Completed";

export { NOT_COMPLETED, COMPLETED };

export async function fetchAllSections() {
  const snap = await getDocs(collection(db, "sections"));
  const out = {};
  snap.forEach((d) => (out[d.id] = d.data()));
  return out;
}

export async function fetchAllQp() {
  const snap = await getDocs(collection(db, "qpTracking"));
  const out = {};
  snap.forEach((d) => (out[d.id] = d.data()));
  return out;
}

export async function setSectionStage(id, stage, status, user) {
  const ref = doc(db, "sections", id);
  await updateDoc(ref, {
    [stage]: status,
    updatedBy: user.email,
    updatedAt: serverTimestamp(),
  });
}

export async function setQpStatus(id, status, user) {
  const ref = doc(db, "qpTracking", id);
  await updateDoc(ref, {
    status,
    updatedBy: user.email,
    updatedAt: serverTimestamp(),
  });
}

export async function getFacultyLink(uid) {
  const snap = await getDoc(doc(db, "facultyLinks", uid));
  return snap.exists() ? snap.data() : null;
}

export async function setFacultyLink(uid, email, name) {
  await setDoc(doc(db, "facultyLinks", uid), {
    email,
    name,
    linkedAt: serverTimestamp(),
  });
}

/** Returns true if the sections collection already has at least one document. */
export async function isSeeded() {
  const snap = await getDocs(query(collection(db, "sections"), limit(1)));
  return !snap.empty;
}

/** One-time write of every section-faculty row and course row from courses.json.
 *  Safe to re-run: only creates docs that don't already exist — never overwrites
 *  a status a faculty member has already set. */
export async function seedDatabase(courseData, onProgress) {
  const [existingSections, existingQp] = await Promise.all([fetchAllSections(), fetchAllQp()]);
  const sectionRows = flattenSections(courseData).filter((r) => !existingSections[r.id]);
  const courseRows = flattenCourses(courseData).filter((r) => !existingQp[r.id]);

  const all = [
    ...sectionRows.map((r) => ({
      col: "sections", id: r.id,
      data: {
        tab: r.tab, programme: r.programme, semester: r.semester,
        code: r.code, name: r.name, lead: r.lead || null,
        section: r.section, faculty: r.faculty,
        cie1: NOT_COMPLETED, cie2: NOT_COMPLETED, cie3: NOT_COMPLETED,
        updatedBy: null, updatedAt: null,
      },
    })),
    ...courseRows.map((r) => ({
      col: "qpTracking", id: r.id,
      data: {
        tab: r.tab, programme: r.programme, semester: r.semester,
        code: r.code, name: r.name, lead: r.lead || null,
        status: NOT_COMPLETED,
        updatedBy: null, updatedAt: null,
      },
    })),
  ];

  let written = 0;
  const CHUNK = 400;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const item of chunk) batch.set(doc(db, item.col, item.id), item.data);
    await batch.commit();
    written += chunk.length;
    if (onProgress) onProgress(written, all.length);
  }
  return written;
}

// ============================================================
// CIE Component monitoring (CIE-1/2/3 marks, evaluation methods,
// submission dates, and the credits/category-driven validation
// rules from the SoCSE CIE Consolidated Dashboard workbook).
//
//   cieComponents/{id}   one doc per course, per tab
//     { ...static course fields (code, name, lead, credits, category,
//         track, seeType, students)...
//       cie1: { a:{method,marks,date}, b:{...}, c:{...} },
//       cie2: { marks, qpDate, scrutinyDate, keyDate },
//       cie3: { a:{...}, b:{...}, c:{...} },
//       remarks, updatedBy, updatedAt }
// ============================================================

export async function fetchAllCie() {
  const snap = await getDocs(collection(db, "cieComponents"));
  const out = {};
  snap.forEach((d) => (out[d.id] = d.data()));
  return out;
}

/** Faculty/admin save: the editable component blocks + remarks + audit fields.
 *  Uses set(merge) rather than update so it also works the moment a
 *  coordinator has resynced the course in (no separate "does it exist"
 *  round-trip needed on the caller's side). */
export async function saveCieComponent(id, patch, user) {
  const ref = doc(db, "cieComponents", id);
  await setDoc(
    ref,
    { ...patch, updatedBy: user.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/** Admin-only: reassign course lead / faculty email mapping for one course.
 *  Kept separate from saveCieComponent because rules gate it to admins only. */
export async function setCieCourseMapping(id, { lead, leadEmail }, user) {
  const ref = doc(db, "cieComponents", id);
  await setDoc(
    ref,
    { lead: lead || null, leadEmail: leadEmail || null, updatedBy: user.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function isCieSeeded() {
  const snap = await getDocs(query(collection(db, "cieComponents"), limit(1)));
  return !snap.empty;
}

/** Admin-only migration: adds/corrects the `programmeGroup` field on every
 *  existing cieComponents doc (needed for programme-coordinator permissions).
 *  Safe to re-run — only touches that one field, never marks/dates. */
export async function backfillProgrammeGroups(user) {
  const { programmeGroupForTab } = await import("./cie-data.js");
  const existing = await fetchAllCie();
  const entries = Object.entries(existing).filter(
    ([, d]) => d.tab && d.programmeGroup !== programmeGroupForTab(d.tab)
  );
  let written = 0;
  const CHUNK = 400;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const [id, d] of chunk) {
      batch.set(doc(db, "cieComponents", id),
        { programmeGroup: programmeGroupForTab(d.tab), updatedBy: user.email, updatedAt: serverTimestamp() },
        { merge: true });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

/** One-time write of every course row from data/cie-components.json.
 *  Safe to re-run: never overwrites marks/dates a faculty member already entered. */
export async function seedCieComponents(cieCourseData, onProgress) {
  const existing = await fetchAllCie();
  const rows = flattenCieCourses(cieCourseData).filter((r) => !existing[r.id]);

  const all = rows.map((r) => ({ id: r.id, data: emptyCieDoc(r) }));

  let written = 0;
  const CHUNK = 400;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const item of chunk) batch.set(doc(db, "cieComponents", item.id), item.data);
    await batch.commit();
    written += chunk.length;
    if (onProgress) onProgress(written, all.length);
  }
  return written;
}

// ============================================================
// Faculty directory — name ↔ email, used for the admin course
// mapping tool (dropdown of real emails instead of free text)
// and for CSV bulk-mapping uploads.
//   facultyDirectory/{slug(name)}  { name, email, updatedBy, updatedAt }
// ============================================================

function slugName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function fetchFacultyDirectory() {
  const snap = await getDocs(collection(db, "facultyDirectory"));
  const out = {};
  snap.forEach((d) => (out[d.id] = d.data()));
  return out;
}

/** Admin-only. entries: [{name, email}]. Upserts — last write for a given
 *  name wins, so re-uploading a corrected CSV is safe. */
export async function upsertFacultyDirectory(entries, user) {
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const e of chunk) {
      if (!e.name) continue;
      batch.set(
        doc(db, "facultyDirectory", slugName(e.name)),
        { name: e.name, email: e.email || null, updatedBy: user.email, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

// ============================================================
// Programme coordinators — one designated coordinator (name +
// email) per broad programme group (BTech, BCA, BSc, MTech,
// Minors, UE). Coordinators get edit rights across every course
// in their programme, not just courses where they're the lead.
//   coordinators/{programmeGroup}  { programme, name, email, updatedBy, updatedAt }
// ============================================================

export async function fetchCoordinators() {
  const snap = await getDocs(collection(db, "coordinators"));
  const out = {};
  snap.forEach((d) => (out[d.id] = d.data()));
  return out;
}

/** Admin-only. */
export async function setCoordinator(programmeGroup, { name, email }, user) {
  await setDoc(
    doc(db, "coordinators", programmeGroup),
    { programme: programmeGroup, name: name || null, email: email || null, updatedBy: user.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ============================================================
// Deadlines & notifications — powers the Settings page's due-date
// reminders (CIE marks entry, CIE component selection) and general
// notification broadcasts. Emails are actually sent by a Cloud
// Function watching the `notifications` collection (see
// functions/index.js) — this app only ever writes documents here;
// it never sends mail directly from the browser.
//   settings/deadlines        { bySemester: { "<semester>": {
//                                  cie1Qp, cie1Marks, cie2Qp, cie2Marks, cie3Qp, cie3Marks
//                                } }, updatedBy, updatedAt }
//   notifications/{autoId}    { type, subject, message, recipients, status, createdBy, createdAt }
// ============================================================

export async function fetchDeadlines() {
  const snap = await getDoc(doc(db, "settings", "deadlines"));
  return snap.exists() ? snap.data() : {};
}

/** Admin-only. */
export async function setDeadlines(patch, user) {
  await setDoc(
    doc(db, "settings", "deadlines"),
    { ...patch, updatedBy: user.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ============================================================
// Portal Admins — 3-4 extra people with FULL admin rights (not
// scoped to one programme, unlike coordinators/{programmeGroup}).
// Anyone already in this list (or the hardcoded ADMIN_EMAILS) can
// add/remove more — firestore.rules' isAdmin() checks this same
// document, so it's not just cosmetic.
//   settings/portalAdmins   { emails: [string], updatedBy, updatedAt }
// ============================================================

export async function fetchPortalAdmins() {
  const snap = await getDoc(doc(db, "settings", "portalAdmins"));
  return snap.exists() ? snap.data() : { emails: [] };
}

/** Admin-only (enforced by rules — only an existing admin can call this). */
export async function setPortalAdmins(emails, user) {
  await setDoc(
    doc(db, "settings", "portalAdmins"),
    { emails, updatedBy: user.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ============================================================
// Portion (Syllabus) Coverage — week-wise cumulative classes-
// taken and syllabus-% covered, per section. Reuses the exact
// same section ids as `sections`/`tlpEntries` but writes to its
// own collection, so nothing existing is touched.
//   portionCoverage/{sectionId}   { ...section facts..., totalClassesAllotted,
//                                    portionToComplete, weeks: [{ceWeek,chWeek,epWeek,cpWeek} x16],
//                                    updatedBy, updatedAt }
//   settings/portionWeeks         { bySemester: { "<semester>": {
//                                      academicYear, weeks: [{from,to}] x16
//                                    } }, updatedBy, updatedAt }
// ============================================================

export async function fetchAllPortionCoverage() {
  const snap = await getDocs(collection(db, "portionCoverage"));
  const out = {};
  snap.forEach((d) => (out[d.id] = d.data()));
  return out;
}

/** Any signed-in user (same trust level as `sections`/`tlpEntries`) —
 *  restricted by rules to only the editable fields. */
export async function savePortionCoverageEntry(id, patch, user) {
  await setDoc(
    doc(db, "portionCoverage", id),
    { ...patch, updatedBy: user.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/** Admin-only. One-time write of every section row. Safe to re-run: only
 *  creates rows that don't already exist. */
export async function seedPortionCoverage(sectionRows, emptyPortionDocFn, onProgress) {
  const existing = await fetchAllPortionCoverage();
  const rows = sectionRows.filter((r) => !existing[r.id]);
  const all = rows.map((r) => ({ id: r.id, data: emptyPortionDocFn(r) }));

  let written = 0;
  const CHUNK = 400;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const item of chunk) batch.set(doc(db, "portionCoverage", item.id), item.data);
    await batch.commit();
    written += chunk.length;
    if (onProgress) onProgress(written, all.length);
  }
  return written;
}

/** The per-semester 16-week From/To date schedule + academic year, set by
 *  admins on Settings and shared by every section's Portion Coverage card. */
export async function fetchPortionWeeks() {
  const snap = await getDoc(doc(db, "settings", "portionWeeks"));
  return snap.exists() ? snap.data() : { bySemester: {} };
}

/** Admin-only. Merges one semester's schedule into the existing map —
 *  pass the FULL bySemester object (already merged client-side) so other
 *  semesters' schedules are never clobbered. */
export async function setPortionWeeks(bySemester, user) {
  await setDoc(
    doc(db, "settings", "portionWeeks"),
    { bySemester, updatedBy: user.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ============================================================
// Drive report organization config — the top-level "academic year"
// folder name (e.g. "Even 2026") used by the organizeTlpReportToDrive
// Cloud Function, so it can be changed per term from Settings without
// a redeploy.
//   settings/driveConfig   { academicYearLabel, updatedBy, updatedAt }
// ============================================================

export async function fetchDriveConfig() {
  const snap = await getDoc(doc(db, "settings", "driveConfig"));
  return snap.exists() ? snap.data() : { academicYearLabel: "" };
}

/** Admin-only. */
export async function setDriveConfig(academicYearLabel, user) {
  await setDoc(
    doc(db, "settings", "driveConfig"),
    { academicYearLabel, updatedBy: user.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/** Calls the listDriveReports Cloud Function (see functions/index.js) to
 *  get a live summary of every file actually sitting in the shared Drive
 *  folder. Requires the same one-time Drive API setup as file uploads —
 *  throws with a readable message if that hasn't been done yet. */
export async function listDriveReports() {
  const functions = getFunctions(app);
  const callable = httpsCallable(functions, "listDriveReports");
  const result = await callable();
  return result.data;
}

/** Admin-only. Queues an email — a Cloud Function trigger picks this doc
 *  up, sends it, and flips `status` to "sent" (or "failed"). recipients
 *  is an array of email addresses; type is 'reminder' | 'general'. */
export async function queueNotification({ type, subject, message, recipients }, user) {
  const ref = await addDoc(collection(db, "notifications"), {
    type, subject, message, recipients,
    status: "pending",
    createdBy: user.email,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Admin-only. Most recent 50 notifications, newest first — the Settings
 *  page's "recent activity" log. */
export async function fetchRecentNotifications() {
  const snap = await getDocs(query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(50)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ============================================================
// Teaching-Learning Pedagogy (TLP) — per-section pedagogy type
// (min 3, enforced client-side) + CIE-1/CIE-3 pedagogy & assessment
// style. Reuses the SAME section ids as `sections`, but writes to
// its own collection, so nothing existing is touched.
//   tlpEntries/{sectionId}   { ...section facts..., pedagogyTypes,
//                              ictTools, cie1, cie3, updatedBy, updatedAt }
// ============================================================

export async function fetchAllTlp() {
  const snap = await getDocs(collection(db, "tlpEntries"));
  const out = {};
  snap.forEach((d) => (out[d.id] = d.data()));
  return out;
}

/** Any signed-in user (same trust level as `sections`) — restricted by
 *  rules to only the editable fields, never the pre-filled section facts. */
export async function saveTlpEntry(id, patch, user) {
  await setDoc(
    doc(db, "tlpEntries", id),
    { ...patch, updatedBy: user.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/** Admin-only. One-time write of every section row. Safe to re-run: only
 *  creates rows that don't already exist. */
export async function seedTlpEntries(sectionRows, emptyTlpDocFn, onProgress) {
  const existing = await fetchAllTlp();
  const rows = sectionRows.filter((r) => !existing[r.id]);
  const all = rows.map((r) => ({ id: r.id, data: emptyTlpDocFn(r) }));

  let written = 0;
  const CHUNK = 400;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const item of chunk) batch.set(doc(db, "tlpEntries", item.id), item.data);
    await batch.commit();
    written += chunk.length;
    if (onProgress) onProgress(written, all.length);
  }
  return written;
}

// ============================================================
// TLP option extensions — lets an admin add pedagogy types /
// assessment methods beyond the built-in reference list. Lives in
// the same `settings` collection as deadlines, so no new rules
// are needed for this part.
//   settings/tlpOptions   { extraPedagogyTypes: [{name,description}],
//                            extraAssessmentMethods: [{name,description}],
//                            updatedBy, updatedAt }
// ============================================================

export async function fetchTlpOptions() {
  const snap = await getDoc(doc(db, "settings", "tlpOptions"));
  return snap.exists() ? snap.data() : { extraPedagogyTypes: [], extraAssessmentMethods: [] };
}

/** Admin-only. */
export async function setTlpOptions(patch, user) {
  await setDoc(
    doc(db, "settings", "tlpOptions"),
    { ...patch, updatedBy: user.email, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ============================================================
// Faculty report submissions (TLP tab) — each faculty can attach
// multiple report links (Google Drive, or any URL) per section,
// plus a dashboard to monitor who has/hasn't submitted. Reuses
// the same section ids as `sections`/`tlpEntries` but its own
// collection. Unlike the other trackers, faculty can create their
// own row directly (no admin seeding needed) — reports are
// low-risk, link-only data.
//   facultyReports/{sectionId}   { ...section facts...,
//     reports: [{ id, title, url, addedBy, addedAt }],
//     updatedBy, updatedAt }
// ============================================================

export async function fetchAllFacultyReports() {
  const snap = await getDocs(collection(db, "facultyReports"));
  const out = {};
  snap.forEach((d) => (out[d.id] = d.data()));
  return out;
}

/** Any signed-in user. Creates the row on first use (no seeding step) if
 *  it doesn't already exist, then appends one report link. Section
 *  identity fields are only written on that first creation — later calls
 *  touch just `reports`/audit fields, matching what the rules allow. */
export async function addFacultyReport(id, sectionFacts, report, user) {
  const ref = doc(db, "facultyReports", id);
  const snap = await getDoc(ref);
  const exists = snap.exists();
  const existingReports = exists ? (snap.data().reports || []) : [];
  const reports = [...existingReports, { ...report, addedBy: user.email, addedAt: new Date().toISOString() }];
  await setDoc(
    ref,
    {
      ...(exists ? {} : sectionFacts),
      reports,
      updatedBy: user.email,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Any signed-in user (rules still restrict this to the `reports` field). */
export async function removeFacultyReport(id, reportId, user) {
  const ref = doc(db, "facultyReports", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const reports = (snap.data().reports || []).filter((r) => r.id !== reportId);
  await setDoc(ref, { reports, updatedBy: user.email, updatedAt: serverTimestamp() }, { merge: true });
}
