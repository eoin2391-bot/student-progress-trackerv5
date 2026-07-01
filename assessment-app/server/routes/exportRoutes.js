const express = require('express');
const { stringify } = require('csv-stringify/sync');
const db = require('../db');
const { requireTeacher } = require('../auth');

const router = express.Router();
router.use(requireTeacher);

function sendCsv(res, filename, rows) {
  const csv = stringify(rows, { header: true });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// Mass export: every student's total score (and per-question breakdown) for one test.
router.get('/tests/:testId', (req, res) => {
  const test = db.prepare('SELECT * FROM tests WHERE id = ? AND teacher_id = ?').get(req.params.testId, req.teacherId);
  if (!test) return res.status(404).json({ error: 'Test not found' });

  const questions = db.prepare('SELECT * FROM questions WHERE test_id = ? ORDER BY order_index').all(test.id);
  const attempts = db.prepare(`
    SELECT a.*, s.display_name FROM attempts a JOIN students s ON s.id = a.student_id
    WHERE a.test_id = ? ORDER BY s.display_name COLLATE NOCASE
  `).all(test.id);

  const rows = attempts.map(a => {
    const row = { Student: a.display_name, Status: a.status, 'Submitted At': a.submitted_at || '' };
    let total = 0;
    for (const q of questions) {
      const ans = db.prepare('SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?').get(a.id, q.id);
      const score = ans ? (ans.final_score ?? 0) : 0;
      row[`Q${q.order_index + 1} (${q.max_marks})`] = ans ? score : '';
      total += score;
    }
    row['Total'] = total;
    row['Max Total'] = questions.reduce((s, q) => s + q.max_marks, 0);
    return row;
  });

  sendCsv(res, `results_${test.title.replace(/\W+/g, '_')}.csv`, rows);
});

// Individual export: one student's full result on one test, with answers.
router.get('/attempts/:attemptId', (req, res) => {
  const attempt = db.prepare(`
    SELECT a.*, s.display_name, t.title, t.teacher_id
    FROM attempts a JOIN students s ON s.id = a.student_id JOIN tests t ON t.id = a.test_id
    WHERE a.id = ?
  `).get(req.params.attemptId);
  if (!attempt || attempt.teacher_id !== req.teacherId) return res.status(404).json({ error: 'Attempt not found' });

  const rows = db.prepare(`
    SELECT ans.*, q.order_index, q.type, q.prompt, q.max_marks
    FROM answers ans JOIN questions q ON q.id = ans.question_id
    WHERE ans.attempt_id = ? ORDER BY q.order_index
  `).all(attempt.id).map(r => ({
    Student: attempt.display_name,
    Test: attempt.title,
    Question: `Q${r.order_index + 1}: ${r.prompt}`,
    Type: r.type,
    Response: r.type === 'mcq' ? `Option ${(r.response_index ?? -1) + 1 || 'n/a'}` : (r.response_text || ''),
    Score: r.final_score,
    'Max Marks': r.max_marks
  }));

  sendCsv(res, `result_${attempt.display_name.replace(/\W+/g, '_')}_${attempt.title.replace(/\W+/g, '_')}.csv`, rows);
});

// Mass export across an entire class: one row per student, one column per test.
router.get('/classes/:classId', (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(req.params.classId, req.teacherId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const students = db.prepare('SELECT * FROM students WHERE class_id = ? ORDER BY display_name COLLATE NOCASE').all(cls.id);
  const tests = db.prepare('SELECT * FROM tests WHERE class_id = ? ORDER BY created_at').all(cls.id);

  const rows = students.map(s => {
    const row = { Student: s.display_name };
    for (const t of tests) {
      const attempt = db.prepare('SELECT * FROM attempts WHERE test_id = ? AND student_id = ?').get(t.id, s.id);
      if (!attempt) { row[t.title] = ''; continue; }
      const total = db.prepare('SELECT COALESCE(SUM(final_score),0) n FROM answers WHERE attempt_id = ?').get(attempt.id).n;
      row[t.title] = total;
    }
    return row;
  });

  sendCsv(res, `class_${cls.name.replace(/\W+/g, '_')}_results.csv`, rows);
});

module.exports = router;
