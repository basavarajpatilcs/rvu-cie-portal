# RVU CIE Marks-Entry Tracker — Web Portal

A lightweight portal for faculty to mark their CIE-1 / CIE-2 / CIE-3 marks-entry
status per section, and for coordinators to see live completion dashboards —
built to sit on **GitHub Pages** (free static hosting) with **Firebase**
(free tier) handling login and the database.

It mirrors the Excel tracker you already have: same 128 courses, 317
section-faculty assignments, same three CIE stages, same CIE-2 "Question
Paper + Answer Key by Course Lead" check — just live, multi-user, and
accessible from a phone.

---

## Why Firebase, not "just GitHub Pages"

GitHub Pages only serves static files (HTML/CSS/JS) — it cannot run a login
check or a database on its own. Firebase is Google's free backend-as-a-service
and is the standard pairing for this: **Firebase Authentication** handles the
"only @rvu.edu.in accounts" login, and **Firestore** is the live database
every faculty member's browser reads and writes to directly. Nothing else
needs to be hosted or run — no server to maintain.

This does mean you (or your IT team) need to create one free Firebase
project. It takes about 10 minutes, done once. Steps below.

---

## 1. Prerequisites

- A Google account to create the Firebase project (any Google account —
  doesn't need to be @rvu.edu.in).
- Confirm RVU staff emails are **Google Workspace** accounts (i.e. faculty
  already sign into Gmail/Google Drive with their @rvu.edu.in address). This
  portal uses **Google Sign-In**. If RVU instead uses Microsoft 365 for
  email, see [Using Microsoft accounts instead](#using-microsoft-accounts-instead) below.
- A GitHub account and a repository to publish this folder from.

---

## 2. Create the Firebase project

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Name it e.g. `rvu-cie-tracker` → continue through the wizard (Analytics
   is optional, skip it).
3. Once created, click the **Web** icon (`</>`) to register a web app.
   Give it a nickname (e.g. "CIE Portal") — you don't need Firebase Hosting,
   we're using GitHub Pages instead.
4. Firebase shows a `firebaseConfig` object. Copy it — you'll paste it into
   `js/firebase-config.js` in step 4.

### Enable Google sign-in

1. In the Firebase console: **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Google**. Set a support email (your
   own is fine) → Save.

### Enable Firestore

1. **Build → Firestore Database → Create database**.
2. Choose **Production mode** (we supply proper security rules below).
3. Pick a location close to Bengaluru (e.g. `asia-south1`).

### Publish the security rules

1. **Firestore Database → Rules** tab.
2. Delete the default contents and paste in everything from
   [`firestore.rules`](./firestore.rules) in this folder.
3. **Publish**.

This is what actually restricts data access to @rvu.edu.in accounts — the
check in the app itself is just a friendly error message; this is the real
lock.

---

## 3. Configure the app

Open `js/firebase-config.js` and replace the placeholder values with the
config object Firebase showed you in step 2:

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "rvu-cie-tracker.firebaseapp.com",
  projectId: "rvu-cie-tracker",
  storageBucket: "rvu-cie-tracker.appspot.com",
  messagingSenderId: "...",
  appId: "...",
};
```

Also in that file:

- `ALLOWED_DOMAIN` — leave as `"rvu.edu.in"` unless your domain differs.
- `ADMIN_EMAILS` — list the email addresses of exam-office coordinators who
  should see the "Initialise tracker" button on the dashboard. **Also copy
  this same list into `firestore.rules`** (in the `isAdmin()` function) —
  the two lists must match, since the client-side list only controls what
  button is *shown*, while the rules file controls what's actually
  *allowed*.

This file is safe to commit to a public GitHub repo — a Firebase web config
only identifies which project to talk to, it isn't a secret. Real security
lives in `firestore.rules`.

---

## 4. Deploy to GitHub Pages

1. Push this whole `rvu-cie-portal` folder to a GitHub repository (as the
   repo root, or in a subfolder — either works).
2. In the repo: **Settings → Pages** → Source: **Deploy from a branch** →
   pick your branch and the folder this code lives in → **Save**.
3. GitHub gives you a URL like `https://<username>.github.io/<repo>/`.

### Authorize that domain in Firebase

1. Firebase console → **Authentication → Settings → Authorized domains**.
2. Click **Add domain**, enter your `github.io` URL's host
   (e.g. `yourname.github.io`).

Without this step, Google Sign-In will fail on the live site (it works fine
when you test locally on `localhost`, which Firebase authorizes by default).

---

## 5. First-time data load

1. Visit your live site, sign in with an email listed in `ADMIN_EMAILS`.
2. Go to **Coordinator Dashboard**.
3. Click **Initialise tracker with course list**. This writes all 128
   courses, 317 section-faculty rows, and the CIE-2 QP+Key tracking rows
   into Firestore, each starting as "Not Completed".
4. This button is safe to click again later (e.g. after editing
   `data/courses.json` to add a new semester's courses) — it only creates
   rows that don't already exist and never overwrites a status someone has
   already set.

---

## 6. How it works day-to-day

**Faculty** sign in → the app asks once "which faculty member are you?"
(a searchable list drawn from the course data) so it can highlight their
own sections and default the "My sections only" filter — this links their
Google login to their name in Firestore. They can skip this and browse all
sections instead. Clicking a status button toggles that section's CIE-1 /
CIE-2 / CIE-3 status between "Not Completed" and "Completed", with an
audit trail (`updatedBy`, `updatedAt`) recorded on every change. Course
leads see an extra "QP + Key" toggle under their course for the CIE-2
question paper and answer key submission.

**Coordinators** see the same dashboard structure as the Excel workbook:
KPI cards, completion % by programme, completion % by BTech semester, four
charts, and a searchable/sortable/filterable table of every tracked item
(handy for finding exactly who's still pending for a given CIE stage).

---

## 7. Updating the course list later

`data/courses.json` is the single source of truth for which courses,
sections, and faculty exist. To add a new semester or fix a name:

1. Edit `data/courses.json` directly (same shape: `groups[].courses[].sections[]`).
2. Redeploy (push to GitHub).
3. On the Coordinator Dashboard, click **Re-sync course list** — it adds
   any new rows without touching existing statuses.

---

## Data model (Firestore)

```
sections/{id}
  tab, programme, semester, code, name, lead, section, faculty
  cie1, cie2, cie3        "Completed" | "Not Completed"
  updatedBy, updatedAt

qpTracking/{id}
  tab, programme, semester, code, name, lead
  status                  "Completed" | "Not Completed"
  updatedBy, updatedAt

facultyLinks/{uid}
  email, name, linkedAt   -- which faculty member a given login is
```

---

## Known limitations / good next steps

- **Write access isn't restricted to "your own" section.** Any signed-in
  @rvu.edu.in account can toggle any row (matching how the shared Excel
  file worked before — anyone with access could edit any cell). Every
  change is now logged with who made it and when, which the spreadsheet
  didn't have. If you want to lock faculty to only their own rows, extend
  `firestore.rules` to check `resource.data.faculty` against a verified
  `facultyLinks` entry — this needs the name-linking step to be mandatory
  (not skippable) to work reliably.
- **Admin check is an email allow-list**, not Firebase custom claims. This
  is simpler to set up (no Cloud Functions needed) but means anyone who can
  edit `firestore.rules` and `firebase-config.js` controls who's an admin.
  Fine for a small coordinator team; upgrade to custom claims if you need
  stronger separation.
- **No email notifications / reminders.** The dashboard shows pending items
  live, but nothing proactively emails faculty who haven't completed a
  stage. Could be added later with a scheduled Cloud Function.

### Using Microsoft accounts instead

If RVU staff sign in with Microsoft 365 (not Google Workspace), swap the
Google provider for Firebase's Microsoft (OAuth) provider: enable it under
**Authentication → Sign-in method → Microsoft**, and change
`GoogleAuthProvider` to `OAuthProvider('microsoft.com')` in `js/auth.js`
(with `tenant` set to RVU's Azure AD tenant ID so only RVU accounts appear).
The domain check in `isAllowedEmail()` and the Firestore rules stay the same.

---

## File structure

```
rvu-cie-portal/
  index.html          Login page
  faculty.html         Faculty dashboard
  admin.html            Coordinator dashboard
  firestore.rules        Paste into Firebase console
  css/styles.css          All styling
  js/
    firebase-config.js     Your Firebase project keys + admin list  ← edit this
    auth.js                  Sign-in, domain check, auth guard
    data.js                    Loads & shapes data/courses.json
    store.js                     Firestore reads/writes, seeding
    faculty.js                     Faculty page logic
    admin.js                        Coordinator page logic
  data/courses.json                  Source course/section/faculty list
```
