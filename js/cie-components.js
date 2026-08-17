import { requireAuth, signOutUser, isAdmin } from "./auth.js";
import { loadCieCourseData, flattenCieCourses, computeCie, CIE_TABS } from "./cie-data.js";
import { fetchAllCie, saveCieComponent, isCieSeeded, seedCieComponents, getFacultyLink } from "./store.js";

const CAPS = { cie1: 20, cie2: 25, cie3: 25, total: 70 };
const EVAL_METHODS_FALLBACK = ["Others (please specify)"];

async function main() {
  const user = await requireAuth();
  if (!user) return;

  renderTopbar(user);

  const [cieCourseData, cieDocs, link] = await Promise.all([
    loadCieCourseData(),
    fetchAllCie(),
    getFacultyLink(user.uid),
  ]);

  const courses = flattenCieCourses(cieCourseData);
  const evalMethods = cieCourseData.evaluationMethods || EVAL_METHODS_FALLBACK;
  const myName = link ? link.name : null;
  const admin = isAdmin(user.email);
  const seeded = courses.length ? Object.keys(cieDocs).length > 0 : true;

  document.getElementById("loadingVeil").remove();
  document.getElementById("appRoot").innerHTML = appShellHtml(myName, admin, seeded, courses.length);
  wireFilterBar();

  if (admin && !seeded) {
    document.getElementById("seedCieBtn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Seeding\u2026";
      try {
        const n = await seedCieComponents(cieCourseData, (done, total) => {
          btn.textContent = `Seeding\u2026 ${done}/${total}`;
        });
        alert(`Seeded ${n} CIE component rows. Reloading\u2026`);
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert("Seeding failed. Check console for details.");
        btn.disabled = false;
        btn.textContent = "Seed CIE Component data";
      }
    });
  }

  window.__cieRenderList = renderList;
  renderDashboard();
  renderList();

  function docFor(course) {
    return cieDocs[course.id] || null;
  }

  function canEdit(course) {
    if (admin) return true;
    if (!myName) return false;
    return !!course.lead && course.lead === myName;
  }

  function currentFilters() {
    return {
      tab: document.getElementById("filterTab").value,
      search: document.getElementById("filterSearch").value.trim().toLowerCase(),
      mineOnly: myName ? document.getElementById("filterMine").checked : false,
      errorsOnly: document.getElementById("filterErrors").checked,
    };
  }

  function renderDashboard() {
    let total = 0, completed = 0, missingLead = 0, errors = 0, sumTotal = 0, withMarks = 0;
    for (const c of courses) {
      total++;
      const doc = docFor(c);
      const calc = computeCie(doc || emptyStub(c), CAPS);
      if (calc.status === "Completed") completed++;
      if (!c.lead) missingLead++;
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

  function renderList() {
    const { tab, search, mineOnly, errorsOnly } = currentFilters();
    const grouped = new Map();

    for (const c of courses) {
      if (tab !== "All" && c.tab !== tab) continue;
      if (mineOnly && !(c.lead && c.lead === myName)) continue;
      if (search) {
        const hay = `${c.code} ${c.name} ${c.lead || ""}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }
      const doc = docFor(c);
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
    const id = card.dataset.id;
    const course = courses.find((c) => c.id === id);
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
      alert(
        cieDocs[id]
          ? "Could not save. Check your connection and try again."
          : "This course hasn't been seeded into CIE Component monitoring yet — ask your coordinator to seed it from the Coordinator Dashboard."
      );
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
  }
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

  return `
    <div class="cie-card" data-id="${course.id}" data-credits="${course.credits}" data-lead="${escapeAttr(course.lead || "")}">
      <div class="cie-card__head">
        <div>
          <div class="course-card__code">${escapeHtml(course.code)}</div>
          <div class="course-card__title">${escapeHtml(course.name)}</div>
          <div class="cie-card__meta">
            <span>Lead: <strong>${course.lead ? escapeHtml(course.lead) : "\u26A0 not on record"}</strong></span>
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

        ${editable
          ? `<div class="cie-save-row">
               <button type="button" class="btn btn--primary btn--sm cie-save-btn">Save changes</button>
               <span class="cie-save-note">Only you (course lead) or a coordinator can edit this course.</span>
             </div>`
          : `<div class="cie-readonly-note">Read-only &mdash; only ${course.lead ? escapeHtml(course.lead) : "the course lead"} or a coordinator can edit CIE component data for this course.</div>`
        }
      </div>
    </div>`;
}

function wireFilterBar() {
  const els = [
    document.getElementById("filterTab"),
    document.getElementById("filterSearch"),
    document.getElementById("filterMine"),
    document.getElementById("filterErrors"),
  ];
  els.forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => window.__cieRenderList && window.__cieRenderList());
    el.addEventListener("change", () => window.__cieRenderList && window.__cieRenderList());
  });
}

function renderTopbar(user) {
  document.getElementById("topbarUser").innerHTML = `
    ${isAdmin(user.email) ? `<span class="badge-role">Coordinator</span>` : ""}
    ${user.photoURL ? `<img src="${user.photoURL}" alt="" />` : ""}
    <span>${escapeHtml(user.displayName || user.email)}</span>
    <button class="btn btn--ghost btn--sm" id="signOutBtn" type="button">Sign out</button>
  `;
  document.getElementById("topbarUser").querySelector("#signOutBtn").addEventListener("click", async () => {
    await signOutUser();
    window.location.href = "index.html";
  });
  if (isAdmin(user.email)) {
    document.getElementById("adminNavLink").style.display = "inline-block";
  }
}

function appShellHtml(myName, admin, seeded, totalCourses) {
  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">CIE Component Monitoring</span>
        <h1>CIE-1 / CIE-2 / CIE-3 Marks &amp; Validation</h1>
        <p>Enter evaluation method, marks, and submission dates for each CIE component. Caps and the Credits+1 component-count rule are checked live, exactly as in the CIE Consolidated Dashboard workbook.</p>
      </div>
    </div>

    ${admin && !seeded && totalCourses > 0 ? `
      <div class="panel" style="border-color:var(--brass);">
        <div class="panel__body" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <span>CIE Component monitoring hasn't been seeded into Firestore yet (${totalCourses} courses found in the course list).</span>
          <button class="btn btn--primary btn--sm" id="seedCieBtn" type="button">Seed CIE Component data</button>
        </div>
      </div>` : ""}

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
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

main().then(() => {
  // Expose renderList to the filter-bar listeners wired before it existed.
});
