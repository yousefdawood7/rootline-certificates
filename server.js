require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const store = require('./lib/store');
const { newCertificateId } = require('./lib/ids');
const { certificateHtml } = require('./lib/template');
const { certificatePdf } = require('./lib/pdf');
const { sendCertificateEmail } = require('./lib/mailer');
const { readWorkbook, suggestMapping } = require('./lib/excel');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS) || 600; // Resend allows ~2 requests/second

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanFields(input) {
  return {
    studentName: String(input.studentName || '').trim(),
    email: String(input.email || '').trim(),
    course: String(input.course || '').trim(),
    instructor: String(input.instructor || '').trim(),
    date: String(input.date || '').trim(),
  };
}

function validate(fields) {
  const errors = [];
  if (!fields.studentName) errors.push('Student name is required');
  if (!EMAIL_RE.test(fields.email)) errors.push('A valid email is required');
  if (!fields.course) errors.push('Course is required');
  if (!fields.instructor) errors.push('Instructor is required');
  if (!fields.date) errors.push('Date is required');
  return errors;
}

// "2026-10-22" or a real date -> "October 2026" (matches the design's date line)
function formatCertificateDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ---------- status & email template ----------

app.get('/api/status', (req, res) => {
  res.json({
    resendConfigured: Boolean(process.env.RESEND_API_KEY),
    from: process.env.RESEND_FROM || null,
  });
});

app.get('/api/email-template', (req, res) => res.json(store.getEmailTemplate()));

app.put('/api/email-template', (req, res) => {
  res.json(store.setEmailTemplate({
    subject: String(req.body.subject || ''),
    body: String(req.body.body || ''),
  }));
});

// ---------- spreadsheet import ----------

// Step 1: read the file and suggest which column is which
app.post('/api/import/inspect', (req, res) => {
  try {
    const buffer = Buffer.from(req.body.file, 'base64');
    const { sheetName, headers, rows } = readWorkbook(buffer);
    res.json({
      sheetName,
      headers,
      rowCount: rows.length,
      sample: rows.slice(0, 5),
      suggestedMapping: suggestMapping(headers),
    });
  } catch (err) {
    res.status(400).json({ error: 'Could not read that file: ' + err.message });
  }
});

// Step 2: create draft certificates, each with its own generated ID
app.post('/api/import', (req, res) => {
  try {
    const buffer = Buffer.from(req.body.file, 'base64');
    const { rows } = readWorkbook(buffer);
    const mapping = req.body.mapping || {};
    const defaults = req.body.defaults || {};
    const created = [];
    const skipped = [];

    rows.forEach((row, index) => {
      const get = (field) => (mapping[field] ? row[mapping[field]] : '');
      const fields = cleanFields({
        studentName: get('studentName'),
        email: get('email'),
        course: get('course') || defaults.course,
        instructor: get('instructor') || defaults.instructor,
        date: formatCertificateDate(get('date') || defaults.date),
      });
      const errors = validate(fields);
      if (errors.length) {
        skipped.push({ row: index + 2, reason: errors.join('; ') }); // +2: header row + 1-based
        return;
      }
      const id = newCertificateId(undefined, store.idExists);
      created.push(store.addCertificate({ id, ...fields }));
    });

    res.json({ created: created.length, skipped, certificates: created });
  } catch (err) {
    res.status(400).json({ error: 'Import failed: ' + err.message });
  }
});

// ---------- certificates ----------

app.get('/api/certificates', (req, res) => res.json(store.listCertificates()));

// Create one certificate by hand (the "make the first, then the second" flow)
app.post('/api/certificates', (req, res) => {
  const fields = cleanFields(req.body);
  const errors = validate(fields);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const id = newCertificateId(undefined, store.idExists);
  res.status(201).json(store.addCertificate({ id, ...fields }));
});

app.get('/api/certificates/:id', (req, res) => {
  const cert = store.getCertificate(req.params.id);
  if (!cert) return res.status(404).json({ error: 'Not found' });
  res.json(cert);
});

// Edit fields. The ID never changes. Sent certificates are locked.
app.put('/api/certificates/:id', (req, res) => {
  const cert = store.getCertificate(req.params.id);
  if (!cert) return res.status(404).json({ error: 'Not found' });
  if (cert.status === 'sent') return res.status(409).json({ error: 'This certificate was already sent and is locked' });
  const fields = cleanFields({ ...cert, ...req.body });
  const errors = validate(fields);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  res.json(store.updateCertificate(cert.id, { ...fields, status: 'draft', error: null }));
});

app.delete('/api/certificates/:id', (req, res) => {
  const cert = store.getCertificate(req.params.id);
  if (!cert) return res.status(404).json({ error: 'Not found' });
  if (cert.status === 'sent') return res.status(409).json({ error: 'Sent certificates cannot be deleted' });
  store.deleteCertificate(cert.id);
  res.json({ ok: true });
});

// Live preview: the exact HTML used for the PDF, shown in the UI
app.get('/api/certificates/:id/preview', (req, res) => {
  const cert = store.getCertificate(req.params.id);
  if (!cert) return res.status(404).send('Not found');
  res.type('html').send(certificateHtml(cert));
});

app.get('/api/certificates/:id/pdf', async (req, res) => {
  try {
    const cert = store.getCertificate(req.params.id);
    if (!cert) return res.status(404).json({ error: 'Not found' });
    const pdf = await certificatePdf(cert);
    res.type('application/pdf');
    res.set('Content-Disposition', `attachment; filename="RootLine-Certificate-${cert.id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- sending (batch jobs) ----------

const jobs = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runJob(job, { ids, subject, body, force }) {
  for (const id of ids) {
    const cert = store.getCertificate(id);
    job.current = id;
    if (!cert) {
      job.results.push({ id, status: 'failed', error: 'Not found' });
      job.failed++;
    } else if (cert.status === 'sent' && !force) {
      job.results.push({ id, email: cert.email, status: 'skipped', error: 'Already sent' });
      job.skipped++;
    } else {
      try {
        const pdf = await certificatePdf(cert);
        const resendId = await sendCertificateEmail({ cert, subject, body, pdf });
        store.updateCertificate(id, { status: 'sent', sentAt: new Date().toISOString(), resendId, error: null });
        job.results.push({ id, email: cert.email, status: 'sent' });
        job.sent++;
      } catch (err) {
        store.updateCertificate(id, { status: 'failed', error: err.message });
        job.results.push({ id, email: cert.email, status: 'failed', error: err.message });
        job.failed++;
      }
    }
    job.done++;
    await sleep(SEND_DELAY_MS);
  }
  job.current = null;
  job.finished = true;
  job.finishedAt = new Date().toISOString();
}

// ids: list of certificate IDs; omit to send every draft/failed certificate
app.post('/api/send', (req, res) => {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    return res.status(400).json({ error: 'Set RESEND_API_KEY and RESEND_FROM in your .env file first' });
  }
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!subject || !body) return res.status(400).json({ error: 'Email subject and message are required' });

  store.setEmailTemplate({ subject, body });

  const all = store.listCertificates();
  const ids = Array.isArray(req.body.ids) && req.body.ids.length
    ? req.body.ids
    : all.filter((c) => c.status !== 'sent').map((c) => c.id);
  if (!ids.length) return res.status(400).json({ error: 'Nothing to send' });

  const job = {
    id: crypto.randomUUID(),
    total: ids.length,
    done: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    current: null,
    finished: false,
    results: [],
  };
  jobs.set(job.id, job);
  runJob(job, { ids, subject, body, force: Boolean(req.body.force) });
  res.status(202).json({ jobId: job.id, total: job.total });
});

// Sends one certificate to a test address you choose. Status and history are not changed.
app.post('/api/send-test', async (req, res) => {
  try {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
      return res.status(400).json({ error: 'Set RESEND_API_KEY and RESEND_FROM in your .env file first' });
    }
    const cert = store.getCertificate(req.body.id);
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });
    const to = String(req.body.to || '').trim();
    if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Enter a valid test email address' });
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '').trim();
    if (!subject || !body) return res.status(400).json({ error: 'Email subject and message are required' });

    const pdf = await certificatePdf(cert);
    await sendCertificateEmail({
      cert: { ...cert, email: to },
      subject: '[TEST] ' + subject,
      body,
      pdf,
    });
    res.json({ ok: true, sentTo: to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`RootLine Certificates running at http://localhost:${PORT}`);
  if (!process.env.RESEND_API_KEY) console.log('Warning: RESEND_API_KEY is not set yet (preview still works).');
});
