const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signTeacher, signStudent } = require('../auth');

const router = express.Router();

// ── Teacher registration & login ──────────────────────────────────────────
router.post('/teacher/register', (req, res) => {
  const { username, name, password } = req.body || {};
  if (!username || !name || !password) {
    return res.status(400).json({ error: 'username, name and password are required' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const uname = String(username).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM teachers WHERE username = ?').get(uname);
  if (existing) return res.status(409).json({ error: 'That username is already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO teachers (username, name, password_hash) VALUES (?, ?, ?)')
    .run(uname, String(name).trim(), hash);
  const teacher = { id: info.lastInsertRowid, username: uname, name: String(name).trim() };
  res.json({ token: signTeacher(teacher), teacher });
});

router.post('/teacher/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
  const uname = String(username).trim().toLowerCase();
  const teacher = db.prepare('SELECT * FROM teachers WHERE username = ?').get(uname);
  if (!teacher || !bcrypt.compareSync(password, teacher.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  res.json({ token: signTeacher(teacher), teacher: { id: teacher.id, username: teacher.username, name: teacher.name } });
});

// ── Student sign-in (no personal information required) ───────────────────
// Step 1: look up a class by its join code to list student icons/nicknames.
router.get('/class/:joinCode', (req, res) => {
  const joinCode = String(req.params.joinCode).trim().toUpperCase();
  const cls = db.prepare('SELECT id, name, join_code FROM classes WHERE join_code = ?').get(joinCode);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  const students = db.prepare('SELECT id, display_name, avatar FROM students WHERE class_id = ? ORDER BY display_name COLLATE NOCASE')
    .all(cls.id);
  res.json({ class: cls, students });
});

// Step 2: pick your icon/nickname and enter your PIN.
router.post('/student/login', (req, res) => {
  const { joinCode, studentId, pin } = req.body || {};
  if (!joinCode || !studentId || !pin) {
    return res.status(400).json({ error: 'joinCode, studentId and pin are required' });
  }
  const cls = db.prepare('SELECT id FROM classes WHERE join_code = ?').get(String(joinCode).trim().toUpperCase());
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND class_id = ?').get(studentId, cls.id);
  if (!student || !bcrypt.compareSync(String(pin), student.pin_hash)) {
    return res.status(401).json({ error: 'Incorrect PIN' });
  }
  res.json({
    token: signStudent(student),
    student: { id: student.id, display_name: student.display_name, avatar: student.avatar, classId: cls.id }
  });
});

module.exports = router;
