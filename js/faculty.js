import { requireAuth, isAdmin, initials } from "./auth.js";
import { loadCourseData, flattenSections, flattenCourses, uniqueFacultyNames } from "./data.js";
import {
  fetchAllSections, fetchAllQp, setSectionStage, setQpStatus,
  getFacultyLink, setFacultyLink, COMPLETED, NOT_COMPLETED,
  fetchAllCie,
} from "./store.js";
import { buildSectionReport, sectionReportToCsv, uniqueSemesters, downloadCsv } from "./section-reports.js";
import { loadCieCourseData, flattenCieCourses, computeCie } from "./cie-data.js";
import { renderSharedTopbar } from "./topbar.js";

const CIE_CAPS = { cie1: 20, cie2: 25, cie3: 25, total: 70 };

const SKIP_KEY = "rvu_skip_name_pick";

async function main() {
  const user = await requireAuth();
  if (!user) return;

  const [courseData, sectionDocsRaw, qpDocsRaw, link, cieCourseData, cieDocsRaw] = await Promise.all([
    loadCourseData(),
    fetchAllSections(),
    fetchAllQp(),
    getFacultyLink(user.uid),
    loadCieCourseData(),
    fetchAllCie(),
  ]);
  const sectionDocs = { ...sectionDocsRaw };
  const qpDocs = { ...qpDocsRaw };
  const cieDocs = { ...cieDocsRaw };
  const cieCourses = flattenCieCourses(cieCourseData);

  renderSharedTopbar(user, { onRefresh: refreshData });

  const sectionRows = flattenSections(courseData);
  const courseRows = flattenCourses(courseData);
  const allNames = uniqueFacultyNames(courseData);

  let myName = link ? link.name : null;

  document.getElementById("loadingVeil").remove();

  if (!myName && localStorage.getItem(SKIP_KEY) !== "1") {
    renderNamePicker(allNames, async (name) => {
      await setFacultyLink(user.uid, user.email, name);
      myName = name;
      renderApp();
    }, () => {
      localStorage.setItem(SKIP_KEY, "1");
      renderApp();
    });
  } else {
    renderApp();
  }

  async function refreshData() {
    const [freshSec, freshQp, freshCie] = await Promise.all([fetchAllSections(), fetchAllQp(), fetchAllCie()]);
    replaceContents(sectionDocs, freshSec);
    replaceContents(qpDocs, freshQp);
    replaceContents(cieDocs, freshCie);
    renderList();
    renderMySummary();
    if (document.getElementById("sec-panel-report") && document.getElementById("sec-panel-report").style.display !== "none") {
      generateSectionReport();
    }
  }

  function renderApp() {
    document.getElementById("appRoot").innerHTML = appShellHtml(myName, uniqueSemesters(courseRows));
    wireFilterBar(myName);
    wireTabs();
    wireReportControls();
    renderBanner(myName);
    renderList();
    renderMySummary();
  }

  function renderBanner(name) {
    const el = document.getElementById("nameBanner");
    if (!el) return;
    if (name) {
      el.innerHTML = `You're set up as <strong>${escapeHtml(name)}</strong>. <button class="btn btn--sm btn--outline" id="changeNameBtn" type="button">Not you? Change</button>`;
      el.querySelector("#changeNameBtn").addEventListener("click", () => {
        localStorage.removeItem(SKIP_KEY);
        renderNamePicker(allNames, async (n) => {
          await setFacultyLink(user.uid, user.email, n);
          myName = n;
          renderApp();
        }, () => { localStorage.setItem(SKIP_KEY, "1"); renderApp(); });
      });
    } else {
      el.innerHTML = `Browsing without a linked name — showing all sections. <button class="btn btn--sm btn--outline" id="setNameBtn" type="button">Set my name</button>`;
      el.querySelector("#setNameBtn").addEventListener("click", () => {
        localStorage.removeItem(SKIP_KEY);
        renderNamePicker(allNames, async (n) => {
          await setFacultyLink(user.uid, user.email, n);
          myName = n;
          renderApp();
        }, () => renderApp());
      });
    }
  }

  function wireFilterBar(name) {
    const progSel = document.getElementById("filterProgramme");
    const searchInput = document.getElementById("filterSearch");
    const mineChip = document.getElementById("filterMine");

    if (!name) {
      mineChip.parentElement.style.display = "none";
    } else {
      mineChip.checked = true;
    }

    [progSel, searchInput, mineChip].forEach((el) => {
      el.addEventListener("input", renderList);
      el.addEventListener("change", renderList);
    });
  }

  function currentFilters() {
    return {
      programme: document.getElementById("filterProgramme").value,
      search: document.getElementById("filterSearch").value.trim().toLowerCase(),
      mineOnly: myName ? document.getElementById("filterMine").checked : false,
    };
  }

  function renderList() {
    const { programme, search, mineOnly } = currentFilters();

    // Group course-level rows by tab, attach live section+qp data
    const grouped = new Map();
    for (const c of courseRows) {
      if (programme !== "All" && c.programme !== programme) continue;
      const secsForCourse = sectionRows.filter((s) => s.courseKey === c.courseKey);
      const liveSecs = secsForCourse.map((s) => ({ ...s, live: sectionDocs[s.id] || {} }));

      if (mineOnly) {
        const hasMine = liveSecs.some((s) => s.faculty === myName) || c.lead === myName;
        if (!hasMine) continue;
      }
      if (search) {
        const hay = `${c.code} ${c.name}`.toLowerCase();
        const facultyHay = liveSecs.map((s) => s.faculty.toLowerCase()).join(" ");
        if (!hay.includes(search) && !facultyHay.includes(search)) continue;
      }

      if (!grouped.has(c.tab)) grouped.set(c.tab, []);
      grouped.get(c.tab).push({ course: c, sections: liveSecs, qp: qpDocs[c.id] || {} });
    }

    const listEl = document.getElementById("courseList");
    if (grouped.size === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <h3>No matching courses</h3>
          <p>Try a different programme, or clear the search box.</p>
        </div>`;
      return;
    }

    let html = "";
    for (const [tab, items] of grouped) {
      html += `<div class="eyebrow" style="margin: 22px 0 10px;">${escapeHtml(tab)}</div>`;
      for (const item of items) html += courseCardHtml(item, myName);
    }
    listEl.innerHTML = html;
    listEl.querySelectorAll(".status-btn[data-kind='section']").forEach((btn) => {
      btn.addEventListener("click", onSectionToggle);
    });
    listEl.querySelectorAll(".status-btn[data-kind='qp']").forEach((btn) => {
      btn.addEventListener("click", onQpToggle);
    });
  }

  // ---------- Tabs: Marks Entry / Report ----------

  function wireTabs() {
    const tabs = document.querySelectorAll(".sec-page-tab");
    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        tabs.forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        document.querySelectorAll(".sec-page-panel").forEach((p) => (p.style.display = "none"));
        document.getElementById(`sec-panel-${t.dataset.panel}`).style.display = "block";
      });
    });
  }

  // ---------- Consolidated report: by programme + semester ----------

  function reportFilters() {
    return {
      programme: document.getElementById("repProgramme").value,
      semester: document.getElementById("repSemester").value,
      search: document.getElementById("repSearch").value.trim(),
    };
  }

  function generateSectionReport() {
    const report = buildSectionReport(courseRows, sectionRows, sectionDocs, qpDocs, reportFilters());
    window.__lastSectionReport = report;
    const out = document.getElementById("secReportOutput");

    out.innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Courses</div><div class="value">${report.totals.courses}</div></div>
        <div class="kpi"><div class="label">Sections</div><div class="value">${report.totals.sections}</div></div>
        <div class="kpi"><div class="label">Fully Completed</div><div class="value">${report.totals.completed}</div></div>
        <div class="kpi"><div class="label">QP + Key Done</div><div class="value">${report.totals.qpDone}</div></div>
        <div class="kpi"><div class="label">Missing Lead</div><div class="value">${report.totals.missingLead}</div></div>
      </div>

      <div class="panel">
        <div class="panel__head"><h2>Summary by Programme &amp; Semester</h2></div>
        <div class="panel__body" style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Programme</th><th>Semester</th><th>Courses</th><th>Sections</th><th>CIE-1</th><th>CIE-2</th><th>CIE-3</th><th>% Stage Complete</th><th>QP+Key Done</th><th>Fully Completed</th><th>Missing Lead</th></tr></thead>
            <tbody>
              ${report.groupSummary.map((g) => `
                <tr>
                  <td>${escapeHtml(g.programme)}</td>
                  <td>${escapeHtml(String(g.semester))}</td>
                  <td>${g.courses}</td>
                  <td>${g.sections}</td>
                  <td>${g.cie1}</td>
                  <td>${g.cie2}</td>
                  <td>${g.cie3}</td>
                  <td>${g.pctSections}%</td>
                  <td>${g.qpDone} (${g.pctQp}%)</td>
                  <td>${g.completed}</td>
                  <td>${g.missingLead}</td>
                </tr>`).join("") || `<tr><td colspan="11" style="color:var(--ink-soft);">No matching rows.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><h2>Course-level Detail (${report.rows.length})</h2></div>
        <div class="panel__body" style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Programme</th><th>Sem</th><th>Code</th><th>Course</th><th>Lead</th><th>Sections</th><th>CIE-1</th><th>CIE-2</th><th>CIE-3</th><th>QP+Key</th><th>Status</th></tr></thead>
            <tbody>
              ${report.rows.slice(0, 500).map((r) => `
                <tr>
                  <td>${escapeHtml(r.course.programme)}</td>
                  <td>${escapeHtml(String(r.course.semester))}</td>
                  <td class="mono">${escapeHtml(r.course.code)}</td>
                  <td>${escapeHtml(r.course.name)}</td>
                  <td>${escapeHtml(r.course.lead || "\u2014")}</td>
                  <td>${r.totalSecs}</td>
                  <td>${r.cie1}/${r.totalSecs}</td>
                  <td>${r.cie2}/${r.totalSecs}</td>
                  <td>${r.cie3}/${r.totalSecs}</td>
                  <td>${r.qpDone ? "\u2713" : "\u2014"}</td>
                  <td>${r.status}</td>
                </tr>`).join("")}
            </tbody>
          </table>
          ${report.rows.length > 500 ? `<p style="font-size:12px;color:var(--ink-soft);">Showing first 500 of ${report.rows.length} rows &mdash; use Export CSV for the full list.</p>` : ""}
        </div>
      </div>
    `;
  }

  function wireReportControls() {
    document.getElementById("repGenerateBtn").addEventListener("click", generateSectionReport);
    document.getElementById("repExportBtn").addEventListener("click", () => {
      const report = window.__lastSectionReport || buildSectionReport(courseRows, sectionRows, sectionDocs, qpDocs, reportFilters());
      downloadCsv(`section-tracker-report-${Date.now()}.csv`, sectionReportToCsv(report.rows));
    });
  }

  // ---------- My Summary: everything for the logged-in faculty in one place ----------

  function renderMySummary() {
    const out = document.getElementById("mySummaryOutput");
    if (!out) return;

    if (!myName) {
      out.innerHTML = `<div class="empty-state"><h3>Set your name first</h3><p>Use "Set my name" above so we know which courses are yours.</p></div>`;
      return;
    }

    // Section-tracker courses: as course lead or as section faculty.
    const myLeadCourses = courseRows.filter((c) => c.lead === myName);
    const mySectionRows = sectionRows.filter((s) => s.faculty === myName);
    const myLeadCourseKeys = new Set(myLeadCourses.map((c) => c.courseKey));
    const mySectionCourseKeys = new Set(mySectionRows.map((s) => s.courseKey));
    const allMyCourseKeys = new Set([...myLeadCourseKeys, ...mySectionCourseKeys]);

    let secTotal = 0, secDone = 0, qpDone = 0, qpTotal = 0;
    const pending = [];

    for (const key of allMyCourseKeys) {
      const course = courseRows.find((c) => c.courseKey === key);
      const secs = sectionRows.filter((s) => s.courseKey === key && s.faculty === myName);
      for (const s of secs) {
        for (const stage of ["cie1", "cie2", "cie3"]) {
          secTotal++;
          const live = sectionDocs[s.id] || {};
          if (live[stage] === "Completed") secDone++;
          else pending.push(`${course.code} — Sec ${s.section} — ${stage.toUpperCase()} not marked complete`);
        }
      }
      if (course && course.lead === myName) {
        qpTotal++;
        const qp = qpDocs[course.id] || {};
        if (qp.status === "Completed") qpDone++;
        else pending.push(`${course.code} — CIE-2 Question Paper + Answer Key not confirmed`);
      }
    }

    // CIE Component monitoring: courses where they're the lead (checks the
    // live doc's lead first, since admins can reassign it after seeding).
    const myCieCourses = cieCourses.filter((c) => {
      const doc = cieDocs[c.id];
      const lead = (doc && doc.lead) ?? c.lead;
      return lead === myName;
    });
    let cieCompleted = 0;
    for (const c of myCieCourses) {
      const doc = cieDocs[c.id];
      const calc = computeCie(doc || { credits: c.credits, cie1: {}, cie2: {}, cie3: {} }, CIE_CAPS);
      if (calc.status === "Completed") cieCompleted++;
      else pending.push(`${c.code} (CIE Components) — ${calc.status === "Not Started" ? "not started" : `in progress, ${calc.componentCheck ? "" : `needs ${calc.minReq} components`}`}`);
    }

    out.innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">My Courses (Section Tracker)</div><div class="value">${allMyCourseKeys.size}</div></div>
        <div class="kpi"><div class="label">CIE-1/2/3 Stages Marked</div><div class="value">${secDone}/${secTotal}</div></div>
        <div class="kpi"><div class="label">QP + Key Confirmed</div><div class="value">${qpDone}/${qpTotal}</div></div>
        <div class="kpi"><div class="label">My CIE Component Courses</div><div class="value">${myCieCourses.length}</div></div>
        <div class="kpi"><div class="label">CIE Components Completed</div><div class="value">${cieCompleted}/${myCieCourses.length}</div></div>
      </div>

      <div class="panel">
        <div class="panel__head"><h2>Pending Actions (${pending.length})</h2>
          <span style="font-size:12px;color:var(--ink-soft);">Everything below still needs your attention.</span>
        </div>
        <div class="panel__body">
          ${pending.length
            ? `<ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.9;">${pending.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
            : `<p style="color:var(--green);font-weight:600;">Nothing pending &mdash; you're fully up to date.</p>`}
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><h2>My CIE Component Courses</h2></div>
        <div class="panel__body" style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Code</th><th>Course</th><th>Tab</th><th>Status</th></tr></thead>
            <tbody>
              ${myCieCourses.map((c) => {
                const doc = cieDocs[c.id];
                const calc = computeCie(doc || { credits: c.credits, cie1: {}, cie2: {}, cie3: {} }, CIE_CAPS);
                return `<tr><td class="mono">${escapeHtml(c.code)}</td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.tab)}</td><td>${calc.status}</td></tr>`;
              }).join("") || `<tr><td colspan="4" style="color:var(--ink-soft);">No CIE Component courses on record for you yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async function onSectionToggle(e) {
    const btn = e.currentTarget;
    const { id, stage } = btn.dataset;
    const isComplete = btn.classList.contains("is-complete");
    const next = isComplete ? NOT_COMPLETED : COMPLETED;
    btn.classList.add("saving");
    btn.disabled = true;
    try {
      await setSectionStage(id, stage, next, user);
      sectionDocs[id] = { ...(sectionDocs[id] || {}), [stage]: next };
      renderList();
    } catch (err) {
      console.error(err);
      alert("Could not save that change. Check your connection and try again.");
      btn.classList.remove("saving");
      btn.disabled = false;
    }
  }

  async function onQpToggle(e) {
    const btn = e.currentTarget;
    const { id } = btn.dataset;
    const isComplete = btn.classList.contains("is-complete");
    const next = isComplete ? NOT_COMPLETED : COMPLETED;
    btn.classList.add("saving");
    btn.disabled = true;
    try {
      await setQpStatus(id, next, user);
      qpDocs[id] = { ...(qpDocs[id] || {}), status: next };
      renderList();
    } catch (err) {
      console.error(err);
      alert("Could not save that change. Check your connection and try again.");
      btn.classList.remove("saving");
      btn.disabled = false;
    }
  }

  function courseCardHtml(item, myName) {
    const { course, sections, qp } = item;
    const isLead = course.lead && course.lead === myName;
    const qpStatus = qp.status || NOT_COMPLETED;
    const rows = sections
      .map((s) => {
        const mine = s.faculty === myName;
        return `
        <div class="section-row">
          <span class="sec-badge">Sec ${escapeHtml(String(s.section))}</span>
          <span class="faculty-name ${mine ? "me" : ""}">${escapeHtml(s.faculty)}${mine ? " (you)" : ""}</span>
          ${statusButtonHtml(s.id, "cie1", s.live.cie1, "CIE-1")}
          ${statusButtonHtml(s.id, "cie2", s.live.cie2, "CIE-2")}
          ${statusButtonHtml(s.id, "cie3", s.live.cie3, "CIE-3")}
        </div>`;
      })
      .join("");

    const leadLine = course.lead
      ? `Course Lead: <strong>${escapeHtml(course.lead)}</strong>${isLead ? " (you)" : ""}`
      : `<span style="color:var(--red)">&#9888; Course lead not on record</span>`;

    return `
      <div class="course-card">
        <div class="course-card__head">
          <div>
            <div class="course-card__code">${escapeHtml(course.code)}</div>
            <div class="course-card__title">${escapeHtml(course.name)}</div>
          </div>
          <div style="font-size:12.5px;color:var(--ink-soft);">${leadLine}</div>
        </div>
        ${rows || `<div class="section-row"><span style="color:var(--ink-soft);grid-column:1/-1;">No section-faculty data on record for this course.</span></div>`}
        <div class="qp-row">
          <span class="qp-label">CIE-2 Question Paper + Answer Key (Course Lead)</span>
          ${statusButtonHtml(course.id, null, qpStatus, "QP + Key", "qp")}
        </div>
      </div>`;
  }

  function statusButtonHtml(id, stage, status, label, kind = "section") {
    const complete = status === COMPLETED;
    return `
      <button type="button" class="status-btn ${complete ? "is-complete" : ""}"
        data-kind="${kind}" data-id="${id}" ${stage ? `data-stage="${stage}"` : ""}
        title="${label}: click to toggle">
        <span class="box">${complete ? "&#10003;" : ""}</span>
        ${label}
      </button>`;
  }
}



function renderNamePicker(names, onPick, onSkip) {
  const root = document.getElementById("appRoot");
  root.innerHTML = `
    <div class="name-picker">
      <span class="eyebrow">One-time setup</span>
      <h2>Which faculty member are you?</h2>
      <p style="color:var(--ink-soft);font-size:13.5px;">
        This links your login to your name in the course list, so we can highlight your sections
        and remember it next time. You can change this later.
      </p>
      <input list="facultyNamesList" id="namePickerInput" placeholder="Start typing your name&hellip;" />
      <datalist id="facultyNamesList">
        ${names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("")}
      </datalist>
      <div style="display:flex; gap:10px; margin-top:6px;">
        <button class="btn btn--primary" id="namePickerSave" type="button">Save and continue</button>
        <button class="btn btn--outline" id="namePickerSkip" type="button">Skip for now</button>
      </div>
    </div>`;
  const style = document.createElement("style");
  document.getElementById("namePickerInput").style.cssText =
    "width:100%;padding:10px 12px;border-radius:6px;border:1px solid var(--line);font-size:14px;margin:12px 0 16px;";

  document.getElementById("namePickerSave").addEventListener("click", () => {
    const val = document.getElementById("namePickerInput").value.trim();
    if (!val || !names.includes(val)) {
      alert("Pick a name from the suggested list.");
      return;
    }
    onPick(val);
  });
  document.getElementById("namePickerSkip").addEventListener("click", onSkip);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function replaceContents(target, fresh) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, fresh);
}

function appShellHtml(myName, semesters) {
  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">My Courses</span>
        <h1>CIE Marks-Entry Status</h1>
        <p>Mark each section's status once marks are entered and verified. Course leads also confirm CIE-2 question paper + answer key submission below each course.</p>
      </div>
    </div>
    <div id="nameBanner" style="font-size:13px;color:var(--ink-soft);margin-bottom:16px;"></div>

    <div class="topbar__nav" style="background:transparent;padding:0;margin-bottom:16px;display:flex;gap:6px;">
      <button type="button" class="sec-page-tab btn btn--outline btn--sm active" data-panel="entry" style="border-color:var(--maroon);">Marks Entry</button>
      <button type="button" class="sec-page-tab btn btn--outline btn--sm" data-panel="report">Report</button>
      <button type="button" class="sec-page-tab btn btn--outline btn--sm" data-panel="summary">My Summary</button>
    </div>

    <div id="sec-panel-entry" class="sec-page-panel">
      <div class="filter-bar">
        <select id="filterProgramme">
          <option>All</option>
          <option>BTech</option>
          <option>BCA</option>
          <option>BSc</option>
          <option>MTech</option>
          <option>Minors</option>
          <option>UE</option>
        </select>
        <input type="search" id="filterSearch" placeholder="Search course, code, or faculty name" />
        <label class="toggle-chip">
          <input type="checkbox" id="filterMine" ${myName ? "checked" : ""} />
          My sections only
        </label>
      </div>
      <div id="courseList"></div>
    </div>

    <div id="sec-panel-report" class="sec-page-panel" style="display:none;">
      <div class="filter-bar">
        <select id="repProgramme">
          <option value="All">All programmes</option>
          <option>BTech</option>
          <option>BCA</option>
          <option>BSc</option>
          <option>MTech</option>
          <option>Minors</option>
          <option>UE</option>
        </select>
        <select id="repSemester">
          <option value="All">All semesters</option>
          ${semesters.map((s) => `<option>${escapeHtml(String(s))}</option>`).join("")}
        </select>
        <input type="search" id="repSearch" placeholder="Search course, code, or lead" />
        <button class="btn btn--primary btn--sm" id="repGenerateBtn" type="button">Generate Report</button>
        <button class="btn btn--outline btn--sm" id="repExportBtn" type="button">Export CSV</button>
      </div>
      <div id="secReportOutput"><div class="empty-state"><h3>No report generated yet</h3><p>Choose a programme/semester (optional) and click Generate Report.</p></div></div>
    </div>

    <div id="sec-panel-summary" class="sec-page-panel" style="display:none;">
      <div id="mySummaryOutput"></div>
    </div>
  `;
}

main();
