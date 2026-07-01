const express = require('express');
const db = require('../db');
const { requireTeacher, requireStudent } = require('../auth');
const { computeSuggestedScore } = require('../grading/similarity');

const router = express.Router();

function questionRow(id) {
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
}

function sanitizedQuestion(q) {
  // Never send the answer key / exemplar to the student.
  return {
    id: q.id,
    orderIndex: q.order_index,
    type: q.type,
    prompt: q.prompt,
    options: q.options ? JSON.parse(q.options) : [],
    maxMarks: q.max_marks
  };
}

// ── Student: what tests are available ─────────────────────────────────────
router.get('/available', requireStudent, (req, res) => {
  const tests = db.prepare('SELECT * FROM tests WHERE class_id = ? AND published = 1 ORDER BY created_at DESC').all(req.classId);
  const withStatus = tests.map(t => {
    const attempt = db.prepare('SELECT * FROM attempts WHERE test_id = ? AND student_id = ?').get(t.id, req.studentId);
    const questionCount = db.prepare('SELECT COUNT(*) n FROM questions WHERE test_id = ?').get(t.id).n;
    return {
      id: t.id,
      title: t.title,
      questionCount,
      status: attempt ? attempt.status : 'not_started'
    };
  });
  res.json({ tests: withStatus });
});

router.post('/:testId/start', requireStudent, (req, res) => {
  const test = db.prepare('SELECT * FROM tests WHERE id = ? AND class_id = ? AND published = 1').get(req.params.testId, req.classId);
  if (!test) return res.status(404).json({ error: 'Test not available' });

  let attempt = db.prepare('SELECT * FROM attempts WHERE test_id = ? AND student_id = ?').get(test.id, req.studentId);
  if (!attempt) {
    const info = db.prepare('INSERT INTO attempts (test_id, student_id) VALUES (?, ?)').run(test.id, req.studentId);
    attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(info.lastInsertRowid);
  }
  if (attempt.status === 'submitted' || attempt.status === 'reviewed') {
    return res.status(409).json({ error: 'You have already submitted this test' });
  }

  const questions = db.prepare('SELECT * FROM questions WHERE test_id = ? ORDER BY order_index').all(test.id).map(sanitizedQuestion);
  res.json({ attemptId: attempt.id, test: { id: test.id, title: test.title }, questions });
});

router.post('/:attemptId/submit', requireStudent, (req, res) => {
  const attempt = db.prepare('SELECT * FROM attempts WHERE id = ? AND student_id = ?').get(req.params.attemptId, req.studentId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (attempt.status !== 'in_progress') return res.status(409).json({ error: 'This attempt was already submitted' });

  const { answers } = req.body || {};
  if (!Array.isArray(answers)) return res.status(400).json({ error: 'answers array is required' });

  const upsert = db.prepare(`
    INSERT INTO answers (attempt_id, question_id, response_text, response_index, auto_score, suggested_score, final_score, teacher_confirmed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(attempt_id, question_id) DO UPDATE SET
      response_text = excluded.response_text,
      response_index = excluded.response_index,
      auto_score = excluded.auto_score,
      suggested_score = excluded.suggested_score,
      final_score = excluded.final_score,
      teacher_confirmed = excluded.teacher_confirmed
  `);

  const tx = db.transaction(() => {
    for (const a of answers) {
      const q = questionRow(a.questionId);
      if (!q || q.test_id !== attempt.test_id) continue;

      if (q.type === 'mcq') {
        const idx = Number.isInteger(a.responseIndex) ? a.responseIndex : null;
        const correct = idx != null && idx === q.correct_index;
        const score = correct ? q.max_marks : 0;
        upsert.run(attempt.id, q.id, null, idx, score, null, score, 1);
      } else {
        const responseText = String(a.responseText || '');
        const { suggestedScore } = computeSuggestedScore({
          studentAnswer: responseText,
          exemplarAnswer: q.exemplar_answer,
          keywords: q.keywords ? JSON.parse(q.keywords) : [],
          maxMarks: q.max_marks
        });
        upsert.run(attempt.id, q.id, responseText, null, null, suggestedScore, suggestedScore, 0);
      }
    }
    db.prepare("UPDATE attempts SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?").run(attempt.id);
  });
  tx();

  res.json({ ok: true });
});

// ── Teacher: review & grading ─────────────────────────────────────────────
router.get('/test/:testId', requireTeacher, (req, res) => {
  const test = db.prepare('SELECT * FROM tests WHERE id = ? AND teacher_id = ?').get(req.params.testId, req.teacherId);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  const maxTotal = db.prepare('SELECT COALESCE(SUM(max_marks),0) n FROM questions WHERE test_id = ?').get(test.id).n;

  const attempts = db.prepare(`
    SELECT a.*, s.display_name, s.avatar
    FROM attempts a JOIN students s ON s.id = a.student_id
    WHERE a.test_id = ?
    ORDER BY s.display_name COLLATE NOCASE
  `).all(test.id);

  const withTotals = attempts.map(a => {
    const total = db.prepare('SELECT COALESCE(SUM(final_score),0) n FROM answers WHERE attempt_id = ?').get(a.id).n;
    const needsReview = db.prepare(`
      SELECT COUNT(*) n FROM answers ans JOIN questions q ON q.id = ans.question_id
      WHERE ans.attempt_id = ? AND q.type = 'short' AND ans.teacher_confirmed = 0
    `).get(a.id).n;
    return {
      attemptId: a.id,
      studentId: a.student_id,
      displayName: a.display_name,
      avatar: a.avatar,
      status: a.status,
      submittedAt: a.submitted_at,
      totalScore: total,
      maxTotal,
      needsReview
    };
  });

  res.json({ test: { id: test.id, title: test.title }, maxTotal, attempts: withTotals });
});

router.get('/:attemptId/review', requireTeacher, (req, res) => {
  const attempt = db.prepare(`
    SELECT a.*, s.display_name, s.avatar, t.teacher_id, t.title
    FROM attempts a
    JOIN students s ON s.id = a.student_id
    JOIN tests t ON t.id = a.test_id
    WHERE a.id = ?
  `).get(req.params.attemptId);
  if (!attempt || attempt.teacher_id !== req.teacherId) return res.status(404).json({ error: 'Attempt not found' });

  const rows = db.prepare(`
    SELECT ans.*, q.type, q.prompt, q.options, q.correct_index, q.exemplar_answer, q.keywords, q.max_marks, q.order_index
    FROM answers ans JOIN questions q ON q.id = ans.question_id
    WHERE ans.attempt_id = ?
    ORDER BY q.order_index
  `).all(attempt.id);

  const answers = rows.map(r => ({
    answerId: r.id,
    questionId: r.question_id,
    type: r.type,
    prompt: r.prompt,
    options: r.options ? JSON.parse(r.options) : [],
    correctIndex: r.correct_index,
    exemplarAnswer: r.exemplar_answer,
    keywords: r.keywords ? JSON.parse(r.keywords) : [],
    maxMarks: r.max_marks,
    responseText: r.response_text,
    responseIndex: r.response_index,
    autoScore: r.auto_score,
    suggestedScore: r.suggested_score,
    finalScore: r.final_score,
    teacherConfirmed: !!r.teacher_confirmed
  }));

  res.json({
    attemptId: attempt.id,
    testTitle: attempt.title,
    student: { id: attempt.student_id, displayName: attempt.display_name, avatar: attempt.avatar },
    status: attempt.status,
    submittedAt: attempt.submitted_at,
    answers
  });
});

router.patch('/:attemptId/answers/:answerId', requireTeacher, (req, res) => {
  const attempt = db.prepare(`
    SELECT a.*, t.teacher_id FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ?
  `).get(req.params.attemptId);
  if (!attempt || attempt.teacher_id !== req.teacherId) return res.status(404).json({ error: 'Attempt not found' });

  const answer = db.prepare('SELECT * FROM answers WHERE id = ? AND attempt_id = ?').get(req.params.answerId, attempt.id);
  if (!answer) return res.status(404).json({ error: 'Answer not found' });

  const { finalScore } = req.body || {};
  if (typeof finalScore !== 'number' || Number.isNaN(finalScore)) {
    return res.status(400).json({ error: 'finalScore must be a number' });
  }
  db.prepare('UPDATE answers SET final_score = ?, teacher_confirmed = 1 WHERE id = ?').run(finalScore, answer.id);
  res.json({ ok: true });
});

router.post('/:attemptId/finalize', requireTeacher, (req, res) => {
  const attempt = db.prepare(`
    SELECT a.*, t.teacher_id FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ?
  `).get(req.params.attemptId);
  if (!attempt || attempt.teacher_id !== req.teacherId) return res.status(404).json({ error: 'Attempt not found' });
  db.prepare("UPDATE attempts SET status = 'reviewed' WHERE id = ?").run(attempt.id);
  res.json({ ok: true });
});

module.exports = router;
