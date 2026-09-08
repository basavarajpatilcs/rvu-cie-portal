// ============================================================
// Admin-only tools for the CIE Components page:
//   - Course ↔ Faculty (lead) mapping, editable per row + CSV bulk upload
//   - Faculty directory CSV upload (name ↔ email)
//   - CSV templates (per tab) + bulk marks-upload
//   (Programme coordinator mapping lives on the Settings page.)
// ============================================================

import { programmeGroupForTab } from "./cie-data.js";
import {
  setCieCourseMapping, upsertFacultyDirectory, saveCieComponent, backfillProgrammeGroups,
} from "./store.js";
import { parseCsv, downloadCsv, csvEscape } from "./cie-reports.js";

export function renderAdminTools(root, ctx) {
  root.innerHTML = `
    <div class="panel">
      <div class="panel__head"><h2>Course &harr; Faculty Mapping</h2>
        <span style="font-size:12px;color:var(--ink-soft);">Reassign course lead / faculty email, one at a time or via CSV.</span>
      </div>
      <div class="panel__body">
        <div class="filter-bar" style="margin-bottom:12px;">
          <input type="search" id="mapSearch" placeholder="Search course, code, or lead" />
          <label class="btn btn--outline btn--sm" style="cursor:pointer;">
            Upload mapping CSV
            <input type="file" accept=".csv" id="mapCsvInput" style="display:none;" />
          </label>
          <button class="btn btn--outline btn--sm" id="mapTemplateBtn" type="button">Download mapping template</button>
        </div>
        <div id="mapStatus" style="font-size:12.5px;color:var(--ink-soft);margin-bottom:8px;"></div>
        <div style="overflow-x:auto;">
          <table class="data-table" id="mapTable"></table>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>Programme &harr; Coordinator Permissions</h2>
        <button class="btn btn--outline btn--sm" id="backfillBtn" type="button">Repair programme tags on existing courses</button>
      </div>
      <div class="panel__body">
        <p style="font-size:13px;color:var(--ink-soft);margin:0 0 8px;">
          Coordinator <strong>assignment</strong> (who coordinates BTech/BCA/BSc/MTech/Minors/UE) now lives on the
          <a href="settings.html" style="color:var(--maroon);">Settings</a> page. Use the button here only if a course
          added or seeded before that page existed isn't respecting its coordinator's edit permissions yet.
        </p>
        <div id="backfillStatus" style="font-size:12px;color:var(--ink-soft);"></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>CSV Templates &amp; Bulk Upload</h2>
        <span style="font-size:12px;color:var(--ink-soft);">One template per programme/semester tab — fill in CIE-1/2/3 offline, then upload.</span>
      </div>
      <div class="panel__body">
        <div id="tabTemplateLinks" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;"></div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <label class="btn btn--primary btn--sm" style="cursor:pointer;">
            Upload filled CIE marks CSV
            <input type="file" accept=".csv" id="marksCsvInput" style="display:none;" />
          </label>
          <label class="btn btn--outline btn--sm" style="cursor:pointer;">
            Upload faculty directory CSV (name,email)
            <input type="file" accept=".csv" id="facultyCsvInput" style="display:none;" />
          </label>
          <button class="btn btn--outline btn--sm" id="facultyTemplateBtn" type="button">Download faculty directory template</button>
        </div>
        <div id="bulkStatus" style="font-size:12.5px;color:var(--ink-soft);margin-top:8px;"></div>
      </div>
    </div>
  `;

  renderMapTable(root, ctx, "");
  root.querySelector("#mapSearch").addEventListener("input", (e) => renderMapTable(root, ctx, e.target.value.trim().toLowerCase()));
  root.querySelector("#mapTemplateBtn").addEventListener("click", () => downloadCsv("cie-course-mapping-template.csv", mappingTemplateCsv(ctx.courses)));
  root.querySelector("#mapCsvInput").addEventListener("change", (e) => handleMappingCsv(e, root, ctx));

  root.querySelector("#backfillBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const status = root.querySelector("#backfillStatus");
    btn.disabled = true;
    status.textContent = "Repairing\u2026";
    try {
      const n = await backfillProgrammeGroups(ctx.user);
      status.textContent = `Done \u2014 ${n} course(s) tagged with their programme group. Coordinator permissions now apply to them.`;
    } catch (err) {
      console.error(err);
      status.textContent = "Failed \u2014 check console.";
    } finally {
      btn.disabled = false;
    }
  });

  renderTabTemplateLinks(root, ctx);
  root.querySelector("#marksCsvInput").addEventListener("change", (e) => handleMarksCsv(e, root, ctx));
  root.querySelector("#facultyCsvInput").addEventListener("change", (e) => handleFacultyCsv(e, root, ctx));
  root.querySelector("#facultyTemplateBtn").addEventListener("click", () => downloadCsv("faculty-directory-template.csv", "name,email\r\nDr.Jane Doe,jane.doe@rvu.edu.in\r\n"));
}

// ---------- Course ↔ Faculty mapping table ----------

function renderMapTable(root, ctx, search) {
  const tbl = root.querySelector("#mapTable");
  const rows = ctx.courses.filter((c) => {
    if (!search) return true;
    return `${c.code} ${c.name} ${c.lead || ""}`.toLowerCase().includes(search);
  });

  tbl.innerHTML = `
    <thead><tr><th>Tab</th><th>Code</th><th>Course</th><th>Lead</th><th>Lead Email</th><th></th></tr></thead>
    <tbody>
      ${rows.slice(0, 300).map((c) => {
        const doc = ctx.cieDocs[c.id];
        const lead = (doc && doc.lead) ?? c.lead ?? "";
        const email = (doc && doc.leadEmail) || "";
        return `
        <tr data-id="${c.id}">
          <td>${escapeHtml(c.tab)}</td>
          <td class="mono">${escapeHtml(c.code)}</td>
          <td>${escapeHtml(c.name)}</td>
          <td><input type="text" class="map-lead" value="${escapeAttr(lead)}" list="facultyNamesDatalist" style="width:170px;padding:5px 7px;border:1px solid var(--line);border-radius:4px;" /></td>
          <td><input type="email" class="map-email" value="${escapeAttr(email)}" placeholder="name@rvu.edu.in" style="width:190px;padding:5px 7px;border:1px solid var(--line);border-radius:4px;" /></td>
          <td><button type="button" class="btn btn--outline btn--sm map-save-btn">Save</button></td>
        </tr>`;
      }).join("")}
    </tbody>
    <datalist id="facultyNamesDatalist">
      ${Object.values(ctx.facultyDirectory).map((f) => `<option value="${escapeAttr(f.name)}"></option>`).join("")}
    </datalist>
  `;
  if (rows.length > 300) {
    tbl.insertAdjacentHTML("beforeend", "");
    root.querySelector("#mapStatus").textContent = `Showing first 300 of ${rows.length} matching courses — narrow your search to see more.`;
  } else {
    root.querySelector("#mapStatus").textContent = `${rows.length} course(s).`;
  }

  tbl.querySelectorAll(".map-save-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tr = btn.closest("tr");
      const id = tr.dataset.id;
      const lead = tr.querySelector(".map-lead").value.trim();
      const leadEmail = tr.querySelector(".map-email").value.trim();
      btn.disabled = true;
      btn.textContent = "Saving\u2026";
      try {
        await setCieCourseMapping(id, { lead, leadEmail }, ctx.user);
        if (lead && leadEmail) await upsertFacultyDirectory([{ name: lead, email: leadEmail }], ctx.user);
        ctx.cieDocs[id] = { ...(ctx.cieDocs[id] || {}), lead: lead || null, leadEmail: leadEmail || null };
        btn.textContent = "Saved \u2713";
        setTimeout(() => { btn.textContent = "Save"; btn.disabled = false; }, 1000);
      } catch (err) {
        console.error(err);
        alert("Could not save mapping. Check your connection and try again.");
        btn.disabled = false;
        btn.textContent = "Save";
      }
    });
  });
}

function mappingTemplateCsv(courses) {
  const header = ["Tab", "Code", "Name", "CurrentLead", "NewLeadName", "NewLeadEmail"];
  const lines = [header.map(csvEscape).join(",")];
  for (const c of courses) {
    lines.push([c.tab, c.code, c.name, c.lead || "", "", ""].map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

async function handleMappingCsv(e, root, ctx) {
  const file = e.target.files[0];
  if (!file) return;
  const status = root.querySelector("#mapStatus");
  status.textContent = "Reading CSV\u2026";
  const text = await file.text();
  const records = parseCsv(text);
  const byKey = new Map(ctx.courses.map((c) => [`${c.tab}||${c.code}`, c]));
  let updated = 0, skipped = 0;
  for (const r of records) {
    const key = `${r.Tab}||${r.Code}`;
    const course = byKey.get(key);
    if (!course || !r.NewLeadName) { skipped++; continue; }
    try {
      await setCieCourseMapping(course.id, { lead: r.NewLeadName, leadEmail: r.NewLeadEmail }, ctx.user);
      await upsertFacultyDirectory([{ name: r.NewLeadName, email: r.NewLeadEmail }], ctx.user);
      ctx.cieDocs[course.id] = { ...(ctx.cieDocs[course.id] || {}), lead: r.NewLeadName, leadEmail: r.NewLeadEmail || null };
      updated++;
    } catch (err) {
      console.error(err);
      skipped++;
    }
  }
  status.textContent = `Mapping CSV processed: ${updated} updated, ${skipped} skipped (blank NewLeadName, or course not found — check Tab/Code match exactly).`;
  renderMapTable(root, ctx, root.querySelector("#mapSearch").value.trim().toLowerCase());
  e.target.value = "";
}

// ---------- CSV templates + bulk marks upload ----------

const MARKS_HEADER = [
  "Tab", "Code", "Name",
  "c1a_method", "c1a_marks", "c1a_date", "c1b_method", "c1b_marks", "c1b_date", "c1c_method", "c1c_marks", "c1c_date",
  "c2_marks", "c2_qp", "c2_scrutiny", "c2_key",
  "c3a_method", "c3a_marks", "c3a_date", "c3b_method", "c3b_marks", "c3b_date", "c3c_method", "c3c_marks", "c3c_date",
  "Remarks",
];

function renderTabTemplateLinks(root, ctx) {
  const el = root.querySelector("#tabTemplateLinks");
  const tabs = [...new Set(ctx.courses.map((c) => c.tab))];
  el.innerHTML = tabs.map((t) =>
    `<button type="button" class="btn btn--outline btn--sm tab-template-btn" data-tab="${escapeAttr(t)}">${escapeHtml(t)} template</button>`
  ).join("") + `<button type="button" class="btn btn--outline btn--sm" id="allTemplateBtn">All tabs template</button>`;

  el.querySelectorAll(".tab-template-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      const rows = ctx.courses.filter((c) => c.tab === tab);
      downloadCsv(`cie-marks-template-${slugify(tab)}.csv`, marksTemplateCsv(rows));
    });
  });
  el.querySelector("#allTemplateBtn").addEventListener("click", () => {
    downloadCsv("cie-marks-template-all.csv", marksTemplateCsv(ctx.courses));
  });
}

function marksTemplateCsv(courses) {
  const lines = [MARKS_HEADER.map(csvEscape).join(",")];
  for (const c of courses) {
    lines.push([c.tab, c.code, c.name, ...Array(22).fill(""), ""].map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

async function handleMarksCsv(e, root, ctx) {
  const file = e.target.files[0];
  if (!file) return;
  const status = root.querySelector("#bulkStatus");
  status.textContent = "Reading CSV\u2026";
  const text = await file.text();
  const records = parseCsv(text);
  const byKey = new Map(ctx.courses.map((c) => [`${c.tab}||${c.code}`, c]));
  let updated = 0, skipped = 0;
  for (const r of records) {
    const course = byKey.get(`${r.Tab}||${r.Code}`);
    if (!course) { skipped++; continue; }
    const patch = {
      cie1: {
        a: { method: r.c1a_method || "", marks: r.c1a_marks || null, date: r.c1a_date || null },
        b: { method: r.c1b_method || "", marks: r.c1b_marks || null, date: r.c1b_date || null },
        c: { method: r.c1c_method || "", marks: r.c1c_marks || null, date: r.c1c_date || null },
      },
      cie2: {
        marks: r.c2_marks || null, qpDate: r.c2_qp || null, scrutinyDate: r.c2_scrutiny || null, keyDate: r.c2_key || null,
      },
      cie3: {
        a: { method: r.c3a_method || "", marks: r.c3a_marks || null, date: r.c3a_date || null },
        b: { method: r.c3b_method || "", marks: r.c3b_marks || null, date: r.c3b_date || null },
        c: { method: r.c3c_method || "", marks: r.c3c_marks || null, date: r.c3c_date || null },
      },
      remarks: r.Remarks || "",
    };
    try {
      await saveCieComponent(course.id, patch, ctx.user);
      ctx.cieDocs[course.id] = { ...(ctx.cieDocs[course.id] || {}), ...patch };
      updated++;
    } catch (err) {
      console.error(err);
      skipped++;
    }
  }
  status.textContent = `Marks CSV processed: ${updated} updated, ${skipped} skipped (course not found, or row is blank — check Tab/Code match your template exactly).`;
  e.target.value = "";
  if (ctx.onDataChanged) ctx.onDataChanged();
}

async function handleFacultyCsv(e, root, ctx) {
  const file = e.target.files[0];
  if (!file) return;
  const status = root.querySelector("#bulkStatus");
  status.textContent = "Reading CSV\u2026";
  const text = await file.text();
  const records = parseCsv(text).filter((r) => r.name);
  try {
    const n = await upsertFacultyDirectory(records.map((r) => ({ name: r.name, email: r.email })), ctx.user);
    for (const r of records) ctx.facultyDirectory[slugify(r.name)] = { name: r.name, email: r.email };
    status.textContent = `Faculty directory CSV processed: ${n} entries upserted.`;
  } catch (err) {
    console.error(err);
    status.textContent = "Could not process faculty directory CSV. Check console for details.";
  }
  e.target.value = "";
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
