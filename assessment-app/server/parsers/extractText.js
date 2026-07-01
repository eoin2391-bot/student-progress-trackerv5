const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const JSZip = require('jszip');
const xml2js = require('xml2js');
const ExcelJS = require('exceljs');

async function extractDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return { kind: 'text', text: value };
}

async function extractPdf(buffer) {
  const data = await pdfParse(buffer);
  return { kind: 'text', text: data.text };
}

async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);
      return na - nb;
    });

  const parser = new xml2js.Parser();
  const slideTexts = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async('string');
    const parsed = await parser.parseStringPromise(xml);
    const paragraphLines = [];

    // Collect each <a:p> paragraph's runs as one line; runs within a
    // paragraph are joined with no separator (they're fragments of one line),
    // but distinct paragraphs become distinct lines so the question/option
    // segmentation heuristics (which are line-based) still work.
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node['a:p']) {
        for (const p of node['a:p']) {
          const runTexts = [];
          (function collectRuns(n) {
            if (!n || typeof n !== 'object') return;
            if (n['a:t']) {
              for (const t of n['a:t']) {
                if (typeof t === 'string') runTexts.push(t);
                else if (t && t._) runTexts.push(t._);
              }
            }
            for (const key of Object.keys(n)) {
              const val = n[key];
              if (Array.isArray(val)) val.forEach(collectRuns);
              else if (typeof val === 'object') collectRuns(val);
            }
          })(p);
          paragraphLines.push(runTexts.join(''));
        }
      }
      for (const key of Object.keys(node)) {
        const val = node[key];
        if (Array.isArray(val)) val.forEach(walk);
        else if (typeof val === 'object') walk(val);
      }
    })(parsed);
    slideTexts.push(paragraphLines.join('\n'));
  }
  return { kind: 'text', text: slideTexts.join('\n\n') };
}

async function extractXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, row => {
    const values = row.values.slice(1).map(v => {
      if (v == null) return '';
      if (typeof v === 'object' && v.text) return v.text;
      if (typeof v === 'object' && v.richText) return v.richText.map(r => r.text).join('');
      return String(v);
    });
    rows.push(values);
  });
  return { kind: 'rows', rows };
}

async function extractText(buffer, filename, mimetype) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'docx' || mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocx(buffer);
  }
  if (ext === 'pdf' || mimetype === 'application/pdf') {
    return extractPdf(buffer);
  }
  if (ext === 'pptx' || mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return extractPptx(buffer);
  }
  if (ext === 'xlsx' || mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return extractXlsx(buffer);
  }
  throw new Error(`Unsupported file type: .${ext}`);
}

module.exports = { extractText };
