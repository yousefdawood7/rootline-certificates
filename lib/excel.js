// Reads an uploaded .xlsx, .xls or .csv file and finds the columns we need.
const XLSX = require('xlsx');

const FIELD_PATTERNS = {
  studentName: /(student|recipient|full\s*name|^name$|attendee|participant)/i,
  email: /e-?mail/i,
  course: /(course|workshop|program|title)/i,
  instructor: /(instructor|teacher|trainer|facilitator)/i,
  date: /date/i,
};

function readWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { sheetName, headers, rows };
}

function suggestMapping(headers) {
  const mapping = {};
  for (const field of Object.keys(FIELD_PATTERNS)) {
    const match = headers.find((h) => FIELD_PATTERNS[field].test(String(h)));
    mapping[field] = match || '';
  }
  return mapping;
}

module.exports = { readWorkbook, suggestMapping };
