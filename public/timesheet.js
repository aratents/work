const state = { company: null, employee: null, currentMonth: '', currentTimesheet: null, previousMonths: [] };
const qs = (s) => document.querySelector(s);
function showNotice(el, message, kind = '') { el.textContent = message; el.className = `notice ${kind}`.trim(); el.classList.remove('hidden'); }
function hideNotice(el) { el.classList.add('hidden'); el.textContent = ''; }
function currentMonthValue() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; }
async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || 'אירעה שגיאה.');
  return payload;
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
function renderTimesheet(timesheet) {
  state.currentTimesheet = timesheet;
  const tbody = qs('#timesheetBody'); tbody.innerHTML = '';
  timesheet.rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.date}</td>
      <td><input type="time" data-field="startTime" data-index="${index}" value="${row.startTime || ''}" /></td>
      <td><input type="time" data-field="endTime" data-index="${index}" value="${row.endTime || ''}" /></td>
      <td><select data-field="travelType" data-index="${index}"><option value="none" ${row.travelType === 'none' ? 'selected' : ''}>ללא</option><option value="public" ${row.travelType === 'public' ? 'selected' : ''}>תחבורה ציבורית</option><option value="private" ${row.travelType === 'private' ? 'selected' : ''}>רכב פרטי</option></select></td>
      <td><input type="number" min="0" step="0.01" data-field="travelInput" data-index="${index}" value="${row.travelInput ?? 0}" placeholder="סכום / קמ" /></td>
      <td><input type="text" data-field="note" data-index="${index}" value="${row.note || ''}" placeholder="הערה" /></td>
      <td>${row.totalHours ?? 0}</td><td>${row.regularHours ?? 0}</td><td>${row.overtime125Hours ?? 0}</td><td>${row.overtime150Hours ?? 0}</td><td>₪${row.travelAmount ?? 0}</td><td>₪${row.totalPay ?? 0}</td>`;
    tbody.appendChild(tr);
  });
  renderSummary(timesheet.summary);
  qs('#submitStamp').textContent = timesheet.submittedAt ? `החודש כבר נשלח בתאריך ${new Date(timesheet.submittedAt).toLocaleString('he-IL')}` : 'החודש עדיין לא נשלח.';
}
function collectRows() {
  const rows = state.currentTimesheet?.rows?.map((r) => ({ ...r })) || [];
  document.querySelectorAll('#timesheetBody input, #timesheetBody select').forEach((input) => { const index = Number(input.dataset.index); const field = input.dataset.field; rows[index][field] = input.value; });
  return rows;
}
async function loadCurrentMonth() {
  const payload = await api(`/api/timesheet/${state.employee.idNumber}/${state.currentMonth}`); renderTimesheet(payload.timesheet);
}
async function saveTimesheet() {
  const payload = await api(`/api/timesheet/${state.employee.idNumber}/${state.currentMonth}`, { method: 'PUT', body: JSON.stringify({ rows: collectRows() }) });
  renderTimesheet(payload.timesheet); showNotice(qs('#timesheetNotice'), 'טבלת השעות נשמרה בהצלחה.', 'ok');
}
async function submitMonth() {
  await saveTimesheet();
  const payload = await api(`/api/timesheet/${state.employee.idNumber}/${state.currentMonth}/submit`, { method: 'POST', body: JSON.stringify({}) });
  showNotice(qs('#timesheetNotice'), `החודש נשלח בהצלחה בתאריך ${new Date(payload.submittedAt).toLocaleString('he-IL')}.`, 'ok');
  await loadCurrentMonth(); await loadHistory();
}
function renderHistory(items) {
  const tbody = qs('#historyBody'); tbody.innerHTML = '';
  qs('#historyEmpty').style.display = items.length ? 'none' : 'block';
  items.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.month}</td><td>${item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('he-IL') : '-'}</td><td>${item.workDays}</td><td>${item.totalHours}</td><td>${item.regularHours}</td><td>${item.overtime125Hours}</td><td>${item.overtime150Hours}</td><td>₪${item.travelAmount}</td><td>₪${item.totalPay}</td>`;
    tbody.appendChild(tr);
  });
}
async function loadHistory() {
  const payload = await api(`/api/employee/${state.employee.idNumber}/timesheet-history`);
  state.previousMonths = payload.months || [];
  renderHistory(state.previousMonths);
}
async function init() {
  const id = localStorage.getItem('ara_employee_id'); if (!id) { window.location.href = '/'; return; }
  const cfg = await api('/api/config'); state.company = cfg.company; qs('#companyName').textContent = `${cfg.company.name} - דיווח שעות עבודה`;
  const employeePayload = await api(`/api/employee/${id}`); state.employee = employeePayload.employee;
  const complete = Boolean(state.employee.sections?.personalLocked && state.employee.sections?.bankLocked && state.employee.documents?.form101Done && state.employee.documents?.idCard && state.employee.documents?.taxCoordination && state.employee.documents?.dischargeCertificate);
  if (!complete) { window.location.href = '/onboarding.html'; return; }
  qs('#employeeNameBadge').textContent = `${state.employee.firstName || ''} ${state.employee.lastName || ''}`.trim() || state.employee.idNumber;
  state.currentMonth = currentMonthValue();
  qs('#currentMonthLabel').textContent = state.currentMonth;
  await loadCurrentMonth(); await loadHistory();
  qs('#logoutBtn').addEventListener('click', () => { localStorage.removeItem('ara_employee_id'); window.location.href = '/'; });
  qs('#saveTimesheetBtn').addEventListener('click', async () => { try { hideNotice(qs('#timesheetNotice')); await saveTimesheet(); } catch (e) { showNotice(qs('#timesheetNotice'), e.message, 'warn'); } });
  qs('#submitMonthBtn').addEventListener('click', async () => { try { hideNotice(qs('#timesheetNotice')); await submitMonth(); } catch (e) { showNotice(qs('#timesheetNotice'), e.message, 'warn'); } });
}
init().catch((e) => showNotice(qs('#timesheetNotice'), e.message || 'שגיאה בטעינת העמוד.', 'warn'));
