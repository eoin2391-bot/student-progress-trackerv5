const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Persist a generated secret across restarts if none is supplied via env,
// so existing logins/tokens don't get invalidated every deploy.
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const secretFile = path.join(dataDir, 'jwt_secret.txt');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const secret = require('crypto').randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

const SECRET = loadSecret();

function signTeacher(teacher) {
  return jwt.sign({ role: 'teacher', teacherId: teacher.id, username: teacher.username }, SECRET, { expiresIn: '30d' });
}

function signStudent(student) {
  return jwt.sign({ role: 'student', studentId: student.id, classId: student.class_id }, SECRET, { expiresIn: '12h' });
}

function verify(token) {
  return jwt.verify(token, SECRET);
}

function getToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function requireTeacher(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = verify(token);
    if (payload.role !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
    req.teacherId = payload.teacherId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireStudent(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = verify(token);
    if (payload.role !== 'student') return res.status(403).json({ error: 'Student access required' });
    req.studentId = payload.studentId;
    req.classId = payload.classId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { signTeacher, signStudent, verify, requireTeacher, requireStudent };
