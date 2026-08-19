// ============================================================
// Consolidated report for the "My Sections" (CIE-1/2/3 stage +
// QP/Answer-Key) tracker — grouped by programme and semester,
// same spirit as the CIE Components consolidated report.
// ============================================================

import { csvEscape, downloadCsv } from "./cie-reports.js";
export { downloadCsv };

/** Every distinct (programme, semester) pair present in the course list,
 *  in a sensible order, for populating the semester filter dropdown. */
export function uniqueSemesters(courseRows) {
  const set = new Set(courseRows.map((c) => c.semester).filter(Boolean));
  const order = ["I", "III", "V", "VII", "2023 Batch", "2024 Batch", "2025 Batch", "All"];
  return [...set].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export function buildSectionReport(courseRows, sectionRows, sectionDocs, qpDocs, filters) {
  const { programme, semester, search } = filters;

  const courses = courseRows.filter((c) => {
    if (programme && programme !== "All" && c.programme !== programme) return false;
    if (semester && semester !== "All" && c.semester !== semester) return false;
    if (search) {
      const hay = `${c.code} ${c.name} ${c.lead || ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const rows = courses.map((c) => {
    const secs = sectionRows
      .filter((s) => s.courseKey === c.courseKey)
      .map((s) => ({ ...s, live: sectionDocs[s.id] || {} }));
    const qp = qpDocs[c.id] || {};

    const stageCount = (stage) => secs.filter((s) => s.live[stage] === "Completed").length;
    const cie1 = stageCount("cie1"), cie2 = stageCount("cie2"), cie3 = stageCount("cie3");
    const totalSecs = secs.length;
    const allDone = totalSecs > 0 && cie1 === totalSecs && cie2 === totalSecs && cie3 === totalSecs;
    const anyDone = cie1 + cie2 + cie3 > 0;

    return {
      course: c, sections: secs, qp,
      totalSecs, cie1, cie2, cie3,
      qpDone: qp.status === "Completed",
      status: allDone ? "Completed" : anyDone ? "In Progress" : "Not Started",
      missingLead: !c.lead,
    };
  });

  const byGroup = new Map();
  for (const r of rows) {
    const key = `${r.course.programme} — Sem ${r.course.semester}`;
    const g = byGroup.get(key) || {
      group: key, programme: r.course.programme, semester: r.course.semester,
      courses: 0, sections: 0, cie1: 0, cie2: 0, cie3: 0, qpDone: 0,
      completed: 0, missingLead: 0,
    };
    g.courses++;
    g.sections += r.totalSecs;
    g.cie1 += r.cie1; g.cie2 += r.cie2; g.cie3 += r.cie3;
    if (r.qpDone) g.qpDone++;
    if (r.status === "Completed") g.completed++;
    if (r.missingLead) g.missingLead++;
    byGroup.set(key, g);
  }

  const groupSummary = [...byGroup.values()].map((g) => ({
    ...g,
    pctSections: g.sections ? Math.round(((g.cie1 + g.cie2 + g.cie3) / (g.sections * 3)) * 100) : 0,
    pctQp: g.courses ? Math.round((g.qpDone / g.courses) * 100) : 0,
  }));

  const totals = {
    courses: rows.length,
    sections: rows.reduce((a, r) => a + r.totalSecs, 0),
    completed: rows.filter((r) => r.status === "Completed").length,
    qpDone: rows.filter((r) => r.qpDone).length,
    missingLead: rows.filter((r) => r.missingLead).length,
  };

  return { rows, groupSummary, totals };
}

export function sectionReportToCsv(rows) {
  const header = [
    "Programme", "Semester", "Tab", "Code", "Course", "Lead", "Sections",
    "CIE-1 Done", "CIE-2 Done", "CIE-3 Done", "QP+Key Done", "Status",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push([
      r.course.programme, r.course.semester, r.course.tab, r.course.code, r.course.name,
      r.course.lead || "", r.totalSecs, r.cie1, r.cie2, r.cie3, r.qpDone ? "Yes" : "No", r.status,
    ].map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}
