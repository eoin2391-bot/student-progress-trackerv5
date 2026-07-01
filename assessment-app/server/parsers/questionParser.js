// Heuristic question extraction from raw document text or spreadsheet rows.
// Output is always a review-ready draft: the teacher confirms/edits before a
// test is saved, so these heuristics favour recall over precision.

const LETTER = 'ABCDEFGH';

function blankQuestion(orderIndex) {
  return {
    orderIndex,
    type: 'short',
    prompt: '',
    options: [],
    correctIndex: null,
    exemplarAnswer: '',
    keywords: [],
    maxMarks: 1
  };
}

function parseFromText(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const questionStart = /^(?:Q(?:uestion)?\s*)?(\d{1,3})[\.\):]\s+(.*)$/i;
  const optionStart = /^\(?([A-Ha-h])[\.\):]\s+(.*)$/;
  const answerLine = /^(?:answer|ans|correct)\s*(?:key)?[\s:=-]+\(?([A-Ha-h])\)?\s*$/i;
  const marksLine = /^\[?(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)\]?$/i;

  const questions = [];
  let current = null;
  let n = 0;

  for (const line of lines) {
    const qMatch = line.match(questionStart);
    const oMatch = line.match(optionStart);
    const aMatch = line.match(answerLine);
    const mMatch = line.match(marksLine);

    if (qMatch) {
      if (current) questions.push(current);
      n += 1;
      current = blankQuestion(n);
      current.prompt = qMatch[2].trim();
      continue;
    }
    if (!current) {
      // Text before the first detected question number: start an implicit one.
      n += 1;
      current = blankQuestion(n);
      current.prompt = line;
      continue;
    }
    if (oMatch) {
      current.type = 'mcq';
      current.options.push(oMatch[2].trim());
      continue;
    }
    if (aMatch) {
      const idx = LETTER.indexOf(aMatch[1].toUpperCase());
      if (idx >= 0) current.correctIndex = idx;
      continue;
    }
    if (mMatch) {
      current.maxMarks = parseFloat(mMatch[1]);
      continue;
    }
    // Continuation line: appends to the last option if options have started,
    // otherwise to the question prompt.
    if (current.options.length > 0) {
      current.options[current.options.length - 1] += ' ' + line;
    } else {
      current.prompt = current.prompt ? current.prompt + ' ' + line : line;
    }
  }
  if (current) questions.push(current);

  // Short-answer heuristic: no options found -> treat prompt as exemplar seed
  // only if an explicit "Exemplar:" / "Model answer:" marker was embedded.
  for (const q of questions) {
    if (q.type === 'short') {
      const m = q.prompt.match(/^(.*?)\s*(?:Exemplar|Model answer|Sample answer)\s*:\s*(.+)$/i);
      if (m) {
        q.prompt = m[1].trim();
        q.exemplarAnswer = m[2].trim();
      }
    }
  }

  return questions.filter(q => q.prompt.length > 0);
}

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

function parseFromRows(rows) {
  if (!rows.length) return [];

  const headerCandidates = rows[0].map(normalizeHeader);
  const looksLikeHeader = headerCandidates.some(h =>
    /question|prompt|answer|correct|option|type|marks?|points?/.test(h)
  );

  let colMap = null;
  let dataRows = rows;

  if (looksLikeHeader) {
    colMap = {};
    headerCandidates.forEach((h, i) => {
      if (/^question|prompt$/.test(h) || h === 'q') colMap.prompt = i;
      else if (/^option\s*a$|^a$|^opt(ion)?1$/.test(h)) colMap.optA = i;
      else if (/^option\s*b$|^b$|^opt(ion)?2$/.test(h)) colMap.optB = i;
      else if (/^option\s*c$|^c$|^opt(ion)?3$/.test(h)) colMap.optC = i;
      else if (/^option\s*d$|^d$|^opt(ion)?4$/.test(h)) colMap.optD = i;
      else if (/^answer|correct/.test(h)) colMap.answer = i;
      else if (/^type$/.test(h)) colMap.type = i;
      else if (/^marks?|points?$/.test(h)) colMap.marks = i;
      else if (/^exemplar|model answer|sample answer$/.test(h)) colMap.exemplar = i;
      else if (/^keywords?$/.test(h)) colMap.keywords = i;
    });
    dataRows = rows.slice(1);
  }

  const questions = [];
  let n = 0;
  for (const row of dataRows) {
    const get = i => (i != null && row[i] != null ? String(row[i]).trim() : '');
    const prompt = colMap ? get(colMap.prompt) : get(0);
    if (!prompt) continue;
    n += 1;
    const q = blankQuestion(n);
    q.prompt = prompt;

    if (colMap) {
      const options = [colMap.optA, colMap.optB, colMap.optC, colMap.optD]
        .map(get)
        .filter(Boolean);
      if (options.length >= 2) {
        q.type = 'mcq';
        q.options = options;
        const ansRaw = get(colMap.answer).toUpperCase();
        const idx = LETTER.indexOf(ansRaw.charAt(0));
        if (ansRaw && idx >= 0 && idx < options.length) q.correctIndex = idx;
      } else {
        q.type = 'short';
        q.exemplarAnswer = get(colMap.exemplar) || get(colMap.answer);
        q.keywords = get(colMap.keywords) ? get(colMap.keywords).split(/[,;]/).map(s => s.trim()).filter(Boolean) : [];
      }
      if (colMap.marks != null && get(colMap.marks)) q.maxMarks = parseFloat(get(colMap.marks)) || 1;
      if (colMap.type != null && get(colMap.type)) {
        const t = get(colMap.type).toLowerCase();
        if (t.startsWith('mcq') || t.startsWith('multi')) q.type = 'mcq';
        else if (t.startsWith('short')) q.type = 'short';
      }
    } else {
      // Positional fallback: question, optA, optB, optC, optD, answerLetter, marks
      const options = row.slice(1, 5).map(v => (v == null ? '' : String(v).trim())).filter(Boolean);
      if (options.length >= 2) {
        q.type = 'mcq';
        q.options = options;
        const ansRaw = String(row[5] || '').trim().toUpperCase();
        const idx = LETTER.indexOf(ansRaw.charAt(0));
        if (ansRaw && idx >= 0 && idx < options.length) q.correctIndex = idx;
        if (row[6]) q.maxMarks = parseFloat(row[6]) || 1;
      } else {
        q.type = 'short';
        q.exemplarAnswer = get(1);
      }
    }
    questions.push(q);
  }
  return questions;
}

module.exports = { parseFromText, parseFromRows };
