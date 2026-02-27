import { Bot } from 'grammy';
import { config } from '../config';
import { logger } from '../utils/logger';
import { handleIncomingMessage } from '../services/orchestrator';

const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

const NICK_CHAT_ID = config.NICK_TELEGRAM_CHAT_ID;

// Handle ALL text messages from Nick — always active
bot.on('message:text', async (ctx) => {
  const chatId = String(ctx.chat.id);
  if (chatId !== NICK_CHAT_ID) {
    logger.warn('Message from unauthorized chat', { chatId });
    return;
  }

  const message = ctx.message.text;
  logger.info('Telegram from Nick', { text: message.substring(0, 80) });

  try {
    // Process through orchestrator — handles all intent logic,
    // sends notifications to other parties, returns reply for Nick
    const reply = await handleIncomingMessage('nick', 'telegram', message);
    await ctx.reply(reply);
  } catch (err) {
    logger.error('Error handling Telegram message', { error: err });
    await ctx.reply("Sorry, something went wrong on my end. Could you try that again?");
  }
});

/** Send a message to Nick via Telegram */
export async function sendToNick(message: string): Promise<void> {
  await bot.api.sendMessage(Number(NICK_CHAT_ID), message);
}

export function startTelegramBot(): void {
  bot.start({
    onStart: () => { logger.info('Telegram bot started — always listening for Nick'); },
  });
}

export { bot };
