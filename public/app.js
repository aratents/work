const state = {
  company: null,
  currentEmployee: null,
  currentMonth: '',
  currentTimesheet: null,
  activeStep: 'personal'
};

const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));

function showNotice(el, message, kind = '') {
  el.textContent = message;
  el.className = `notice ${kind}`.trim();
  el.classList.remove('hidden');
}

function hideNotice(el) {
  el.classList.add('hidden');
  el.textContent = '';
}

function sanitizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function todayMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new Error(payload?.error || 'אירעה שגיאה.');
  }
  return payload;
}

async function uploadFile(url, file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(url, { method: 'POST', body: formData });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || 'שגיאה בהעלאת קובץ.');
  return payload;
}

async function loadConfig() {
  const { company } = await api('/api/config');
  state.company = company;
  qs('#companyName').textContent = `${company.name} - דיווח שעות עבודה`;
  qs('#phonePill').textContent = `${company.phoneMain} עידן | ${company.phoneSecond} אייל`;
  qs('#emailPill').textContent = company.email;
  qs('#emailPill').href = `mailto:${company.email}`;
  qs('#addressPill').textContent = company.address;
  qs('#form101Link').href = company.form101Url || 'https://tpz.link/xb2jv';
  qs('#footerYear').textContent = new Date().getFullYear();
}

function setLoggedIn(employee) {
  state.currentEmployee = employee;
  localStorage.setItem('ara_employee_id', employee.idNumber);
  qs('#loginCard').classList.add('hidden');
  qs('#portalSection').classList.remove('hidden');
  qs('#employeeDisplayName').textContent = `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'עובד';
  populateProfile(employee);
  refreshWorkflow();
}

function setLoggedOut() {
  state.currentEmployee = null;
  state.currentTimesheet = null;
  state.activeStep = 'personal';
  localStorage.removeItem('ara_employee_id');
  qs('#portalSection').classList.add('hidden');
  qs('#loginCard').classList.remove('hidden');
  qs('#loginIdNumber').value = '';
}

function employeeSections() {
  const sections = state.currentEmployee?.sections || {};
  return {
    personalLocked: Boolean(sections.personalLocked),
    bankLocked: Boolean(sections.bankLocked)
  };
}

function getAvailableSteps() {
  const sections = employeeSections();
  return {
    personal: true,
    bank: sections.personalLocked,
    documents: sections.personalLocked && sections.bankLocked,
    hours: sections.personalLocked && sections.bankLocked
  };
}

function goToStep(step) {
  const available = getAvailableSteps();
  if (!available[step]) return;
  state.activeStep = step;
  qsa('.stepSection').forEach((section) => section.classList.add('hidden'));
  qs(`#${step}Step`).classList.remove('hidden');
  qsa('.stepPill').forEach((pill) => {
    pill.classList.toggle('active', pill.dataset.stepTarget === step);
    pill.classList.toggle('disabledStep', !available[pill.dataset.stepTarget]);
  });
}

function setSectionLocked(sectionKey, locked) {
  const fieldsWrap = qs(`#${sectionKey}Fields`);
  const lockBox = qs(`#${sectionKey}LockBox`);
  const badge = qs(`#${sectionKey}StatusBadge`);
  const saveBtn = qs(`#save${sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1)}Btn`);
  if (fieldsWrap) {
    fieldsWrap.querySelectorAll('input, select, textarea, button').forEach((el) => {
      if (!el.disabled || el.id !== 'idNumber') {
        if (el.id !== 'idNumber') el.disabled = locked;
      }
    });
  }
  if (saveBtn) saveBtn.disabled = locked;
  if (lockBox) lockBox.classList.toggle('hidden', !locked);
  badge.textContent = locked ? 'הושלם וננעל' : 'ממתין למילוי';
  badge.className = locked ? 'badge ok' : 'badge';
}

function populateProfile(employee) {
  qs('#firstName').value = employee.firstName || '';
  qs('#lastName').value = employee.lastName || '';
  qs('#idNumber').value = employee.idNumber || '';
  qs('#phone').value = employee.phone || '';
  qs('#email').value = employee.email || '';
  qs('#beneficiaryName').value = employee.beneficiaryName || '';
  qs('#bankName').value = employee.bankName || '';
  qs('#branchNumber').value = employee.branchNumber || '';
  qs('#bankAccount').value = employee.bankAccount || '';
  qs('#form101Done').checked = Boolean(employee.documents?.form101Done);
  renderDocuments(employee.documents || {});
  const sections = employeeSections();
  setSectionLocked('personal', sections.personalLocked);
  setSectionLocked('bank', sections.bankLocked);
}

function renderDocuments(documents) {
  const buildLink = (doc) => doc
    ? `הועלה: <a href="${doc.url}" target="_blank" rel="noreferrer">${doc.originalName}</a>`
    : 'עדיין לא הועלה קובץ';
  qs('#idCardMeta').innerHTML = buildLink(documents.idCard);
  qs('#taxMeta').innerHTML = buildLink(documents.taxCoordination);
  qs('#dischargeMeta').innerHTML = buildLink(documents.dischargeCertificate);
  const docsDone = Boolean(documents.form101Done && documents.idCard && documents.taxCoordination && documents.dischargeCertificate);
  const badge = qs('#documentsStatusBadge');
  badge.textContent = docsDone ? 'המסמכים הושלמו' : 'השלם מסמכים';
  badge.className = docsDone ? 'badge ok' : 'badge warn';
}

function refreshWorkflow() {
  const available = getAvailableSteps();
  qsa('.stepPill').forEach((pill) => {
    pill.classList.toggle('disabledStep', !available[pill.dataset.stepTarget]);
  });
  if (!available[state.activeStep]) {
    if (!available.bank) goToStep('personal');
    else if (!available.documents) goToStep('bank');
    else goToStep('documents');
  } else {
    goToStep(state.activeStep);
  }
}

function collectPersonalPayload() {
  return {
    firstName: qs('#firstName').value.trim(),
    lastName: qs('#lastName').value.trim(),
    phone: qs('#phone').value.trim(),
    email: qs('#email').value.trim()
  };
}

function collectBankPayload() {
  return {
    beneficiaryName: qs('#beneficiaryName').value.trim(),
    bankName: qs('#bankName').value.trim(),
    branchNumber: qs('#branchNumber').value.trim(),
    bankAccount: qs('#bankAccount').value.trim()
  };
}

async function login(idNumber) {
  hideNotice(qs('#loginNotice'));
  const payload = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ idNumber })
  });
  setLoggedIn(payload.employee);
  state.currentMonth = todayMonth();
  await loadMonth(state.currentMonth);
}

async function savePersonal() {
  hideNotice(qs('#personalNotice'));
  const result = await api(`/api/employee/${state.currentEmployee.idNumber}/personal`, {
    method: 'PUT',
    body: JSON.stringify(collectPersonalPayload())
  });
  state.currentEmployee = result.employee;
  setLoggedIn(result.employee);
  showNotice(qs('#personalNotice'), 'הפרטים האישיים נשמרו והשלב ננעל.', 'ok');
  goToStep('bank');
}

async function saveBank() {
  hideNotice(qs('#bankNotice'));
  const result = await api(`/api/employee/${state.currentEmployee.idNumber}/bank`, {
    method: 'PUT',
    body: JSON.stringify(collectBankPayload())
  });
  state.currentEmployee = result.employee;
  setLoggedIn(result.employee);
  showNotice(qs('#bankNotice'), 'פרטי הבנק נשמרו והשלב ננעל.', 'ok');
  goToStep('documents');
}

function renderTimesheet(timesheet) {
  state.currentTimesheet = timesheet;
  const tbody = qs('#timesheetBody');
  tbody.innerHTML = '';
  timesheet.rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.date}</td>
      <td><input type="time" data-field="startTime" data-index="${index}" value="${row.startTime || ''}" /></td>
      <td><input type="time" data-field="endTime" data-index="${index}" value="${row.endTime || ''}" /></td>
      <td>
        <select data-field="travelType" data-index="${index}">
          <option value="none" ${row.travelType === 'none' ? 'selected' : ''}>ללא</option>
          <option value="public" ${row.travelType === 'public' ? 'selected' : ''}>תחבורה ציבורית</option>
          <option value="private" ${row.travelType === 'private' ? 'selected' : ''}>רכב פרטי</option>
        </select>
      </td>
      <td><input type="number" min="0" step="0.01" data-field="travelInput" data-index="${index}" value="${row.travelInput ?? 0}" placeholder="סכום / קמ" /></td>
      <td><input type="text" data-field="note" data-index="${index}" value="${row.note || ''}" placeholder="הערה" /></td>
      <td>${row.totalHours ?? 0}</td>
      <td>${row.regularHours ?? 0}</td>
      <td>${row.overtime125Hours ?? 0}</td>
      <td>${row.overtime150Hours ?? 0}</td>
      <td>₪${row.travelAmount ?? 0}</td>
      <td>₪${row.totalPay ?? 0}</td>
    `;
    tbody.appendChild(tr);
  });
  renderSummary(timesheet.summary);
  qs('#submitStamp').textContent = timesheet.submittedAt
    ? `החודש כבר נשלח בתאריך ${new Date(timesheet.submittedAt).toLocaleString('he-IL')}`
    : 'החודש עדיין לא נשלח.';
}

function renderSummary(summary) {
  qs('#sumWorkDays').textContent = summary.workDays ?? 0;
  qs('#sumTotalHours').textContent = summary.totalHours ?? 0;
  qs('#sumRegularHours').textContent = summary.regularHours ?? 0;
  qs('#sumOt125').textContent = summary.overtime125Hours ?? 0;
  qs('#sumOt150').textContent = summary.overtime150Hours ?? 0;
  qs('#sumTravelAmount').textContent = `₪${summary.travelAmount ?? 0}`;
  qs('#sumTotalPay').textContent = `₪${summary.totalPay ?? 0}`;
}

function collectRowsFromTable() {
  const rows = state.currentTimesheet?.rows?.map((row) => ({ ...row })) || [];
  qsa('#timesheetBody input, #timesheetBody select').forEach((input) => {
    const index = Number(input.dataset.index);
    const field = input.dataset.field;
    rows[index][field] = input.value;
  });
  return rows;
}

async function loadMonth(month = todayMonth()) {
  state.currentMonth = todayMonth();
  month = state.currentMonth;
  hideNotice(qs('#timesheetNotice'));
  const payload = await api(`/api/timesheet/${state.currentEmployee.idNumber}/${month}`);
  renderTimesheet(payload.timesheet);
}

async function saveTimesheet() {
  hideNotice(qs('#timesheetNotice'));
  const rows = collectRowsFromTable();
  const payload = await api(`/api/timesheet/${state.currentEmployee.idNumber}/${state.currentMonth}`, {
    method: 'PUT',
    body: JSON.stringify({ rows })
  });
  renderTimesheet(payload.timesheet);
  showNotice(qs('#timesheetNotice'), 'טבלת השעות נשמרה בהצלחה.', 'ok');
}

async function submitMonth() {
  hideNotice(qs('#timesheetNotice'));
  await saveTimesheet();
  const payload = await api(`/api/timesheet/${state.currentEmployee.idNumber}/${state.currentMonth}/submit`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  showNotice(qs('#timesheetNotice'), `החודש נשלח בהצלחה בתאריך ${new Date(payload.submittedAt).toLocaleString('he-IL')}.`, 'ok');
  await loadMonth(state.currentMonth);
}

async function uploadDocument(docType, fileInputId) {
  hideNotice(qs('#filesNotice'));
  const file = qs(`#${fileInputId}`).files[0];
  if (!file) {
    showNotice(qs('#filesNotice'), 'יש לבחור קובץ לפני העלאה.', 'warn');
    return;
  }
  const result = await uploadFile(`/api/employee/${state.currentEmployee.idNumber}/upload/${docType}`, file);
  state.currentEmployee.documents = result.documents || {};
  renderDocuments(state.currentEmployee.documents);
  showNotice(qs('#filesNotice'), 'הקובץ הועלה בהצלחה.', 'ok');
}

async function saveForm101Done() {
  const result = await api(`/api/employee/${state.currentEmployee.idNumber}/documents-meta`, {
    method: 'PUT',
    body: JSON.stringify({ form101Done: qs('#form101Done').checked })
  });
  state.currentEmployee = result.employee;
  renderDocuments(state.currentEmployee.documents || {});
}

function bindEvents() {
  qs('#loginBtn').addEventListener('click', async () => {
    try {
      const idNumber = sanitizeDigits(qs('#loginIdNumber').value);
      if (idNumber.length < 5) {
        showNotice(qs('#loginNotice'), 'יש להזין תעודת זהות תקינה.', 'warn');
        return;
      }
      await login(idNumber);
    } catch (error) {
      showNotice(qs('#loginNotice'), error.message, 'warn');
    }
  });

  if (qs('#logoutBtn')) qs('#logoutBtn').addEventListener('click', () => setLoggedOut());
  qs('#savePersonalBtn').addEventListener('click', async () => {
    try { await savePersonal(); } catch (error) { showNotice(qs('#personalNotice'), error.message, 'warn'); }
  });
  qs('#saveBankBtn').addEventListener('click', async () => {
    try { await saveBank(); } catch (error) { showNotice(qs('#bankNotice'), error.message, 'warn'); }
  });
  qs('#saveTimesheetBtn').addEventListener('click', async () => {
    try { await saveTimesheet(); } catch (error) { showNotice(qs('#timesheetNotice'), error.message, 'warn'); }
  });
  qs('#submitMonthBtn').addEventListener('click', async () => {
    try { await submitMonth(); } catch (error) { showNotice(qs('#timesheetNotice'), error.message, 'warn'); }
  });
  qs('#uploadIdCardBtn').addEventListener('click', async () => {
    try { await uploadDocument('idCard', 'idCardFile'); } catch (error) { showNotice(qs('#filesNotice'), error.message, 'warn'); }
  });
  qs('#uploadTaxBtn').addEventListener('click', async () => {
    try { await uploadDocument('taxCoordination', 'taxFile'); } catch (error) { showNotice(qs('#filesNotice'), error.message, 'warn'); }
  });
  qs('#uploadDischargeBtn').addEventListener('click', async () => {
    try { await uploadDocument('dischargeCertificate', 'dischargeFile'); } catch (error) { showNotice(qs('#filesNotice'), error.message, 'warn'); }
  });
  qs('#form101Done').addEventListener('change', async () => {
    try { await saveForm101Done(); } catch (error) { showNotice(qs('#filesNotice'), error.message, 'warn'); }
  });
  qsa('.stepPill').forEach((pill) => {
    pill.addEventListener('click', () => goToStep(pill.dataset.stepTarget));
  });
}

(async function init() {
  try {
    await loadConfig();
    bindEvents();
    state.currentMonth = todayMonth();
    const cachedId = localStorage.getItem('ara_employee_id');
    if (cachedId) {
      try { await login(cachedId); } catch (_error) { localStorage.removeItem('ara_employee_id'); }
    }
  } catch (error) {
    showNotice(qs('#loginNotice'), error.message || 'המערכת לא עלתה כראוי.', 'warn');
  }
})();
