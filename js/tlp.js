import { requireAuth, isAdmin } from "./auth.js";
import { loadCourseData, flattenSections } from "./data.js";
import { fetchAllTlp, saveTlpEntry, seedTlpEntries, getFacultyLink, fetchTlpOptions, fetchAllCie } from "./store.js";
import { loadTlpReference, mergeTlpOptions, emptyTlpDoc, computeTlpStatus, PROGRAMME_TABS } from "./tlp-data.js";
import { renderSharedTopbar } from "./topbar.js";

async function main() {
  const user = await requireAuth();
  if (!user) return;

  const admin = isAdmin(user.email);

  const [courseData, tlpDocsRaw, refBase, extras, link, cieDocsRaw] = await Promise.all([
    loadCourseData(), fetchAllTlp(), loadTlpReference(), fetchTlpOptions(), getFacultyLink(user.uid), fetchAllCie(),
  ]);
  const ref = mergeTlpOptions(refBase, extras);
  const tlpDocs = { ...tlpDocsRaw };
  const cieDocs = { ...cieDocsRaw };
  const sectionRows = flattenSections(courseData);
  const myName = link ? link.name : null;
  const minPedagogy = ref.minPedagogyTypes || 3;

  const missingCount = sectionRows.filter((s) => !tlpDocs[s.id]).length;

  renderSharedTopbar(user, { onRefresh: refreshData });

  document.getElementById("loadingVeil").remove();
  document.getElementById("appRoot").innerHTML = shellHtml(sectionRows, admin, missingCount);
  wireProgrammeTabs();
  wireFilterBar();

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
      // Already present (maybe just unchecked) — check it instead of duplicating.
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
  }

  async function refreshData() {
    const [fresh, freshCie] = await Promise.all([fetchAllTlp(), fetchAllCie()]);
    for (const k of Object.keys(tlpDocs)) delete tlpDocs[k];
    Object.assign(tlpDocs, fresh);
    for (const k of Object.keys(cieDocs)) delete cieDocs[k];
    Object.assign(cieDocs, freshCie);
    renderDashboard();
    renderList();
  }

  renderDashboard();
  renderList();
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

  // Read-only reference to the course-level CIE Components record for this
  // exact course (matched via the same courseKey — no data is duplicated,
  // this just shows what's already on file so the two modules don't drift
  // apart without anyone noticing).
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

function shellHtml(sectionRows, admin, missingCount) {
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

    <div class="topbar__nav" style="background:transparent;padding:0;margin-bottom:16px;display:flex;gap:6px;flex-wrap:wrap;">
      ${PROGRAMME_TABS.map((t, i) => `<button type="button" class="tlp-programme-tab btn btn--outline btn--sm ${i === 0 ? "active" : ""}" data-programme="${t}" style="${i === 0 ? "border-color:var(--maroon);" : ""}">${t} (${counts[t]})</button>`).join("")}
    </div>

    <div id="tlpDashboard"></div>

    <div class="filter-bar">
      <input type="search" id="tlpSearch" placeholder="Search course, code, section, or faculty" />
      <label class="toggle-chip">
        <input type="checkbox" id="tlpMine" />
        My sections only
      </label>
      <label class="toggle-chip">
        <input type="checkbox" id="tlpIncomplete" />
        Incomplete only
      </label>
    </div>
    <div id="tlpList"></div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

main();
