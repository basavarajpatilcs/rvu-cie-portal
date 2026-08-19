# Email notifications — one-time setup

The Settings page can **queue** emails (writes a doc to Firestore's
`notifications` collection), but nothing actually gets sent until you
deploy this `functions/` folder with real SMTP credentials. Do this once.

## 1. Get SMTP credentials

Any SMTP provider works. Two easy options:

- **A Google Workspace / Gmail account** (e.g. a shared
  `noreply@rvu.edu.in` or your own): create an
  [App Password](https://myaccount.google.com/apppasswords) (requires
  2-Step Verification turned on) — use that as `SMTP_PASS`, not your
  normal password. `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`.
- **SendGrid / Mailgun / any transactional email service** — they give
  you an SMTP host, port, username, and password/API key directly.

## 2. Initialize functions (first time only)

From the project root (where `firebase.json` lives):
```
firebase init functions
```
- Choose **JavaScript** (not TypeScript).
- When it asks to overwrite `functions/package.json` / `functions/index.js`
  — say **No** (you already have the ones from this update).
- Let it install dependencies, or run `cd functions && npm install` after.

## 3. Set the SMTP config

```
cd functions
firebase functions:config:set 2>/dev/null || true   # (ignore if this errors — see note below)
```

This project uses the newer **params** style (`defineString`/`defineSecret`
in `index.js`), which reads from a `.env` file plus one secret. From the
`functions/` folder:

```
cat > .env << 'EOF'
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@rvu.edu.in
SMTP_FROM=RVU CIE Tracker <noreply@rvu.edu.in>
EOF
```
(edit the values for your actual provider — use `nano .env` if the
heredoc gives you trouble, same as earlier with `firebase.json`)

Then set the one **secret** value (the password) — this is stored securely
in Secret Manager, never in your repo:
```
firebase functions:secrets:set SMTP_PASS
```
Paste the app password / SMTP password when prompted.

## 4. Deploy

```
firebase deploy --only functions
```

This deploys two functions:
- **`onNotificationCreated`** — sends any notification queued from the
  Settings page (or by the daily check below) within moments.
- **`dailyDeadlineCheck`** — runs once a day (8am IST). If either deadline
  set on the Settings page is within 3 days, it emails every programme
  coordinator a heads-up digest.

## 5. Test it

- Go to **Settings → Send Notification**, fill in a subject/message, put
  your own email in Recipients, click **Send Notification**.
- Check **Recent Activity** at the bottom of the Settings page — status
  should flip from `pending` to `sent` within a few seconds. If it shows
  `failed`, check the error in the Firebase Console → Functions → Logs.

## Notes on the daily reminder's scope

`dailyDeadlineCheck` intentionally sends **one digest to programme
coordinators**, not individual "you personally have 3 things pending"
emails to every faculty member. Scanning every course's live completion
state and cross-referencing it to `facultyDirectory` email addresses is
straightforward to add later (the data's all there — `cieComponents` and
`sections` documents, `facultyDirectory` for the emails) but is enough
extra logic that it's worth building and testing separately once the
basic reminder flow is confirmed working end-to-end.
