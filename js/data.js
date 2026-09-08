// ============================================================
// Loads data/courses.json and derives the flat structures the
// rest of the app works with: one row per section-faculty
// assignment, one row per course (for CIE-2 QP+Key tracking),
// and the unique list of faculty names for the name-picker.
// ============================================================

let cache = null;

export async function loadCourseData() {
  if (cache) return cache;
  const res = await fetch("data/courses.json");
  if (!res.ok) throw new Error("Could not load data/courses.json");
  cache = await res.json();
  return cache;
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Guards against duplicate/placeholder course codes (e.g. "CS4XXX" used for two
 *  different courses where the final code hasn't been assigned yet) by appending
 *  a counter the first time an id would collide. */
function uniqueIdFactory() {
  const seen = new Map();
  return (base) => {
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}--${n + 1}`;
  };
}

/** One row per section-faculty assignment across every group. */
export function flattenSections(data) {
  const rows = [];
  const uid = uniqueIdFactory();
  for (const g of data.groups) {
    for (const c of g.courses) {
      const courseKey = `${slug(g.tab)}__${slug(c.code)}-${slug(c.name)}`;
      for (const s of c.sections) {
        const base = `sec__${courseKey}__${s.section}`;
        rows.push({
          id: uid(base),
          courseKey,
          tab: g.tab,
          programme: g.programme,
          semester: g.semester,
          code: c.code,
          name: c.name,
          lead: c.lead,
          section: s.section,
          faculty: s.faculty,
        });
      }
    }
  }
  return rows;
}

/** One row per course, for CIE-2 QP + Answer Key tracking. */
export function flattenCourses(data) {
  const rows = [];
  const uid = uniqueIdFactory();
  for (const g of data.groups) {
    for (const c of g.courses) {
      const courseKey = `${slug(g.tab)}__${slug(c.code)}-${slug(c.name)}`;
      const base = `qp__${courseKey}`;
      rows.push({
        id: uid(base),
        courseKey,
        tab: g.tab,
        programme: g.programme,
        semester: g.semester,
        code: c.code,
        name: c.name,
        lead: c.lead,
        sectionCount: c.sections.length,
      });
    }
  }
  return rows;
}

/** Sorted, de-duplicated list of every faculty name that appears anywhere. */
export function uniqueFacultyNames(data) {
  const set = new Set();
  for (const g of data.groups) {
    for (const c of g.courses) {
      for (const s of c.sections) set.add(s.faculty);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export const PROGRAMMES = ["BTech", "BCA", "BSc", "MTech", "Minors", "UE"];
