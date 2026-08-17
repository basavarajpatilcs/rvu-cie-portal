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
  writeBatch,
  serverTimestamp,
  query,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./auth.js";
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

/** Faculty/admin save: only the editable component blocks + remarks + audit fields. */
export async function saveCieComponent(id, patch, user) {
  const ref = doc(db, "cieComponents", id);
  await updateDoc(ref, {
    ...patch,
    updatedBy: user.email,
    updatedAt: serverTimestamp(),
  });
}

export async function isCieSeeded() {
  const snap = await getDocs(query(collection(db, "cieComponents"), limit(1)));
  return !snap.empty;
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
