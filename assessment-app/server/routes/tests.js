const express = require('express');
const db = require('../db');
const { requireTeacher } = require('../auth');

const router = express.Router();
router.use(requireTeacher);

function assertOwnsTest(teacherId, testId) {
  return db.prepare('SELECT * FROM tests WHERE id = ? AND teacher_id = ?').get(testId, teacherId);
}

function serializeQuestion(q) {
  return {
    id: q.id,
    orderIndex: q.order_index,
    type: q.type,
    prompt: q.prompt,
    options: q.options ? JSON.parse(q.options) : [],
    correctIndex: q.correct_index,
    exemplarAnswer: q.exemplar_answer,
    keywords: q.keywords ? JSON.parse(q.keywords) : [],
    maxMarks: q.max_marks
  };
}

function loadTestWithQuestions(testId) {
  const test = db.prepare('SELECT * FROM tests WHERE id = ?').get(testId);
  if (!test) return null;
  const questions = db.prepare('SELECT * FROM questions WHERE test_id = ? ORDER BY order_index').all(testId)
    .map(serializeQuestion);
  return { ...test, questions };
}

function saveQuestions(testId, questions) {
  db.prepare('DELETE FROM questions WHERE test_id = ?').run(testId);
  const insert = db.prepare(`
    INSERT INTO questions (test_id, order_index, type, prompt, options, correct_index, exemplar_answer, keywords, max_marks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  questions.forEach((q, i) => {
    const type = q.type === 'mcq' ? 'mcq' : 'short';
    insert.run(
      testId,
      i,
      type,
      String(q.prompt || '').trim(),
      type === 'mcq' ? JSON.stringify((q.options || []).map(o => String(o))) : null,
      type === 'mcq' && Number.isInteger(q.correctIndex) ? q.correctIndex : null,
      type === 'short' ? String(q.exemplarAnswer || '') : null,
      type === 'short' ? JSON.stringify(q.keywords || []) : null,
      Number(q.maxMarks) > 0 ? Number(q.maxMarks) : 1
    );
  });
}

router.get('/', (req, res) => {
  const tests = db.prepare('SELECT * FROM tests WHERE teacher_id = ? ORDER BY created_at DESC').all(req.teacherId);
  const withCounts = tests.map(t => ({
    ...t,
    questionCount: db.prepare('SELECT COUNT(*) n FROM questions WHERE test_id = ?').get(t.id).n,
    attemptCount: db.prepare('SELECT COUNT(*) n FROM attempts WHERE test_id = ?').get(t.id).n
  }));
  res.json({ tests: withCounts });
});

router.post('/', (req, res) => {
  const { title, classId, questions } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Test title is required' });
  if (classId) {
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(classId, req.teacherId);
    if (!cls) return res.status(400).json({ error: 'Class not found' });
  }
  const info = db.prepare('INSERT INTO tests (teacher_id, class_id, title) VALUES (?, ?, ?)')
    .run(req.teacherId, classId || null, title.trim());
  saveQuestions(info.lastInsertRowid, questions || []);
  res.json(loadTestWithQuestions(info.lastInsertRowid));
});

router.get('/:id', (req, res) => {
  const test = assertOwnsTest(req.teacherId, req.params.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  res.json(loadTestWithQuestions(test.id));
});

router.put('/:id', (req, res) => {
  const test = assertOwnsTest(req.teacherId, req.params.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  const { title, classId, questions } = req.body || {};
  if (classId) {
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(classId, req.teacherId);
    if (!cls) return res.status(400).json({ error: 'Class not found' });
  }
  db.prepare('UPDATE tests SET title = ?, class_id = ? WHERE id = ?')
    .run(title ? title.trim() : test.title, classId || null, test.id);
  if (Array.isArray(questions)) saveQuestions(test.id, questions);
  res.json(loadTestWithQuestions(test.id));
});

router.post('/:id/publish', (req, res) => {
  const test = assertOwnsTest(req.teacherId, req.params.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  const published = !!(req.body && req.body.published);
  if (published && !test.class_id) return res.status(400).json({ error: 'Assign the test to a class before publishing' });
  db.prepare('UPDATE tests SET published = ? WHERE id = ?').run(published ? 1 : 0, test.id);
  res.json({ ok: true, published });
});

router.delete('/:id', (req, res) => {
  const test = assertOwnsTest(req.teacherId, req.params.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  db.prepare('DELETE FROM tests WHERE id = ?').run(test.id);
  res.json({ ok: true });
});

module.exports = { router, loadTestWithQuestions, serializeQuestion };
