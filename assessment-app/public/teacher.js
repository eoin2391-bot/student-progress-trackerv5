const root = document.getElementById('root');
const ROLE = 'teacher';

const state = {
  teacher: null,
  tab: 'classes',
  classes: [],
  avatars: [],
  activeClassId: null,
  activeClassDetail: null,
  tests: [],
  builder: null, // { id, title, classId, questions: [] }
  gradingTestId: null,
  gradingTest: null,
  gradingAttempt: null,
  authMode: 'login',
  authError: ''
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function h(strings, ...vals) { return strings.reduce((acc, s, i) => acc + s + (vals[i] ?? ''), ''); }

// ── Boot ─────────────────────────────────────────────────────────────────
async function boot() {
  const token = Api.getToken(ROLE);
  if (!token) return renderAuth();
  try {
    await loadClasses();
    render();
  } catch {
    Api.clearToken(ROLE);
    renderAuth();
  }
}

// ── Auth views ───────────────────────────────────────────────────────────
function renderAuth() {
  const isLogin = state.authMode === 'login';
  root.innerHTML = h`
    <div class="center-screen">
      <div class="card">
        <h1>🧑‍🏫 Teacher Sign In</h1>
        <p class="muted">${isLogin ? 'Log in to manage your classes and tests.' : 'Create a teacher account.'}</p>
        <form id="authForm">
          ${!isLogin ? h`<label>Your name</label><input type="text" id="f-name" required>` : ''}
          <label>Username</label>
          <input type="text" id="f-username" required autocomplete="username">
          <label>Password</label>
          <input type="password" id="f-password" required autocomplete="${isLogin ? 'current-password' : 'new-password'}">
          ${state.authError ? h`<p class="error-text">${esc(state.authError)}</p>` : ''}
          <button type="submit" class="btn-primary btn-block" style="margin-top:18px;">${isLogin ? 'Log In' : 'Create Account'}</button>
        </form>
        <p class="muted" style="margin-top:16px; text-align:center;">
          ${isLogin ? "Don't have an account?" : 'Already have an account?'}
          <a href="#" id="toggleMode">${isLogin ? 'Create one' : 'Log in'}</a>
        </p>
        <p class="muted" style="text-align:center;"><a href="index.html">&larr; Back</a></p>
      </div>
    </div>
  `;
  document.getElementById('toggleMode').onclick = e => {
    e.preventDefault();
    state.authMode = isLogin ? 'register' : 'login';
    state.authError = '';
    renderAuth();
  };
  document.getElementById('authForm').onsubmit = async e => {
    e.preventDefault();
    const username = document.getElementById('f-username').value.trim();
    const password = document.getElementById('f-password').value;
    try {
      const body = isLogin
        ? { username, password }
        : { username, password, name: document.getElementById('f-name').value.trim() };
      const data = await Api.post(ROLE, `/api/auth/teacher/${isLogin ? 'login' : 'register'}`, body);
      Api.setToken(ROLE, data.token);
      state.teacher = data.teacher;
      state.authError = '';
      await loadClasses();
      render();
    } catch (err) {
      state.authError = err.message;
      renderAuth();
    }
  };
}

function logout() {
  Api.clearToken(ROLE);
  state.teacher = null;
  renderAuth();
}

// ── Data loaders ─────────────────────────────────────────────────────────
async function loadClasses() {
  const [{ classes }, { avatars }] = await Promise.all([
    Api.get(ROLE, '/api/classes'),
    Api.get(ROLE, '/api/classes/avatars')
  ]);
  state.classes = classes;
  state.avatars = avatars;
}

async function loadTests() {
  const { tests } = await Api.get(ROLE, '/api/tests');
  state.tests = tests;
}

// ── Shell ────────────────────────────────────────────────────────────────
function render() {
  const tabs = [
    ['classes', '👥 Classes & Students'],
    ['tests', '📝 Tests'],
    ['grading', '✅ Grading']
  ];
  root.innerHTML = h`
    <div class="app-shell">
      <div class="sidebar" style="position:relative;">
        <div class="brand">📝 Test Portal</div>
        ${tabs.map(([id, label]) => h`
          <button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>
        `).join('')}
        <div class="logout">
          <button class="btn-secondary btn-block" id="logoutBtn">Log Out</button>
        </div>
      </div>
      <div class="main" id="mainContent"></div>
    </div>
  `;
  root.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => { state.tab = btn.dataset.tab; render(); };
  });
  document.getElementById('logoutBtn').onclick = logout;
  const main = document.getElementById('mainContent');
  if (state.tab === 'classes') renderClassesTab(main);
  else if (state.tab === 'tests') renderTestsTab(main);
  else if (state.tab === 'grading') renderGradingTab(main);
}

// ── Classes tab ──────────────────────────────────────────────────────────
function renderClassesTab(main) {
  if (state.activeClassId) return renderClassDetail(main);
  main.innerHTML = h`
    <div class="row between"><h2>Classes</h2>
      <button class="btn-primary" id="newClassBtn">+ New Class</button>
    </div>
    ${state.classes.length === 0 ? h`<p class="muted">No classes yet.</p>` : h`
      <table><thead><tr><th>Class</th><th>Join Code</th><th>Students</th><th></th></tr></thead>
      <tbody>
        ${state.classes.map(c => h`
          <tr>
            <td>${esc(c.name)}</td>
            <td><code>${esc(c.join_code)}</code></td>
            <td>${c.studentCount}</td>
            <td><button class="btn-secondary" data-open="${c.id}">Open</button></td>
          </tr>
        `).join('')}
      </tbody></table>
    `}
  `;
  document.getElementById('newClassBtn').onclick = async () => {
    const name = prompt('Class name (e.g. Year 3B):');
    if (!name || !name.trim()) return;
    await Api.post(ROLE, '/api/classes', { name: name.trim() });
    await loadClasses();
    render();
  };
  main.querySelectorAll('[data-open]').forEach(btn => {
    btn.onclick = async () => {
      state.activeClassId = Number(btn.dataset.open);
      await loadClassDetail();
      render();
    };
  });
}

async function loadClassDetail() {
  const { students } = await Api.get(ROLE, `/api/classes/${state.activeClassId}/students`);
  state.activeClassDetail = { students };
}

function renderClassDetail(main) {
  const cls = state.classes.find(c => c.id === state.activeClassId);
  const students = state.activeClassDetail.students;
  main.innerHTML = h`
    <p><a href="#" id="backLink">&larr; All classes</a></p>
    <div class="row between">
      <h2>${esc(cls.name)}</h2>
      <div class="row">
        <span class="pill blue">Join code: ${esc(cls.join_code)}</span>
        <button class="btn-secondary" id="exportClassBtn">⬇ Export Class Results</button>
        <button class="btn-danger" id="deleteClassBtn">Delete Class</button>
      </div>
    </div>
    <p class="muted">Students use this join code, then pick their icon and enter their PIN &mdash; no name/email needed to sign in.</p>

    <div class="panel">
      <h3>Add a student</h3>
      <div class="row wrap">
        <input type="text" id="newStudentName" placeholder="Nickname (e.g. BlueFox7)" style="flex:2;">
        <input type="text" id="newStudentPin" placeholder="4-digit PIN" maxlength="4" style="flex:1;">
        <button class="btn-primary" id="addStudentBtn">Add</button>
      </div>
      <details style="margin-top:14px;">
        <summary style="cursor:pointer; font-weight:600; font-size:14px;">Bulk import (paste a list)</summary>
        <p class="muted">One student per line: <code>Nickname</code> or <code>Nickname, 1234</code>. A random PIN is generated if you don't provide one.</p>
        <textarea id="bulkText" rows="6" placeholder="RedPanda\nBlueFox, 4821\nSunnyDay"></textarea>
        <button class="btn-primary" id="bulkImportBtn" style="margin-top:8px;">Import</button>
        <div id="bulkResult"></div>
      </details>
    </div>

    <div class="panel">
      <h3>Students (${students.length})</h3>
      ${students.length === 0 ? h`<p class="muted">No students yet.</p>` : h`
        <table><thead><tr><th></th><th>Nickname</th><th></th></tr></thead>
        <tbody>
          ${students.map(s => h`
            <tr>
              <td style="font-size:22px;">${esc(s.avatar)}</td>
              <td>${esc(s.display_name)}</td>
              <td class="row">
                <button class="btn-secondary" data-reset="${s.id}">Reset PIN</button>
                <button class="btn-danger" data-remove="${s.id}">Remove</button>
              </td>
            </tr>
          `).join('')}
        </tbody></table>
      `}
    </div>
  `;
  document.getElementById('backLink').onclick = e => { e.preventDefault(); state.activeClassId = null; render(); };
  document.getElementById('exportClassBtn').onclick = () => downloadExport(`/api/export/classes/${cls.id}`);
  document.getElementById('deleteClassBtn').onclick = async () => {
    if (!confirm(`Delete "${cls.name}" and all its students, tests and results? This cannot be undone.`)) return;
    await Api.del(ROLE, `/api/classes/${cls.id}`);
    state.activeClassId = null;
    await loadClasses();
    render();
  };
  document.getElementById('addStudentBtn').onclick = async () => {
    const displayName = document.getElementById('newStudentName').value.trim();
    const pin = document.getElementById('newStudentPin').value.trim();
    if (!displayName || !/^\d{4}$/.test(pin)) return toast('Enter a nickname and a 4-digit PIN.');
    try {
      await Api.post(ROLE, `/api/classes/${cls.id}/students`, { displayName, pin });
      await loadClassDetail();
      await loadClasses();
      render();
    } catch (err) { toast(err.message); }
  };
  document.getElementById('bulkImportBtn').onclick = async () => {
    const text = document.getElementById('bulkText').value;
    if (!text.trim()) return;
    const { created } = await Api.post(ROLE, `/api/classes/${cls.id}/students/bulk`, { text });
    document.getElementById('bulkResult').innerHTML = h`
      <p class="muted" style="margin-top:8px;">Added ${created.length} student(s). Generated PINs:</p>
      <ul>${created.map(c => h`<li>${esc(c.display_name)}: <strong>${esc(c.pin)}</strong></li>`).join('')}</ul>
    `;
    await loadClassDetail();
    await loadClasses();
  };
  main.querySelectorAll('[data-remove]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remove this student?')) return;
      await Api.del(ROLE, `/api/classes/${cls.id}/students/${btn.dataset.remove}`);
      await loadClassDetail();
      await loadClasses();
      render();
    };
  });
  main.querySelectorAll('[data-reset]').forEach(btn => {
    btn.onclick = async () => {
      const pin = prompt('New 4-digit PIN:');
      if (!pin || !/^\d{4}$/.test(pin)) return;
      await Api.patch(ROLE, `/api/classes/${cls.id}/students/${btn.dataset.reset}`, { pin });
      toast('PIN updated.');
    };
  });
}

async function downloadExport(url) {
  const token = Api.getToken(ROLE);
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return toast('Export failed.');
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="(.+)"/);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = match ? match[1] : 'export.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Tests tab ────────────────────────────────────────────────────────────
async function renderTestsTab(main) {
  if (state.builder) return renderTestBuilder(main);
  await loadTests();
  main.innerHTML = h`
    <div class="row between"><h2>Tests</h2>
      <button class="btn-primary" id="newTestBtn">+ New Test</button>
    </div>
    ${state.tests.length === 0 ? h`<p class="muted">No tests yet.</p>` : h`
      <table><thead><tr><th>Title</th><th>Class</th><th>Questions</th><th>Attempts</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${state.tests.map(t => {
          const cls = state.classes.find(c => c.id === t.class_id);
          return h`
            <tr>
              <td>${esc(t.title)}</td>
              <td>${cls ? esc(cls.name) : '<span class="muted">Unassigned</span>'}</td>
              <td>${t.questionCount}</td>
              <td>${t.attemptCount}</td>
              <td>${t.published ? '<span class="pill green">Published</span>' : '<span class="pill gray">Draft</span>'}</td>
              <td class="row wrap">
                <button class="btn-secondary" data-edit="${t.id}">Edit</button>
                <button class="btn-secondary" data-publish="${t.id}">${t.published ? 'Unpublish' : 'Publish'}</button>
                <button class="btn-secondary" data-export="${t.id}">⬇ Export</button>
                <button class="btn-danger" data-delete="${t.id}">Delete</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody></table>
    `}
  `;
  document.getElementById('newTestBtn').onclick = () => {
    state.builder = { id: null, title: '', classId: state.classes[0]?.id || null, questions: [] };
    render();
  };
  main.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = async () => {
    const full = await Api.get(ROLE, `/api/tests/${btn.dataset.edit}`);
    state.builder = { id: full.id, title: full.title, classId: full.class_id, questions: full.questions };
    render();
  });
  main.querySelectorAll('[data-publish]').forEach(btn => btn.onclick = async () => {
    const t = state.tests.find(x => x.id === Number(btn.dataset.publish));
    try {
      await Api.post(ROLE, `/api/tests/${t.id}/publish`, { published: !t.published });
      render();
    } catch (err) { toast(err.message); }
  });
  main.querySelectorAll('[data-export]').forEach(btn => btn.onclick = () => downloadExport(`/api/export/tests/${btn.dataset.export}`));
  main.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Delete this test and all its results?')) return;
    await Api.del(ROLE, `/api/tests/${btn.dataset.delete}`);
    render();
  });
}

function blankMcq() { return { type: 'mcq', prompt: '', options: ['', ''], correctIndex: 0, maxMarks: 1 }; }
function blankShort() { return { type: 'short', prompt: '', exemplarAnswer: '', keywords: [], maxMarks: 1 }; }

function renderTestBuilder(main) {
  const b = state.builder;
  main.innerHTML = h`
    <p><a href="#" id="backLink">&larr; All tests</a></p>
    <h2>${b.id ? 'Edit Test' : 'New Test'}</h2>
    <div class="panel">
      <label>Test title</label>
      <input type="text" id="titleInput" value="${esc(b.title)}" placeholder="e.g. Fractions Quiz">
      <label>Assign to class</label>
      <select id="classSelect">
        <option value="">— Unassigned —</option>
        ${state.classes.map(c => h`<option value="${c.id}" ${b.classId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
    </div>

    <div class="panel">
      <h3>Import questions from a file</h3>
      <p class="muted">Upload a Word, PDF, PowerPoint or Excel file. Questions are extracted automatically &mdash; review and fix them below before saving.</p>
      <input type="file" id="importFile" accept=".docx,.pdf,.pptx,.xlsx">
      <button class="btn-secondary" id="importBtn" style="margin-top:8px;">Parse File</button>
      <div id="importStatus" class="muted" style="margin-top:8px;"></div>
    </div>

    <div id="questionsList"></div>

    <div class="row wrap" style="margin:16px 0;">
      <button class="btn-secondary" id="addMcqBtn">+ Add Multiple Choice</button>
      <button class="btn-secondary" id="addShortBtn">+ Add Short Answer</button>
    </div>

    <button class="btn-primary" id="saveTestBtn">Save Test</button>
    <button class="btn-secondary" id="cancelBtn">Cancel</button>
  `;
  document.getElementById('backLink').onclick = e => { e.preventDefault(); state.builder = null; render(); };
  document.getElementById('cancelBtn').onclick = () => { state.builder = null; render(); };
  document.getElementById('titleInput').oninput = e => { b.title = e.target.value; };
  document.getElementById('classSelect').onchange = e => { b.classId = e.target.value ? Number(e.target.value) : null; };
  document.getElementById('addMcqBtn').onclick = () => { b.questions.push(blankMcq()); renderQuestionsList(); };
  document.getElementById('addShortBtn').onclick = () => { b.questions.push(blankShort()); renderQuestionsList(); };
  document.getElementById('importBtn').onclick = async () => {
    const file = document.getElementById('importFile').files[0];
    if (!file) return toast('Choose a file first.');
    const status = document.getElementById('importStatus');
    status.textContent = 'Parsing…';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await Api.post(ROLE, '/api/import/parse', fd, true);
      b.questions.push(...data.questions);
      status.textContent = `Added ${data.questionCount} question(s) from the file. Review them below.`;
      renderQuestionsList();
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
    }
  };
  document.getElementById('saveTestBtn').onclick = saveBuilder;
  renderQuestionsList();
}

function renderQuestionsList() {
  const b = state.builder;
  const list = document.getElementById('questionsList');
  list.innerHTML = b.questions.map((q, i) => h`
    <div class="question-card" data-qi="${i}">
      <div class="row between">
        <div class="qnum">Q${i + 1} &middot; ${q.type === 'mcq' ? 'Multiple Choice' : 'Short Answer'}</div>
        <button class="btn-danger" data-remove-q="${i}">Remove</button>
      </div>
      <label>Question</label>
      <textarea rows="2" data-field="prompt">${esc(q.prompt)}</textarea>
      ${q.type === 'mcq' ? h`
        <label>Options (select the correct one)</label>
        ${q.options.map((opt, oi) => h`
          <div class="option-row">
            <input type="radio" name="correct-${i}" data-correct="${oi}" ${q.correctIndex === oi ? 'checked' : ''}>
            <input type="text" data-option="${oi}" value="${esc(opt)}" placeholder="Option ${oi + 1}" style="flex:1;">
            <button class="btn-secondary" data-remove-opt="${oi}" title="Remove option">✕</button>
          </div>
        `).join('')}
        <button class="btn-secondary" data-add-opt="1" style="margin-top:6px;">+ Add Option</button>
      ` : h`
        <label>Exemplar / model answer</label>
        <textarea rows="2" data-field="exemplarAnswer">${esc(q.exemplarAnswer)}</textarea>
        <label>Key words to look for (comma separated, optional)</label>
        <input type="text" data-field="keywords" value="${esc((q.keywords || []).join(', '))}" placeholder="e.g. photosynthesis, sunlight, energy">
      `}
      <label>Marks</label>
      <input type="number" min="0.5" step="0.5" data-field="maxMarks" value="${q.maxMarks}" style="max-width:100px;">
    </div>
  `).join('') || '<p class="muted">No questions yet. Add one manually or import a file.</p>';

  list.querySelectorAll('[data-qi]').forEach(card => {
    const i = Number(card.dataset.qi);
    const q = b.questions[i];
    const field = sel => card.querySelector(sel);
    field('[data-field="prompt"]').oninput = e => { q.prompt = e.target.value; };
    if (q.type === 'mcq') {
      card.querySelectorAll('[data-option]').forEach(inp => {
        inp.oninput = e => { q.options[Number(inp.dataset.option)] = e.target.value; };
      });
      card.querySelectorAll('[data-correct]').forEach(r => {
        r.onchange = () => { q.correctIndex = Number(r.dataset.correct); };
      });
      card.querySelectorAll('[data-remove-opt]').forEach(btn => {
        btn.onclick = () => {
          const oi = Number(btn.dataset.removeOpt);
          if (q.options.length <= 2) return toast('A multiple choice question needs at least 2 options.');
          q.options.splice(oi, 1);
          if (q.correctIndex === oi) q.correctIndex = 0;
          else if (q.correctIndex > oi) q.correctIndex -= 1;
          renderQuestionsList();
        };
      });
      const addOpt = card.querySelector('[data-add-opt]');
      if (addOpt) addOpt.onclick = () => { q.options.push(''); renderQuestionsList(); };
    } else {
      field('[data-field="exemplarAnswer"]').oninput = e => { q.exemplarAnswer = e.target.value; };
      field('[data-field="keywords"]').oninput = e => { q.keywords = e.target.value.split(',').map(s => s.trim()).filter(Boolean); };
    }
    field('[data-field="maxMarks"]').oninput = e => { q.maxMarks = parseFloat(e.target.value) || 1; };
  });
  list.querySelectorAll('[data-remove-q]').forEach(btn => {
    btn.onclick = () => { b.questions.splice(Number(btn.dataset.removeQ), 1); renderQuestionsList(); };
  });
}

async function saveBuilder() {
  const b = state.builder;
  if (!b.title.trim()) return toast('Give the test a title.');
  if (b.questions.length === 0) return toast('Add at least one question.');
  for (const q of b.questions) {
    if (!q.prompt.trim()) return toast('Every question needs question text.');
    if (q.type === 'mcq' && q.options.filter(o => o.trim()).length < 2) return toast('Every multiple choice question needs at least 2 options.');
  }
  const payload = { title: b.title, classId: b.classId, questions: b.questions };
  try {
    if (b.id) await Api.put(ROLE, `/api/tests/${b.id}`, payload);
    else await Api.post(ROLE, '/api/tests', payload);
    state.builder = null;
    toast('Test saved.');
    render();
  } catch (err) { toast(err.message); }
}

// ── Grading tab ──────────────────────────────────────────────────────────
async function renderGradingTab(main) {
  await loadTests();
  if (state.gradingAttempt) return renderGradingAttempt(main);
  if (state.gradingTestId) return renderGradingList(main);

  main.innerHTML = h`
    <h2>Grading</h2>
    ${state.tests.length === 0 ? h`<p class="muted">No tests yet.</p>` : h`
      <div class="panel">
        <label>Choose a test</label>
        <select id="testSelect">
          <option value="">— Select —</option>
          ${state.tests.map(t => h`<option value="${t.id}">${esc(t.title)} (${t.attemptCount} attempt(s))</option>`).join('')}
        </select>
      </div>
    `}
  `;
  const sel = document.getElementById('testSelect');
  if (sel) sel.onchange = async () => {
    if (!sel.value) return;
    state.gradingTestId = Number(sel.value);
    await loadGradingList();
    render();
  };
}

async function loadGradingList() {
  state.gradingTest = await Api.get(ROLE, `/api/attempts/test/${state.gradingTestId}`);
}

function statusPill(status, needsReview) {
  if (status === 'not_started' || status === undefined) return '<span class="pill gray">Not started</span>';
  if (status === 'in_progress') return '<span class="pill orange">In progress</span>';
  if (status === 'submitted') return needsReview > 0
    ? `<span class="pill orange">${needsReview} to review</span>`
    : '<span class="pill blue">Submitted</span>';
  return '<span class="pill green">Reviewed</span>';
}

function renderGradingList(main) {
  const g = state.gradingTest;
  main.innerHTML = h`
    <p><a href="#" id="backLink">&larr; Choose another test</a></p>
    <div class="row between">
      <h2>${esc(g.test.title)}</h2>
      <button class="btn-secondary" id="exportBtn">⬇ Export Results</button>
    </div>
    <table><thead><tr><th></th><th>Student</th><th>Status</th><th>Score</th><th></th></tr></thead>
    <tbody>
      ${g.attempts.length === 0 ? '' : g.attempts.map(a => h`
        <tr>
          <td style="font-size:20px;">${esc(a.avatar)}</td>
          <td>${esc(a.displayName)}</td>
          <td>${statusPill(a.status, a.needsReview)}</td>
          <td>${a.status === 'not_started' ? '—' : `${a.totalScore} / ${a.maxTotal}`}</td>
          <td>${a.status === 'not_started' ? '' : `<button class="btn-secondary" data-review="${a.attemptId}">Review</button>`}</td>
        </tr>
      `).join('')}
    </tbody></table>
    ${g.attempts.length === 0 ? '<p class="muted">No students in this class yet.</p>' : ''}
  `;
  document.getElementById('backLink').onclick = e => { e.preventDefault(); state.gradingTestId = null; state.gradingTest = null; render(); };
  document.getElementById('exportBtn').onclick = () => downloadExport(`/api/export/tests/${state.gradingTestId}`);
  main.querySelectorAll('[data-review]').forEach(btn => btn.onclick = async () => {
    state.gradingAttempt = await Api.get(ROLE, `/api/attempts/${btn.dataset.review}/review`);
    render();
  });
}

function renderGradingAttempt(main) {
  const a = state.gradingAttempt;
  main.innerHTML = h`
    <p><a href="#" id="backLink">&larr; Back to results</a></p>
    <div class="row between">
      <h2>${esc(a.student.avatar)} ${esc(a.student.displayName)} &mdash; ${esc(a.testTitle)}</h2>
      <button class="btn-secondary" id="exportOneBtn">⬇ Export this result</button>
    </div>
    ${a.answers.map((ans, i) => h`
      <div class="question-card" data-ai="${i}">
        <div class="qnum">Q${i + 1} (${ans.maxMarks} marks)</div>
        <p>${esc(ans.prompt)}</p>
        ${ans.type === 'mcq' ? h`
          ${ans.options.map((opt, oi) => h`
            <div class="option-row">
              <span>${oi === ans.correctIndex ? '✅' : (oi === ans.responseIndex ? '❌' : '◻️')}</span>
              <span style="${oi === ans.responseIndex ? 'font-weight:600;' : ''}">${esc(opt)}</span>
              ${oi === ans.correctIndex ? '<span class="pill green">Correct answer</span>' : ''}
            </div>
          `).join('')}
          <p class="muted">Auto-graded: ${ans.finalScore} / ${ans.maxMarks}</p>
        ` : h`
          <p><strong>Student's answer:</strong> ${esc(ans.responseText) || '<span class="muted">(no answer given)</span>'}</p>
          <p class="muted"><strong>Exemplar:</strong> ${esc(ans.exemplarAnswer) || '—'}${ans.keywords.length ? ` &middot; Keywords: ${esc(ans.keywords.join(', '))}` : ''}</p>
          <p class="muted">Suggested mark (auto-similarity): ${ans.suggestedScore} / ${ans.maxMarks}</p>
          <label>Confirm / adjust mark</label>
          <div class="row">
            <input type="number" min="0" max="${ans.maxMarks}" step="0.5" data-score value="${ans.finalScore}" style="max-width:100px;">
            <span>/ ${ans.maxMarks}</span>
            <button class="btn-primary" data-confirm="${ans.answerId}">${ans.teacherConfirmed ? 'Update' : 'Confirm'}</button>
            ${ans.teacherConfirmed ? '<span class="pill green">Confirmed</span>' : '<span class="pill orange">Needs review</span>'}
          </div>
        `}
      </div>
    `).join('')}
    <button class="btn-green" id="finalizeBtn">Mark Fully Reviewed</button>
  `;
  document.getElementById('backLink').onclick = e => { e.preventDefault(); state.gradingAttempt = null; loadGradingList().then(render); };
  document.getElementById('exportOneBtn').onclick = () => downloadExport(`/api/export/attempts/${a.attemptId}`);
  main.querySelectorAll('[data-confirm]').forEach(btn => {
    btn.onclick = async () => {
      const card = btn.closest('.question-card');
      const score = parseFloat(card.querySelector('[data-score]').value);
      if (Number.isNaN(score)) return toast('Enter a valid score.');
      await Api.patch(ROLE, `/api/attempts/${a.attemptId}/answers/${btn.dataset.confirm}`, { finalScore: score });
      state.gradingAttempt = await Api.get(ROLE, `/api/attempts/${a.attemptId}/review`);
      render();
    };
  });
  document.getElementById('finalizeBtn').onclick = async () => {
    await Api.post(ROLE, `/api/attempts/${a.attemptId}/finalize`, {});
    toast('Marked as reviewed.');
    state.gradingAttempt = null;
    await loadGradingList();
    render();
  };
}

boot();
