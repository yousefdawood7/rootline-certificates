// Renders the certificate from the template that was extracted from the PowerPoint.
// The same HTML is used for the live preview in the browser and for the PDF,
// so what you see is exactly what gets emailed.
const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const SVG_TEMPLATE = fs.readFileSync(path.join(TEMPLATE_DIR, 'certificate.svg'), 'utf8');
const SIGNATURE_B64 = fs.readFileSync(path.join(TEMPLATE_DIR, 'signature.png')).toString('base64');

const FONTS_DIR = path.join(__dirname, '..', 'node_modules', '@fontsource');
function fontFace(pkg, file, family, weight) {
  const b64 = fs.readFileSync(path.join(FONTS_DIR, pkg, 'files', file)).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
    `src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}
let FONT_CSS = null;
function fontCss() {
  if (!FONT_CSS) {
    FONT_CSS = [
      fontFace('arimo', 'arimo-latin-400-normal.woff2', 'Arimo', 400),
      fontFace('arimo', 'arimo-latin-700-normal.woff2', 'Arimo', 700),
      fontFace('jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2', 'JetBrains Mono', 400),
    ].join('\n');
  }
  return FONT_CSS;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Shrink long values so they stay inside the same box as the design's placeholder.
function fitFontSize(text, size, maxWidth, bold) {
  const charWidth = bold ? 0.6 : 0.52; // rough average glyph width in em
  const estimated = Array.from(text).length * size * charWidth;
  return estimated > maxWidth ? size * (maxWidth / estimated) : size;
}

// Fills every field placeholder in the SVG template.
function fillSvg(svg, values) {
  return svg.replace(
    /<text([^>]*?)data-field="(\w+)"([^>]*)>\{\{\w+\}\}<\/text>/g,
    (match, before, field, after) => {
      const attrs = before + after;
      const value = values[field] == null ? '' : String(values[field]);
      const maxWidth = parseFloat(attrs.match(/data-maxw="([\d.]+)"/)[1]);
      const size = parseFloat(attrs.match(/data-size="([\d.]+)"/)[1]);
      const bold = /font-weight="bold"/.test(attrs);
      const fitted = fitFontSize(value, size, maxWidth * 0.97, bold);
      const cleaned = attrs
        .replace(/\s*data-(field|maxw|size)="[^"]*"/g, '')
        .replace(/font-size="[^"]*"/, `font-size="${fitted.toFixed(1)}"`);
      return `<text${cleaned}>${escapeXml(value)}</text>`;
    }
  );
}

function certificateSvg(cert) {
  const svg = fillSvg(SVG_TEMPLATE, {
    STUDENT_NAME: cert.studentName,
    COURSE_TITLE: cert.course,
    INSTRUCTOR_NAME: cert.instructor,
    ISSUE_DATE: cert.date,
    CERT_ID: cert.id,
  });
  return svg.replace(
    'xlink:href="signature.png"',
    `xlink:href="data:image/png;base64,${SIGNATURE_B64}"`
  );
}

// Full HTML document. forPdf = true sizes it to exactly one A4 landscape page.
function certificateHtml(cert, { forPdf = false } = {}) {
  const sizing = forPdf
    ? '@page{size:A4 landscape;margin:0}html,body{width:297mm;height:210mm;margin:0;overflow:hidden}svg{width:297mm;height:210mm;display:block}'
    : 'html,body{margin:0;background:#EDEDED}svg{display:block;width:100%;height:auto;box-shadow:0 2px 12px rgba(0,0,0,.15)}';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Certificate ${escapeXml(cert.id)}</title>
<style>
${fontCss()}
${sizing}
</style>
</head>
<body>
${certificateSvg(cert)}
</body>
</html>`;
}

module.exports = { certificateHtml, certificateSvg, escapeXml };
