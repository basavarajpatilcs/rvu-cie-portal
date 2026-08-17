import { requireAuth, signOutUser, isAdmin, initials } from "./auth.js";
import { loadCourseData, flattenSections, flattenCourses, uniqueFacultyNames } from "./data.js";
import {
  fetchAllSections, fetchAllQp, setSectionStage, setQpStatus,
  getFacultyLink, setFacultyLink, COMPLETED, NOT_COMPLETED,
} from "./store.js";

const SKIP_KEY = "rvu_skip_name_pick";

async function main() {
  const user = await requireAuth();
  if (!user) return;

  renderTopbar(user);

  const [courseData, sectionDocs, qpDocs, link] = await Promise.all([
    loadCourseData(),
    fetchAllSections(),
    fetchAllQp(),
    getFacultyLink(user.uid),
  ]);

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

  function renderApp() {
    document.getElementById("appRoot").innerHTML = appShellHtml(myName);
    wireFilterBar(myName);
    renderBanner(myName);
    renderList();
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

    const bySections = new Map(sectionDocs);
    const byQp = new Map(qpDocs);

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

function appShellHtml(myName) {
  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">Faculty Dashboard</span>
        <h1>CIE Marks-Entry Status</h1>
        <p>Mark each section's status once marks are entered and verified. Course leads also confirm CIE-2 question paper + answer key submission below each course.</p>
      </div>
    </div>
    <div id="nameBanner" style="font-size:13px;color:var(--ink-soft);margin-bottom:16px;"></div>
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
  `;
}

main();
