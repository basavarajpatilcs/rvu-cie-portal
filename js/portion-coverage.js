import { requireAuth, isEffectiveAdmin } from "./auth.js";
import { loadCourseData, flattenSections } from "./data.js";
import {
  fetchAllPortionCoverage, savePortionCoverageEntry, seedPortionCoverage,
  getFacultyLink, fetchPortionWeeks, fetchCoordinators,
} from "./store.js";
import { emptyPortionDoc, computePortionStatus, PROGRAMME_TABS, WEEK_COUNT } from "./portion-data.js";
import { renderSharedTopbar, roleBadgeHtml } from "./topbar.js";

async function main() {
  const user = await requireAuth();
  if (!user) return;

  const admin = await isEffectiveAdmin(user.email);

  const [courseData, pcDocsRaw, link, weeksMeta, coordinators] = await Promise.all([
    loadCourseData(), fetchAllPortionCoverage(), getFacultyLink(user.uid), fetchPortionWeeks(), fetchCoordinators(),
  ]);
  const pcDocs = { ...pcDocsRaw };
  const sectionRows = flattenSections(courseData);
  const myName = link ? link.name : null;
  const bySemester = weeksMeta.bySemester || {};
  const myCoordProgrammes = Object.entries(coordinators)
    .filter(([, c]) => c && c.email && c.email.toLowerCase() === user.email.toLowerCase())
    .map(([g]) => g);

  const missingCount = sectionRows.filter((s) => !pcDocs[s.id]).length;

  renderSharedTopbar(user, { admin, roleBadge: roleBadgeHtml(admin, myCoordProgrammes), onRefresh: refreshData });

  document.getElementById("loadingVeil").remove();
  document.getElementById("appRoot").innerHTML = shellHtml(sectionRows, admin, missingCount);
  wireProgrammeTabs();
  wireFilterBar();

  if (admin && missingCount > 0) {
    document.getElementById("seedPcBtn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Seeding\u2026";
      try {
        const n = await seedPortionCoverage(sectionRows, emptyPortionDoc, (done, total) => {
          btn.textContent = `Seeding\u2026 ${done}/${total}`;
        });
        alert(`Seeded ${n} Portion Coverage row(s). Reloading\u2026`);
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert("Seeding failed. Check console for details.");
        btn.disabled = false;
        btn.textContent = "Seed / resync Portion Coverage data";
      }
    });
  }

  let activeProgramme = "BTech";

  function docFor(section) {
    return pcDocs[section.id] || null;
  }

  function canEdit(section) {
    if (admin) return true;
    if (myCoordProgrammes.includes(section.programme)) return true;
    if (!myName) return false;
    return section.faculty === myName || section.lead === myName;
  }

  /** Falls back to generic "Week N" labels if the admin hasn't set a
   *  schedule for this section's semester yet. */
  function weekLabelsFor(section) {
    const sched = bySemester[section.semester];
    if (sched && sched.weeks && sched.weeks.length === WEEK_COUNT) {
      return sched.weeks.map((w, i) => (w.from && w.to) ? `${w.from} to ${w.to}` : `Week ${i + 1}`);
    }
    return Array.from({ length: WEEK_COUNT }, (_, i) => `Week ${i + 1}`);
  }

  function renderDashboard() {
    const rows = sectionRows.filter((s) => s.programme === activeProgramme);
    let total = 0, completed = 0, behind = 0, notStarted = 0;
    for (const s of rows) {
      total++;
      const calc = computePortionStatus(docFor(s) || emptyPortionDoc(s));
      if (calc.status === "Completed") completed++;
      else if (calc.status === "Behind Schedule") behind++;
      else if (calc.status === "Not Started") notStarted++;
    }
    document.getElementById("pcDashboard").innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">${activeProgramme} Sections</div><div class="value">${total}</div></div>
        <div class="kpi"><div class="label">Completed</div><div class="value">${completed}</div></div>
        <div class="kpi"><div class="label">Behind Schedule</div><div class="value">${behind}</div></div>
        <div class="kpi"><div class="label">Not Started</div><div class="value">${notStarted}</div></div>
      </div>`;
  }

  function renderList() {
    const search = document.getElementById("pcSearch").value.trim().toLowerCase();
    const mineOnly = myName ? document.getElementById("pcMine").checked : false;
    const behindOnly = document.getElementById("pcBehind").checked;
    const rows = sectionRows.filter((s) => s.programme === activeProgramme);

    const grouped = new Map();
    for (const s of rows) {
      if (mineOnly && !(s.faculty === myName || s.lead === myName)) continue;
      if (search) {
        const hay = `${s.code} ${s.name} ${s.faculty || ""} ${s.section}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }
      const doc = docFor(s);
      const calc = computePortionStatus(doc || emptyPortionDoc(s));
      if (behindOnly && calc.status !== "Behind Schedule") continue;

      const key = s.tab;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ section: s, doc, calc });
    }

    const listEl = document.getElementById("pcList");
    if (grouped.size === 0) {
      listEl.innerHTML = `<div class="empty-state"><h3>No matching sections</h3><p>Try a different filter, or clear the search box.</p></div>`;
      return;
    }

    let html = "";
    for (const [tabName, items] of grouped) {
      html += `<div class="eyebrow" style="margin: 22px 0 10px;">${escapeHtml(tabName)}</div>`;
      for (const item of items) html += pcCardHtml(item, canEdit(item.section), weekLabelsFor(item.section));
    }
    listEl.innerHTML = html;

    listEl.querySelectorAll("[data-recalc]").forEach((el) => {
      el.addEventListener("input", () => recalcCard(el.closest(".cie-card")));
    });
    listEl.querySelectorAll(".pc-save-btn").forEach((btn) => {
      btn.addEventListener("click", () => onSave(btn));
    });
  }

  function readDraft(card) {
    const weeks = [];
    for (let i = 0; i < WEEK_COUNT; i++) {
      const g = (name) => card.querySelector(`[name="${name}_${i}"]`);
      weeks.push({
        ceWeek: g("ceWeek") ? g("ceWeek").value : "",
        chWeek: g("chWeek") ? g("chWeek").value : "",
        epWeek: g("epWeek") ? g("epWeek").value : "",
        cpWeek: g("cpWeek") ? g("cpWeek").value : "",
      });
    }
    const totalInput = card.querySelector(`[name="totalClassesAllotted"]`);
    const portionInput = card.querySelector(`[name="portionToComplete"]`);
    return {
      weeks,
      totalClassesAllotted: totalInput ? totalInput.value : "",
      portionToComplete: portionInput ? portionInput.value : "100%",
    };
  }

  function recalcCard(card) {
    const draft = readDraft(card);
    const calc = computePortionStatus(draft);
    card.querySelector(".pc-live-summary").outerHTML = pcSummaryHtml(calc);
    calc.cumulativeWeeks.forEach((w, i) => {
      const chCumCell = card.querySelector(`.pc-cum-ch_${i}`);
      const cpCumCell = card.querySelector(`.pc-cum-cp_${i}`);
      if (chCumCell) chCumCell.textContent = w.chCum || 0;
      if (cpCumCell) cpCumCell.textContent = (w.cpCum || 0) + "%";
    });
  }

  async function onSave(btn) {
    const card = btn.closest(".cie-card");
    const id = card.dataset.id;
    const draft = readDraft(card);
    btn.disabled = true;
    btn.textContent = "Saving\u2026";
    try {
      await savePortionCoverageEntry(id, draft, user);
      pcDocs[id] = { ...(pcDocs[id] || {}), ...draft };
      btn.textContent = "Saved \u2713";
      renderDashboard();
      setTimeout(() => { btn.textContent = "Save changes"; btn.disabled = false; }, 1200);
    } catch (err) {
      console.error(err);
      alert("Could not save. If this section was added recently, ask a coordinator to resync Portion Coverage data, then try again.");
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
  }

  function wireProgrammeTabs() {
    const tabs = document.querySelectorAll(".pc-programme-tab");
    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        tabs.forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        activeProgramme = t.dataset.programme;
        renderDashboard();
        renderList();
      });
    });
  }

  function wireFilterBar() {
    ["pcSearch", "pcMine", "pcBehind"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", renderList);
      el.addEventListener("change", renderList);
    });
  }

  async function refreshData() {
    const fresh = await fetchAllPortionCoverage();
    for (const k of Object.keys(pcDocs)) delete pcDocs[k];
    Object.assign(pcDocs, fresh);
    renderDashboard();
    renderList();
  }

  renderDashboard();
  renderList();
}

function pcSummaryHtml(calc) {
  return `
    <div class="cie-summary pc-live-summary">
      <div class="stat"><div class="n">${calc.lastCh ?? "\u2014"}</div><div class="l">Classes Held (Cum.)</div></div>
      <div class="stat"><div class="n">${calc.pctClassesHeld !== null ? calc.pctClassesHeld + "%" : "\u2014"}</div><div class="l">% Classes Held</div></div>
      <div class="stat ${calc.behind ? "over" : ""}"><div class="n">${calc.lastCp !== null ? calc.lastCp + "%" : "\u2014"}</div><div class="l">Portion Covered (Cum.)</div></div>
      <div class="stat"><div class="n">${calc.lastEp !== null ? calc.lastEp + "%" : "\u2014"}</div><div class="l">Portion Expected (Cum.)</div></div>
      <div class="stat"><div class="n" style="font-size:11px;">${calc.status}</div><div class="l">Status</div></div>
    </div>`;
}

function statusBadgeHtml(calc) {
  if (calc.status === "Completed") return `<span class="cie-badge cie-badge--ok">Completed</span>`;
  if (calc.status === "Behind Schedule") return `<span class="cie-badge cie-badge--warn">Behind Schedule</span>`;
  if (calc.status === "In Progress") return `<span class="cie-badge cie-badge--progress">In Progress</span>`;
  return `<span class="cie-badge cie-badge--progress">Not Started</span>`;
}

/** Two stacked rows: an editable "this week" input, and a read-only
 *  "cumulative" figure below it (previous + this week, computed
 *  automatically — no manual running totals). */
/** Three stacked rows per metric: an editable "Planned" figure for that
 *  week, an editable "This Week" (actual) figure, and a read-only
 *  "Cumulative" total below it (previous + this week, computed
 *  automatically — no manual running totals). */
function weekTableHtml(weeks, cumulativeWeeks, weekLabels, editable, plannedKey, weeklyKey, cumField, cumClass, label, suffix) {
  return `
    <div class="pc-week-table-wrap">
      <table class="pc-week-table">
        <thead>
          <tr>
            <th class="pc-row-label">${escapeHtml(label)}</th>
            ${weekLabels.map((w, i) => `<th>W${i + 1}<br/>${escapeHtml(w)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="pc-row-label" style="color:var(--maroon);">Planned</td>
            ${weeks.map((w, i) => `<td><input type="number" name="${plannedKey}_${i}" data-recalc value="${w[plannedKey] ?? ""}" ${editable ? "" : "disabled"} /></td>`).join("")}
          </tr>
          <tr>
            <td class="pc-row-label">This Week</td>
            ${weeks.map((w, i) => `<td><input type="number" name="${weeklyKey}_${i}" data-recalc value="${w[weeklyKey] ?? ""}" ${editable ? "" : "disabled"} /></td>`).join("")}
          </tr>
          <tr>
            <td class="pc-row-label" style="color:var(--ink-soft);">Cumulative</td>
            ${cumulativeWeeks.map((w, i) => `<td class="pc-cum-${cumClass}_${i}" style="color:var(--ink-soft);font-weight:600;">${(w[cumField] || 0)}${suffix}</td>`).join("")}
          </tr>
        </tbody>
      </table>
    </div>`;
}

function pcCardHtml(item, editable, weekLabels) {
  const { section, doc } = item;
  const d = doc || emptyPortionDoc(section);
  const calc = item.calc;
  const weeks = d.weeks && d.weeks.length === WEEK_COUNT ? d.weeks : emptyPortionDoc(section).weeks;
  const cumulativeWeeks = calc.cumulativeWeeks;

  return `
    <div class="cie-card" data-id="${section.id}">
      <div class="cie-card__head">
        <div>
          <div class="course-card__code">${escapeHtml(section.code)} &mdash; Sec ${escapeHtml(section.section)}</div>
          <div class="course-card__title">${escapeHtml(section.name)}</div>
          <div class="cie-card__meta">
            <span>Faculty: <strong>${section.faculty ? escapeHtml(section.faculty) : "\u26A0 not on record"}</strong></span>
            <span>${escapeHtml(section.programme)} \u00b7 Sem ${escapeHtml(String(section.semester))}</span>
          </div>
        </div>
        ${statusBadgeHtml(calc)}
      </div>
      <div class="cie-card__body">
        ${pcSummaryHtml(calc)}

        <div class="cie-block" style="margin-top:14px;">
          <div class="cie-block__head"><span class="cie-block__title">Course Totals</span></div>
          <div class="cie-single-row" style="grid-template-columns:1fr 1fr;">
            <div><label>Total Classes Allotted (Credits-based)</label><input type="number" name="totalClassesAllotted" data-recalc value="${d.totalClassesAllotted ?? ""}" ${editable ? "" : "disabled"} /></div>
            <div><label>Portion to be Completed</label><input type="text" name="portionToComplete" value="${escapeAttr(d.portionToComplete || "100%")}" ${editable ? "" : "disabled"} /></div>
          </div>
        </div>

        <div class="cie-block">
          <div class="cie-block__head"><span class="cie-block__title">Classes Taken</span></div>
          ${weekTableHtml(weeks, cumulativeWeeks, weekLabels, editable, "ceWeek", "chWeek", "chCum", "ch", "Classes Held", "")}
        </div>

        <div class="cie-block">
          <div class="cie-block__head"><span class="cie-block__title">Syllabus Coverage %</span></div>
          ${weekTableHtml(weeks, cumulativeWeeks, weekLabels, editable, "epWeek", "cpWeek", "cpCum", "cp", "Portion Covered %", "%")}
        </div>

        ${!doc ? `<div class="cie-readonly-note" style="color:var(--amber);">Not yet seeded into Portion Coverage &mdash; ask a coordinator to resync from this page.</div>` : ""}
        ${editable
          ? `<div class="cie-save-row">
               <button type="button" class="btn btn--primary btn--sm pc-save-btn">Save changes</button>
               <span class="cie-save-note">Enter only THIS week's classes/portion &mdash; cumulative totals update automatically.</span>
             </div>`
          : `<div class="cie-readonly-note">Read-only &mdash; only ${section.faculty ? escapeHtml(section.faculty) : "this section's faculty"} or a coordinator can edit.</div>`
        }
      </div>
    </div>`;
}

function shellHtml(sectionRows, admin, missingCount) {
  const counts = {};
  for (const t of PROGRAMME_TABS) counts[t] = sectionRows.filter((s) => s.programme === t).length;

  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">Portion Coverage</span>
        <h1>Week-wise Syllabus &amp; Classes Coverage</h1>
        <p>Enter only THIS week's classes held and portion covered for each section &mdash; cumulative totals (previous + this week) are calculated automatically.</p>
        ${admin ? `<p style="font-size:12.5px;color:var(--ink-soft);">Week date ranges (From/To) are set per semester on the <a href="settings.html" style="color:var(--maroon);">Settings</a> page.</p>` : ""}
      </div>
    </div>

    ${admin && missingCount > 0 ? `
      <div class="panel" style="border-color:var(--brass);">
        <div class="panel__body" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <span>${missingCount} section(s) aren't in Portion Coverage data yet.</span>
          <button class="btn btn--primary btn--sm" id="seedPcBtn" type="button">Seed / resync Portion Coverage data</button>
        </div>
      </div>` : ""}

    <div class="topbar__nav" style="background:transparent;padding:0;margin-bottom:16px;display:flex;gap:6px;flex-wrap:wrap;">
      ${PROGRAMME_TABS.map((t, i) => `<button type="button" class="pc-programme-tab btn btn--outline btn--sm ${i === 0 ? "active" : ""}" data-programme="${t}" style="${i === 0 ? "border-color:var(--maroon);" : ""}">${t} (${counts[t]})</button>`).join("")}
    </div>

    <div id="pcDashboard"></div>

    <div class="filter-bar">
      <input type="search" id="pcSearch" placeholder="Search course, code, section, or faculty" />
      <label class="toggle-chip">
        <input type="checkbox" id="pcMine" />
        My sections only
      </label>
      <label class="toggle-chip">
        <input type="checkbox" id="pcBehind" />
        Behind schedule only
      </label>
    </div>
    <div id="pcList"></div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

main();
