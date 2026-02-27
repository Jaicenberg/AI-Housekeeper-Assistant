import cron from 'node-cron';
import { logger } from '../utils/logger';
import {
  toDateString,
  getNextMonday,
  getNextFriday,
  nowCentral,
  makeAppointmentId,
} from '../utils/date';
import {
  getUpcomingAppointments,
  upsertAppointment,
  updateAppointment,
  getAppointment,
  getTodayAppointments,
  getAppointmentsNeedingFollowUp,
} from '../store/store';
import { generateReconfirmation, generateOutreachMessages } from '../services/claude';
import { textHousekeeper, textBoss } from '../services/openphone';
import { sendToNick } from '../bot/telegram';
import { Appointment } from '../types';
import { addMessage } from '../store/store';
import { v4Fallback } from '../utils/id';

function logOutgoing(to: 'housekeeper' | 'boss' | 'nick', channel: 'telegram' | 'sms', content: string, language: 'en' | 'es', appointmentId?: string): void {
  addMessage({
    id: v4Fallback(),
    timestamp: new Date().toISOString(),
    from: 'bot',
    to,
    channel,
    content,
    appointmentId,
    language,
  });
}

/** Create next week's appointments with pending_nick_approval status */
function createPendingAppointments(): Appointment[] {
  const nextMon = getNextMonday();
  const nextFri = getNextFriday();
  const monDate = toDateString(nextMon);
  const friDate = toDateString(nextFri);
  const now = new Date().toISOString();
  const created: Appointment[] = [];

  for (const [date, day, type] of [
    [monDate, 'monday', 'full'],
    [friDate, 'friday', 'half'],
  ] as [string, 'monday' | 'friday', 'full' | 'half'][]) {
    const id = makeAppointmentId(date, type);
    const existing = getAppointment(id);
    if (!existing) {
      const appt: Appointment = {
        id,
        date,
        dayOfWeek: day,
        cleanType: type,
        status: 'pending_nick_approval',
        outreachAttempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      upsertAppointment(appt);
      created.push(appt);
      logger.info('Created pending appointment', { id });
    }
  }

  return created;
}

export function startScheduler(): void {
  // ── Friday 9am: Ask Nick about next week's schedule ─────────
  cron.schedule('0 9 * * 5', async () => {
    logger.info('Friday check-in: asking Nick about next week');

    const created = createPendingAppointments();
    if (created.length === 0) {
      logger.info('Appointments already exist, skipping Friday check-in');
      return;
    }

    const monDate = created.find(a => a.dayOfWeek === 'monday')?.date;
    const friDate = created.find(a => a.dayOfWeek === 'friday')?.date;

    const msg = `Hey Nick! Just checking in for next week — will the regular cleaning schedule work? (Monday ${monDate} full clean, Friday ${friDate} half clean) Let me know if you need any changes or want to skip!`;

    try {
      await sendToNick(msg);
      logOutgoing('nick', 'telegram', msg, 'en');
    } catch (err) {
      logger.error('Failed to send Friday check-in to Nick', { error: err });
    }
  }, { timezone: 'America/Chicago' });

  // ── Day-of 8am: Reconfirm with BOTH Gilma and boss ─────────
  cron.schedule('0 8 * * *', async () => {
    const todayAppts = getTodayAppointments();
    const toReconfirm = todayAppts.filter(
      a => a.status === 'confirmed' || a.status === 'day_of_reconfirmed'
    );

    if (toReconfirm.length === 0) return;

    logger.info('Day-of reconfirmation', { count: toReconfirm.length });

    for (const appt of toReconfirm) {
      try {
        const msgs = await generateReconfirmation(appt);

        await textHousekeeper(msgs.housekeeperMsg);
        logOutgoing('housekeeper', 'sms', msgs.housekeeperMsg, 'es', appt.id);

        await textBoss(msgs.bossMsg);
        logOutgoing('boss', 'sms', msgs.bossMsg, 'es', appt.id);

        await sendToNick(`Sent day-of reconfirmation for today's ${appt.cleanType} clean to Gilma and her boss. Waiting for their response.`);
        logOutgoing('nick', 'telegram', 'Sent day-of reconfirmation', 'en', appt.id);
      } catch (err) {
        logger.error('Day-of reconfirmation failed', { appointmentId: appt.id, error: err });
      }
    }
  }, { timezone: 'America/Chicago' });

  // ── Daily 9am: Follow up on awaiting_confirmation ───────────
  cron.schedule('0 9 * * *', async () => {
    const needFollowUp = getAppointmentsNeedingFollowUp();

    if (needFollowUp.length === 0) return;

    logger.info('Following up on pending confirmations', { count: needFollowUp.length });

    for (const appt of needFollowUp) {
      try {
        const msgs = await generateOutreachMessages(
          [appt],
          false,
          undefined
        );

        await textHousekeeper(msgs.housekeeperMsg);
        logOutgoing('housekeeper', 'sms', msgs.housekeeperMsg, 'es', appt.id);

        await textBoss(msgs.bossMsg);
        logOutgoing('boss', 'sms', msgs.bossMsg, 'es', appt.id);

        updateAppointment(appt.id, {
          status: 'outreach_sent',
          outreachAttempts: appt.outreachAttempts + 1,
          lastOutreachDate: toDateString(new Date()),
        });

        await sendToNick(`Following up with Gilma and her boss about the ${appt.date} (${appt.dayOfWeek}) cleaning — they said they'd confirm by today.`);
      } catch (err) {
        logger.error('Follow-up failed', { appointmentId: appt.id, error: err });
      }
    }
  }, { timezone: 'America/Chicago' });

  // ── Daily midnight: Check for stale outreach_sent ───────────
  cron.schedule('0 0 * * *', () => {
    const upcoming = getUpcomingAppointments();
    const today = toDateString(new Date());

    for (const appt of upcoming) {
      // If it's the day before the appointment and still outreach_sent, notify Nick
      const apptDate = new Date(appt.date + 'T12:00:00');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = toDateString(tomorrow);

      if (appt.date === tomorrowStr && appt.status === 'outreach_sent') {
        sendToNick(
          `Heads up: tomorrow's ${appt.cleanType} clean (${appt.date}) hasn't been confirmed yet by Gilma or her boss. I'll try reaching out again in the morning.`
        ).catch(err => logger.error('Failed to warn Nick about unconfirmed appointment', { error: err }));
      }
    }
  }, { timezone: 'America/Chicago' });

  logger.info('Scheduler started — Friday check-in, day-of reconfirm, daily follow-ups');
}
