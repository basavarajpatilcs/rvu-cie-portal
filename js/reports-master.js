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

main();
