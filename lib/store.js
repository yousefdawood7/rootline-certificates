// Local storage: every certificate and the email template are saved to data/store.json on this machine.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_STORE = {
  certificates: [],
  emailTemplate: {
    subject: 'Your RootLine certificate: {{course}}',
    body:
      'Hi {{name}},\n\n' +
      'Congratulations on completing {{course}}. Your certificate is attached to this email.\n\n' +
      'Certificate ID: {{id}}\n\n' +
      'Best regards,\n{{instructor}}\nRootLine',
  },
};

let state = null;

function load() {
  if (state) return state;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    state.certificates = state.certificates || [];
    state.emailTemplate = state.emailTemplate || DEFAULT_STORE.emailTemplate;
  } else {
    state = JSON.parse(JSON.stringify(DEFAULT_STORE));
    save();
  }
  return state;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE); // atomic replace, so a crash never leaves a half-written file
}

function listCertificates() {
  return load().certificates;
}

function getCertificate(id) {
  return load().certificates.find((c) => c.id === id) || null;
}

function idExists(id) {
  return load().certificates.some((c) => c.id === id);
}

function addCertificate(cert) {
  const now = new Date().toISOString();
  const record = {
    uid: crypto.randomUUID(),
    status: 'draft', // draft | sent | failed
    sentAt: null,
    resendId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    ...cert,
  };
  load().certificates.push(record);
  save();
  return record;
}

function updateCertificate(id, changes) {
  const cert = getCertificate(id);
  if (!cert) return null;
  Object.assign(cert, changes, { updatedAt: new Date().toISOString() });
  save();
  return cert;
}

function deleteCertificate(id) {
  const s = load();
  const before = s.certificates.length;
  s.certificates = s.certificates.filter((c) => c.id !== id);
  save();
  return s.certificates.length < before;
}

function getEmailTemplate() {
  return load().emailTemplate;
}

function setEmailTemplate(template) {
  load().emailTemplate = { subject: template.subject, body: template.body };
  save();
  return load().emailTemplate;
}

module.exports = {
  listCertificates,
  getCertificate,
  idExists,
  addCertificate,
  updateCertificate,
  deleteCertificate,
  getEmailTemplate,
  setEmailTemplate,
};
