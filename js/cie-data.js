// ============================================================
// Loads data/cie-components.json — the course-level CIE-1/2/3
// component list (credits, category, SEE type, eval-method
// options, marks caps) that CIE component monitoring is built on.
// Mirrors the shape of data.js so both modules feel consistent.
// ============================================================

let cache = null;

export async function loadCieCourseData() {
  if (cache) return cache;
  const res = await fetch("data/cie-components.json");
  if (!res.ok) throw new Error("Could not load data/cie-components.json");
  cache = await res.json();
  return cache;
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uniqueIdFactory() {
  const seen = new Map();
  return (base) => {
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}--${n + 1}`;
  };
}

/** One row per course across every tab, carrying the static Odd Sem
 *  2026-27 course-list fields (credits, category, SEE type, students). */
export function flattenCieCourses(data) {
  const rows = [];
  const uid = uniqueIdFactory();
  for (const g of data.groups) {
    for (const c of g.courses) {
      const base = `cie__${slug(g.tab)}__${slug(c.code)}-${slug(c.name)}`;
      rows.push({
        id: uid(base),
        tab: g.tab,
        code: c.code,
        name: c.name,
        lead: c.lead || null,
        programme: c.programme,
        semester: c.semester,
        credits: Number(c.credits) || 0,
        category: c.category || null,
        track: c.track || null,
        seeType: c.seeType || null,
        students: c.students == null ? null : Number(c.students),
      });
    }
  }
  return rows;
}

export const CIE_TABS = [
  "BTech Sem 1", "BTech Sem 3", "BTech Sem 5", "BTech Sem 7",
  "BCA", "BSc", "Minors-2023", "Minors-2024", "Minors-2025", "UE",
];

/** Default empty component document — matches the shape store.js writes on seed
 *  and the shape the entry form reads/writes. */
export function emptyCieDoc(course) {
  return {
    tab: course.tab, code: course.code, name: course.name, lead: course.lead,
    programme: course.programme, semester: course.semester,
    credits: course.credits, category: course.category, track: course.track,
    seeType: course.seeType, students: course.students,
    cie1: { a: blankOption(), b: blankOption(), c: blankOption() },
    cie2: { marks: null, qpDate: null, scrutinyDate: null, keyDate: null },
    cie3: { a: blankOption(), b: blankOption(), c: blankOption() },
    remarks: "",
    updatedBy: null, updatedAt: null,
  };
}

function blankOption() {
  return { method: "", marks: null, date: null };
}

/** All the derived numbers + flags the Excel computes with formulas —
 *  recomputed live in the browser so it behaves like the spreadsheet. */
export function computeCie(doc, caps) {
  const c1 = ["a", "b", "c"].map((k) => num(doc.cie1?.[k]?.marks));
  const c3 = ["a", "b", "c"].map((k) => num(doc.cie3?.[k]?.marks));
  const cie1Total = sum(c1);
  const cie2Marks = num(doc.cie2?.marks);
  const cie3Total = sum(c3);
  const totalCie = cie1Total + cie2Marks + cie3Total;

  const componentsUsed =
    c1.filter((v) => v > 0).length +
    (cie2Marks > 0 ? 1 : 0) +
    c3.filter((v) => v > 0).length;

  const minReq = (doc.credits || 0) + 1;
  const componentCheck = componentsUsed >= minReq;

  const cie1Over = cie1Total > caps.cie1;
  const cie2Over = cie2Marks > caps.cie2;
  const cie3Over = cie3Total > caps.cie3;
  const totalOver = totalCie > caps.total;

  let status = "Not Started";
  if (cie1Total > 0 || cie2Marks > 0 || cie3Total > 0) status = "In Progress";
  if (cie1Total > 0 && cie2Marks > 0 && cie3Total > 0 && componentCheck) status = "Completed";

  const hasError = cie1Over || cie2Over || cie3Over || totalOver || !doc.lead;

  return {
    cie1Total, cie2Marks, cie3Total, totalCie, componentsUsed, minReq,
    componentCheck, cie1Over, cie2Over, cie3Over, totalOver, status, hasError,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}
