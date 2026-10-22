const $ = (sel) => document.querySelector(sel);
const DRAFTS_KEY = 'rootline.drafts';
const state = { certs: [], allCerts: [], hiddenIds: new Set(), selectedId: null, fileBase64: null, headers: [] };

function loadStoredDrafts() {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((c) => c && c.id && c.status !== 'sent') : [];
  } catch {
    return [];
  }
}

function saveStoredDrafts(drafts) {
  try {
    const clean = (drafts || []).filter((c) => c && c.id && c.status !== 'sent');
    if (clean.length === 0) {
      localStorage.removeItem(DRAFTS_KEY);
    } else {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(clean));
    }
  } catch (e) {
    console.error('Failed to save drafts to localStorage', e);
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function setMsg(el, text, ok) {
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

// ---------- status, template, list ----------

async function loadStatus() {
  const s = await api('/api/status');
  const pill = $('#status');
  if (s.resendConfigured && s.from) {
    pill.textContent = 'Resend ready · ' + s.from;
    pill.className = 'pill ok';
  } else {
    pill.textContent = 'Resend not configured (.env)';
    pill.className = 'pill bad';
  }
}

async function loadTemplate() {
  const t = await api('/api/email-template');
  $('#subject').value = t.subject;
  $('#body').value = t.body;
}

async function loadCerts(keepSelection = true) {
  const localDrafts = loadStoredDrafts();
  if (localDrafts.length > 0) {
    try {
      await api('/api/certificates/sync', { method: 'POST', body: { drafts: localDrafts } });
    } catch (e) {
      console.warn('Sync drafts error:', e);
    }
  }
  const serverDrafts = await api('/api/certificates');
  state.allCerts = (serverDrafts || []).filter((c) => c.status !== 'sent');
  saveStoredDrafts(state.allCerts);
  refreshVisibleCerts(keepSelection);
}

function refreshVisibleCerts(keepSelection = true) {
  state.certs = state.allCerts.filter((c) => !state.hiddenIds.has(c.id));
  if (!keepSelection || !state.certs.find((c) => c.id === state.selectedId)) {
    state.selectedId = state.certs.length ? state.certs[0].id : null;
  }
  renderList();
  renderWorkspace();
}

async function removeFromBatch(id) {
  const cert = state.allCerts.find((c) => c.id === id);
  if (!cert) return;

  try {
    await api(`/api/certificates/${id}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('Failed to delete on server:', e);
  }

  const nextIdx = state.certs.findIndex((c) => c.id === id);
  state.hiddenIds.delete(id);
  state.allCerts = state.allCerts.filter((c) => c.id !== id);
  state.certs = state.allCerts.filter((c) => !state.hiddenIds.has(c.id));
  saveStoredDrafts(state.allCerts);

  if (state.selectedId === id) {
    if (state.certs.length > 0) {
      const newIdx = Math.min(nextIdx, state.certs.length - 1);
      state.selectedId = state.certs[newIdx].id;
    } else {
      state.selectedId = null;
    }
  }
  renderList();
  renderWorkspace();
  toast(`Removed ${cert.studentName}`);
}

function renderList() {
  const list = $('#list');
  list.innerHTML = '';
  $('#count').textContent = `(${state.certs.length})`;

  const pending = state.certs.filter((c) => c.status !== 'sent').length;
  $('#sendAllBtn').disabled = pending === 0;
  $('#sendAllBtn').textContent = `Send all pending (${pending})`;

  state.certs.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'item' + (c.id === state.selectedId ? ' active' : '');
    row.innerHTML = `
      <div>
        <div class="n"></div>
        <div class="s"></div>
      </div>
      <div class="item-right">
        <span class="badge ${c.status}">${c.status}</span>
        <button class="remove-batch-btn" title="Remove certificate" type="button">&times;</button>
      </div>`;
    row.querySelector('.n').textContent = c.studentName;
    row.querySelector('.s').textContent = c.id;
    row.onclick = () => { state.selectedId = c.id; renderList(); renderWorkspace(); };
    row.querySelector('.remove-batch-btn').onclick = (e) => {
      e.stopPropagation();
      removeFromBatch(c.id);
    };
    list.appendChild(row);
  });
  if (!state.certs.length) {
    list.innerHTML = state.hiddenIds.size > 0
      ? '<div class="hint" style="padding:12px">All certificates removed from batch view.</div>'
      : '<div class="hint" style="padding:12px">No certificates yet.</div>';
  }
}

// ---------- editor & preview ----------

function selectedCert() {
  return state.certs.find((c) => c.id === state.selectedId) || null;
}

function renderWorkspace() {
  const cert = selectedCert();
  $('#empty').classList.toggle('hidden', !!cert);
  $('#workspace').classList.toggle('hidden', !cert);
  if (!cert) return;

  const idx = state.certs.indexOf(cert);
  $('#prevBtn').disabled = idx <= 0;
  $('#nextBtn').disabled = idx >= state.certs.length - 1;
  $('#certId').textContent = cert.id;
  $('#certStatus').innerHTML = `<span class="badge ${cert.status}">${cert.status}</span>` +
    (cert.sentAt ? ` <span class="hint">sent ${new Date(cert.sentAt).toLocaleString()}</span>` : '');
  $('#pdfLink').href = `/api/certificates/${cert.id}/pdf`;

  const locked = cert.status === 'sent';
  ['studentName', 'email', 'course', 'instructor', 'date'].forEach((f) => {
    const input = $('#e_' + f);
    input.value = cert[f] || '';
    input.disabled = locked;
  });
  $('#saveBtn').disabled = locked;
  $('#sendOneBtn').disabled = locked;
  $('#editMsg').textContent = locked ? 'This certificate was sent and is locked.' : '';
  $('#editMsg').className = 'msg';
  refreshPreview();
}

function refreshPreview() {
  const cert = selectedCert();
  if (cert) $('#preview').src = `/api/certificates/${cert.id}/preview?v=${Date.now()}`;
}

function readEditor() {
  return {
    studentName: $('#e_studentName').value,
    email: $('#e_email').value,
    course: $('#e_course').value,
    instructor: $('#e_instructor').value,
    date: $('#e_date').value,
  };
}

async function saveSelected() {
  const cert = selectedCert();
  if (!cert) return false;
  try {
    const updated = await api(`/api/certificates/${cert.id}`, { method: 'PUT', body: readEditor() });
    state.allCerts = state.allCerts.map((c) => (c.id === updated.id ? updated : c));
    saveStoredDrafts(state.allCerts);
    refreshVisibleCerts(true);
    setMsg($('#editMsg'), 'Saved. Preview updated.', true);
    return true;
  } catch (err) {
    setMsg($('#editMsg'), err.message, false);
    return false;
  }
}

// ---------- events: navigation & editing ----------

$('#prevBtn').onclick = () => {
  const i = state.certs.findIndex((c) => c.id === state.selectedId);
  if (i > 0) { state.selectedId = state.certs[i - 1].id; renderList(); renderWorkspace(); }
};
$('#nextBtn').onclick = () => {
  const i = state.certs.findIndex((c) => c.id === state.selectedId);
  if (i < state.certs.length - 1) { state.selectedId = state.certs[i + 1].id; renderList(); renderWorkspace(); }
};
$('#saveBtn').onclick = saveSelected;
$('#removeFromBatchBtn').onclick = () => {
  const cert = selectedCert();
  if (cert) removeFromBatch(cert.id);
};

// Live preview while typing (debounced)
let previewTimer = null;
['studentName', 'email', 'course', 'instructor', 'date'].forEach((f) => {
  $('#e_' + f).addEventListener('input', () => {
    const cert = selectedCert();
    if (!cert || cert.status === 'sent') return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try {
        await api(`/api/certificates/${cert.id}`, { method: 'PUT', body: readEditor() });
        const idx = state.allCerts.findIndex((c) => c.id === cert.id);
        if (idx !== -1) {
          state.allCerts[idx] = { ...state.allCerts[idx], ...readEditor(), status: 'draft' };
          saveStoredDrafts(state.allCerts);
        }
        refreshVisibleCerts(true);
        refreshPreview();
      } catch (err) {
        setMsg($('#editMsg'), err.message, false);
      }
    }, 500);
  });
});

// ---------- events: create, import ----------

$('#addForm').onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    const cert = await api('/api/certificates', { method: 'POST', body: data });
    state.selectedId = cert.id;
    await loadCerts();
    e.target.studentName.value = '';
    e.target.email.value = '';
    toast(`Draft created: ${cert.id}`);
  } catch (err) {
    toast(err.message);
  }
};

$('#file').onchange = () => {
  $('#inspectBtn').disabled = !$('#file').files.length;
  $('#mappingBox').classList.add('hidden');
};

$('#inspectBtn').onclick = async () => {
  const file = $('#file').files[0];
  if (!file) return;
  try {
    state.fileBase64 = await fileToBase64(file);
    const info = await api('/api/import/inspect', { method: 'POST', body: { file: state.fileBase64 } });
    state.headers = info.headers;
    document.querySelectorAll('select[data-map]').forEach((sel) => {
      const field = sel.dataset.map;
      sel.innerHTML = '<option value="">not in file</option>' +
        info.headers.map((h) => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`).join('');
      sel.value = info.suggestedMapping[field] || '';
    });
    $('#mappingBox').classList.remove('hidden');
    $('#importResult').textContent = `${info.rowCount} rows found on "${info.sheetName}".`;
  } catch (err) {
    toast(err.message);
  }
};

$('#importBtn').onclick = async () => {
  const mapping = {};
  document.querySelectorAll('select[data-map]').forEach((sel) => { mapping[sel.dataset.map] = sel.value; });
  if (!mapping.studentName || !mapping.email) {
    toast('Student name and email columns are required.');
    return;
  }
  try {
    const result = await api('/api/import', {
      method: 'POST',
      body: {
        file: state.fileBase64,
        mapping,
        defaults: {
          course: $('#defCourse').value,
          instructor: $('#defInstructor').value,
          date: $('#defDate').value || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        },
      },
    });
    const skippedText = result.skipped.length
      ? ` ${result.skipped.length} row(s) skipped: ` + result.skipped.slice(0, 3).map((s) => `row ${s.row} (${s.reason})`).join(', ')
      : '';
    $('#importResult').textContent = `Created ${result.created} draft certificate(s).` + skippedText;
    if (result.certificates.length) state.selectedId = result.certificates[0].id;
    await loadCerts();
  } catch (err) {
    toast(err.message);
  }
};

// ---------- events: email template & sending ----------

$('#saveTemplateBtn').onclick = async () => {
  try {
    await api('/api/email-template', { method: 'PUT', body: { subject: $('#subject').value, body: $('#body').value } });
    toast('Email message saved');
  } catch (err) { toast(err.message); }
};

function emailPayload() {
  return { subject: $('#subject').value, body: $('#body').value };
}

async function runJob(body, label) {
  const { jobId, total } = await api('/api/send', { method: 'POST', body });
  $('#progressBox').classList.remove('hidden');
  $('#sendAllBtn').disabled = true;
  $('#sendOneBtn').disabled = true;

  await new Promise((resolve) => {
    const timer = setInterval(async () => {
      try {
        const job = await api(`/api/jobs/${jobId}`);
        const pct = Math.round((job.done / job.total) * 100);
        $('#bar').style.width = pct + '%';
        $('#progressText').textContent =
          `${label}: ${job.done}/${total} · sent ${job.sent} · failed ${job.failed} · skipped ${job.skipped}` +
          (job.current ? ` · now ${job.current}` : '');
        if (job.finished) {
          clearInterval(timer);
          const failures = job.results.filter((r) => r.status === 'failed');
          toast(failures.length
            ? `Done: ${job.sent} sent, ${failures.length} failed. First error: ${failures[0].error}`
            : `Done: ${job.sent} certificate(s) sent`);
          resolve();
        }
      } catch (err) {
        clearInterval(timer);
        toast(err.message);
        resolve();
      }
    }, 800);
  });

  await loadCerts();
  setTimeout(() => $('#progressBox').classList.add('hidden'), 4000);
}

$('#sendAllBtn').onclick = async () => {
  const pendingCerts = state.certs.filter((c) => c.status !== 'sent');
  if (!pendingCerts.length) return;
  if (!confirm(`Send ${pendingCerts.length} certificate email(s) now? Sent certificates cannot be changed afterwards.`)) return;
  await runJob({ ...emailPayload(), ids: pendingCerts.map((c) => c.id) }, 'Sending batch');
};

$('#sendOneBtn').onclick = async () => {
  const cert = selectedCert();
  if (!cert) return;
  if (!confirm(`Send the certificate to ${cert.email}?`)) return;
  await runJob({ ...emailPayload(), ids: [cert.id] }, 'Sending');
};

$('#sendTestBtn').onclick = async () => {
  const cert = selectedCert();
  const to = $('#testTo').value.trim();
  if (!cert) { toast('Select a certificate first.'); return; }
  if (!to) { toast('Enter a test email address.'); return; }
  const btn = $('#sendTestBtn');
  btn.disabled = true;
  btn.textContent = 'Sending test…';
  try {
    await api('/api/send-test', { method: 'POST', body: { id: cert.id, to, ...emailPayload() } });
    localStorage.setItem('rootline.testTo', to);
    toast(`Test sent to ${to}`);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send test of selected certificate';
  }
};

// ---------- utils ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------- boot ----------

(async function boot() {
  $('#testTo').value = localStorage.getItem('rootline.testTo') || '';
  const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.querySelector('#addForm [name=date]').value = currentMonth;
  $('#defDate').value = currentMonth;
  try {
    await loadStatus();
    await loadTemplate();
    await loadCerts(false);
  } catch (err) {
    toast(err.message);
  }
})();
