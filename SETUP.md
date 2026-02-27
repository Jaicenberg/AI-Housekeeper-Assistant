# AI Housekeeper Assistant — Setup Instructions

## What's Pending (Nick's Action Items)

### 1. Buy Anthropic API Credits
- Go to [console.anthropic.com](https://console.anthropic.com) using the Ash account
- Add credits (the bot uses Claude Sonnet 4 for all message processing)
- The API key is already configured in the `.env` file

### 2. Share Google Calendar with Service Account
The bot needs write access to the "Nick and Lauren" calendar to create/update cleaning events.

1. Open [Google Calendar](https://calendar.google.com)
2. Find the **"Nick and Lauren"** calendar on the left sidebar
3. Click the three dots next to it → **Settings and sharing**
4. Scroll to **Share with specific people**
5. Click **+ Add people and groups**
6. Paste this email:
   ```
   housekeeper-bot@housekeeper-assistant.iam.gserviceaccount.com
   ```
7. Set permission to **Make changes to events**
8. Click **Send**

That's it — the bot will then be able to create events like "Housekeeper Full Clean" and "Housekeeper Half Clean" on that calendar.

---

## For Mohamed (VPS Deployment)

### Prerequisites
- Node.js 18+ installed
- The `.env` file (get from Nick/Fran — not in the repo for security)
- The Google service account JSON file (same — not in repo)

### Steps
1. Clone the repo
2. `npm install`
3. Place the `.env` file in the project root (use `.env.example` as reference)
4. `npm run build`
5. `npm start`

### Services That Need to Be Running
- **Telegram bot**: Starts automatically (long polling)
- **Webhook server**: Listens on port 3000 (configure OpenPhone webhook URL to point to `https://<vps-domain>:3000/webhooks/sms`)
- **Scheduler**: Starts automatically with cron jobs

### Recommended: Use PM2 for Process Management
```bash
npm install -g pm2
pm2 start dist/index.js --name housekeeper-bot
pm2 save
pm2 startup
```

### OpenPhone Webhook Setup
The VPS needs a public URL. Set the OpenPhone webhook to:
```
POST https://<your-vps-domain-or-ip>:3000/webhooks/sms
```
Subscribe to the `message.received` event.

---

## How the Bot Works (Quick Summary)

1. **Every Friday at 9am CT**: Bot asks Nick via Telegram if next week's cleaning schedule is the same
2. **Nick approves**: Bot texts Gilma and her boss in Spanish to confirm times
3. **Housekeeper confirms**: Bot notifies Nick + Lauren, creates a Google Calendar event
4. **Day of cleaning at 8am**: Bot reconfirms with Gilma and her boss
5. **Any time**: Nick can message the bot naturally to cancel, reschedule, or ask about status
