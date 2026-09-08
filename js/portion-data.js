// ============================================================
// Portion (Syllabus) Coverage — week-wise classes-taken and
// syllabus-% covered, per section. Reuses the SAME section rows
// the section tracker / TLP already use (data.js's flattenSections)
// — no new course data, no overlap with CIE Components or TLP.
//
// Faculty enter WEEKLY figures only (classes held this week,
// portion % covered this week) — the app always computes and
// displays the running CUMULATIVE totals automatically (previous
// week's cumulative + this week's entry), so no one has to do
// that math by hand or re-type a running total every week.
// ============================================================

export const WEEK_COUNT = 16;

export function emptyPortionDoc(section) {
  return {
    courseKey: section.courseKey, tab: section.tab, programme: section.programme,
    semester: section.semester, code: section.code, name: section.name,
    section: section.section, faculty: section.faculty,
    totalClassesAllotted: null,
    portionToComplete: "100%",
    // Each week stores WEEKLY (not cumulative) figures — the four values
    // added/covered *that week only*. Cumulative totals are derived, never
    // stored, so there's nothing to get out of sync.
    weeks: Array.from({ length: WEEK_COUNT }, () => ({ ceWeek: null, chWeek: null, epWeek: null, cpWeek: null })),
    updatedBy: null, updatedAt: null,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Running cumulative totals for all 4 metrics, one entry per week —
 *  week i's cumulative = sum of weeks[0..i]'s weekly values. This is the
 *  "previous week + this week" addition the coverage sheet needs, computed
 *  automatically instead of requiring faculty to track a running total. */
export function computeCumulativeWeeks(doc, weekCount = WEEK_COUNT) {
  const weeks = doc.weeks || [];
  let ceCum = 0, chCum = 0, epCum = 0, cpCum = 0;
  const out = [];
  for (let i = 0; i < weekCount; i++) {
    const w = weeks[i] || {};
    ceCum += num(w.ceWeek);
    chCum += num(w.chWeek);
    epCum += num(w.epWeek);
    cpCum += num(w.cpWeek);
    out.push({
      ceWeek: w.ceWeek, chWeek: w.chWeek, epWeek: w.epWeek, cpWeek: w.cpWeek,
      ceCum, chCum, epCum, cpCum,
      hasEntry: w.ceWeek != null || w.chWeek != null || w.epWeek != null || w.cpWeek != null,
    });
  }
  return out;
}

export function computePortionStatus(doc, weekCount = WEEK_COUNT) {
  const cum = computeCumulativeWeeks(doc, weekCount);
  const weeksStarted = cum.filter((w) => w.hasEntry).length;
  const last = [...cum].reverse().find((w) => w.hasEntry);

  const lastCh = last ? last.chCum : null;
  const lastCp = last ? last.cpCum : null;
  const lastEp = last ? last.epCum : null;

  const totalAllotted = num(doc.totalClassesAllotted) || null;
  const pctClassesHeld = totalAllotted && lastCh !== null ? Math.round((lastCh / totalAllotted) * 100) : null;

  let status = "Not Started";
  if (weeksStarted > 0) status = "In Progress";
  if (lastCp !== null && lastCp >= 100) status = "Completed";
  const behind = lastCp !== null && lastEp !== null && lastCp < lastEp - 10;
  if (status === "In Progress" && behind) status = "Behind Schedule";

  return { weeksStarted, lastCe: last ? last.ceCum : null, lastCh, lastEp, lastCp, pctClassesHeld, behind, status, cumulativeWeeks: cum };
}

export const PROGRAMME_TABS = ["BTech", "BCA", "BSc", "MTech", "Minors", "UE"];
