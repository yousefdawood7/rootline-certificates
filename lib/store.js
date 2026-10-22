// Local storage: sent certificates and the email template are saved to data/store.json on this machine.
// Active drafts live in memory and browser localStorage; only sent certificates are committed to store.json as a reference log.
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
const activeDrafts = new Map();

function load() {
  if (state) return state;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      state.certificates = (state.certificates || []).filter((c) => c.status === 'sent');
      state.emailTemplate = state.emailTemplate || DEFAULT_STORE.emailTemplate;
    } catch {
      state = JSON.parse(JSON.stringify(DEFAULT_STORE));
    }
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

function syncDraft(cert) {
  if (!cert || !cert.id) return;
  // If already logged as sent in store.json, do not resurrect as draft
  if (load().certificates.some((c) => c.id === cert.id)) return;
  activeDrafts.set(cert.id, {
    uid: cert.uid || crypto.randomUUID(),
    status: 'draft',
    sentAt: null,
    resendId: null,
    error: null,
    createdAt: cert.createdAt || new Date().toISOString(),
    updatedAt: cert.updatedAt || new Date().toISOString(),
    ...cert,
  });
}

function listCertificates() {
  return Array.from(activeDrafts.values());
}

function listSentCertificates() {
  return load().certificates.filter((c) => c.status === 'sent');
}

function getCertificate(id) {
  return activeDrafts.get(id) || load().certificates.find((c) => c.id === id) || null;
}

function idExists(id) {
  return activeDrafts.has(id) || load().certificates.some((c) => c.id === id);
}

function addCertificate(cert) {
  const now = new Date().toISOString();
  const record = {
    uid: crypto.randomUUID(),
    status: cert.status || 'draft', // draft | sent | failed
    sentAt: cert.sentAt || null,
    resendId: cert.resendId || null,
    error: cert.error || null,
    createdAt: now,
    updatedAt: now,
    ...cert,
  };
  if (record.status === 'sent') {
    load().certificates.push(record);
    save();
  } else {
    activeDrafts.set(record.id, record);
  }
  return record;
}

function updateCertificate(id, changes) {
  const now = new Date().toISOString();
  if (changes.status === 'sent') {
    const existing = activeDrafts.get(id) || load().certificates.find((c) => c.id === id) || { id };
    activeDrafts.delete(id);
    const updated = { ...existing, ...changes, updatedAt: now };
    const s = load();
    const idx = s.certificates.findIndex((c) => c.id === id);
    if (idx !== -1) {
      s.certificates[idx] = updated;
    } else {
      s.certificates.push(updated);
    }
    save();
    return updated;
  }

  // Not sent - update in activeDrafts
  const cert = activeDrafts.get(id);
  if (!cert) {
    const sentCert = load().certificates.find((c) => c.id === id);
    if (sentCert) {
      Object.assign(sentCert, changes, { updatedAt: now });
      save();
      return sentCert;
    }
    return null;
  }
  Object.assign(cert, changes, { updatedAt: now });
  return cert;
}

function deleteCertificate(id) {
  let deleted = false;
  if (activeDrafts.has(id)) {
    activeDrafts.delete(id);
    deleted = true;
  }
  const s = load();
  const before = s.certificates.length;
  s.certificates = s.certificates.filter((c) => c.id !== id);
  if (s.certificates.length < before) {
    save();
    deleted = true;
  }
  return deleted;
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
  listSentCertificates,
  getCertificate,
  idExists,
  addCertificate,
  updateCertificate,
  deleteCertificate,
  syncDraft,
  getEmailTemplate,
  setEmailTemplate,
};
