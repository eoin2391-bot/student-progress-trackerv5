# Class Test Portal

A classroom testing/assessment app: teachers build or import tests, students
sign in with an icon + PIN (no personal information), multiple-choice
questions are auto-graded, short answers get a locally-computed suggested
mark for the teacher to confirm, and results export as CSV.

This is a separate app from the existing Primary Marks Book PWA in this repo
(that one is a client-only gradebook; this one has a real backend + database
so results are stored centrally and survive across devices).

## Features

- **Teacher accounts** — username/password sign-in (bcrypt-hashed).
- **Classes & students** — each class gets a join code. Students are added
  with a nickname + emoji avatar + 4-digit PIN — never a real name, email or
  other personal data. Bulk-paste import supported.
- **Mass question import** — upload a `.docx`, `.pdf`, `.pptx` or `.xlsx`
  file. The server extracts the text (or spreadsheet rows) and heuristically
  splits it into multiple-choice or short-answer questions for the teacher
  to review and correct before saving. Nothing is auto-published without
  teacher review.
- **Test builder** — add/edit questions manually, mark MCQ correct answers,
  and provide a short-answer exemplar + optional keyword list.
- **Student test-taking** — icon/PIN sign-in, take assigned tests, submit.
- **Grading**
  - MCQ: graded automatically against the teacher's answer key.
  - Short answer: a suggested mark is computed offline (no external AI
    calls, no API key) from keyword coverage and text-similarity against the
    teacher's exemplar. The teacher always reviews and confirms/adjusts the
    final mark before it counts.
- **Export** — CSV export of an individual student's result, all results for
  one test, or a whole class's scores across all its tests.

## Project layout

```
assessment-app/
  server/
    index.js            Express app entrypoint
    db.js                SQLite schema (better-sqlite3)
    auth.js              JWT helpers + auth middleware
    routes/               auth, classes, import, tests, attempts, exportRoutes
    parsers/              extractText.js (docx/pdf/pptx/xlsx -> text/rows)
                           questionParser.js (heuristic question segmentation)
    grading/similarity.js  local short-answer suggested-score algorithm
    data/                 SQLite database file + JWT secret (gitignored)
  public/                 vanilla JS frontend (no build step)
    index.html            landing page (choose teacher/student)
    teacher.html/.js       teacher dashboard
    student.html/.js       student portal
    api.js, styles.css
```

## Running locally

```bash
cd assessment-app
npm install
npm start
```

Then open http://localhost:3000 — choose **Teacher** to register an account
and set up a class, or **Student** to sign in with a class join code.

Data is stored in `server/data/app.db` (SQLite). Set `DATA_DIR` to change
where that lives, and `JWT_SECRET` to pin the signing secret (otherwise one
is generated and persisted to `server/data/jwt_secret.txt` on first boot).

## Importing questions

Supported formats and how they're parsed:

- **.docx** — Word's raw text is extracted (via `mammoth`), then split into
  questions using numbered-line patterns (`1.`, `Q2)`, etc.), lettered
  option lines (`A) …`), and `Answer: B` / `[2 marks]` markers.
- **.pdf** — Same text-based heuristic, using `pdf-parse` for extraction.
- **.pptx** — Each slide's paragraphs become lines, then the same heuristic
  applies. One question (or a small group) per slide works best.
- **.xlsx** — If the first row looks like a header (contains words like
  "question", "option", "answer", "marks"), columns are matched flexibly.
  Otherwise it falls back to a fixed layout: question, option A–D, answer
  letter, marks. Rows with 2+ non-empty options become MCQ; otherwise the
  row becomes a short-answer question.

For short-answer questions, add an "Exemplar:" (or "Model answer:") marker
in the source document, or an `Exemplar`/`Answer` column in a spreadsheet,
so the model answer is captured for suggested marking.

Import is always a **draft** — the teacher can edit every question, option,
correct answer, exemplar and mark value before saving the test.

## Deployment

The app is a single Node/Express process with an embedded SQLite database
(no external DB service required), so it runs on any Node host:

### Render (recommended, dashboard-only)

The repo root includes a `render.yaml` Blueprint (Render only auto-detects
this file at the repository root, even though it points Render at the
`assessment-app` subfolder) that provisions the web service, a 1GB
persistent disk mounted at `/data`, and a random `JWT_SECRET` for you.

1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. In the [Render dashboard](https://dashboard.render.com), click **New +** →
   **Blueprint**, and select this repository.
3. Render detects `render.yaml` at the repo root and shows a plan for one web
   service (`class-test-portal`) on the **Starter** tier (~$7/month — the
   cheapest tier that supports persistent disks, which this app needs so the
   SQLite database survives restarts). Click **Apply** / **Create**.
4. Wait for the first build+deploy to finish, then open the `.onrender.com`
   URL Render gives you — that's your live "preview" link, the equivalent of
   the GitHub Pages link the gradebook app uses.

If you'd rather not use the Blueprint, you can instead click **New +** →
**Web Service**, point it at this repo with root directory `assessment-app`,
build command `npm install`, start command `npm start`, and manually add a
disk mounted at `/data` plus an env var `DATA_DIR=/data` under the service's
**Disks** and **Environment** tabs.

### Railway / Fly.io

Deploy as a Node web service (`npm install && npm start`, root directory
`assessment-app`). Attach a **persistent volume** mounted at, e.g., `/data`,
and set `DATA_DIR=/data` so the SQLite file and JWT secret survive redeploys.

### A VPS

Clone the repo, `npm install`, run behind a process manager (pm2/systemd)
and a reverse proxy (nginx/Caddy) for TLS.

---

Wherever you deploy, set `JWT_SECRET` to a fixed random value in production
so logins don't reset on restart, and back up the `DATA_DIR` (it's the
entire database).

## Known limitations

- If a student closes the browser mid-test, resuming reloads the questions
  but previously typed (unsubmitted) answers are not recovered — only a
  submitted attempt is stored.
- Short-answer suggested marks are a heuristic (keyword + token overlap),
  not true language understanding — always intended as a starting point for
  the teacher, not a final grade.
