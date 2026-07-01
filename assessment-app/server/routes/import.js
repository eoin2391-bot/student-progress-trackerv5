const express = require('express');
const multer = require('multer');
const { requireTeacher } = require('../auth');
const { extractText } = require('../parsers/extractText');
const { parseFromText, parseFromRows } = require('../parsers/questionParser');

const router = express.Router();
router.use(requireTeacher);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

router.post('/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const extracted = await extractText(req.file.buffer, req.file.originalname, req.file.mimetype);
    const questions = extracted.kind === 'rows'
      ? parseFromRows(extracted.rows)
      : parseFromText(extracted.text);
    res.json({ questions, questionCount: questions.length });
  } catch (err) {
    console.error('Import parse failed:', err.message);
    res.status(422).json({ error: 'Could not parse that file: ' + err.message });
  }
});

module.exports = router;
