import { requireAuth, isEffectiveAdmin } from "./auth.js";
import { loadCourseData, flattenSections } from "./data.js";
import {
  fetchAllTlp, saveTlpEntry, seedTlpEntries, getFacultyLink, fetchTlpOptions, fetchAllCie,
  fetchAllFacultyReports, addFacultyReport, removeFacultyReport,
} from "./store.js";
import { loadTlpReference, mergeTlpOptions, emptyTlpDoc, computeTlpStatus, PROGRAMME_TABS } from "./tlp-data.js";
import { renderSharedTopbar } from "./topbar.js";

async function main() {
  const user = await requireAuth();
  if (!user) return;

  const admin = await isEffectiveAdmin(user.email);

  const [courseData, tlpDocsRaw, refBase, extras, link, cieDocsRaw, reportDocsRaw] = await Promise.all([
    loadCourseData(), fetchAllTlp(), loadTlpReference(), fetchTlpOptions(), getFacultyLink(user.uid), fetchAllCie(), fetchAllFacultyReports(),
  ]);
  const ref = mergeTlpOptions(refBase, extras);
  const tlpDocs = { ...tlpDocsRaw };
  const cieDocs = { ...cieDocsRaw };
  const reportDocs = { ...reportDocsRaw };
  const sectionRows = flattenSections(courseData);
  const myName = link ? link.name : null;
  const minPedagogy = ref.minPedagogyTypes || 3;

  const missingCount = sectionRows.filter((s) => !tlpDocs[s.id]).length;

  renderSharedTopbar(user, { admin, onRefresh: refreshData });

  document.getElementById("loadingVeil").remove();
  document.getElementById("appRoot").innerHTML = shellHtml(sectionRows, admin, missingCount, myName);
  wireProgrammeTabs();
  wireFilterBar();
  wireViewTabs();

  if (admin && missingCount > 0) {
    document.getElementById("seedTlpBtn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Seeding\u2026";
      try {
        const n = await seedTlpEntries(sectionRows, emptyTlpDoc, (done, total) => {
          btn.textContent = `Seeding\u2026 ${done}/${total}`;
        });
        alert(`Seeded ${n} TLP row(s). Reloading\u2026`);
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert("Seeding failed. Check console for details.");
        btn.disabled = false;
        btn.textContent = "Seed / resync TLP data";
      }
    });
  }

  let activeProgramme = "BTech";

  function docFor(section) {
    return tlpDocs[section.id] || null;
  }

  function canEdit(section) {
    if (admin) return true;
    if (!myName) return false;
    return section.faculty === myName || section.lead === myName;
  }

  function currentFilters() {
    return {
      search: document.getElementById("tlpSearch").value.trim().toLowerCase(),
      mineOnly: myName ? document.getElementById("tlpMine").checked : false,
      incompleteOnly: document.getElementById("tlpIncomplete").checked,
    };
  }

  function renderDashboard() {
    const rows = sectionRows.filter((s) => s.programme === activeProgramme);
    let total = 0, completed = 0, inProgress = 0;
    for (const s of rows) {
      total++;
      const calc = computeTlpStatus(docFor(s) || emptyTlpDoc(s), minPedagogy);
      if (calc.status === "Completed") completed++;
      else if (calc.status === "In Progress") inProgress++;
    }
    document.getElementById("tlpDashboard").innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">${activeProgramme} Sections</div><div class="value">${total}</div></div>
        <div class="kpi"><div class="label">Completed</div><div class="value">${completed}</div></div>
        <div class="kpi"><div class="label">In Progress</div><div class="value">${inProgress}</div></div>
        <div class="kpi"><div class="label">Not Started</div><div class="value">${total - completed - inProgress}</div></div>
      </div>`;
  }

  function renderList() {
    const { search, mineOnly, incompleteOnly } = currentFilters();
    const rows = sectionRows.filter((s) => s.programme === activeProgramme);

    const grouped = new Map();
    for (const s of rows) {
      if (mineOnly && !(s.faculty === myName || s.lead === myName)) continue;
      if (search) {
        const hay = `${s.code} ${s.name} ${s.faculty || ""} ${s.section}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }
      const doc = docFor(s);
      const calc = computeTlpStatus(doc || emptyTlpDoc(s), minPedagogy);
      if (incompleteOnly && calc.status === "Completed") continue;

      const key = s.tab;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ section: s, doc, calc });
    }

    const listEl = document.getElementById("tlpList");
    if (grouped.size === 0) {
      listEl.innerHTML = `<div class="empty-state"><h3>No matching sections</h3><p>Try a different filter, or clear the search box.</p></div>`;
      return;
    }

    let html = "";
    for (const [tabName, items] of grouped) {
      html += `<div class="eyebrow" style="margin: 22px 0 10px;">${escapeHtml(tabName)}</div>`;
      for (const item of items) html += tlpCardHtml(item, canEdit(item.section), ref, minPedagogy, cieDocs[`cie__${item.section.courseKey}`]);
    }
    listEl.innerHTML = html;

    listEl.querySelectorAll("[data-recalc]").forEach((el) => {
      el.addEventListener("change", () => recalcCard(el.closest(".cie-card")));
      el.addEventListener("input", () => recalcCard(el.closest(".cie-card")));
    });
    listEl.querySelectorAll(".tlp-save-btn").forEach((btn) => {
      btn.addEventListener("click", () => onSave(btn));
    });
    listEl.querySelectorAll(".tlp-add-custom-btn").forEach((btn) => {
      btn.addEventListener("click", () => onAddCustomPedagogy(btn));
    });
  }

  function onAddCustomPedagogy(btn) {
    const card = btn.closest(".cie-card");
    const input = card.querySelector(".tlp-custom-input");
    const name = input.value.trim();
    if (!name) return;
    const grid = card.querySelector(".tlp-pedagogy-grid");
    const exists = [...grid.querySelectorAll(".tlp-pedagogy-check")].some((c) => c.value.toLowerCase() === name.toLowerCase());
    if (exists) {
      const cb = [...grid.querySelectorAll(".tlp-pedagogy-check")].find((c) => c.value.toLowerCase() === name.toLowerCase());
      cb.checked = true;
    } else {
      const label = document.createElement("label");
      label.style.cssText = "display:flex;align-items:center;gap:6px;font-size:13px;";
      label.innerHTML = `<input type="checkbox" class="tlp-pedagogy-check" data-recalc value="${escapeAttr(name)}" checked /> ${escapeHtml(name)} <small style="color:var(--ink-soft);">(custom)</small>`;
      grid.appendChild(label);
      label.querySelector("input").addEventListener("change", () => recalcCard(card));
    }
    input.value = "";
    recalcCard(card);
  }

  function readDraft(card) {
    const checked = [...card.querySelectorAll(".tlp-pedagogy-check:checked")].map((c) => c.value);
    const g = (name) => card.querySelector(`[name="${name}"]`);
    const val = (name) => (g(name) ? g(name).value : "");
    return {
      pedagogyTypes: checked,
      ictTools: val("ictTools"),
      cie1: { pedagogyType: val("cie1_type"), assessmentStyle: val("cie1_style") },
      cie3: { pedagogyType: val("cie3_type"), assessmentStyle: val("cie3_style") },
    };
  }

  function recalcCard(card) {
    const draft = readDraft(card);
    const calc = computeTlpStatus(draft, minPedagogy);
    card.querySelector(".tlp-live-summary").outerHTML = tlpSummaryHtml(calc, minPedagogy);
    const saveBtn = card.querySelector(".tlp-save-btn");
    if (saveBtn) {
      saveBtn.disabled = draft.pedagogyTypes.length < minPedagogy;
      saveBtn.title = draft.pedagogyTypes.length < minPedagogy
        ? `Select at least ${minPedagogy} teaching pedagogy types before saving`
        : "";
    }
  }

  async function onSave(btn) {
    const card = btn.closest(".cie-card");
    const id = card.dataset.id;
    const draft = readDraft(card);
    if (draft.pedagogyTypes.length < minPedagogy) {
      alert(`Please select at least ${minPedagogy} teaching pedagogy types before saving.`);
      return;
    }
    btn.disabled = true;
    btn.textContent = "Saving\u2026";
    try {
      await saveTlpEntry(id, draft, user);
      tlpDocs[id] = { ...(tlpDocs[id] || {}), ...draft };
      btn.textContent = "Saved \u2713";
      renderDashboard();
      setTimeout(() => { btn.textContent = "Save changes"; btn.disabled = false; }, 1200);
    } catch (err) {
      console.error(err);
      alert("Could not save. If this section was added recently, ask a coordinator to resync TLP data, then try again.");
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
  }

  function wireProgrammeTabs() {
    const tabs = document.querySelectorAll(".tlp-programme-tab");
    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        tabs.forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        activeProgramme = t.dataset.programme;
        renderDashboard();
        renderList();
        renderReportsDashboard();
        renderReportsList();
      });
    });
  }

  function wireFilterBar() {
    ["tlpSearch", "tlpMine", "tlpIncomplete"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", renderList);
      el.addEventListener("change", renderList);
    });
    ["tlpReportsSearch", "tlpReportsMine", "tlpReportsZero"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", renderReportsList);
      el.addEventListener("change", renderReportsList);
    });
  }

  function wireViewTabs() {
    const tabs = document.querySelectorAll(".tlp-view-tab");
    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        tabs.forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        document.querySelectorAll(".tlp-view-panel").forEach((p) => (p.style.display = "none"));
        document.getElementById(`tlp-view-${t.dataset.view}`).style.display = "block";
        if (t.dataset.view === "reports") {
          renderReportsDashboard();
          renderReportsList();
        }
      });
    });
  }

  // ---------- Report Submissions: dashboard + per-section links ----------

  function reportsDocFor(section) {
    return reportDocs[section.id] || null;
  }

  function reportsFilters() {
    return {
      search: document.getElementById("tlpReportsSearch").value.trim().toLowerCase(),
      mineOnly: myName ? document.getElementById("tlpReportsMine").checked : false,
      zeroOnly: document.getElementById("tlpReportsZero").checked,
    };
  }

  function renderReportsDashboard() {
    const rows = sectionRows.filter((s) => s.programme === activeProgramme);
    let totalSections = 0, sectionsWithReports = 0, totalReports = 0;
    for (const s of rows) {
      totalSections++;
      const n = (reportsDocFor(s)?.reports || []).length;
      if (n > 0) sectionsWithReports++;
      totalReports += n;
    }
    const el = document.getElementById("tlpReportsDashboard");
    if (!el) return;
    el.innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">${activeProgramme} Sections</div><div class="value">${totalSections}</div></div>
        <div class="kpi"><div class="label">Sections with &ge;1 Report</div><div class="value">${sectionsWithReports}</div></div>
        <div class="kpi"><div class="label">Sections with 0 Reports</div><div class="value">${totalSections - sectionsWithReports}</div></div>
        <div class="kpi"><div class="label">Total Reports Submitted</div><div class="value">${totalReports}</div></div>
      </div>`;
  }

  function renderReportsList() {
    const { search, mineOnly, zeroOnly } = reportsFilters();
    const rows = sectionRows.filter((s) => s.programme === activeProgramme);

    const grouped = new Map();
    for (const s of rows) {
      if (mineOnly && !(s.faculty === myName || s.lead === myName)) continue;
      if (search) {
        const hay = `${s.code} ${s.name} ${s.faculty || ""} ${s.section}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }
      const doc = reportsDocFor(s);
      const reports = doc?.reports || [];
      if (zeroOnly && reports.length > 0) continue;

      const key = s.tab;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ section: s, reports });
    }

    const listEl = document.getElementById("tlpReportsList");
    if (!listEl) return;
    if (grouped.size === 0) {
      listEl.innerHTML = `<div class="empty-state"><h3>No matching sections</h3><p>Try a different filter, or clear the search box.</p></div>`;
      return;
    }

    let html = "";
    for (const [tabName, items] of grouped) {
      html += `<div class="eyebrow" style="margin: 22px 0 10px;">${escapeHtml(tabName)}</div>`;
      for (const item of items) html += reportsCardHtml(item, canEdit(item.section));
    }
    listEl.innerHTML = html;

    listEl.querySelectorAll(".tlp-report-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => onAddReport(btn));
    });
    listEl.querySelectorAll(".tlp-report-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => onRemoveReport(btn));
    });
  }

  async function onAddReport(btn) {
    const card = btn.closest(".cie-card");
    const id = card.dataset.id;
    const section = sectionRows.find((s) => s.id === id);
    const titleInput = card.querySelector(".tlp-report-title");
    const urlInput = card.querySelector(".tlp-report-url");
    const title = titleInput.value.trim();
    const url = urlInput.value.trim();

    if (!title || !url) {
      alert("Please provide both a title and a link before adding.");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      alert("The link should start with http:// or https:// — paste your Google Drive (or other) share link directly.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Adding\u2026";
    try {
      const reportId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const sectionFacts = {
        courseKey: section.courseKey, tab: section.tab, programme: section.programme,
        semester: section.semester, code: section.code, name: section.name,
        section: section.section, faculty: section.faculty,
      };
      await addFacultyReport(id, sectionFacts, { id: reportId, title, url }, user);
      const existing = reportDocs[id] || { reports: [] };
      reportDocs[id] = { ...existing, reports: [...(existing.reports || []), { id: reportId, title, url, addedBy: user.email, addedAt: new Date().toISOString() }] };
      titleInput.value = "";
      urlInput.value = "";
      renderReportsDashboard();
      renderReportsList();
    } catch (err) {
      console.error(err);
      alert("Could not add the report link. Check your connection and try again.");
    } finally {
      btn.disabled = false;
      btn.textContent = "+ Add Report";
    }
  }

  async function onRemoveReport(btn) {
    const card = btn.closest(".cie-card");
    const id = card.dataset.id;
    const reportId = btn.dataset.reportId;
    if (!confirm("Remove this report link?")) return;
    btn.disabled = true;
    try {
      await removeFacultyReport(id, reportId, user);
      if (reportDocs[id]) {
        reportDocs[id] = { ...reportDocs[id], reports: (reportDocs[id].reports || []).filter((r) => r.id !== reportId) };
      }
      renderReportsDashboard();
      renderReportsList();
    } catch (err) {
      console.error(err);
      alert("Could not remove the report link. Check your connection and try again.");
      btn.disabled = false;
    }
  }

  async function refreshData() {
    const [fresh, freshCie, freshReports] = await Promise.all([fetchAllTlp(), fetchAllCie(), fetchAllFacultyReports()]);
    for (const k of Object.keys(tlpDocs)) delete tlpDocs[k];
    Object.assign(tlpDocs, fresh);
    for (const k of Object.keys(cieDocs)) delete cieDocs[k];
    Object.assign(cieDocs, freshCie);
    for (const k of Object.keys(reportDocs)) delete reportDocs[k];
    Object.assign(reportDocs, freshReports);
    renderDashboard();
    renderList();
    renderReportsDashboard();
    renderReportsList();
  }

  renderDashboard();
  renderList();
  renderReportsDashboard();
  renderReportsList();
}

function tlpSummaryHtml(calc, minPedagogy) {
  return `
    <div class="cie-summary tlp-live-summary">
      <div class="stat ${calc.meetsMin ? "" : "over"}"><div class="n">${calc.pedagogyCount}/${minPedagogy}+</div><div class="l">Pedagogy Types</div></div>
      <div class="stat ${calc.cie1Done ? "" : "over"}"><div class="n">${calc.cie1Done ? "\u2713" : "\u2014"}</div><div class="l">CIE-1 Set</div></div>
      <div class="stat ${calc.cie3Done ? "" : "over"}"><div class="n">${calc.cie3Done ? "\u2713" : "\u2014"}</div><div class="l">CIE-3 Set</div></div>
      <div class="stat"><div class="n" style="font-size:11px;">${calc.status}</div><div class="l">Status</div></div>
    </div>`;
}

function statusBadgeHtml(calc) {
  if (calc.status === "Completed") return `<span class="cie-badge cie-badge--ok">Completed</span>`;
  if (calc.status === "In Progress") return `<span class="cie-badge cie-badge--progress">In Progress</span>`;
  return `<span class="cie-badge cie-badge--progress">Not Started</span>`;
}

function tlpCardHtml(item, editable, ref, minPedagogy, cieDoc) {
  const { section, doc } = item;
  const d = doc || emptyTlpDoc(section);
  const calc = item.calc;
  const selected = new Set(d.pedagogyTypes || []);

  const assessmentOptions = (selectedVal) => ref.assessmentMethods
    .map((m) => `<option value="${escapeAttr(m.name)}" ${selectedVal === m.name ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
    .join("");

  const cieRefChip = (label, methodValue) => methodValue
    ? `<span style="display:inline-block;background:var(--paper);border:1px solid var(--line);border-radius:5px;padding:3px 8px;font-size:11.5px;color:var(--ink-soft);margin-right:6px;">${label}: <strong style="color:var(--ink);">${escapeHtml(methodValue)}</strong></span>`
    : "";
  const cieMethodsFor = (stage) => {
    const opts = cieDoc?.[stage];
    if (!opts) return "";
    return ["a", "b", "c"].map((k) => opts[k]?.method).filter(Boolean).join(", ");
  };
  const cieContextHtml = cieDoc
    ? `<div style="margin-bottom:8px;">
         ${cieRefChip("CIE-1 Evaluation Method (CIE Components)", cieMethodsFor("cie1"))}
         ${cieRefChip("CIE-3 Evaluation Method (CIE Components)", cieMethodsFor("cie3"))}
       </div>`
    : `<p style="font-size:11.5px;color:var(--ink-soft);margin:0 0 8px;">No CIE Components record found yet for this course &mdash; nothing to cross-check against.</p>`;

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
        ${tlpSummaryHtml(calc, minPedagogy)}

        <div class="cie-block" style="margin-top:14px;">
          <div class="cie-block__head"><span class="cie-block__title">General Teaching Pedagogy &nbsp;<small style="font-weight:400;color:var(--ink-soft);">select at least ${minPedagogy}</small></span></div>
          <div class="tlp-pedagogy-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px 14px;">
            ${ref.pedagogyTypes.map((p) => `
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;">
                <input type="checkbox" class="tlp-pedagogy-check" data-recalc value="${escapeAttr(p.name)}" ${selected.has(p.name) ? "checked" : ""} ${editable ? "" : "disabled"} />
                ${escapeHtml(p.name)}
              </label>`).join("")}
            ${[...selected].filter((name) => !ref.pedagogyTypes.some((p) => p.name === name)).map((name) => `
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;">
                <input type="checkbox" class="tlp-pedagogy-check" data-recalc value="${escapeAttr(name)}" checked ${editable ? "" : "disabled"} />
                ${escapeHtml(name)} <small style="color:var(--ink-soft);">(custom)</small>
              </label>`).join("")}
          </div>
          ${editable ? `
            <div style="display:flex;gap:6px;margin-top:10px;">
              <input type="text" class="tlp-custom-input" placeholder="Not listed? Type a pedagogy type and add it" style="flex:1;padding:6px 9px;border:1px solid var(--line);border-radius:5px;font-size:13px;" />
              <button type="button" class="btn btn--outline btn--sm tlp-add-custom-btn">+ Add</button>
            </div>` : ""}
        </div>

        <div class="cie-block">
          <div class="cie-block__head"><span class="cie-block__title">ICT Tools Used</span></div>
          <input type="text" name="ictTools" data-recalc value="${escapeAttr(d.ictTools || "")}" placeholder="e.g. PPT, online compiler, Google Classroom" style="width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:5px;font-size:13px;" ${editable ? "" : "disabled"} />
        </div>

        <div class="cie-block">
          <div class="cie-block__head"><span class="cie-block__title">CIE-1: Section-Level Teaching &amp; Assessment</span></div>
          <p style="font-size:11px;color:var(--ink-soft);margin:0 0 8px;">This is separate from CIE Components' course-wide "Evaluation Method" (which drives marks caps) &mdash; it records how <em>this specific section</em> taught and assessed CIE-1.</p>
          ${cieContextHtml}
          <div class="cie-single-row" style="grid-template-columns:1fr 1fr;">
            <div><label>Teaching/Delivery Method</label><select name="cie1_type" data-recalc ${editable ? "" : "disabled"}><option value="">&mdash;</option>${assessmentOptions(d.cie1?.pedagogyType)}</select></div>
            <div><label>In-Class Assessment Style</label><select name="cie1_style" data-recalc ${editable ? "" : "disabled"}><option value="">&mdash;</option>${assessmentOptions(d.cie1?.assessmentStyle)}</select></div>
          </div>
        </div>

        <div class="cie-block">
          <div class="cie-block__head"><span class="cie-block__title">CIE-3: Section-Level Teaching &amp; Assessment</span></div>
          <p style="font-size:11px;color:var(--ink-soft);margin:0 0 8px;">Same distinction as above, for CIE-3.</p>
          <div class="cie-single-row" style="grid-template-columns:1fr 1fr;">
            <div><label>Teaching/Delivery Method</label><select name="cie3_type" data-recalc ${editable ? "" : "disabled"}><option value="">&mdash;</option>${assessmentOptions(d.cie3?.pedagogyType)}</select></div>
            <div><label>In-Class Assessment Style</label><select name="cie3_style" data-recalc ${editable ? "" : "disabled"}><option value="">&mdash;</option>${assessmentOptions(d.cie3?.assessmentStyle)}</select></div>
          </div>
        </div>

        ${!doc ? `<div class="cie-readonly-note" style="color:var(--amber);">Not yet seeded into TLP &mdash; ask a coordinator to resync from this page.</div>` : ""}
        ${editable
          ? `<div class="cie-save-row">
               <button type="button" class="btn btn--primary btn--sm tlp-save-btn" ${calc.pedagogyCount < minPedagogy ? "disabled" : ""}>Save changes</button>
               <span class="cie-save-note">Only this section's faculty or a coordinator can edit.</span>
             </div>`
          : `<div class="cie-readonly-note">Read-only &mdash; only ${section.faculty ? escapeHtml(section.faculty) : "this section's faculty"} or a coordinator can edit.</div>`
        }
      </div>
    </div>`;
}

function reportsCardHtml(item, editable) {
  const { section, reports } = item;
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
        ${reports.length > 0
          ? `<span class="cie-badge cie-badge--ok">${reports.length} report${reports.length === 1 ? "" : "s"}</span>`
          : `<span class="cie-badge cie-badge--warn">No reports yet</span>`
        }
      </div>
      <div class="cie-card__body">
        ${reports.length > 0 ? `
          <div class="cie-block" style="margin-top:0;">
            <div class="cie-block__head"><span class="cie-block__title">Submitted Reports</span></div>
            <ul style="margin:0;padding-left:0;list-style:none;">
              ${reports.map((r) => `
                <li style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px;">
                  <span>
                    <a href="${escapeAttr(r.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--maroon);font-weight:600;">${escapeHtml(r.title)}</a>
                    <span style="color:var(--ink-soft);font-size:11.5px;"> &mdash; added by ${escapeHtml(r.addedBy || "")}${r.addedAt ? `, ${new Date(r.addedAt).toLocaleDateString()}` : ""}</span>
                  </span>
                  ${editable ? `<button type="button" class="tlp-report-remove-btn btn btn--outline btn--sm" data-report-id="${escapeAttr(r.id)}" style="color:var(--red);border-color:var(--red);">Remove</button>` : ""}
                </li>`).join("")}
            </ul>
          </div>` : `<p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 10px;">No reports submitted for this section yet.</p>`}

        ${editable ? `
          <div class="cie-block">
            <div class="cie-block__head"><span class="cie-block__title">Add a Report Link</span></div>
            <div class="cie-single-row" style="grid-template-columns:1fr 2fr auto;align-items:end;">
              <div><label>Title</label><input type="text" class="tlp-report-title" placeholder="e.g. Weekly Progress Report 1" /></div>
              <div><label>Google Drive / File Link</label><input type="url" class="tlp-report-url" placeholder="https://drive.google.com/..." /></div>
              <div><button type="button" class="tlp-report-add-btn btn btn--primary btn--sm">+ Add Report</button></div>
            </div>
            <p style="font-size:11px;color:var(--ink-soft);margin:8px 0 0;">Make sure the Drive link's sharing setting allows anyone at RVU with the link to view it.</p>
          </div>`
          : `<div class="cie-readonly-note">Read-only &mdash; only ${section.faculty ? escapeHtml(section.faculty) : "this section's faculty"} or a coordinator can add report links here.</div>`
        }
      </div>
    </div>`;
}

function shellHtml(sectionRows, admin, missingCount, myName) {
  const counts = {};
  for (const t of PROGRAMME_TABS) counts[t] = sectionRows.filter((s) => s.programme === t).length;

  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">Teaching-Learning Pedagogy</span>
        <h1>TLP &mdash; Pedagogy Type &amp; Assessment Selection</h1>
        <p>Every section's faculty selects at least 3 general teaching pedagogy types, ICT tools used, and the section-level teaching/assessment style for CIE-1 and CIE-3 &mdash; across all programmes, sections, and semesters.</p>
        <p style="font-size:12.5px;color:var(--ink-soft);">This is a separate, section-level record from <a href="cie-components.html" style="color:var(--maroon);">CIE Components</a>' course-level marks &amp; evaluation-method entry. Each TLP card shows what's already on file in CIE Components for context, but the two are entered and stored independently.</p>
      </div>
    </div>

    ${admin && missingCount > 0 ? `
      <div class="panel" style="border-color:var(--brass);">
        <div class="panel__body" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <span>${missingCount} section(s) aren't in TLP data yet.</span>
          <button class="btn btn--primary btn--sm" id="seedTlpBtn" type="button">Seed / resync TLP data</button>
        </div>
      </div>` : ""}

    <div class="topbar__nav" style="background:transparent;padding:0;margin-bottom:12px;display:flex;gap:6px;">
      <button type="button" class="tlp-view-tab btn btn--outline btn--sm active" data-view="entry" style="border-color:var(--maroon);">Pedagogy Selection</button>
      <button type="button" class="tlp-view-tab btn btn--outline btn--sm" data-view="reports">Report Submissions</button>
    </div>

    <div class="topbar__nav" style="background:transparent;padding:0;margin-bottom:16px;display:flex;gap:6px;flex-wrap:wrap;">
      ${PROGRAMME_TABS.map((t, i) => `<button type="button" class="tlp-programme-tab btn btn--outline btn--sm ${i === 0 ? "active" : ""}" data-programme="${t}" style="${i === 0 ? "border-color:var(--maroon);" : ""}">${t} (${counts[t]})</button>`).join("")}
    </div>

    <div id="tlp-view-entry" class="tlp-view-panel">
      <div id="tlpDashboard"></div>

      <div class="filter-bar">
        <input type="search" id="tlpSearch" placeholder="Search course, code, section, or faculty" />
        <label class="toggle-chip">
          <input type="checkbox" id="tlpMine" ${myName && !admin ? "checked" : ""} />
          My sections only
        </label>
        <label class="toggle-chip">
          <input type="checkbox" id="tlpIncomplete" />
          Incomplete only
        </label>
      </div>
      <div id="tlpList"></div>
    </div>

    <div id="tlp-view-reports" class="tlp-view-panel" style="display:none;">
      <p style="font-size:12.5px;color:var(--ink-soft);margin:-4px 0 14px;">Each faculty can attach multiple report links per section (Google Drive or any shareable URL) &mdash; no file upload needed. The programme tabs above apply to this view too.</p>
      <div id="tlpReportsDashboard"></div>

      <div class="filter-bar">
        <input type="search" id="tlpReportsSearch" placeholder="Search course, code, section, or faculty" />
        <label class="toggle-chip">
          <input type="checkbox" id="tlpReportsMine" ${myName && !admin ? "checked" : ""} />
          My sections only
        </label>
        <label class="toggle-chip">
          <input type="checkbox" id="tlpReportsZero" />
          Missing reports only
        </label>
      </div>
      <div id="tlpReportsList"></div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

main();
