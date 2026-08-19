import { requireAuth, isAdmin } from "./auth.js";
import { loadCourseData, flattenSections, flattenCourses, PROGRAMMES } from "./data.js";
import { fetchAllSections, fetchAllQp, seedDatabase, isSeeded, COMPLETED } from "./store.js";
import { renderSharedTopbar } from "./topbar.js";

let chartRefs = {};

async function main() {
  const user = await requireAuth();
  if (!user) return;

  const admin = isAdmin(user.email);
  document.getElementById("seedPanel").style.display = admin ? "block" : "none";

  const courseData = await loadCourseData();
  const sectionRows = flattenSections(courseData);
  const courseRows = flattenCourses(courseData);

  const seeded = await isSeeded();
  document.getElementById("loadingVeil").remove();

  if (!seeded && !admin) {
    document.getElementById("appRoot").innerHTML = `
      <div class="empty-state">
        <h3>Dashboard not set up yet</h3>
        <p>Ask a coordinator to open this page once to initialise the tracker.</p>
      </div>`;
    renderSharedTopbar(user, { onRefresh: () => window.location.reload() });
    return;
  }

  if (admin) wireSeedButton(courseData, seeded, refresh);

  async function refresh() {
    const [sectionDocs, qpDocs] = await Promise.all([fetchAllSections(), fetchAllQp()]);
    render(sectionRows, courseRows, sectionDocs, qpDocs);
  }

  renderSharedTopbar(user, { onRefresh: refresh });

  if (seeded) await refresh();
  else document.getElementById("appRoot").innerHTML = `<div class="empty-state"><h3>Ready to initialise</h3><p>Use the panel above to load the course &amp; section list into the live tracker.</p></div>`;
}

function wireSeedButton(courseData, alreadySeeded, onDone) {
  const btn = document.getElementById("seedBtn");
  const progress = document.getElementById("seedProgress");
  btn.textContent = alreadySeeded ? "Re-sync course list" : "Initialise tracker with course list";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    progress.style.display = "inline";
    progress.textContent = "Writing\u2026";
    try {
      const n = await seedDatabase(courseData, (done, total) => {
        progress.textContent = `Writing ${done} / ${total}\u2026`;
      });
      progress.textContent = `Done \u2014 ${n} new record(s) written.`;
      btn.textContent = "Re-sync course list";
      await onDone();
    } catch (err) {
      console.error(err);
      progress.textContent = "Failed \u2014 check console.";
    } finally {
      btn.disabled = false;
    }
  });
}

function render(sectionRows, courseRows, sectionDocs, qpDocs) {
  const merged = sectionRows.map((r) => ({ ...r, live: sectionDocs[r.id] || {} }));
  const mergedQp = courseRows.map((r) => ({ ...r, live: qpDocs[r.id] || {} }));

  const totalTracked = merged.length;
  const cie1Done = merged.filter((r) => r.live.cie1 === COMPLETED).length;
  const cie2Done = merged.filter((r) => r.live.cie2 === COMPLETED).length;
  const cie3Done = merged.filter((r) => r.live.cie3 === COMPLETED).length;
  const qpTotal = mergedQp.length;
  const qpDone = mergedQp.filter((r) => r.live.status === COMPLETED).length;

  document.getElementById("appRoot").innerHTML = appHtml();

  setKpi("kpiTotal", totalTracked, "section-faculty assignments");
  setKpi("kpiCie1", pct(cie1Done, totalTracked), `${cie1Done} / ${totalTracked} verified`);
  setKpi("kpiCie2", pct(cie2Done, totalTracked), `${cie2Done} / ${totalTracked} verified`);
  setKpi("kpiCie3", pct(cie3Done, totalTracked), `${cie3Done} / ${totalTracked} verified`);
  setKpi("kpiQp", pct(qpDone, qpTotal), `${qpDone} / ${qpTotal} courses`);

  // ---- Programme breakdown ----
  const progRows = PROGRAMMES.map((p) => {
    const secs = merged.filter((r) => r.programme === p);
    const qps = mergedQp.filter((r) => r.programme === p);
    return {
      label: p,
      total: secs.length,
      cie1: pctNum(secs.filter((r) => r.live.cie1 === COMPLETED).length, secs.length),
      cie2: pctNum(secs.filter((r) => r.live.cie2 === COMPLETED).length, secs.length),
      cie3: pctNum(secs.filter((r) => r.live.cie3 === COMPLETED).length, secs.length),
      qp: pctNum(qps.filter((r) => r.live.status === COMPLETED).length, qps.length),
    };
  });
  fillBreakdownTable("progTable", progRows);

  // ---- BTech semester breakdown ----
  const semTabs = ["BTech Sem 1", "BTech Sem 3", "BTech Sem 5", "BTech Sem 7"];
  const semRows = semTabs.map((tab) => {
    const secs = merged.filter((r) => r.tab === tab);
    const qps = mergedQp.filter((r) => r.tab === tab);
    return {
      label: tab,
      total: secs.length,
      cie1: pctNum(secs.filter((r) => r.live.cie1 === COMPLETED).length, secs.length),
      cie2: pctNum(secs.filter((r) => r.live.cie2 === COMPLETED).length, secs.length),
      cie3: pctNum(secs.filter((r) => r.live.cie3 === COMPLETED).length, secs.length),
      qp: pctNum(qps.filter((r) => r.live.status === COMPLETED).length, qps.length),
    };
  });
  fillBreakdownTable("semTable", semRows);

  drawCharts(progRows, semRows, { cie1Done, cie2Done, cie3Done, totalTracked });

  wirePendingTable(merged, mergedQp);
}

function setKpi(id, value, sub) {
  document.getElementById(id).querySelector(".value").textContent = value;
  document.getElementById(id).querySelector(".sub").textContent = sub;
}

function pct(n, d) { return d ? Math.round((n / d) * 100) + "%" : "0%"; }
function pctNum(n, d) { return d ? Math.round((n / d) * 100) : 0; }

function fillBreakdownTable(tbodyId, rows) {
  const tbody = document.querySelector(`#${tbodyId} tbody`);
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${r.label}</td>
      <td class="mono">${r.total}</td>
      <td>${miniBar(r.cie1)}</td>
      <td>${miniBar(r.cie2)}</td>
      <td>${miniBar(r.cie3)}</td>
      <td>${miniBar(r.qp)}</td>
    </tr>`
    )
    .join("");
}

function miniBar(p) {
  const color = p >= 80 ? "var(--green)" : p >= 40 ? "var(--amber)" : "var(--red)";
  return `
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="width:70px;height:7px;background:#EAE7DE;border-radius:4px;overflow:hidden;">
        <div style="width:${p}%;height:100%;background:${color};"></div>
      </div>
      <span class="mono" style="font-size:11.5px;">${p}%</span>
    </div>`;
}

function drawCharts(progRows, semRows, overall) {
  Object.values(chartRefs).forEach((c) => c && c.destroy());

  chartRefs.prog = new Chart(document.getElementById("progChart"), {
    type: "bar",
    data: {
      labels: progRows.map((r) => r.label),
      datasets: [
        { label: "CIE-1", data: progRows.map((r) => r.cie1), backgroundColor: "#7A1F2B" },
        { label: "CIE-2", data: progRows.map((r) => r.cie2), backgroundColor: "#B5872F" },
        { label: "CIE-3", data: progRows.map((r) => r.cie3), backgroundColor: "#2E6F40" },
      ],
    },
    options: chartOptions("% complete"),
  });

  chartRefs.sem = new Chart(document.getElementById("semChart"), {
    type: "bar",
    data: {
      labels: semRows.map((r) => r.label.replace("BTech ", "")),
      datasets: [
        { label: "CIE-1", data: semRows.map((r) => r.cie1), backgroundColor: "#7A1F2B" },
        { label: "CIE-2", data: semRows.map((r) => r.cie2), backgroundColor: "#B5872F" },
        { label: "CIE-3", data: semRows.map((r) => r.cie3), backgroundColor: "#2E6F40" },
      ],
    },
    options: chartOptions("% complete"),
  });

  chartRefs.overall = new Chart(document.getElementById("overallChart"), {
    type: "doughnut",
    data: {
      labels: ["CIE-1 verified", "CIE-1 pending"],
      datasets: [{
        data: [overall.cie1Done, overall.totalTracked - overall.cie1Done],
        backgroundColor: ["#2E6F40", "#EAE7DE"],
      }],
    },
    options: { plugins: { legend: { position: "bottom", labels: { font: { family: "IBM Plex Sans" } } } } },
  });

  chartRefs.qp = new Chart(document.getElementById("qpChart"), {
    type: "bar",
    data: {
      labels: progRows.map((r) => r.label),
      datasets: [{ label: "QP + Key %", data: progRows.map((r) => r.qp), backgroundColor: "#B5872F" }],
    },
    options: chartOptions("% complete"),
  });
}

function chartOptions(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: yLabel } } },
    plugins: { legend: { position: "bottom", labels: { font: { family: "IBM Plex Sans" }, boxWidth: 12 } } },
  };
}

function wirePendingTable(merged, mergedQp) {
  const stageSel = document.getElementById("pendingStage");
  const statusSel = document.getElementById("pendingStatus");
  const searchInput = document.getElementById("pendingSearch");
  let sortKey = "status";
  let sortDir = 1;

  function buildRows() {
    const stage = stageSel.value;
    const rows = [];
    const stages = stage === "All" ? ["cie1", "cie2", "cie3"] : [stage];
    for (const r of merged) {
      for (const st of stages) {
        rows.push({
          programme: r.programme, semester: r.semester, code: r.code, name: r.name,
          section: r.section, faculty: r.faculty, stage: stageLabel(st),
          status: r.live[st] || "Not Completed",
        });
      }
    }
    if (stage === "All" || stage === "qp") {
      for (const r of mergedQp) {
        rows.push({
          programme: r.programme, semester: r.semester, code: r.code, name: r.name,
          section: "\u2014", faculty: r.lead || "\u26a0 Not marked", stage: "QP+Key",
          status: r.live.status || "Not Completed",
        });
      }
    }
    return rows;
  }

  function draw() {
    let rows = buildRows();
    const statusFilter = statusSel.value;
    const search = searchInput.value.trim().toLowerCase();
    if (statusFilter !== "All") rows = rows.filter((r) => r.status === statusFilter);
    if (search) {
      rows = rows.filter((r) =>
        `${r.code} ${r.name} ${r.faculty}`.toLowerCase().includes(search)
      );
    }
    rows.sort((a, b) => {
      const av = String(a[sortKey]).toLowerCase();
      const bv = String(b[sortKey]).toLowerCase();
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });

    document.getElementById("pendingCount").textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;
    const tbody = document.querySelector("#pendingTable tbody");
    tbody.innerHTML = rows
      .slice(0, 400)
      .map(
        (r) => `
      <tr>
        <td>${r.programme}</td>
        <td>${r.semester}</td>
        <td class="mono">${escapeHtml(r.code)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(String(r.section))}</td>
        <td>${escapeHtml(r.faculty)}</td>
        <td>${r.stage}</td>
        <td>${r.status === "Completed" ? `<span class="pill pill--completed">Completed</span>` : `<span class="pill pill--pending">Pending</span>`}</td>
      </tr>`
      )
      .join("");
  }

  [stageSel, statusSel].forEach((el) => el.addEventListener("change", draw));
  searchInput.addEventListener("input", draw);
  document.querySelectorAll("#pendingTable thead th[data-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; }
      draw();
    });
  });

  draw();
}

function stageLabel(s) { return { cie1: "CIE-1", cie2: "CIE-2", cie3: "CIE-3" }[s] || s; }

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}


function appHtml() {
  return `
    <div class="page-head">
      <div>
        <span class="eyebrow">Coordinator Dashboard</span>
        <h1>CIE Marks-Entry Tracking</h1>
        <p>Live view of every section's marks-entry verification status, across all programmes and semesters.</p>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi" id="kpiTotal"><div class="label">Tracked Sections</div><div class="value">&ndash;</div><div class="sub"></div></div>
      <div class="kpi" id="kpiCie1"><div class="label">CIE-1 Verified</div><div class="value">&ndash;</div><div class="sub"></div></div>
      <div class="kpi" id="kpiCie2"><div class="label">CIE-2 Verified</div><div class="value">&ndash;</div><div class="sub"></div></div>
      <div class="kpi" id="kpiCie3"><div class="label">CIE-3 Verified</div><div class="value">&ndash;</div><div class="sub"></div></div>
      <div class="kpi" id="kpiQp"><div class="label">QP + Key Submitted</div><div class="value">&ndash;</div><div class="sub"></div></div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>Completion by Programme</h2></div>
      <div class="panel__body">
        <table class="data-table" id="progTable">
          <thead><tr><th>Programme</th><th>Sections</th><th>CIE-1</th><th>CIE-2</th><th>CIE-3</th><th>QP+Key</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel__head"><h2>BTech &mdash; Completion by Semester</h2></div>
      <div class="panel__body">
        <table class="data-table" id="semTable">
          <thead><tr><th>Semester</th><th>Sections</th><th>CIE-1</th><th>CIE-2</th><th>CIE-3</th><th>QP+Key</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="chart-grid">
      <div class="panel chart-box"><div class="panel__head"><h2>By Programme</h2></div><div class="panel__body"><canvas id="progChart" height="130"></canvas></div></div>
      <div class="panel chart-box"><div class="panel__head"><h2>BTech by Semester</h2></div><div class="panel__body"><canvas id="semChart" height="130"></canvas></div></div>
      <div class="panel chart-box"><div class="panel__head"><h2>CIE-1 Overall</h2></div><div class="panel__body"><canvas id="overallChart" height="130"></canvas></div></div>
      <div class="panel chart-box"><div class="panel__head"><h2>QP + Key by Programme</h2></div><div class="panel__body"><canvas id="qpChart" height="130"></canvas></div></div>
    </div>

    <div class="panel">
      <div class="panel__head">
        <h2>All Tracked Items</h2>
        <span id="pendingCount" style="font-size:12.5px;color:var(--ink-soft);"></span>
      </div>
      <div class="panel__body">
        <div class="filter-bar">
          <select id="pendingStage">
            <option value="All">All CIE stages</option>
            <option value="cie1">CIE-1</option>
            <option value="cie2">CIE-2</option>
            <option value="cie3">CIE-3</option>
            <option value="qp">QP + Key only</option>
          </select>
          <select id="pendingStatus">
            <option value="All">All statuses</option>
            <option value="Not Completed">Pending only</option>
            <option value="Completed">Completed only</option>
          </select>
          <input type="search" id="pendingSearch" placeholder="Search course, code, or faculty" />
        </div>
        <div style="max-height:480px;overflow:auto;">
          <table class="data-table" id="pendingTable">
            <thead>
              <tr>
                <th data-key="programme">Programme</th>
                <th data-key="semester">Sem</th>
                <th data-key="code">Code</th>
                <th data-key="name">Course</th>
                <th data-key="section">Sec</th>
                <th data-key="faculty">Faculty</th>
                <th data-key="stage">Stage</th>
                <th data-key="status">Status</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

main();
