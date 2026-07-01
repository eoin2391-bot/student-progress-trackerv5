const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireTeacher } = require('../auth');

const router = express.Router();
router.use(requireTeacher);

const AVATARS = ['🦊','🐼','🐶','🐱','🦁','🐸','🐵','🐰','🐨','🐯','🦄','🐙','🐢','🦉','🐳','🦋','🐝','🐞','🦖','🐬'];

function genJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join('');
  } while (db.prepare('SELECT 1 FROM classes WHERE join_code = ?').get(code));
  return code;
}

function assertOwnsClass(teacherId, classId) {
  return db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(classId, teacherId);
}

router.get('/avatars', (req, res) => res.json({ avatars: AVATARS }));

router.get('/', (req, res) => {
  const classes = db.prepare('SELECT * FROM classes WHERE teacher_id = ? ORDER BY created_at DESC').all(req.teacherId);
  const withCounts = classes.map(c => ({
    ...c,
    studentCount: db.prepare('SELECT COUNT(*) n FROM students WHERE class_id = ?').get(c.id).n
  }));
  res.json({ classes: withCounts });
});

router.post('/', (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Class name is required' });
  const joinCode = genJoinCode();
  const info = db.prepare('INSERT INTO classes (teacher_id, name, join_code) VALUES (?, ?, ?)')
    .run(req.teacherId, name.trim(), joinCode);
  res.json(db.prepare('SELECT * FROM classes WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  const cls = assertOwnsClass(req.teacherId, req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  db.prepare('DELETE FROM classes WHERE id = ?').run(cls.id);
  res.json({ ok: true });
});

// ── Students within a class ────────────────────────────────────────────────
router.get('/:id/students', (req, res) => {
  const cls = assertOwnsClass(req.teacherId, req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  const students = db.prepare('SELECT id, display_name, avatar, created_at FROM students WHERE class_id = ? ORDER BY display_name COLLATE NOCASE')
    .all(cls.id);
  res.json({ students });
});

router.post('/:id/students', (req, res) => {
  const cls = assertOwnsClass(req.teacherId, req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  const { displayName, avatar, pin } = req.body || {};
  if (!displayName || !displayName.trim()) return res.status(400).json({ error: 'Display name / nickname is required' });
  if (!/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
  const chosenAvatar = AVATARS.includes(avatar) ? avatar : AVATARS[crypto.randomInt(AVATARS.length)];
  const pinHash = bcrypt.hashSync(String(pin), 10);
  const info = db.prepare('INSERT INTO students (class_id, display_name, avatar, pin_hash) VALUES (?, ?, ?, ?)')
    .run(cls.id, displayName.trim(), chosenAvatar, pinHash);
  res.json({ id: info.lastInsertRowid, display_name: displayName.trim(), avatar: chosenAvatar });
});

// Bulk import of student nicknames, one per line, format: "Name" or "Name, PIN"
router.post('/:id/students/bulk', (req, res) => {
  const cls = assertOwnsClass(req.teacherId, req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });

  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  const insert = db.prepare('INSERT INTO students (class_id, display_name, avatar, pin_hash) VALUES (?, ?, ?, ?)');
  const created = [];
  const tx = db.transaction(() => {
    for (const line of lines) {
      const [namePart, pinPart] = line.split(',').map(s => s && s.trim());
      const name = namePart;
      if (!name) continue;
      const pin = /^\d{4}$/.test(pinPart || '') ? pinPart : String(crypto.randomInt(0, 10000)).padStart(4, '0');
      const avatar = AVATARS[crypto.randomInt(AVATARS.length)];
      const pinHash = bcrypt.hashSync(pin, 10);
      const info = insert.run(cls.id, name, avatar, pinHash);
      created.push({ id: info.lastInsertRowid, display_name: name, avatar, pin });
    }
  });
  tx();
  res.json({ created });
});

router.patch('/:id/students/:studentId', (req, res) => {
  const cls = assertOwnsClass(req.teacherId, req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND class_id = ?').get(req.params.studentId, cls.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const { displayName, avatar, pin } = req.body || {};
  const updates = [];
  const values = [];
  if (displayName && displayName.trim()) { updates.push('display_name = ?'); values.push(displayName.trim()); }
  if (avatar && AVATARS.includes(avatar)) { updates.push('avatar = ?'); values.push(avatar); }
  if (pin) {
    if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    updates.push('pin_hash = ?');
    values.push(bcrypt.hashSync(String(pin), 10));
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  values.push(student.id);
  db.prepare(`UPDATE students SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

router.delete('/:id/students/:studentId', (req, res) => {
  const cls = assertOwnsClass(req.teacherId, req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  db.prepare('DELETE FROM students WHERE id = ? AND class_id = ?').run(req.params.studentId, cls.id);
  res.json({ ok: true });
});

module.exports = router;
