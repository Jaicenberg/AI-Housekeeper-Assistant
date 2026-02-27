import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  NICK_TELEGRAM_CHAT_ID: z.string().min(1, 'NICK_TELEGRAM_CHAT_ID is required'),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),

  // OpenPhone
  OPENPHONE_API_KEY: z.string().min(1, 'OPENPHONE_API_KEY is required'),
  OPENPHONE_FROM_NUMBER: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format'),
  OPENPHONE_WEBHOOK_PORT: z.string().default('3000').transform(Number),

  // Contacts
  HOUSEKEEPER_PHONE: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format'),
  BOSS_PHONE: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format'),
  LAUREN_PHONE: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format'),

  // Google Calendar
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().min(1),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  GOOGLE_CALENDAR_ID: z.string().min(1),

  // Timezone
  TZ: z.string().default('America/Chicago'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
