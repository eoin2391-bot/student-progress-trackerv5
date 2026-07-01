const root = document.getElementById('root');
const ROLE = 'student';

const state = {
  student: null,
  joinCode: '',
  classInfo: null,
  pickedStudent: null,
  loginError: '',
  tests: [],
  activeTest: null, // { attemptId, test, questions }
  responses: {}, // questionId -> value
  submitted: false
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

async function boot() {
  const token = Api.getToken(ROLE);
  if (token) {
    try {
      await loadTests();
      state.student = JSON.parse(localStorage.getItem('studentInfo') || 'null');
      return render();
    } catch { Api.clearToken(ROLE); }
  }
  renderJoinCodeScreen();
}

function renderJoinCodeScreen() {
  root.innerHTML = h`
    <div class="center-screen">
      <div class="card">
        <h1>🦊 Student Sign In</h1>
        <p class="muted">Enter the class code your teacher gave you.</p>
        <label>Class code</label>
        <input type="text" id="joinCodeInput" style="text-transform:uppercase; letter-spacing:2px; font-size:20px; text-align:center;" maxlength="6" placeholder="ABC123">
        ${state.loginError ? h`<p class="error-text">${esc(state.loginError)}</p>` : ''}
        <button class="btn-primary btn-block" id="findClassBtn" style="margin-top:16px;">Continue</button>
        <p class="muted" style="text-align:center; margin-top:16px;"><a href="index.html">&larr; Back</a></p>
      </div>
    </div>
  `;
  document.getElementById('findClassBtn').onclick = async () => {
    const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
    if (!code) return;
    try {
      const data = await Api.get(ROLE, `/api/auth/class/${code}`);
      state.joinCode = code;
      state.classInfo = data;
      state.loginError = '';
      renderAvatarScreen();
    } catch (err) {
      state.loginError = err.message;
      renderJoinCodeScreen();
    }
  };
}

function renderAvatarScreen() {
  const { class: cls, students } = state.classInfo;
  root.innerHTML = h`
    <div class="center-screen">
      <div class="card wide">
        <h1>${esc(cls.name)}</h1>
        <p class="muted">Tap your icon.</p>
        <div class="avatar-grid">
          ${students.map(s => h`
            <button class="avatar-btn" data-id="${s.id}">
              <div class="icon">${esc(s.avatar)}</div>
              <div class="name">${esc(s.display_name)}</div>
            </button>
          `).join('')}
        </div>
        ${students.length === 0 ? '<p class="muted">Your teacher hasn\'t added any students to this class yet.</p>' : ''}
        <p class="muted" style="margin-top:16px;"><a href="#" id="backLink">&larr; Different class code</a></p>
      </div>
    </div>
  `;
  document.getElementById('backLink').onclick = e => { e.preventDefault(); renderJoinCodeScreen(); };
  root.querySelectorAll('[data-id]').forEach(btn => {
    btn.onclick = () => {
      state.pickedStudent = students.find(s => s.id === Number(btn.dataset.id));
      renderPinScreen();
    };
  });
}

function renderPinScreen() {
  const s = state.pickedStudent;
  root.innerHTML = h`
    <div class="center-screen">
      <div class="card">
        <div style="text-align:center; font-size:48px;">${esc(s.avatar)}</div>
        <h2 style="text-align:center;">${esc(s.display_name)}</h2>
        <label>Enter your 4-digit PIN</label>
        <input type="password" id="pinInput" maxlength="4" style="text-align:center; letter-spacing:.5em; font-size:26px;">
        ${state.loginError ? h`<p class="error-text">${esc(state.loginError)}</p>` : ''}
        <button class="btn-primary btn-block" id="unlockBtn" style="margin-top:16px;">Unlock</button>
        <p class="muted" style="text-align:center; margin-top:16px;"><a href="#" id="backLink">&larr; Not me</a></p>
      </div>
    </div>
  `;
  document.getElementById('backLink').onclick = e => { e.preventDefault(); renderAvatarScreen(); };
  const pinInput = document.getElementById('pinInput');
  pinInput.oninput = () => { pinInput.value = pinInput.value.replace(/\D/g, ''); };
  pinInput.onkeydown = e => { if (e.key === 'Enter') unlock(); };
  document.getElementById('unlockBtn').onclick = unlock;

  async function unlock() {
    const pin = pinInput.value;
    try {
      const data = await Api.post(ROLE, '/api/auth/student/login', { joinCode: state.joinCode, studentId: s.id, pin });
      Api.setToken(ROLE, data.token);
      localStorage.setItem('studentInfo', JSON.stringify(data.student));
      state.student = data.student;
      state.loginError = '';
      await loadTests();
      render();
    } catch (err) {
      state.loginError = err.message;
      renderPinScreen();
    }
  }
}

async function loadTests() {
  const { tests } = await Api.get(ROLE, '/api/attempts/available');
  state.tests = tests;
}

function logout() {
  Api.clearToken(ROLE);
  localStorage.removeItem('studentInfo');
  Object.assign(state, { student: null, joinCode: '', classInfo: null, pickedStudent: null, tests: [], activeTest: null, responses: {}, submitted: false });
  renderJoinCodeScreen();
}

function statusLabel(status) {
  if (status === 'not_started') return '<span class="pill gray">Not started</span>';
  if (status === 'in_progress') return '<span class="pill orange">In progress</span>';
  if (status === 'submitted') return '<span class="pill blue">Submitted</span>';
  return '<span class="pill green">Reviewed</span>';
}

function render() {
  if (state.activeTest) return renderTestScreen();
  root.innerHTML = h`
    <div class="center-screen">
      <div class="card wide">
        <div class="row between">
          <h1>${esc(state.student.avatar)} Hi, ${esc(state.student.display_name)}</h1>
          <button class="btn-secondary" id="logoutBtn">Log Out</button>
        </div>
        <h3>Your tests</h3>
        ${state.tests.length === 0 ? '<p class="muted">No tests are available right now.</p>' : ''}
        ${state.tests.map(t => h`
          <div class="panel row between">
            <div>
              <strong>${esc(t.title)}</strong>
              <div class="muted">${t.questionCount} question(s)</div>
            </div>
            <div class="row">
              ${statusLabel(t.status)}
              ${t.status === 'not_started' || t.status === 'in_progress'
                ? h`<button class="btn-primary" data-start="${t.id}">${t.status === 'in_progress' ? 'Resume' : 'Start'}</button>`
                : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.getElementById('logoutBtn').onclick = logout;
  root.querySelectorAll('[data-start]').forEach(btn => btn.onclick = () => startTest(Number(btn.dataset.start)));
}

async function startTest(testId) {
  try {
    const data = await Api.post(ROLE, `/api/attempts/${testId}/start`, {});
    state.activeTest = data;
    state.responses = {};
    state.submitted = false;
    render();
  } catch (err) { toast(err.message); }
}

function renderTestScreen() {
  const t = state.activeTest;
  if (state.submitted) {
    root.innerHTML = h`
      <div class="center-screen">
        <div class="card">
          <h1>✅ Submitted!</h1>
          <p class="muted">Your answers for "${esc(t.test.title)}" have been submitted. Your teacher will review your results.</p>
          <button class="btn-primary btn-block" id="doneBtn">Back to my tests</button>
        </div>
      </div>
    `;
    document.getElementById('doneBtn').onclick = async () => { state.activeTest = null; await loadTests(); render(); };
    return;
  }

  root.innerHTML = h`
    <div class="center-screen">
      <div class="card wide">
        <h1>${esc(t.test.title)}</h1>
        <form id="testForm">
          ${t.questions.map((q, i) => h`
            <div class="question-card">
              <div class="qnum">Q${i + 1} (${q.maxMarks} marks)</div>
              <p>${esc(q.prompt)}</p>
              ${q.type === 'mcq' ? q.options.map((opt, oi) => h`
                <div class="option-row">
                  <input type="radio" name="q-${q.id}" value="${oi}" id="q${q.id}-${oi}">
                  <label for="q${q.id}-${oi}" style="margin:0; font-weight:400;">${esc(opt)}</label>
                </div>
              `).join('') : h`
                <textarea rows="3" data-question="${q.id}" placeholder="Type your answer…"></textarea>
              `}
            </div>
          `).join('')}
          <button type="submit" class="btn-primary btn-block">Submit Test</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById('testForm').onsubmit = async e => {
    e.preventDefault();
    const answers = t.questions.map(q => {
      if (q.type === 'mcq') {
        const checked = document.querySelector(`input[name="q-${q.id}"]:checked`);
        return { questionId: q.id, responseIndex: checked ? Number(checked.value) : null };
      }
      const ta = document.querySelector(`[data-question="${q.id}"]`);
      return { questionId: q.id, responseText: ta ? ta.value : '' };
    });
    try {
      await Api.post(ROLE, `/api/attempts/${t.attemptId}/submit`, { answers });
      state.submitted = true;
      render();
    } catch (err) { toast(err.message); }
  };
}

boot();
