# Railway setup

## Environment variables
Set these in Railway:

SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM="ארה אוהלים ומבני מתיחה בעמ <office@ar-a.co.il>"
COMPANY_EMAIL=office@ar-a.co.il
ADMIN_KEY=change-me
BASE_URL=https://your-app.up.railway.app
TZ=Asia/Jerusalem

## Persistent storage
Add a Railway Volume and mount it to:

/app/data

This is required so employee data, uploads, and monthly submissions persist across deploys.
