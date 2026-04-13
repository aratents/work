const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { stringify } = require('csv-stringify/sync');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DEFAULT_HOURLY_RATE = Number(process.env.DEFAULT_HOURLY_RATE || 0);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(ROOT, 'public')));

function ensureDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ employees: {}, timesheets: {}, submissions: [], monthlyDigestLog: [] }, null, 2), 'utf-8');
  }
}
function readDb() { ensureDb(); return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
function writeDb(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8'); }
function sanitizeIdNumber(value) { return String(value || '').replace(/\D/g, '').slice(0, 9); }
function sanitizePhone(value) { return String(value || '').replace(/[^\d+]/g, '').slice(0, 15); }
function round2(num) { return Math.round((Number(num) + Number.EPSILON) * 100) / 100; }
function employeeMonthKey(idNumber, month) { return `${idNumber}__${month}`; }

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return 0;
  let startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins < startMins) endMins += 24 * 60;
  return Math.max(0, endMins - startMins);
}

function travelAmountForRow(row, worked) {
  if (!worked) return 0;
  const type = String(row.travelType || 'none');
  const input = Math.max(0, Number(row.travelInput || 0));
  if (type === 'public') return round2(Math.min(input, 40));
  if (type === 'private') return round2(Math.min(input * 1, 40));
  return 0;
}

function calculateRows(rows, hourlyRate) {
  const normalizedRows = (rows || []).map((row) => {
    const totalMinutes = minutesBetween(row.startTime, row.endTime);
    const totalHours = totalMinutes / 60;
    const regularHours = Math.min(totalHours, 8);
    const ot125Hours = Math.min(Math.max(totalHours - 8, 0), 2);
    const ot150Hours = Math.max(totalHours - 10, 0);
    const worked = totalHours > 0;
    const travelAmount = travelAmountForRow(row, worked);
    const regularPay = regularHours * Number(hourlyRate || 0);
    const ot125Pay = ot125Hours * Number(hourlyRate || 0) * 1.25;
    const ot150Pay = ot150Hours * Number(hourlyRate || 0) * 1.5;
    const totalPay = regularPay + ot125Pay + ot150Pay + travelAmount;

    return {
      date: row.date || '',
      startTime: row.startTime || '',
      endTime: row.endTime || '',
      travelType: row.travelType || 'none',
      travelInput: round2(Number(row.travelInput || 0)),
      note: row.note || '',
      totalHours: round2(totalHours),
      regularHours: round2(regularHours),
      overtime125Hours: round2(ot125Hours),
      overtime150Hours: round2(ot150Hours),
      travelAmount: round2(travelAmount),
      totalPay: round2(totalPay)
    };
  });

  const summary = normalizedRows.reduce((acc, row) => {
    acc.workDays += row.totalHours > 0 ? 1 : 0;
    acc.totalHours += row.totalHours;
    acc.regularHours += row.regularHours;
    acc.overtime125Hours += row.overtime125Hours;
    acc.overtime150Hours += row.overtime150Hours;
    acc.travelAmount += row.travelAmount;
    acc.totalPay += row.totalPay;
    return acc;
  }, { workDays: 0, totalHours: 0, regularHours: 0, overtime125Hours: 0, overtime150Hours: 0, travelAmount: 0, totalPay: 0 });

  Object.keys(summary).forEach((key) => { summary[key] = round2(summary[key]); });
  return { rows: normalizedRows, summary };
}

function employeeDefaults(idNumber) {
  return {
    idNumber,
    documents: { form101Done: false },
    sections: { personalLocked: false, bankLocked: false },
    form101Url: process.env.FORM_101_URL || 'https://tpz.link/xb2jv',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function buildEmployeePayload(employee) {
  return {
    idNumber: employee.idNumber,
    firstName: employee.firstName || '',
    lastName: employee.lastName || '',
    phone: employee.phone || '',
    email: employee.email || '',
    beneficiaryName: employee.beneficiaryName || '',
    bankName: employee.bankName || '',
    branchNumber: employee.branchNumber || '',
    bankAccount: employee.bankAccount || '',
    form101Url: employee.form101Url || process.env.FORM_101_URL || 'https://tpz.link/xb2jv',
    documents: employee.documents || { form101Done: false },
    sections: employee.sections || { personalLocked: false, bankLocked: false },
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt
  };
}

function getEmployeeOrDefault(db, idNumber) {
  if (!db.employees[idNumber]) db.employees[idNumber] = employeeDefaults(idNumber);
  return db.employees[idNumber];
}

function makeMonthRows(month) {
  const [year, mon] = String(month || '').split('-').map(Number);
  if (!year || !mon) return [];
  const daysInMonth = new Date(year, mon, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, idx) => ({
    date: `${year}-${String(mon).padStart(2, '0')}-${String(idx + 1).padStart(2, '0')}`,
    startTime: '',
    endTime: '',
    travelType: 'none',
    travelInput: 0,
    note: ''
  }));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname || '')}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function transporterReady() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
function getTransporter() {
  if (!transporterReady()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
async function sendMailSafe(options) {
  const transporter = getTransporter();
  if (!transporter) {
    const outboxPath = path.join(DATA_DIR, 'mail-outbox.json');
    const outbox = fs.existsSync(outboxPath) ? JSON.parse(fs.readFileSync(outboxPath, 'utf-8')) : [];
    outbox.push({ savedAt: new Date().toISOString(), ...options });
    fs.writeFileSync(outboxPath, JSON.stringify(outbox, null, 2), 'utf-8');
    return { queued: true };
  }
  return transporter.sendMail(options);
}

app.get('/api/config', (_req, res) => {
  res.json({
    company: {
      name: process.env.COMPANY_NAME || 'ארה אוהלים ומבני מתיחה בעמ',
      email: process.env.COMPANY_EMAIL || 'office@ar-a.co.il',
      phoneMain: process.env.COMPANY_PHONE_MAIN || '050-4989113',
      phoneSecond: process.env.COMPANY_PHONE_SECOND || '0587878993',
      address: process.env.COMPANY_ADDRESS || 'מושב גינתון',
      companyId: process.env.COMPANY_ID || '516009784',
      website: process.env.COMPANY_WEBSITE || 'https://www.ar-a.co.il',
      form101Url: process.env.FORM_101_URL || 'https://tpz.link/xb2jv'
    }
  });
});

app.post('/api/auth/login', (req, res) => {
  const idNumber = sanitizeIdNumber(req.body.idNumber);
  if (!idNumber || idNumber.length < 5) return res.status(400).json({ error: 'יש להזין תעודת זהות תקינה.' });
  const db = readDb();
  const employee = getEmployeeOrDefault(db, idNumber);
  writeDb(db);
  return res.json({ employee: buildEmployeePayload(employee) });
});

app.get('/api/employee/:idNumber', (req, res) => {
  const idNumber = sanitizeIdNumber(req.params.idNumber);
  const db = readDb();
  const employee = db.employees[idNumber];
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא.' });
  return res.json({ employee: buildEmployeePayload(employee) });
});

app.put('/api/employee/:idNumber/personal', (req, res) => {
  const idNumber = sanitizeIdNumber(req.params.idNumber);
  const db = readDb();
  const employee = getEmployeeOrDefault(db, idNumber);
  if (employee.sections?.personalLocked) return res.status(400).json({ error: 'השלב של פרטים אישיים כבר ננעל.' });
  employee.firstName = String(req.body.firstName || '').trim();
  employee.lastName = String(req.body.lastName || '').trim();
  employee.phone = sanitizePhone(req.body.phone || '');
  employee.email = String(req.body.email || '').trim();
  if (!employee.firstName || !employee.lastName || !employee.phone || !employee.email) {
    return res.status(400).json({ error: 'יש למלא את כל הפרטים האישיים.' });
  }
  employee.sections = employee.sections || {};
  employee.sections.personalLocked = true;
  employee.updatedAt = new Date().toISOString();
  db.employees[idNumber] = employee;
  writeDb(db);
  return res.json({ employee: buildEmployeePayload(employee) });
});

app.put('/api/employee/:idNumber/bank', (req, res) => {
  const idNumber = sanitizeIdNumber(req.params.idNumber);
  const db = readDb();
  const employee = getEmployeeOrDefault(db, idNumber);
  if (!employee.sections?.personalLocked) return res.status(400).json({ error: 'יש להשלים קודם פרטים אישיים.' });
  if (employee.sections?.bankLocked) return res.status(400).json({ error: 'השלב של פרטי הבנק כבר ננעל.' });
  employee.beneficiaryName = String(req.body.beneficiaryName || '').trim();
  employee.bankName = String(req.body.bankName || '').trim();
  employee.branchNumber = String(req.body.branchNumber || '').trim();
  employee.bankAccount = String(req.body.bankAccount || '').trim();
  if (!employee.beneficiaryName || !employee.bankName || !employee.branchNumber || !employee.bankAccount) {
    return res.status(400).json({ error: 'יש למלא את כל פרטי הבנק.' });
  }
  employee.sections = employee.sections || {};
  employee.sections.bankLocked = true;
  employee.updatedAt = new Date().toISOString();
  db.employees[idNumber] = employee;
  writeDb(db);
  return res.json({ employee: buildEmployeePayload(employee) });
});

app.put('/api/employee/:idNumber/documents-meta', (req, res) => {
  const idNumber = sanitizeIdNumber(req.params.idNumber);
  const db = readDb();
  const employee = getEmployeeOrDefault(db, idNumber);
  employee.documents = employee.documents || {};
  employee.documents.form101Done = Boolean(req.body.form101Done);
  employee.updatedAt = new Date().toISOString();
  db.employees[idNumber] = employee;
  writeDb(db);
  return res.json({ employee: buildEmployeePayload(employee) });
});

app.post('/api/employee/:idNumber/upload/:docType', upload.single('file'), (req, res) => {
  const idNumber = sanitizeIdNumber(req.params.idNumber);
  const docType = String(req.params.docType || '');
  const allowed = ['idCard', 'taxCoordination', 'dischargeCertificate'];
  if (!allowed.includes(docType)) return res.status(400).json({ error: 'סוג מסמך לא נתמך.' });
  if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ.' });
  const db = readDb();
  const employee = db.employees[idNumber];
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא.' });
  employee.documents = employee.documents || {};
  employee.documents[docType] = {
    originalName: req.file.originalname,
    filename: req.file.filename,
    url: `/uploads/${req.file.filename}`,
    uploadedAt: new Date().toISOString()
  };
  employee.updatedAt = new Date().toISOString();
  db.employees[idNumber] = employee;
  writeDb(db);
  return res.json({ documents: employee.documents });
});


app.get('/api/employee/:idNumber/timesheet-history', (req, res) => {
  const idNumber = sanitizeIdNumber(req.params.idNumber);
  const db = readDb();
  const employee = db.employees[idNumber];
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא.' });
  const currentMonth = new Date().toISOString().slice(0, 7);
  const months = Object.values(db.timesheets)
    .filter((item) => item.employeeIdNumber === idNumber && item.month < currentMonth)
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((item) => ({
      month: item.month,
      submittedAt: item.submittedAt,
      workDays: item.summary?.workDays || 0,
      totalHours: item.summary?.totalHours || 0,
      regularHours: item.summary?.regularHours || 0,
      overtime125Hours: item.summary?.overtime125Hours || 0,
      overtime150Hours: item.summary?.overtime150Hours || 0,
      travelAmount: item.summary?.travelAmount || 0,
      totalPay: item.summary?.totalPay || 0
    }));
  return res.json({ months });
});

app.get('/api/timesheet/:idNumber/:month', (req, res) => {
  const idNumber = sanitizeIdNumber(req.params.idNumber);
  const month = String(req.params.month || '').slice(0, 7);
  const db = readDb();
  const employee = db.employees[idNumber];
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא.' });
  const key = employeeMonthKey(idNumber, month);
  if (!db.timesheets[key]) {
    db.timesheets[key] = {
      employeeIdNumber: idNumber,
      month,
      ...calculateRows(makeMonthRows(month), DEFAULT_HOURLY_RATE),
      submittedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeDb(db);
  }
  return res.json({ timesheet: db.timesheets[key] });
});

app.put('/api/timesheet/:idNumber/:month', (req, res) => {
  const idNumber = sanitizeIdNumber(req.params.idNumber);
  const month = String(req.params.month || '').slice(0, 7);
  const db = readDb();
  const employee = db.employees[idNumber];
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא.' });
  const key = employeeMonthKey(idNumber, month);
  const incomingRows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const rows = incomingRows.length ? incomingRows : makeMonthRows(month);
  const calc = calculateRows(rows, DEFAULT_HOURLY_RATE);
  db.timesheets[key] = {
    employeeIdNumber: idNumber,
    month,
    rows: calc.rows,
    summary: calc.summary,
    submittedAt: db.timesheets[key]?.submittedAt || null,
    createdAt: db.timesheets[key]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  writeDb(db);
  return res.json({ timesheet: db.timesheets[key] });
});

function employeeHasRequiredDocs(employee) {
  return Boolean(employee.documents?.form101Done && employee.documents?.idCard && employee.documents?.taxCoordination && employee.documents?.dischargeCertificate);
}

app.post('/api/timesheet/:idNumber/:month/submit', async (req, res) => {
  try {
    const idNumber = sanitizeIdNumber(req.params.idNumber);
    const month = String(req.params.month || '').slice(0, 7);
    const db = readDb();
    const employee = db.employees[idNumber];
    if (!employee) return res.status(404).json({ error: 'העובד לא נמצא.' });
    if (!employee.sections?.personalLocked || !employee.sections?.bankLocked) {
      return res.status(400).json({ error: 'יש להשלים קודם פרטים אישיים ופרטי בנק.' });
    }
    if (!employeeHasRequiredDocs(employee)) {
      return res.status(400).json({ error: 'יש להשלים טופס 101, צילום תעודת זהות, תיאום מס ותעודת שחרור לפני השליחה.' });
    }

    const key = employeeMonthKey(idNumber, month);
    const timesheet = db.timesheets[key];
    if (!timesheet) return res.status(400).json({ error: 'לא קיימת טבלת שעות לחודש זה.' });

    timesheet.submittedAt = new Date().toISOString();
    timesheet.updatedAt = new Date().toISOString();

    const submission = {
      submissionId: crypto.randomUUID(),
      month,
      submittedAt: timesheet.submittedAt,
      employee: buildEmployeePayload(employee),
      summary: timesheet.summary,
      rows: timesheet.rows
    };
    db.submissions.push(submission);
    writeDb(db);

    const csvRows = timesheet.rows.map((row) => ({
      month,
      idNumber: employee.idNumber,
      firstName: employee.firstName || '',
      lastName: employee.lastName || '',
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      travelType: row.travelType,
      travelInput: row.travelInput,
      travelAmount: row.travelAmount,
      totalHours: row.totalHours,
      regularHours: row.regularHours,
      overtime125Hours: row.overtime125Hours,
      overtime150Hours: row.overtime150Hours,
      totalPay: row.totalPay,
      note: row.note || ''
    }));

    const attachments = [{
      filename: `timesheet-${month}-${employee.idNumber}.csv`,
      content: stringify(csvRows, { header: true }),
      contentType: 'text/csv; charset=utf-8'
    }];

    ['idCard', 'taxCoordination', 'dischargeCertificate'].forEach((docType) => {
      if (employee.documents?.[docType]?.filename) {
        attachments.push({
          filename: employee.documents[docType].originalName || employee.documents[docType].filename,
          path: path.join(UPLOADS_DIR, employee.documents[docType].filename)
        });
      }
    });

    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8">
        <h2>נשלח טופס שעות חודשי</h2>
        <p><strong>חודש:</strong> ${month}</p>
        <p><strong>עובד:</strong> ${employee.firstName || ''} ${employee.lastName || ''}</p>
        <p><strong>תעודת זהות:</strong> ${employee.idNumber}</p>
        <p><strong>טלפון:</strong> ${employee.phone || '-'}</p>
        <p><strong>אימייל:</strong> ${employee.email || '-'}</p>
        <hr />
        <p><strong>ימי עבודה:</strong> ${timesheet.summary.workDays}</p>
        <p><strong>סה"כ שעות:</strong> ${timesheet.summary.totalHours}</p>
        <p><strong>שעות רגילות:</strong> ${timesheet.summary.regularHours}</p>
        <p><strong>נוספות 125%:</strong> ${timesheet.summary.overtime125Hours}</p>
        <p><strong>נוספות 150%:</strong> ${timesheet.summary.overtime150Hours}</p>
        <p><strong>נסיעות:</strong> ₪${timesheet.summary.travelAmount}</p>
        <p><strong>סה"כ לתשלום:</strong> ₪${timesheet.summary.totalPay}</p>
      </div>
    `;

    await sendMailSafe({
      from: process.env.SMTP_FROM || process.env.COMPANY_EMAIL,
      to: process.env.COMPANY_EMAIL || 'office@ar-a.co.il',
      replyTo: employee.email || undefined,
      subject: `טופס שעות חודשי ${month} - ${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      html,
      attachments
    });

    return res.json({ ok: true, submittedAt: timesheet.submittedAt });
  } catch (error) {
    console.error('Mail submit error:', error);
    const msg = error?.message ? `אירעה שגיאה בשליחה: ${error.message}` : 'אירעה שגיאה בשליחה.';
    return res.status(500).json({ error: msg });
  }
});

function getMonthlySubmissions(db, month) { return db.submissions.filter((item) => item.month === month); }
function buildMonthlySummaryCsv(submissions, month) {
  return stringify(submissions.map((item) => ({
    month,
    submittedAt: item.submittedAt,
    idNumber: item.employee.idNumber,
    firstName: item.employee.firstName || '',
    lastName: item.employee.lastName || '',
    phone: item.employee.phone || '',
    email: item.employee.email || '',
    workDays: item.summary.workDays,
    totalHours: item.summary.totalHours,
    regularHours: item.summary.regularHours,
    overtime125Hours: item.summary.overtime125Hours,
    overtime150Hours: item.summary.overtime150Hours,
    travelAmount: item.summary.travelAmount,
    totalPay: item.summary.totalPay
  })), { header: true });
}

async function sendMonthlyDigest(month) {
  const db = readDb();
  if (db.monthlyDigestLog.some((item) => item.month === month)) return { skipped: true, reason: 'already_sent' };
  const submissions = getMonthlySubmissions(db, month);
  if (!submissions.length) return { skipped: true, reason: 'no_submissions' };
  const total = submissions.reduce((acc, item) => {
    acc.workDays += Number(item.summary.workDays || 0);
    acc.totalHours += Number(item.summary.totalHours || 0);
    acc.totalPay += Number(item.summary.totalPay || 0);
    return acc;
  }, { workDays: 0, totalHours: 0, totalPay: 0 });

  await sendMailSafe({
    from: process.env.SMTP_FROM || process.env.COMPANY_EMAIL,
    to: process.env.COMPANY_EMAIL || 'office@ar-a.co.il',
    subject: `ריכוז חודשי מרוכז ${month}`,
    html: `
      <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8">
        <h2>ריכוז חודשי מרוכז</h2>
        <p><strong>חודש:</strong> ${month}</p>
        <p><strong>מספר טפסים שהתקבלו:</strong> ${submissions.length}</p>
        <p><strong>סך ימי עבודה:</strong> ${round2(total.workDays)}</p>
        <p><strong>סך שעות:</strong> ${round2(total.totalHours)}</p>
        <p><strong>סך לתשלום:</strong> ₪${round2(total.totalPay)}</p>
      </div>
    `,
    attachments: [{ filename: `monthly-summary-${month}.csv`, content: buildMonthlySummaryCsv(submissions, month), contentType: 'text/csv; charset=utf-8' }]
  });

  db.monthlyDigestLog.push({ month, sentAt: new Date().toISOString(), submissionsCount: submissions.length });
  writeDb(db);
  return { sent: true, submissionsCount: submissions.length };
}

app.get('/api/admin/monthly-summary', (req, res) => {
  const key = req.get('x-admin-key');
  if (!key || key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'אין הרשאה.' });
  const month = String(req.query.month || '').slice(0, 7);
  const db = readDb();
  const submissions = getMonthlySubmissions(db, month);
  return res.json({
    month,
    count: submissions.length,
    rows: submissions.map((item) => ({
      submittedAt: item.submittedAt,
      idNumber: item.employee.idNumber,
      firstName: item.employee.firstName,
      lastName: item.employee.lastName,
      phone: item.employee.phone,
      email: item.employee.email,
      workDays: item.summary.workDays,
      totalHours: item.summary.totalHours,
      totalPay: item.summary.totalPay
    }))
  });
});

app.post('/api/admin/monthly-summary/send', async (req, res) => {
  const key = req.get('x-admin-key');
  if (!key || key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'אין הרשאה.' });
  const month = String(req.body.month || '').slice(0, 7);
  const result = await sendMonthlyDigest(month);
  return res.json(result);
});

cron.schedule('0 8 * * *', async () => {
  try {
    const now = new Date();
    if (now.getDate() !== 1) return;
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const result = await sendMonthlyDigest(month);
    console.log('monthly digest result:', result);
  } catch (error) {
    console.error('monthly digest error', error);
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Employee portal listening on http://localhost:${PORT}`));
