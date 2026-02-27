import { config } from './config';
import { logger } from './utils/logger';
import { startTelegramBot, sendToNick } from './bot/telegram';
import { startWebhookServer } from './services/webhook-server';
import { startScheduler } from './services/scheduler';
import { initOrchestrator } from './services/orchestrator';

async function main(): Promise<void> {
  logger.info('Starting AI Housekeeper Scheduling Assistant...');

  // Wire up the orchestrator with the Telegram sender
  initOrchestrator(sendToNick);
  logger.info('Orchestrator initialized');

  // Start the Express webhook server for incoming SMS
  startWebhookServer();
  logger.info('Webhook server initialized');

  // Start the scheduler (Friday check-in, day-of reconfirm, follow-ups)
  startScheduler();
  logger.info('Scheduler initialized');

  // Start the Telegram bot (long polling — always active for Nick)
  startTelegramBot();
  logger.info('Telegram bot initialized');

  logger.info('All systems running. Bot is always listening for Nick.');
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err });
  process.exit(1);
});
