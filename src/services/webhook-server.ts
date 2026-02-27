import express from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { identifyCaller, sendSMS } from './openphone';
import { handleIncomingMessage } from './orchestrator';
import { ContactRole } from '../types';

export function createWebhookServer(): express.Express {
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // OpenPhone webhook: incoming SMS
  app.post('/webhooks/sms', async (req, res) => {
    try {
      const event = req.body;
      logger.info('Incoming SMS webhook', { type: event?.type });

      if (event?.type !== 'message.received') {
        res.status(200).json({ ok: true });
        return;
      }

      const data = event.data?.object;
      if (!data) {
        res.status(200).json({ ok: true });
        return;
      }

      const fromPhone: string = data.from;
      const messageText: string = data.text || '';
      const callerRole = identifyCaller(fromPhone);

      if (!callerRole) {
        logger.warn('SMS from unknown number', { from: fromPhone });
        res.status(200).json({ ok: true });
        return;
      }

      logger.info('SMS received', { from: callerRole, text: messageText.substring(0, 80) });

      // Process through orchestrator — handles all intent logic,
      // sends notifications to other parties, returns reply for sender
      const reply = await handleIncomingMessage(callerRole, 'sms', messageText);

      // Send the reply back to the SMS sender
      if (reply) {
        try {
          await sendSMS(callerRole, reply);
        } catch (err) {
          logger.error('Failed to send SMS reply', { to: callerRole, error: err });
        }
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error('Webhook handler error', { error: err });
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return app;
}

export function startWebhookServer(): void {
  const app = createWebhookServer();
  app.listen(config.OPENPHONE_WEBHOOK_PORT, () => {
    logger.info(`Webhook server listening on port ${config.OPENPHONE_WEBHOOK_PORT}`);
  });
}
