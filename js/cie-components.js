import { requireAuth, isAdmin } from "./auth.js";
import { loadCieCourseData, flattenCieCourses, computeCie, CIE_TABS, programmeGroupForTab } from "./cie-data.js";
import {
  fetchAllCie, saveCieComponent, seedCieComponents, getFacultyLink,
  fetchFacultyDirectory, fetchCoordinators,
} from "./store.js";
import { buildReport, buildComponentAnalysis, reportRowsToCsv, downloadCsv } from "./cie-reports.js";
import { renderAdminTools } from "./cie-admin-tools.js";
import { renderSharedTopbar } from "./topbar.js";

const CAPS = { cie1: 20, cie2: 25, cie3: 25, total: 70 };
const EVAL_METHODS_FALLBACK = ["Others (please specify)"];

async function main() {
  const user = await requireAuth();
  if (!user) return;

  const admin = isAdmin(user.email);

  const [cieCourseData, cieDocsRaw, link, facultyDirectoryRaw, coordinatorsRaw] = await Promise.all([
    loadCieCourseData(),
    fetchAllCie(),
    getFacultyLink(user.uid),
    fetchFacultyDirectory(),
    fetchCoordinators(),
  ]);
  const cieDocs = { ...cieDocsRaw };
  const facultyDirectory = { ...facultyDirectoryRaw };
  const coordinators = { ...coordinatorsRaw };

  const courses = flattenCieCourses(cieCourseData);
  const evalMethods = cieCourseData.evaluationMethods || EVAL_METHODS_FALLBACK;
  const myName = link ? link.name : null;
  const seededCount = Object.keys(cieDocs).length;
  const missingCount = courses.filter((c) => !cieDocs[c.id]).length;

  const myCoordProgrammes = Object.entries(coordinators)
    .filter(([, c]) => c && c.email && c.email.toLowerCase() === user.email.toLowerCase())
    .map(([g]) => g);

  renderSharedTopbar(user, {
    roleBadge: admin
      ? `<span class="badge-role">Coordinator (Admin)</span>`
      : myCoordProgrammes.length ? `<span class="badge-role">${escapeHtml(myCoordProgrammes.join(", "))} Coordinator</span>` : "",
    onRefresh: refreshData,
  });

  document.getElementById("loadingVeil").remove();
  document.getElementById("appRoot").innerHTML = appShellHtml(myName, admin, missingCount, courses.length, seededCount);
  wireReportControls();
  wireTabs(admin);

  if (admin && missingCount > 0) {
    document.getElementById("seedCieBtn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Seeding\u2026";
      try {
        const n = await seedCieComponents(cieCourseData, (done, total) => {
          btn.textContent = `Seeding\u2026 ${done}/${total}`;
        });
        alert(`Seeded ${n} CIE component row(s) (including any newly-added courses, e.g. MTech). Reloading\u2026`);
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert("Seeding failed. Check console for details.");
        btn.disabled = false;
        btn.textContent = "Seed / resync CIE Component data";
      }
    });
  }

  function docFor(course) {
    return cieDocs[course.id] || null;
  }

  function canEdit(course) {
    if (admin) return true;
    if (myCoordProgrammes.includes(programmeGroupForTab(course.tab))) return true;
    if (!myName) return false;
    const doc = docFor(course);
    const lead = (doc && doc.lead) ?? course.lead;
    return !!lead && lead === myName;
  }

  function renderDashboard() {
    let total = 0, completed = 0, missingLead = 0, errors = 0, sumTotal = 0, withMarks = 0;
    for (const c of courses) {
      total++;
      const doc = docFor(c);
      const calc = computeCie(doc || emptyStub(c), CAPS);
      if (calc.status === "Completed") completed++;
      const lead = (doc && doc.lead) ?? c.lead;
      if (!lead) missingLead++;
      if (calc.hasError) errors++;
      if (doc) { sumTotal += calc.totalCie; if (calc.totalCie > 0) withMarks++; }
    }
    const avg = withMarks ? (sumTotal / withMarks).toFixed(1) : "0.0";

    document.getElementById("cieDashboard").innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Total Courses</div><div class="value">${total}</div></div>
        <div class="kpi"><div class="label">Completed</div><div class="value">${completed}</div></div>
        <div class="kpi"><div class="label">Avg. Total CIE Marks</div><div class="value">${avg}</div></div>
        <div class="kpi"><div class="label">Missing Course Lead</div><div class="value">${missingLead}</div></div>
        <div class="kpi"><div class="label">Courses with Errors</div><div class="value">${errors}</div></div>
      </div>`;
  }

  // ---------- Consolidated report (one-click, filterable) ----------

  function reportFilters() {
    return {
      tab: document.getElementById("repTab").value,
      category: document.getElementById("repCategory").value,
      status: document.getElementById("repStatus").value,
      search: document.getElementById("repSearch").value.trim(),
    };
  }

  function generateReport() {
    const report = buildReport(courses, cieDocs, CAPS, reportFilters());
    window.__lastReport = report;
    const out = document.getElementById("reportOutput");

    out.innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">Courses (filtered)</div><div class="value">${report.totals.courses}</div></div>
        <div class="kpi"><div class="label">Students</div><div class="value">${report.totals.students}</div></div>
        <div class="kpi"><div class="label">Completed</div><div class="value">${report.totals.completed}</div></div>
        <div class="kpi"><div class="label">Missing Lead</div><div class="value">${report.totals.missingLead}</div></div>
        <div class="kpi"><div class="label">Errors</div><div class="value">${report.totals.errors}</div></div>
      </div>

      <div class="chart-grid">
        <div class="panel" style="margin-bottom:0;">
          <div class="panel__head"><h2>Summary by Tab</h2></div>
          <div class="panel__body" style="overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>Tab</th><th>Courses</th><th>Students</th><th>Avg Total</th><th>Completed</th><th>Missing Lead</th><th>Errors</th></tr></thead>
              <tbody>
                ${report.tabSummary.map((t) => `
                  <tr><td>${escapeHtml(t.tab)}</td><td>${t.courses}</td><td>${t.students}</td><td>${t.avgTotal}</td><td>${t.completed}</td><td>${t.missingLead}</td><td>${t.errors}</td></tr>
                `).join("") || `<tr><td colspan="7" style="color:var(--ink-soft);">No matching rows.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel" style="margin-bottom:0;">
          <div class="panel__head"><h2>Courses by Category</h2></div>
          <div class="panel__body" style="overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>Category</th><th>Count</th></tr></thead>
              <tbody>
                ${report.categorySummary.map((c) => `<tr><td>${escapeHtml(c.category)}</td><td>${c.count}</td></tr>`).join("") || `<tr><td colspan="2" style="color:var(--ink-soft);">No matching rows.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><h2>Courses by Status</h2></div>
        <div class="panel__body" style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Status</th><th>Count</th></tr></thead>
            <tbody>${report.statusSummary.map((s) => `<tr><td>${escapeHtml(s.status)}</td><td>${s.count}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><h2>Course-level Detail (${report.rows.length})</h2></div>
        <div class="panel__body" style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Tab</th><th>Code</th><th>Course</th><th>Lead</th><th>CIE-1</th><th>CIE-2</th><th>CIE-3</th><th>Total</th><th>Comp. Check</th><th>Status</th></tr></thead>
            <tbody>
              ${report.rows.slice(0, 500).map((r) => `
                <tr>
                  <td>${escapeHtml(r.course.tab)}</td>
                  <td class="mono">${escapeHtml(r.course.code)}</td>
                  <td>${escapeHtml(r.course.name)}</td>
                  <td>${escapeHtml(r.course.lead || "\u2014")}</td>
                  <td>${r.calc.cie1Total}${r.calc.cie1Over ? " \u26A0" : ""}</td>
                  <td>${r.calc.cie2Marks}${r.calc.cie2Over ? " \u26A0" : ""}</td>
                  <td>${r.calc.cie3Total}${r.calc.cie3Over ? " \u26A0" : ""}</td>
                  <td>${r.calc.totalCie}${r.calc.totalOver ? " \u26A0" : ""}</td>
                  <td>${r.calc.componentCheck ? "OK" : `Need ${r.calc.minReq}`}</td>
                  <td>${r.calc.status}</td>
                </tr>`).join("")}
            </tbody>
          </table>
          ${report.rows.length > 500 ? `<p style="font-size:12px;color:var(--ink-soft);">Showing first 500 of ${report.rows.length} rows &mdash; use Export CSV for the full list.</p>` : ""}
        </div>
      </div>
    `;
  }

  function generateComponentAnalysis() {
    const a = buildComponentAnalysis(courses, cieDocs, evalMethods, programmeGroupForTab);
    const out = document.getElementById("componentAnalysisOutput");
    out.innerHTML = `
      <div class="panel">
        <div class="panel__head"><h2>Evaluation-Method Usage (CIE-1 + CIE-3 combined)</h2>
          <span style="font-size:12px;color:var(--ink-soft);">Reads 0 for a method until courses actually use it in their CIE-1/CIE-3 entries.</span>
        </div>
        <div class="panel__body" style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Component Type</th><th>CIE-1 Uses</th><th>CIE-3 Uses</th><th>Total</th></tr></thead>
            <tbody>
              ${a.overall.filter((r) => r.total > 0).sort((x, y) => y.total - x.total).map((r) => `<tr><td>${escapeHtml(r.method)}</td><td>${r.cie1}</td><td>${r.cie3}</td><td><strong>${r.total}</strong></td></tr>`).join("") || `<tr><td colspan="4" style="color:var(--ink-soft);">No CIE-1/CIE-3 evaluation methods entered yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel__head"><h2>Usage by Programme Group</h2></div>
        <div class="panel__body" style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Component Type</th>${a.groups.map((g) => `<th>${g}</th>`).join("")}</tr></thead>
            <tbody>
              ${a.byGroup.filter((r) => a.groups.some((g) => r[g] > 0)).map((r) => `<tr><td>${escapeHtml(r.method)}</td>${a.groups.map((g) => `<td>${r[g]}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${a.groups.length + 1}" style="color:var(--ink-soft);">No CIE-1/CIE-3 evaluation methods entered yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function wireReportControls() {
    document.getElementById("repGenerateBtn").addEventListener("click", () => {
      generateReport();
      generateComponentAnalysis();
    });
    document.getElementById("repExportBtn").addEventListener("click", () => {
      const report = window.__lastReport || buildReport(courses, cieDocs, CAPS, reportFilters());
      downloadCsv(`cie-consolidated-report-${Date.now()}.csv`, reportRowsToCsv(report.rows));
    });
  }

  // ---------- Tabs: Entry / Report / Admin Tools ----------

  function wireTabs(isAdminUser) {
    const tabs = document.querySelectorAll(".cie-page-tab");
    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        tabs.forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        document.querySelectorAll(".cie-page-panel").forEach((p) => (p.style.display = "none"));
        document.getElementById(`panel-${t.dataset.panel}`).style.display = "block";
        if (t.dataset.panel === "admin" && isAdminUser && !document.getElementById("adminToolsRoot").dataset.rendered) {
          renderAdminTools(document.getElementById("adminToolsRoot"), {
            courses, cieDocs, facultyDirectory, coordinators, user,
            onDataChanged: () => { renderDashboard(); renderList(); },
          });
          document.getElementById("adminToolsRoot").dataset.rendered = "1";
        }
      });
    });
  }

  // ---------- Course entry list ----------

  function currentFilters() {
    return {
      tab: document.getElementById("filterTab").value,
      search: document.getElementById("filterSearch").value.trim().toLowerCase(),
      mineOnly: myName ? document.getElementById("filterMine").checked : false,
      errorsOnly: document.getElementById("filterErrors").checked,
    };
  }

  function renderList() {
    const { tab, search, mineOnly, errorsOnly } = currentFilters();
    const grouped = new Map();

    for (const c of courses) {
      if (tab !== "All" && c.tab !== tab) continue;
      const doc = docFor(c);
      const lead = (doc && doc.lead) ?? c.lead;
      if (mineOnly && !(lead && lead === myName)) continue;
      if (search) {
        const hay = `${c.code} ${c.name} ${lead || ""}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }
      const calc = computeCie(doc || emptyStub(c), CAPS);
      if (errorsOnly && !calc.hasError) continue;

      if (!grouped.has(c.tab)) grouped.set(c.tab, []);
      grouped.get(c.tab).push({ course: c, doc, calc });
    }

    const listEl = document.getElementById("cieList");
    if (grouped.size === 0) {
      listEl.innerHTML = `<div class="empty-state"><h3>No matching courses</h3><p>Try a different tab, or clear the search box.</p></div>`;
      return;
    }

    let html = "";
    for (const [tabName, items] of grouped) {
      html += `<div class="eyebrow" style="margin: 22px 0 10px;">${escapeHtml(tabName)}</div>`;
      for (const item of items) html += cieCardHtml(item, canEdit(item.course), evalMethods);
    }
    listEl.innerHTML = html;

    listEl.querySelectorAll("[data-recalc]").forEach((el) => {
      el.addEventListener("input", () => recalcCard(el.closest(".cie-card")));
    });
    listEl.querySelectorAll(".cie-save-btn").forEach((btn) => {
      btn.addEventListener("click", () => onSave(btn));
    });
  }

  function recalcCard(card) {
    const draft = readDraft(card);
    const calc = computeCie(draft, CAPS);
    card.querySelector(".cie-live-summary").outerHTML = summaryHtml(calc);
  }

  function readDraft(card) {
    const g = (name) => card.querySelector(`[name="${name}"]`);
    const val = (name) => (g(name) ? g(name).value : "");
    return {
      credits: Number(card.dataset.credits) || 0,
      lead: card.dataset.lead || null,
      cie1: {
        a: { method: val("c1a_method"), marks: val("c1a_marks"), date: val("c1a_date") },
        b: { method: val("c1b_method"), marks: val("c1b_marks"), date: val("c1b_date") },
        c: { method: val("c1c_method"), marks: val("c1c_marks"), date: val("c1c_date") },
      },
      cie2: {
        marks: val("c2_marks"), qpDate: val("c2_qp"), scrutinyDate: val("c2_scrutiny"), keyDate: val("c2_key"),
      },
      cie3: {
        a: { method: val("c3a_method"), marks: val("c3a_marks"), date: val("c3a_date") },
        b: { method: val("c3b_method"), marks: val("c3b_marks"), date: val("c3b_date") },
        c: { method: val("c3c_method"), marks: val("c3c_marks"), date: val("c3c_date") },
      },
      remarks: val("remarks"),
    };
  }

  async function onSave(btn) {
    const card = btn.closest(".cie-card");
    const id = card.dataset.id;
    const draft = readDraft(card);
    const patch = { cie1: draft.cie1, cie2: draft.cie2, cie3: draft.cie3, remarks: draft.remarks };
    btn.disabled = true;
    btn.textContent = "Saving\u2026";
    try {
      await saveCieComponent(id, patch, user);
      cieDocs[id] = { ...(cieDocs[id] || {}), ...patch };
      btn.textContent = "Saved \u2713";
      renderDashboard();
      setTimeout(() => { btn.textContent = "Save changes"; btn.disabled = false; }, 1200);
    } catch (err) {
      console.error(err);
      alert("Could not save. Check your connection, or ask a coordinator to resync CIE Component data if this course was added recently, then try again.");
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
  }

  async function refreshData() {
    const [freshCie, freshFacDir, freshCoord] = await Promise.all([
      fetchAllCie(), fetchFacultyDirectory(), fetchCoordinators(),
    ]);
    replaceContents(cieDocs, freshCie);
    replaceContents(facultyDirectory, freshFacDir);
    replaceContents(coordinators, freshCoord);
    renderDashboard();
    renderList();
    if (document.getElementById("panel-report").style.display !== "none") {
      generateReport();
      generateComponentAnalysis();
    }
  }

  wireFilterBar(renderList);
  renderDashboard();
  renderList();
}

function replaceContents(target, fresh) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, fresh);
}

function wireFilterBar(renderList) {
  ["filterTab", "filterSearch", "filterMine", "filterErrors"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", renderList);
    el.addEventListener("change", renderList);
  });
}

function emptyStub(course) {
  return {
    credits: course.credits, lead: course.lead,
    cie1: { a: {}, b: {}, c: {} },
    cie2: {},
    cie3: { a: {}, b: {}, c: {} },
  };
}

function statusBadgeHtml(calc) {
  if (calc.status === "Completed") return `<span class="cie-badge cie-badge--ok">Completed</span>`;
  if (calc.status === "In Progress") return `<span class="cie-badge cie-badge--progress">In Progress</span>`;
  return `<span class="cie-badge cie-badge--progress">Not Started</span>`;
}

function summaryHtml(calc) {
  return `
    <div class="cie-summary cie-live-summary">
      <div class="stat ${calc.cie1Over ? "over" : ""}"><div class="n">${calc.cie1Total}<span style="color:var(--ink-soft);font-weight:400;">/20</span></div><div class="l">CIE-1</div></div>
      <div class="stat ${calc.cie2Over ? "over" : ""}"><div class="n">${calc.cie2Marks}<span style="color:var(--ink-soft);font-weight:400;">/25</span></div><div class="l">CIE-2</div></div>
      <div class="stat ${calc.cie3Over ? "over" : ""}"><div class="n">${calc.cie3Total}<span style="color:var(--ink-soft);font-weight:400;">/25</span></div><div class="l">CIE-3</div></div>
      <div class="stat ${calc.totalOver ? "over" : ""}"><div class="n">${calc.totalCie}<span style="color:var(--ink-soft);font-weight:400;">/70</span></div><div class="l">Total CIE</div></div>
      <div class="stat"><div class="n">${calc.componentsUsed}</div><div class="l">Components Used</div></div>
      <div class="stat ${!calc.componentCheck ? "over" : ""}"><div class="n">${calc.minReq}</div><div class="l">Min Req.</div></div>
      <div class="stat">
        <div class="n" style="font-size:11px;">${calc.componentCheck ? "\u2713 OK" : `\u26A0 Need ${calc.minReq}`}</div>
        <div class="l">Component Check</div>
      </div>
    </div>`;
}

function optionRowHtml(prefix, opt, evalMethods, editable) {
  const o = opt || {};
  return `
    <div class="cie-option-grid">
      <div>
        <label>Evaluation Method</label>
        <select name="${prefix}_method" data-recalc ${editable ? "" : "disabled"}>
          <option value="">&mdash;</option>
          ${evalMethods.map((m) => `<option value="${escapeAttr(m)}" ${o.method === m ? "selected" : ""}>${escapeHtml(m)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Marks</label>
        <input type="number" min="0" step="0.5" name="${prefix}_marks" data-recalc value="${o.marks ?? ""}" ${editable ? "" : "disabled"} />
      </div>
      <div>
        <label>Date Proposed</label>
        <input type="date" name="${prefix}_date" value="${o.date || ""}" ${editable ? "" : "disabled"} />
      </div>
    </div>`;
}

function cieCardHtml(item, editable, evalMethods) {
  const { course, doc } = item;
  const d = doc || emptyStub(course);
  const calc = item.calc;
  const effectiveLead = d.lead ?? course.lead;

  return `
    <div class="cie-card" data-id="${course.id}" data-credits="${course.credits}" data-lead="${escapeAttr(effectiveLead || "")}">
      <div class="cie-card__head">
        <div>
          <div class="course-card__code">${escapeHtml(course.code)}</div>
          <div class="course-card__title">${escapeHtml(course.name)}</div>
          <div class="cie-card__meta">
            <span>Lead: <strong>${effectiveLead ? escapeHtml(effectiveLead) : "\u26A0 not on record"}</strong></span>
            <span>Credits: ${course.credits}</span>
            <span>${escapeHtml(course.category || "\u2014")}</span>
            <span>${escapeHtml(course.seeType || "\u2014")}</span>
            ${course.students != null ? `<span>${course.students} students</span>` : ""}
          </div>
        </div>
        ${statusBadgeHtml(calc)}
      </div>
      <div class="cie-card__body">
        ${summaryHtml(calc)}

        <div class="cie-block" style="margin-top:14px;">
          <div class="cie-block__head"><span class="cie-block__title">CIE-1 &nbsp;<small style="font-weight:400;color:var(--ink-soft);">up to 3 options, max 20</small></span></div>
          ${optionRowHtml("c1a", d.cie1?.a, evalMethods, editable)}
          ${optionRowHtml("c1b", d.cie1?.b, evalMethods, editable)}
          ${optionRowHtml("c1c", d.cie1?.c, evalMethods, editable)}
        </div>

        <div class="cie-block">
          <div class="cie-block__head"><span class="cie-block__title">CIE-2 &nbsp;<small style="font-weight:400;color:var(--ink-soft);">single route, max 25</small></span></div>
          <div class="cie-single-row">
            <div><label>Marks</label><input type="number" min="0" step="0.5" name="c2_marks" data-recalc value="${d.cie2?.marks ?? ""}" ${editable ? "" : "disabled"} /></div>
            <div><label>Question Paper</label><input type="date" name="c2_qp" value="${d.cie2?.qpDate || ""}" ${editable ? "" : "disabled"} /></div>
            <div><label>Scrutiny Form</label><input type="date" name="c2_scrutiny" value="${d.cie2?.scrutinyDate || ""}" ${editable ? "" : "disabled"} /></div>
            <div><label>Answer Key</label><input type="date" name="c2_key" value="${d.cie2?.keyDate || ""}" ${editable ? "" : "disabled"} /></div>
          </div>
        </div>

        <div class="cie-block">
          <div class="cie-block__head"><span class="cie-block__title">CIE-3 &nbsp;<small style="font-weight:400;color:var(--ink-soft);">up to 3 options, max 25</small></span></div>
          ${optionRowHtml("c3a", d.cie3?.a, evalMethods, editable)}
          ${optionRowHtml("c3b", d.cie3?.b, evalMethods, editable)}
          ${optionRowHtml("c3c", d.cie3?.c, evalMethods, editable)}
        </div>

        <div class="cie-remarks">
          <label style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;color:var(--ink-soft);margin-bottom:3px;">Remarks</label>
          <textarea name="remarks" ${editable ? "" : "disabled"} placeholder="${editable ? "Optional notes\u2026" : ""}">${escapeHtml(d.remarks || "")}</textarea>
        </div>

        ${!doc ? `<div class="cie-readonly-note" style="color:var(--amber);">Not yet seeded into CIE Component monitoring &mdash; ask a coordinator to resync from the Admin Tools tab.</div>` : ""}
        ${editable
          ? `<div class="cie-save-row">
               <button type="button" class="btn btn--primary btn--sm cie-save-btn">Save changes</button>
               <span class="cie-save-note">Only the course lead, that programme's coordinator, or an admin can edit this course.</span>
             </div>`
          : `<div class="cie-readonly-note">Read-only &mdash; only ${effectiveLead ? escapeHtml(effectiveLead) : "the course lead"}, that programme's coordinator, or an admin can edit CIE component data for this course.</div>`
        }
      </div>
    </div>`;
}


function appShellHtml(myName, admin, missingCount, totalCourses, seededCount) {
  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">CIE Component Monitoring</span>
        <h1>CIE-1 / CIE-2 / CIE-3 Marks &amp; Validation</h1>
        <p>Enter evaluation method, marks, and submission dates for each CIE component. Caps and the Credits+1 component-count rule are checked live, exactly as in the CIE Consolidated Dashboard workbook.</p>
      </div>
    </div>

    ${admin && missingCount > 0 ? `
      <div class="panel" style="border-color:var(--brass);">
        <div class="panel__body" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <span>${seededCount === 0 ? "CIE Component monitoring hasn't been seeded yet" : `${missingCount} course(s) (e.g. newly-added MTech courses) aren't in Firestore yet`} &mdash; ${totalCourses} total in the course list.</span>
          <button class="btn btn--primary btn--sm" id="seedCieBtn" type="button">${seededCount === 0 ? "Seed CIE Component data" : "Seed / resync CIE Component data"}</button>
        </div>
      </div>` : ""}

    <div class="topbar__nav" style="background:transparent;padding:0;margin-bottom:16px;display:flex;gap:6px;">
      <button type="button" class="cie-page-tab btn btn--outline btn--sm active" data-panel="entry" style="border-color:var(--maroon);">Marks Entry</button>
      <button type="button" class="cie-page-tab btn btn--outline btn--sm" data-panel="report">Consolidated Report</button>
      ${admin ? `<button type="button" class="cie-page-tab btn btn--outline btn--sm" data-panel="admin">Admin Tools</button>` : ""}
    </div>

    <div id="panel-entry" class="cie-page-panel">
      <div id="cieDashboard"></div>
      <div class="filter-bar">
        <select id="filterTab">
          <option>All</option>
          ${CIE_TABS.map((t) => `<option>${escapeHtml(t)}</option>`).join("")}
        </select>
        <input type="search" id="filterSearch" placeholder="Search course, code, or lead" />
        <label class="toggle-chip" style="${myName ? "" : "display:none;"}">
          <input type="checkbox" id="filterMine" />
          My courses only
        </label>
        <label class="toggle-chip">
          <input type="checkbox" id="filterErrors" />
          Errors / over-cap only
        </label>
      </div>
      <div id="cieList"></div>
    </div>

    <div id="panel-report" class="cie-page-panel" style="display:none;">
      <div class="filter-bar">
        <select id="repTab">
          <option value="All">All tabs</option>
          ${CIE_TABS.map((t) => `<option>${escapeHtml(t)}</option>`).join("")}
        </select>
        <select id="repCategory">
          <option value="All">All categories</option>
          <option>Core</option><option>Major</option><option>Elective</option><option>Minor</option>
        </select>
        <select id="repStatus">
          <option value="All">All statuses</option>
          <option>Not Started</option><option>In Progress</option><option>Completed</option>
        </select>
        <input type="search" id="repSearch" placeholder="Search course, code, or lead" />
        <button class="btn btn--primary btn--sm" id="repGenerateBtn" type="button">Generate Report</button>
        <button class="btn btn--outline btn--sm" id="repExportBtn" type="button">Export CSV</button>
      </div>
      <div id="reportOutput"><div class="empty-state"><h3>No report generated yet</h3><p>Set your filters (optional) and click Generate Report.</p></div></div>
      <div id="componentAnalysisOutput"></div>
    </div>

    ${admin ? `<div id="panel-admin" class="cie-page-panel" style="display:none;"><div id="adminToolsRoot"></div></div>` : ""}
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

main();
