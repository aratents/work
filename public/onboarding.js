const state = { company: null, currentEmployee: null, activeStep: 'personal' };
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
function showNotice(el, message, kind = '') { el.textContent = message; el.className = `notice ${kind}`.trim(); el.classList.remove('hidden'); }
function hideNotice(el) { el.classList.add('hidden'); el.textContent = ''; }
async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || 'אירעה שגיאה.');
  return payload;
}
async function uploadFile(url, file) {
  const formData = new FormData(); formData.append('file', file);
  const response = await fetch(url, { method: 'POST', body: formData });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || 'שגיאה בהעלאת קובץ.');
  return payload;
}
function setSectionLocked(sectionKey, locked) {
  const fieldsWrap = qs(`#${sectionKey}Fields`); const lockBox = qs(`#${sectionKey}LockBox`); const badge = qs(`#${sectionKey}StatusBadge`); const saveBtn = qs(`#save${sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1)}Btn`);
  if (fieldsWrap) fieldsWrap.querySelectorAll('input, select, textarea').forEach((el) => { if (el.id !== 'idNumber') el.disabled = locked; });
  if (saveBtn) saveBtn.disabled = locked;
  if (lockBox) lockBox.classList.toggle('hidden', !locked);
  badge.textContent = locked ? 'הושלם וננעל' : 'ממתין למילוי';
  badge.className = locked ? 'badge ok' : 'badge';
}
function docsComplete(documents) { return Boolean(documents?.form101Done && documents?.idCard && documents?.taxCoordination && documents?.dischargeCertificate); }
function renderDocuments(documents) {
  const buildLink = (doc) => doc ? `הועלה: <a href="${doc.url}" target="_blank" rel="noreferrer">${doc.originalName}</a>` : 'עדיין לא הועלה קובץ';
  qs('#idCardMeta').innerHTML = buildLink(documents.idCard);
  qs('#taxMeta').innerHTML = buildLink(documents.taxCoordination);
  qs('#dischargeMeta').innerHTML = buildLink(documents.dischargeCertificate);
  qs('#form101Done').checked = Boolean(documents.form101Done);
  const done = docsComplete(documents);
  qs('#documentsStatusBadge').textContent = done ? 'המסמכים הושלמו' : 'השלם מסמכים';
  qs('#documentsStatusBadge').className = done ? 'badge ok' : 'badge warn';
  qs('#continueToHoursBtn').disabled = !done;
}
function getAvailableSteps() {
  const sections = state.currentEmployee?.sections || {};
  return { personal: true, bank: Boolean(sections.personalLocked), documents: Boolean(sections.personalLocked && sections.bankLocked) };
}
function goToStep(step) {
  const available = getAvailableSteps(); if (!available[step]) return;
  state.activeStep = step;
  qsa('.stepSection').forEach((section) => section.classList.add('hidden'));
  qs(`#${step}Step`).classList.remove('hidden');
  qsa('.stepPill').forEach((pill) => { pill.classList.toggle('active', pill.dataset.stepTarget === step); pill.classList.toggle('disabledStep', !available[pill.dataset.stepTarget]); });
}
function populate(employee) {
  state.currentEmployee = employee;
  qs('#companyName').textContent = `${state.company.name} - קליטת עובד`;
  qs('#employeeNameBadge').textContent = `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.idNumber;
  qs('#idNumber').value = employee.idNumber || '';
  qs('#firstName').value = employee.firstName || '';
  qs('#lastName').value = employee.lastName || '';
  qs('#phone').value = employee.phone || '';
  qs('#email').value = employee.email || '';
  qs('#beneficiaryName').value = employee.beneficiaryName || '';
  qs('#bankName').value = employee.bankName || '';
  qs('#branchNumber').value = employee.branchNumber || '';
  qs('#bankAccount').value = employee.bankAccount || '';
  qs('#form101Link').href = state.company.form101Url || 'https://tpz.link/xb2jv';
  setSectionLocked('personal', Boolean(employee.sections?.personalLocked));
  setSectionLocked('bank', Boolean(employee.sections?.bankLocked));
  renderDocuments(employee.documents || {});
  const available = getAvailableSteps();
  if (!available.bank) goToStep('personal');
  else if (!available.documents) goToStep('bank');
  else goToStep('documents');
  if (docsComplete(employee.documents || {})) qs('#continueToHoursBtn').disabled = false;
}
async function loadEmployee() {
  const id = localStorage.getItem('ara_employee_id');
  if (!id) { window.location.href = '/'; return; }
  const cfg = await api('/api/config'); state.company = cfg.company;
  const payload = await api(`/api/employee/${id}`); populate(payload.employee);
}
async function savePersonal() {
  const result = await api(`/api/employee/${state.currentEmployee.idNumber}/personal`, { method: 'PUT', body: JSON.stringify({ firstName: qs('#firstName').value.trim(), lastName: qs('#lastName').value.trim(), phone: qs('#phone').value.trim(), email: qs('#email').value.trim() }) });
  populate(result.employee); showNotice(qs('#personalNotice'), 'הפרטים האישיים נשמרו והשלב ננעל.', 'ok'); goToStep('bank');
}
async function saveBank() {
  const result = await api(`/api/employee/${state.currentEmployee.idNumber}/bank`, { method: 'PUT', body: JSON.stringify({ beneficiaryName: qs('#beneficiaryName').value.trim(), bankName: qs('#bankName').value.trim(), branchNumber: qs('#branchNumber').value.trim(), bankAccount: qs('#bankAccount').value.trim() }) });
  populate(result.employee); showNotice(qs('#bankNotice'), 'פרטי הבנק נשמרו והשלב ננעל.', 'ok'); goToStep('documents');
}
async function uploadDocument(docType, fileInputId) {
  const file = qs(`#${fileInputId}`).files[0]; if (!file) return showNotice(qs('#filesNotice'), 'יש לבחור קובץ לפני העלאה.', 'warn');
  const result = await uploadFile(`/api/employee/${state.currentEmployee.idNumber}/upload/${docType}`, file);
  state.currentEmployee.documents = result.documents || {}; renderDocuments(state.currentEmployee.documents); showNotice(qs('#filesNotice'), 'הקובץ הועלה בהצלחה.', 'ok');
}
async function saveForm101Done() {
  const result = await api(`/api/employee/${state.currentEmployee.idNumber}/documents-meta`, { method: 'PUT', body: JSON.stringify({ form101Done: qs('#form101Done').checked }) });
  populate(result.employee);
}
function bind() {
  qs('#logoutBtn').addEventListener('click', () => { localStorage.removeItem('ara_employee_id'); window.location.href = '/'; });
  qs('#savePersonalBtn').addEventListener('click', async () => { try { hideNotice(qs('#personalNotice')); await savePersonal(); } catch (e) { showNotice(qs('#personalNotice'), e.message, 'warn'); } });
  qs('#saveBankBtn').addEventListener('click', async () => { try { hideNotice(qs('#bankNotice')); await saveBank(); } catch (e) { showNotice(qs('#bankNotice'), e.message, 'warn'); } });
  qs('#uploadIdCardBtn').addEventListener('click', async () => { try { await uploadDocument('idCard', 'idCardFile'); } catch (e) { showNotice(qs('#filesNotice'), e.message, 'warn'); } });
  qs('#uploadTaxBtn').addEventListener('click', async () => { try { await uploadDocument('taxCoordination', 'taxFile'); } catch (e) { showNotice(qs('#filesNotice'), e.message, 'warn'); } });
  qs('#uploadDischargeBtn').addEventListener('click', async () => { try { await uploadDocument('dischargeCertificate', 'dischargeFile'); } catch (e) { showNotice(qs('#filesNotice'), e.message, 'warn'); } });
  qs('#form101Done').addEventListener('change', async () => { try { await saveForm101Done(); } catch (e) { showNotice(qs('#filesNotice'), e.message, 'warn'); } });
  qs('#continueToHoursBtn').addEventListener('click', () => { window.location.href = '/timesheet.html'; });
  qsa('.stepPill').forEach((pill) => pill.addEventListener('click', () => goToStep(pill.dataset.stepTarget)));
}
bind();
loadEmployee().catch((e) => showNotice(qs('#filesNotice'), e.message || 'שגיאה בטעינת העובד.', 'warn'));
