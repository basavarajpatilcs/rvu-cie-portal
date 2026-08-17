# CIE Component Monitoring — what was added

This adds a second tracking module alongside the existing section/QP
tracker, built from `SOCSE-CIE_Consolidated_Dashboard.xlsx` (118 courses
across BTech Sem 1/3/5/7, BCA, BSc, MTech, Minors-2023/24/25, UE).

## New files

| File | Purpose |
|---|---|
| `data/cie-components.json` | Course list extracted from the workbook: code, name, lead, programme, semester, credits, category, track/cluster, SEE type, student count, plus the 22-item evaluation-method dropdown and the CIE-1/2/3/Total mark caps. |
| `js/cie-data.js` | Loads that JSON, flattens it to one row per course, and recomputes CIE-1/2/3 totals, components-used, min-required (`Credits + 1`), the component check, and status — live, the same way the spreadsheet's formulas do. |
| `js/cie-components.js` | Page controller: dashboard KPIs, filters, and the per-course entry cards (3 evaluation-method/marks/date options for CIE-1 and CIE-3, single marks + QP/Scrutiny/Answer-Key dates for CIE-2, remarks). |
| `cie-components.html` | The page itself — same header/nav/footer chrome as `faculty.html`/`admin.html`. |

## Changed files

- **`js/store.js`** — added `fetchAllCie`, `saveCieComponent`, `isCieSeeded`,
  `seedCieComponents` for a new Firestore collection, `cieComponents/{id}`.
- **`firestore.rules`** — added rules for `cieComponents`: any signed-in
  `@rvu.edu.in` account can read; only admins (from `ADMIN_EMAILS`) can create
  (seed) rows; any signed-in user can update **only** `cie1`, `cie2`, `cie3`,
  `remarks`, `updatedBy`, `updatedAt` — the pre-filled course facts (code,
  name, lead, credits, category…) can never be edited from the client.
- **`css/styles.css`** — added `.cie-*` classes for the entry form, using the
  same maroon/brass/paper tokens as the rest of the portal.
- **`faculty.html`, `admin.html`** — added a "CIE Components" link to the nav.

## Editing permissions

Same trust model as the existing tracker:

- Everyone signed in with `@rvu.edu.in` can **view** every course's CIE
  component data.
- Only the **course lead** (matched against the name you link your login to,
  same mechanism as the section tracker) or a **coordinator** (`ADMIN_EMAILS`)
  can **edit** a course's CIE-1/2/3 marks, dates, and remarks.
- Everyone else sees the same card with disabled fields and a note on who can
  edit it.

## First-time setup after deploying

1. Deploy `firestore.rules` (see main README / commands below) — it now
   covers both the original collections and `cieComponents`.
2. Sign in as an account listed in `ADMIN_EMAILS`.
3. Open **CIE Components** in the nav. Because the collection is empty the
   first time, you'll see a **"Seed CIE Component data"** button — click it
   once. It writes all 118 course rows with blank CIE-1/2/3 fields. Safe to
   click again later (e.g. after adding new courses to the JSON) — it only
   creates rows that don't already exist, never overwrites marks a faculty
   member has entered.
4. Faculty then sign in, link their name (same one-time picker as the
   section tracker), and can edit CIE-1/2/3 for the courses where they're
   listed as course lead.

## Validation rules (mirrors the workbook exactly)

- CIE-1 total (sum of up to 3 options) capped at **20**, turns red over cap.
- CIE-2 (single route) capped at **25**.
- CIE-3 total (sum of up to 3 options) capped at **25**.
- Total CIE capped at **70**.
- **Components used** = number of non-zero marks entries across CIE-1's 3
  options + CIE-2 + CIE-3's 3 options (max 7).
- **Component check**: `Components used ≥ Credits + 1`, else flagged
  `⚠ Insufficient`.
- **Status**: Not Started → In Progress (any marks entered) → Completed
  (all three CIE stages have marks *and* the component check passes).

## Updating the course list later

If the Odd Sem 2026–27 course list changes, regenerate
`data/cie-components.json` from an updated workbook and re-run the seed step
— it only adds new/missing course rows.
