// Local, offline suggested-marking for short-answer questions. Compares a
// student's answer to the teacher's exemplar (and optional keyword list)
// using token overlap. This is a suggestion only — the teacher always
// confirms or overrides the final mark.

const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','to','of','in',
  'on','for','and','or','but','it','its','this','that','these','those','as',
  'at','by','with','from','into','than','then','so','if','not','no','do',
  'does','did','has','have','had','can','could','will','would','should',
  'i','you','he','she','they','we','my','your','his','her','their','our'
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function keywordCoverage(studentTokens, keywords) {
  if (!keywords || keywords.length === 0) return null;
  const studentSet = new Set(studentTokens);
  const normalizedKeywords = keywords.map(k => tokenize(k).join(' ')).filter(Boolean);
  if (normalizedKeywords.length === 0) return null;
  let hits = 0;
  for (const kw of normalizedKeywords) {
    const kwTokens = kw.split(' ');
    const found = kwTokens.every(t => studentSet.has(t));
    if (found) hits += 1;
  }
  return hits / normalizedKeywords.length;
}

// Returns { suggestedScore, similarity, matchedKeywordRatio }
function computeSuggestedScore({ studentAnswer, exemplarAnswer, keywords, maxMarks }) {
  const studentTokens = tokenize(studentAnswer);
  if (studentTokens.length === 0) {
    return { suggestedScore: 0, similarity: 0, matchedKeywordRatio: keywords && keywords.length ? 0 : null };
  }

  const exemplarTokens = tokenize(exemplarAnswer);
  const similarity = jaccard(new Set(studentTokens), new Set(exemplarTokens));
  const keywordRatio = keywordCoverage(studentTokens, keywords);

  // Blend: if keywords were supplied, weight them more heavily than raw
  // similarity since they represent the concepts the teacher cares about.
  const blended = keywordRatio != null
    ? (0.4 * similarity + 0.6 * keywordRatio)
    : similarity;

  const suggestedScore = Math.round(blended * maxMarks * 100) / 100;
  return {
    suggestedScore: Math.max(0, Math.min(maxMarks, suggestedScore)),
    similarity: Math.round(similarity * 100) / 100,
    matchedKeywordRatio: keywordRatio == null ? null : Math.round(keywordRatio * 100) / 100
  };
}

module.exports = { computeSuggestedScore, tokenize };
