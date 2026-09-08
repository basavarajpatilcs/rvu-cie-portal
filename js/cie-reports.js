// ============================================================
// Consolidated CIE Component report — mirrors the "Dashboard"
// tab of the SoCSE CIE Consolidated Dashboard workbook: summary
// by tab, courses by category, courses by status — plus a
// filterable course-level table and CSV export.
// ============================================================

import { computeCie } from "./cie-data.js";

export function buildReport(courses, cieDocs, caps, filters) {
  const { tab, category, status, search } = filters;

  const rows = [];
  for (const c of courses) {
    if (tab && tab !== "All" && c.tab !== tab) continue;
    if (category && category !== "All" && (c.category || "") !== category) continue;
    if (search) {
      const hay = `${c.code} ${c.name} ${c.lead || ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) continue;
    }
    const doc = cieDocs[c.id] || null;
    const calc = computeCie(doc || stub(c), caps);
    if (status && status !== "All" && calc.status !== status) continue;
    rows.push({ course: c, doc, calc });
  }

  const byTab = new Map();
  const byCategory = new Map();
  const byStatus = new Map([["Not Started", 0], ["In Progress", 0], ["Completed", 0]]);

  for (const r of rows) {
    const t = byTab.get(r.course.tab) || {
      tab: r.course.tab, courses: 0, students: 0, sumTotal: 0, withMarks: 0,
      completed: 0, missingLead: 0, errors: 0,
    };
    t.courses++;
    t.students += r.course.students || 0;
    if (r.doc) { t.sumTotal += r.calc.totalCie; if (r.calc.totalCie > 0) t.withMarks++; }
    if (r.calc.status === "Completed") t.completed++;
    if (!r.course.lead) t.missingLead++;
    if (r.calc.hasError) t.errors++;
    byTab.set(r.course.tab, t);

    const cat = r.course.category || "Uncategorised";
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);

    byStatus.set(r.calc.status, (byStatus.get(r.calc.status) || 0) + 1);
  }

  const tabSummary = [...byTab.values()].map((t) => ({
    ...t,
    avgTotal: t.withMarks ? +(t.sumTotal / t.withMarks).toFixed(1) : 0,
  }));

  return {
    rows,
    tabSummary,
    categorySummary: [...byCategory.entries()].map(([category, count]) => ({ category, count })),
    statusSummary: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
    totals: {
      courses: rows.length,
      students: rows.reduce((a, r) => a + (r.course.students || 0), 0),
      completed: rows.filter((r) => r.calc.status === "Completed").length,
      missingLead: rows.filter((r) => !r.course.lead).length,
      errors: rows.filter((r) => r.calc.hasError).length,
    },
  };
}

function stub(course) {
  return {
    credits: course.credits, lead: course.lead,
    cie1: { a: {}, b: {}, c: {} }, cie2: {}, cie3: { a: {}, b: {}, c: {} },
  };
}

/** Mirrors the workbook's "CIE Component Analysis" sheet: how often each
 *  evaluation method is used across CIE-1 + CIE-3, overall and by programme
 *  group. CIE-2 is a fixed single route so it isn't part of this table. */
export function buildComponentAnalysis(courses, cieDocs, evalMethods, programmeGroupForTab) {
  const overall = new Map(evalMethods.map((m) => [m, { method: m, cie1: 0, cie3: 0, total: 0 }]));
  const groups = ["BTech", "BCA", "BSc", "MTech", "Minors", "UE"];
  const byGroup = new Map(evalMethods.map((m) => [m, Object.fromEntries(groups.map((g) => [g, 0]))]));

  for (const c of courses) {
    const doc = cieDocs[c.id];
    if (!doc) continue;
    const group = programmeGroupForTab(c.tab);
    for (const key of ["a", "b", "c"]) {
      const m1 = doc.cie1?.[key]?.method;
      if (m1 && overall.has(m1)) {
        overall.get(m1).cie1++;
        overall.get(m1).total++;
        const g = byGroup.get(m1);
        if (g && group in g) g[group]++;
      }
      const m3 = doc.cie3?.[key]?.method;
      if (m3 && overall.has(m3)) {
        overall.get(m3).cie3++;
        overall.get(m3).total++;
        const g = byGroup.get(m3);
        if (g && group in g) g[group]++;
      }
    }
  }

  return {
    overall: [...overall.values()],
    groups,
    byGroup: evalMethods.map((m) => ({ method: m, ...byGroup.get(m) })),
  };
}

export function reportRowsToCsv(rows) {
  const header = [
    "Tab", "Course Code", "Course Name", "Course Lead", "Credits", "Category", "SEE Type", "Students",
    "CIE-1 (of 20)", "CIE-2 (of 25)", "CIE-3 (of 25)", "Total CIE (of 70)",
    "Components Used", "Min Required", "Component Check", "Status", "Remarks",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    const d = r.doc || {};
    lines.push([
      r.course.tab, r.course.code, r.course.name, r.course.lead || "",
      r.course.credits, r.course.category || "", r.course.seeType || "", r.course.students ?? "",
      r.calc.cie1Total, r.calc.cie2Marks, r.calc.cie3Total, r.calc.totalCie,
      r.calc.componentsUsed, r.calc.minReq, r.calc.componentCheck ? "OK" : "Insufficient",
      r.calc.status, (d.remarks || "").replace(/\n/g, " "),
    ].map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

export function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob(["\uFEFF" + csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Minimal CSV parser — handles quoted fields with embedded commas/newlines,
 *  which is all the bulk-upload templates need. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
    return obj;
  });
}
