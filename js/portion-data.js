// ============================================================
// Portion (Syllabus) Coverage module — week-wise cumulative
// "classes taken" and "syllabus % covered" per section, mirroring
// the SoCSE weekly coverage statement. Reuses the SAME section
// rows the section tracker / TLP already use (data.js's
// flattenSections) — no new course data, no overlap with
// CIE Components or TLP.
//
// Each week records FOUR cumulative numbers, matching the sheet:
//   ce = Classes Expected (cumulative, by that week)
//   ch = Classes Held     (cumulative, by that week)
//   ep = Expected Portion % (cumulative, by that week)
//   cp = Covered Portion %  (cumulative, by that week)
// ============================================================

export const WEEK_COUNT = 16;

export function emptyPortionDoc(section) {
  return {
    courseKey: section.courseKey, tab: section.tab, programme: section.programme,
    semester: section.semester, code: section.code, name: section.name,
    section: section.section, faculty: section.faculty,
    totalClassesAllotted: null,
    portionToComplete: "100%",
    weeks: Array.from({ length: WEEK_COUNT }, () => ({ ce: null, ch: null, ep: null, cp: null })),
    updatedBy: null, updatedAt: null,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Reads the latest week that actually has data for each metric — since
 *  every field is a running cumulative total, the most recent non-empty
 *  entry IS the current total (no need to sum across weeks). */
export function computePortionStatus(doc, weekCount = WEEK_COUNT) {
  const weeks = doc.weeks || [];
  let lastCh = null, lastCe = null, lastEp = null, lastCp = null, weeksStarted = 0;

  for (let i = 0; i < weekCount; i++) {
    const w = weeks[i] || {};
    if (num(w.ce) !== null) lastCe = num(w.ce);
    if (num(w.ch) !== null) lastCh = num(w.ch);
    if (num(w.ep) !== null) lastEp = num(w.ep);
    if (num(w.cp) !== null) lastCp = num(w.cp);
    if (num(w.ce) !== null || num(w.ch) !== null || num(w.ep) !== null || num(w.cp) !== null) weeksStarted = i + 1;
  }

  const totalAllotted = num(doc.totalClassesAllotted);
  const pctClassesHeld = totalAllotted && lastCh !== null ? Math.round((lastCh / totalAllotted) * 100) : null;

  let status = "Not Started";
  if (weeksStarted > 0) status = "In Progress";
  if (lastCp !== null && lastCp >= 100) status = "Completed";
  const behind = lastCp !== null && lastEp !== null && lastCp < lastEp - 10;
  if (status === "In Progress" && behind) status = "Behind Schedule";

  return {
    weeksStarted, lastCe, lastCh, lastEp, lastCp, pctClassesHeld, behind, status,
  };
}

export const PROGRAMME_TABS = ["BTech", "BCA", "BSc", "MTech", "Minors", "UE"];
