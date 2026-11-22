# OutreachOS — AI outreach & lead intelligence

Node.js + Express + SQLite (SQL) + Chart.js + Gemini (free) or Claude for AI.

## Run locally
1. Install Node.js 20+.  2. `cd outreachos && npm install`
3. Copy `.env.example` to `.env`, set JWT_SECRET, a free Gemini key (aistudio.google.com) and your SMTP details (Gmail App Password).
4. `npm start`, open http://localhost:3000, create an account.

## Deploy free
- **Render / Railway**: push to GitHub, create a Web Service, build `npm install`, start `npm start`, add the .env values as environment variables. Add a persistent disk and set `DB_PATH` to it, or the SQLite file resets on redeploy.
- Free hosts often block SMTP ports; use Brevo or Resend SMTP if sending fails.
- WhatsApp checker needs Chromium and a long-running session: run it locally (or on a VPS), not on free hosts.
- Use WhatsApp checking and bulk email carefully: unofficial WhatsApp automation can get the number banned, and cold email must follow anti-spam laws.
