import { requireAuth, isEffectiveAdmin } from "./auth.js";
import { renderSharedTopbar, roleBadgeHtml } from "./topbar.js";
import { loadCourseData, flattenSections, flattenCourses } from "./data.js";
import { loadCieCourseData, flattenCieCourses, computeCie, programmeGroupForTab } from "./cie-data.js";
import { emptyTlpDoc, computeTlpStatus } from "./tlp-data.js";
import { emptyPortionDoc, computePortionStatus } from "./portion-data.js";
import {
  fetchAllSections, fetchAllQp, fetchAllCie, fetchAllTlp, fetchAllFacultyReports, fetchAllPortionCoverage,
  fetchCoordinators,
} from "./store.js";

const CIE_CAPS = { cie1: 20, cie2: 25, cie3: 25, total: 70 };
const PROGRAMME_TABS = ["All", "BTech", "BCA", "BSc", "MTech", "Minors", "UE"];

const TASKS = [
  { key: "naac", label: "NAAC / IQAC Summary (all modules)" },
  { key: "cie", label: "CIE Components (marks & validation)" },
  { key: "sections", label: "My Courses (CIE stage + QP/Key tracker)" },
  { key: "tlp", label: "TLP (pedagogy selection)" },
  { key: "tlpReports", label: "TLP (report submissions)" },
  { key: "portion", label: "Portion Coverage" },
];

async function main() {
  const user = await requireAuth();
  if (!user) return;

  const admin = await isEffectiveAdmin(user.email);
  const coordinators = await fetchCoordinators();
  const myCoordProgrammes = Object.entries(coordinators)
    .filter(([, c]) => c && c.email && c.email.toLowerCase() === user.email.toLowerCase())
    .map(([g]) => g);
  renderSharedTopbar(user, { admin, roleBadge: roleBadgeHtml(admin, myCoordProgrammes), onRefresh: () => window.location.reload() });

  const [courseData, cieCourseData] = await Promise.all([loadCourseData(), loadCieCourseData()]);
  const sectionRows = flattenSections(courseData);
  const courseRows = flattenCourses(courseData);
  const cieCourses = flattenCieCourses(cieCourseData);
  const semesters = [...new Set([...sectionRows, ...cieCourses].map((r) => r.semester))].filter(Boolean);

  document.getElementById("loadingVeil").remove();
  document.getElementById("appRoot").innerHTML = shellHtml(semesters);

  document.getElementById("generateReportBtn").addEventListener("click", () => generateReport());
  document.getElementById("printReportBtn").addEventListener("click", () => window.print());

  async function generateReport() {
    const task = document.getElementById("reportTask").value;
    const programme = document.getElementById("reportProgramme").value;
    const semester = document.getElementById("reportSemester").value;
    const out = document.getElementById("reportOutput");
    out.innerHTML = `<div class="empty-state"><h3>Generating\u2026</h3></div>`;

    if (task === "naac") {
      await generateNaacSummary(out, programme, semester);
      return;
    }

    let title, columns, rows;

    if (task === "cie") {
      const cieDocs = await fetchAllCie();
      const filtered = cieCourses.filter((c) => (programme === "All" || programmeGroupForTab(c.tab) === programme) && (semester === "All" || String(c.semester) === semester));
      title = "CIE Components Report";
      columns = ["Tab", "Code", "Course", "Lead", "Credits", "CIE-1", "CIE-2", "CIE-3", "Total", "Status"];
      rows = filtered.map((c) => {
        const calc = computeCie(cieDocs[c.id] || { credits: c.credits, cie1: {}, cie2: {}, cie3: {} }, CIE_CAPS);
        return [c.tab, c.code, c.name, c.lead || "\u2014", c.credits, calc.cie1Total, calc.cie2Marks, calc.cie3Total, calc.totalCie, calc.status];
      });
    } else if (task === "sections") {
      const [sectionDocs, qpDocs] = await Promise.all([fetchAllSections(), fetchAllQp()]);
      const filtered = sectionRows.filter((s) => (programme === "All" || s.programme === programme) && (semester === "All" || String(s.semester) === semester));
      title = "My Courses (Section Tracker) Report";
      columns = ["Tab", "Code", "Section", "Faculty", "CIE-1", "CIE-2", "CIE-3", "QP+Key"];
      rows = filtered.map((s) => {
        const live = sectionDocs[s.id] || {};
        const course = courseRows.find((c) => c.courseKey === s.courseKey);
        const qp = course ? (qpDocs[course.id] || {}) : {};
        return [s.tab, s.code, s.section, s.faculty || "\u2014", live.cie1 || "\u2014", live.cie2 || "\u2014", live.cie3 || "\u2014", qp.status || "\u2014"];
      });
    } else if (task === "tlp") {
      const tlpDocs = await fetchAllTlp();
      const filtered = sectionRows.filter((s) => (programme === "All" || s.programme === programme) && (semester === "All" || String(s.semester) === semester));
      title = "TLP (Pedagogy Selection) Report";
      columns = ["Tab", "Code", "Section", "Faculty", "Pedagogy Types", "CIE-1 Method", "CIE-3 Method", "Status"];
      rows = filtered.map((s) => {
        const doc = tlpDocs[s.id] || emptyTlpDoc(s);
        const calc = computeTlpStatus(doc, 3);
        return [s.tab, s.code, s.section, s.faculty || "\u2014", (doc.pedagogyTypes || []).join("; "), doc.cie1?.pedagogyType || "\u2014", doc.cie3?.pedagogyType || "\u2014", calc.status];
      });
    } else if (task === "tlpReports") {
      const reportDocs = await fetchAllFacultyReports();
      const filtered = sectionRows.filter((s) => (programme === "All" || s.programme === programme) && (semester === "All" || String(s.semester) === semester));
      title = "TLP Report Submissions";
      columns = ["Tab", "Code", "Section", "Faculty", "Reports Submitted", "Titles"];
      rows = filtered.map((s) => {
        const reports = reportDocs[s.id]?.reports || [];
        return [s.tab, s.code, s.section, s.faculty || "\u2014", reports.length, reports.map((r) => r.title).join("; ") || "\u2014"];
      });
    } else if (task === "portion") {
      const pcDocs = await fetchAllPortionCoverage();
      const filtered = sectionRows.filter((s) => (programme === "All" || s.programme === programme) && (semester === "All" || String(s.semester) === semester));
      title = "Portion Coverage Report";
      columns = ["Tab", "Code", "Section", "Faculty", "Classes Held (Cum.)", "% Classes Held", "Portion Covered (Cum.)", "Status"];
      rows = filtered.map((s) => {
        const calc = computePortionStatus(pcDocs[s.id] || emptyPortionDoc(s));
        return [s.tab, s.code, s.section, s.faculty || "\u2014", calc.lastCh ?? "\u2014", calc.pctClassesHeld !== null ? calc.pctClassesHeld + "%" : "\u2014", calc.lastCp !== null ? calc.lastCp + "%" : "\u2014", calc.status];
      });
    }

    renderReportOutput(out, title, programme, semester, columns, rows);
  }

  // ---------- NAAC / IQAC Summary: cross-module, criterion-aligned ----------

  async function generateNaacSummary(out, programme, semester) {
    const [cieDocs, tlpDocs, pcDocs] = await Promise.all([fetchAllCie(), fetchAllTlp(), fetchAllPortionCoverage()]);

    const matchesFilter = (progValue, semValue) =>
      (programme === "All" || progValue === programme) && (semester === "All" || String(semValue) === semester);

    // ---- CIE Components: continuous internal evaluation ----
    const cieFiltered = cieCourses.filter((c) => matchesFilter(programmeGroupForTab(c.tab), c.semester));
    let cieCompleted = 0, cieTotalMarksSum = 0, cieWithMarks = 0, cieErrors = 0;
    for (const c of cieFiltered) {
      const calc = computeCie(cieDocs[c.id] || { credits: c.credits, cie1: {}, cie2: {}, cie3: {} }, CIE_CAPS);
      if (calc.status === "Completed") cieCompleted++;
      if (calc.hasError) cieErrors++;
      if (calc.totalCie > 0) { cieTotalMarksSum += calc.totalCie; cieWithMarks++; }
    }
    const cieAvgMarks = cieWithMarks ? (cieTotalMarksSum / cieWithMarks).toFixed(1) : "0.0";
    const ciePct = cieFiltered.length ? Math.round((cieCompleted / cieFiltered.length) * 100) : 0;

    // ---- TLP: student-centric, ICT-enabled teaching-learning ----
    const tlpFiltered = sectionRows.filter((s) => matchesFilter(s.programme, s.semester));
    let tlpCompleted = 0, tlpWithIct = 0;
    const pedagogyCounts = new Map();
    for (const s of tlpFiltered) {
      const doc = tlpDocs[s.id] || emptyTlpDoc(s);
      const calc = computeTlpStatus(doc, 3);
      if (calc.status === "Completed") tlpCompleted++;
      if (doc.ictTools && doc.ictTools.trim()) tlpWithIct++;
      for (const p of doc.pedagogyTypes || []) pedagogyCounts.set(p, (pedagogyCounts.get(p) || 0) + 1);
    }
    const tlpPct = tlpFiltered.length ? Math.round((tlpCompleted / tlpFiltered.length) * 100) : 0;
    const ictPct = tlpFiltered.length ? Math.round((tlpWithIct / tlpFiltered.length) * 100) : 0;
    const topPedagogy = [...pedagogyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    // ---- Portion Coverage: syllabus completion against plan ----
    const pcFiltered = sectionRows.filter((s) => matchesFilter(s.programme, s.semester));
    let pcCompleted = 0, pcBehind = 0, pcCoverageSum = 0, pcWithData = 0;
    for (const s of pcFiltered) {
      const calc = computePortionStatus(pcDocs[s.id] || emptyPortionDoc(s));
      if (calc.status === "Completed") pcCompleted++;
      if (calc.status === "Behind Schedule") pcBehind++;
      if (calc.lastCp !== null) { pcCoverageSum += calc.lastCp; pcWithData++; }
    }
    const pcAvgCoverage = pcWithData ? Math.round(pcCoverageSum / pcWithData) : 0;

    // ---- Programme-wise breakdown (across the 6 broad groups) ----
    const groups = ["BTech", "BCA", "BSc", "MTech", "Minors", "UE"];
    const byProgramme = groups.map((g) => {
      const cieRows = cieCourses.filter((c) => programmeGroupForTab(c.tab) === g && (semester === "All" || String(c.semester) === semester));
      const secRows = sectionRows.filter((s) => s.programme === g && (semester === "All" || String(s.semester) === semester));
      const cieDone = cieRows.filter((c) => computeCie(cieDocs[c.id] || { credits: c.credits, cie1: {}, cie2: {}, cie3: {} }, CIE_CAPS).status === "Completed").length;
      const tlpDone = secRows.filter((s) => computeTlpStatus(tlpDocs[s.id] || emptyTlpDoc(s), 3).status === "Completed").length;
      const pcDone = secRows.filter((s) => computePortionStatus(pcDocs[s.id] || emptyPortionDoc(s)).status === "Completed").length;
      return {
        programme: g, courses: cieRows.length, sections: secRows.length,
        ciePct: cieRows.length ? Math.round((cieDone / cieRows.length) * 100) : 0,
        tlpPct: secRows.length ? Math.round((tlpDone / secRows.length) * 100) : 0,
        pcPct: secRows.length ? Math.round((pcDone / secRows.length) * 100) : 0,
      };
    });

    const now = new Date().toLocaleString();
    out.innerHTML = `
      <div id="printableReport">
        <div class="print-header">
          <h2>RV University &mdash; School of Computer Science &amp; Engineering</h2>
          <h3>NAAC / IQAC Summary Report</h3>
          <p>Programme: <strong>${escapeHtml(programme)}</strong> &nbsp;|&nbsp; Semester: <strong>${escapeHtml(semester)}</strong> &nbsp;|&nbsp; Generated: ${escapeHtml(now)}</p>
          <p style="font-size:11px;color:var(--ink-soft);margin-top:4px;">Framed around Criterion 2 (Teaching-Learning &amp; Evaluation) themes &mdash; student-centric/ICT-enabled teaching, continuous internal evaluation, and syllabus completion against plan. Verify exact clause numbers against the current NAAC manual before submission; this report provides the underlying data, not official criterion certification.</p>
        </div>

        <div class="kpi-row">
          <div class="kpi"><div class="label">CIE Components Completed</div><div class="value">${ciePct}%</div></div>
          <div class="kpi"><div class="label">Student-Centric Pedagogy (&ge;3 methods)</div><div class="value">${tlpPct}%</div></div>
          <div class="kpi"><div class="label">Sections Using ICT Tools</div><div class="value">${ictPct}%</div></div>
          <div class="kpi"><div class="label">Avg. Syllabus Coverage</div><div class="value">${pcAvgCoverage}%</div></div>
        </div>

        <table class="data-table print-table" style="margin-bottom:20px;">
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>CIE Components &mdash; courses evaluated</td><td>${cieFiltered.length}</td></tr>
            <tr><td>CIE Components &mdash; fully completed</td><td>${cieCompleted} (${ciePct}%)</td></tr>
            <tr><td>CIE Components &mdash; average total marks (of 70)</td><td>${cieAvgMarks}</td></tr>
            <tr><td>CIE Components &mdash; courses with validation errors</td><td>${cieErrors}</td></tr>
            <tr><td>TLP &mdash; sections tracked</td><td>${tlpFiltered.length}</td></tr>
            <tr><td>TLP &mdash; sections meeting &ge;3-pedagogy-type minimum</td><td>${tlpCompleted} (${tlpPct}%)</td></tr>
            <tr><td>TLP &mdash; sections with ICT tools recorded</td><td>${tlpWithIct} (${ictPct}%)</td></tr>
            <tr><td>Portion Coverage &mdash; sections tracked</td><td>${pcFiltered.length}</td></tr>
            <tr><td>Portion Coverage &mdash; fully completed (100%)</td><td>${pcCompleted}</td></tr>
            <tr><td>Portion Coverage &mdash; behind schedule</td><td>${pcBehind}</td></tr>
          </tbody>
        </table>

        <h3 style="font-family:var(--font-display);font-size:15px;margin:0 0 8px;">Most-Used Teaching Pedagogy Types</h3>
        <table class="data-table print-table" style="margin-bottom:20px;">
          <thead><tr><th>Pedagogy Type</th><th>Sections Using It</th></tr></thead>
          <tbody>
            ${topPedagogy.map(([p, n]) => `<tr><td>${escapeHtml(p)}</td><td>${n}</td></tr>`).join("") || `<tr><td colspan="2" style="color:var(--ink-soft);">No pedagogy data entered yet.</td></tr>`}
          </tbody>
        </table>

        <h3 style="font-family:var(--font-display);font-size:15px;margin:0 0 8px;">Programme-wise Summary</h3>
        <table class="data-table print-table">
          <thead><tr><th>Programme</th><th>Courses</th><th>Sections</th><th>CIE Completed %</th><th>TLP Completed %</th><th>Portion Completed %</th></tr></thead>
          <tbody>
            ${byProgramme.map((p) => `<tr><td>${escapeHtml(p.programme)}</td><td>${p.courses}</td><td>${p.sections}</td><td>${p.ciePct}%</td><td>${p.tlpPct}%</td><td>${p.pcPct}%</td></tr>`).join("")}
          </tbody>
        </table>
      </div>`;
    document.getElementById("printReportBtn").style.display = "inline-block";
  }
}

function renderReportOutput(out, title, programme, semester, columns, rows) {
  const now = new Date().toLocaleString();
  out.innerHTML = `
    <div id="printableReport">
      <div class="print-header">
        <h2>RV University &mdash; School of Computer Science &amp; Engineering</h2>
        <h3>${escapeHtml(title)}</h3>
        <p>Programme: <strong>${escapeHtml(programme)}</strong> &nbsp;|&nbsp; Semester: <strong>${escapeHtml(semester)}</strong> &nbsp;|&nbsp; Generated: ${escapeHtml(now)} &nbsp;|&nbsp; Rows: ${rows.length}</p>
      </div>
      <table class="data-table print-table">
        <thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(String(v))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}" style="color:var(--ink-soft);">No matching rows.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  document.getElementById("printReportBtn").style.display = "inline-block";
}

function shellHtml(semesters) {
  return `
    <div class="page-head no-print">
      <div>
        <span class="eyebrow">Reports</span>
        <h1>Master Report Generator</h1>
        <p>Select what to report on, filter by programme and semester, generate, then Print / Save as PDF using your browser's print dialog (choose "Save as PDF" as the destination).</p>
      </div>
    </div>

    <div class="filter-bar no-print">
      <select id="reportTask">
        ${TASKS.map((t) => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join("")}
      </select>
      <select id="reportProgramme">
        ${PROGRAMME_TABS.map((p) => `<option>${escapeHtml(p)}</option>`).join("")}
      </select>
      <select id="reportSemester">
        <option>All</option>
        ${semesters.map((s) => `<option>${escapeHtml(String(s))}</option>`).join("")}
      </select>
      <button type="button" class="btn btn--primary btn--sm" id="generateReportBtn">Generate Report</button>
      <button type="button" class="btn btn--outline btn--sm" id="printReportBtn" style="display:none;">Print / Save as PDF</button>
    </div>

    <div id="reportOutput"><div class="empty-state no-print"><h3>No report generated yet</h3><p>Choose a Task, Programme, and Semester above, then click Generate Report.</p></div></div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

main().catch((err) => {
  console.error("Page failed to load:", err);
  const veil = document.getElementById("loadingVeil");
  if (veil) veil.remove();
  const root = document.getElementById("appRoot");
  if (root) {
    root.innerHTML = `
      <div class="empty-state">
        <h3>Something went wrong loading this page</h3>
        <p>${(err && err.message) ? err.message.replace(/[<>]/g, "") : "Unknown error"}</p>
        <p style="font-size:12px;color:var(--ink-soft);">Open the browser console (right-click \u2192 Inspect \u2192 Console) for the full error, or try a hard refresh.</p>
      </div>`;
  }
});