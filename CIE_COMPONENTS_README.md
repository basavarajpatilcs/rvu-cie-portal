# CIE Component Monitoring — what was added

This adds a second tracking module alongside the existing section/QP
tracker, built from your latest `CIE_Consolidated_Dashboard.xlsx` — **128
courses** across BTech Sem 1/3/5/7, BCA, BSc, **MTech** (10 courses, Sem I
& III combined — Advanced DS&A, Advanced DBMS, Advanced ML, NLP, Maths for
CS, Explainable AI, GenAI & LLMs, Network Engineering, Cyber Security, Cloud
& Distributed Computing), Minors-2023/24/25, UE — matching the workbook's
own Dashboard tab totals exactly (128 courses, 39 missing lead).

Also included: `firebase.json` and `firestore.indexes.json`, which weren't
in the repo before — needed for `firebase deploy` to work.

## New files

| File | Purpose |
|---|---|
| `data/cie-components.json` | Course list extracted from the workbook: real 128-course list with the actual MTech tab (10 courses). |
| `js/cie-data.js` | Loads that JSON, flattens it, recomputes CIE-1/2/3 totals/checks live, and groups the 12 fine-grained tabs into 6 broad programme groups (BTech/BCA/BSc/MTech/Minors/UE) used for coordinator mapping. |
| `js/cie-reports.js` | Consolidated-report builder (summary by tab / category / status, course-level table), CSV export, and a small CSV parser shared by every upload feature. |
| `js/cie-admin-tools.js` | Admin-only panel: course↔faculty mapping table + CSV bulk upload, programme coordinator mapping, per-tab CSV templates, bulk marks-CSV upload, faculty-directory CSV upload. |
| `js/cie-components.js` | Page controller — three tabs: **Marks Entry**, **Consolidated Report**, **Admin Tools** (admins only). |
| `cie-components.html` | The page itself. |

## Changed files

- **`js/store.js`** — CRUD for `cieComponents`, plus new `facultyDirectory` and
  `coordinators` collections, plus `backfillProgrammeGroups` (see Troubleshooting).
- **`firestore.rules`** — `cieComponents` update rule now allows **admins**,
  **the matching programme's coordinator** (looked up from `coordinators/{group}`),
  or **the course lead** (self-service, CIE-1/2/3/remarks fields only). New
  read/admin-write rules for `facultyDirectory` and `coordinators`.
- **`css/styles.css`**, **`faculty.html`**, **`admin.html`** — styling + nav link.

## The three tabs on the CIE Components page

### 1. Marks Entry
Same as before: per-course cards, editable only by the course lead / that
programme's coordinator / an admin. **Fixed:** saves now use `set(merge)`
instead of `update`, so editing no longer silently fails the first time a
course is touched after being added or resynced.

### 2. Consolidated Report *(everyone)*
Filter by tab, category, status, or free-text search, click **Generate
Report** — mirrors the workbook's Dashboard tab (summary by tab, by
category, by status) plus a course-level table, plus a **Component
Analysis** section (mirrors the workbook's "CIE Component Analysis" tab —
evaluation-method usage counts, overall and by programme group). **Export
CSV** downloads the currently-filtered rows.

### 3. Admin Tools *(admins only)*
- **Course ↔ Faculty Mapping** — reassign a course's lead + email inline,
  or upload a CSV (`Tab,Code,Name,CurrentLead,NewLeadName,NewLeadEmail` —
  download the template button first, fill `NewLeadName`/`NewLeadEmail`,
  re-upload).
- **Programme Coordinator Mapping** — one name+email per programme group.
  That person then gets edit rights over *every* course in their programme,
  not just ones where they're personally the lead.
- **CSV Templates & Bulk Upload** — one marks-entry template per tab
  (`Tab,Code,Name,c1a_method,c1a_marks,c1a_date,…,c3c_date,Remarks`) for
  offline bulk-filling, a faculty-directory template (`name,email`), and
  upload buttons for both.

## First-time setup after deploying

1. Deploy `firestore.rules`.
2. Sign in as an `ADMIN_EMAILS` account → **CIE Components** → **Seed CIE
   Component data** (only shows while any course is missing from Firestore —
   also how you pick up the new MTech courses if you'd already seeded
   before this update).
3. Optional: **Admin Tools → Programme Coordinator Mapping** — assign a
   coordinator per programme so they can edit beyond their own courses.
4. Optional: **Admin Tools → Course ↔ Faculty Mapping** — fix any course
   leads that are wrong or blank, either inline or via CSV.
5. Faculty sign in, link their name (same picker as the section tracker),
   and edit CIE-1/2/3 for courses where they're listed as lead.

## Troubleshooting: "marks entry not working"

The most common cause: a course exists in the course list but has no
matching Firestore document yet (new course, or added after the last seed).
The entry card now says **"Not yet seeded"** in that case instead of
silently failing — click **Seed / resync CIE Component data** as an admin
to fix it for everyone at once.

If programme-coordinator permissions don't seem to apply to courses that
were seeded *before* this update, run **Admin Tools → "Repair programme
tags on existing courses"** once — it backfills the `programmeGroup` field
the coordinator permission check relies on, without touching any marks.

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
