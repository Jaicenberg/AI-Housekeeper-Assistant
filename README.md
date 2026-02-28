# AI Housekeeper Scheduling Assistant

An AI-powered bot that automates the coordination of a recurring housekeeper schedule. It communicates with the homeowner via **Telegram**, the housekeeper and her boss via **SMS (in Spanish)**, and a household member via **SMS (in English)** — all orchestrated by **Claude AI** for natural-language understanding and bilingual message generation.

## How It Works

```
┌─────────────┐   Telegram    ┌──────────────────┐   SMS (Spanish)   ┌─────────────────┐
│    Nick      │◄────────────►│   AI Orchestrator │◄────────────────►│  Housekeeper     │
│ (homeowner)  │              │  (Claude Sonnet)  │                  │  + Boss          │
└─────────────┘              └──────────────────┘                  └─────────────────┘
                                      │
                                      │  SMS (English)
                                      ▼
                              ┌──────────────┐
                              │    Lauren     │
                              │ (household)   │
                              └──────────────┘
```

### Weekly Flow

1. **Friday at 9 AM** — The bot asks Nick via Telegram if next week's cleaning schedule stays the same.
2. **Nick approves** — The bot texts the housekeeper and her boss in Spanish to confirm the times.
3. **Nick changes the schedule** — Outreach explicitly mentions the updated days/times.
4. **Nick declines** — No one is contacted that week.
5. **Housekeeper/boss confirms** — A Google Calendar event is created, and Nick + Lauren are notified.
6. **Day-of at 8 AM** — The bot sends a reconfirmation text to the housekeeper and her boss.
7. **Day-of cancellation** — Nick and Lauren are notified, and the bot asks about rescheduling.

Nick can also message the bot at any time in natural language to cancel, reschedule, add extra cleanings, or ask about upcoming appointments.

## Default Schedule

| Day       | Type       | Duration |
|-----------|------------|----------|
| Monday    | Full Clean | 4 hours  |
| Friday    | Half Clean | 2 hours  |

Arrival window: 10 AM – 2 PM (Chicago time). Additional apartment/office cleanings can be requested on demand.

## Tech Stack

| Component        | Technology                          |
|------------------|-------------------------------------|
| Runtime          | Node.js + TypeScript                |
| AI Engine        | Claude Sonnet via `@anthropic-ai/sdk` |
| Telegram Bot     | grammY (long polling)               |
| SMS              | OpenPhone API                       |
| Calendar         | Google Calendar API (service account) |
| Scheduling       | node-cron                           |
| Config           | Zod-validated environment variables |
| Logging          | Winston                             |
| Persistence      | JSON file store with atomic writes  |

## Project Structure

```
src/
├── index.ts                  # Entry point — wires all services together
├── config.ts                 # Zod-validated env config
├── types.ts                  # All TypeScript interfaces
├── bot/
│   └── telegram.ts           # grammY bot (Nick-only, gated by chat ID)
├── services/
│   ├── orchestrator.ts       # Brain — routes messages → Claude → actions → notifications
│   ├── claude.ts             # Bilingual intent parsing + message generation
│   ├── openphone.ts          # SMS sending via OpenPhone API
│   ├── calendar.ts           # Google Calendar event management
│   ├── scheduler.ts          # Cron jobs (Friday check-in, day-of reconfirm, follow-ups)
│   └── webhook-server.ts     # Express server for incoming SMS webhooks
├── store/
│   └── store.ts              # JSON file persistence
└── utils/
    ├── date.ts               # Date/time helpers (Chicago timezone)
    ├── id.ts                 # ID generation
    └── logger.ts             # Winston logger setup
```

## Setup

### Prerequisites

- Node.js 18+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An Anthropic API key with credits
- An OpenPhone account with API access
- A Google Cloud service account with Calendar API enabled

### Installation

```bash
git clone https://github.com/Jaicenberg/AI-Housekeeper-Assistant.git
cd AI-Housekeeper-Assistant
npm install
```

### Configuration

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:

| Variable                       | Description                              |
|--------------------------------|------------------------------------------|
| `TELEGRAM_BOT_TOKEN`          | Telegram bot token from BotFather        |
| `NICK_TELEGRAM_CHAT_ID`       | Nick's Telegram chat ID                  |
| `ANTHROPIC_API_KEY`           | Anthropic API key                        |
| `OPENPHONE_API_KEY`           | OpenPhone API key                        |
| `OPENPHONE_FROM_NUMBER`       | OpenPhone number (E.164 format)          |
| `OPENPHONE_WEBHOOK_PORT`      | Port for incoming SMS webhooks (default: 3000) |
| `HOUSEKEEPER_PHONE`           | Housekeeper's phone (E.164)              |
| `BOSS_PHONE`                  | Boss's phone (E.164)                     |
| `LAUREN_PHONE`                | Lauren's phone (E.164)                   |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`| Service account email                    |
| `GOOGLE_PRIVATE_KEY`          | Service account private key              |
| `GOOGLE_CALENDAR_ID`          | Target Google Calendar ID                |
| `TZ`                          | Timezone (default: `America/Chicago`)    |

### Build & Run

```bash
npm run build
npm start
```

For development with auto-reload:

```bash
npm run dev
```

### Production Deployment (PM2)

```bash
npm install -g pm2
pm2 start dist/index.js --name housekeeper-bot
pm2 save
pm2 startup
```

### Webhook Setup

Point OpenPhone's webhook to your server:

```
POST https://<your-domain>:3000/webhooks/sms
```

Subscribe to the `message.received` event in the OpenPhone dashboard.

## Appointment Lifecycle

```
pending_nick_approval → pending_outreach → outreach_sent
                                              ├── awaiting_confirmation → confirmed
                                              └── confirmed
                                                      └── day_of_reconfirmed → completed

At any point: → negotiating, cancelled, or rescheduled
```

## Language Rules

- **Housekeeper & Boss**: All communication in Spanish (casual, warm tone)
- **Nick & Lauren**: All communication in English

## License

Private project — not licensed for redistribution.
