import { logger } from '../utils/logger';
import { v4Fallback } from '../utils/id';
import { toDateString, getDayOfWeek, makeAppointmentId } from '../utils/date';
import {
  addMessage,
  getUpcomingAppointments,
  getPendingNickApproval,
  updateAppointment,
  upsertAppointment,
  getAppointment,
  getAppointmentByDate,
} from '../store/store';
import { processMessage, generateOutreachMessages } from './claude';
import { textHousekeeper, textBoss, textLauren } from './openphone';
import { createCleaningEvent, updateCleaningEvent, deleteCleaningEvent } from './calendar';
import { ContactRole, Appointment, CleanType } from '../types';

// ── Injected Telegram sender (set from index.ts) ────────────────

let _sendToNick: ((msg: string) => Promise<void>) | null = null;

export function initOrchestrator(sendToNick: (msg: string) => Promise<void>): void {
  _sendToNick = sendToNick;
}

async function notifyNick(message: string): Promise<void> {
  if (_sendToNick) {
    await _sendToNick(message);
    logOutgoing('bot', 'nick', 'telegram', message, 'en');
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function logIncoming(from: ContactRole, channel: 'telegram' | 'sms', content: string, appointmentId?: string): void {
  addMessage({
    id: v4Fallback(),
    timestamp: new Date().toISOString(),
    from,
    to: 'bot',
    channel,
    content,
    appointmentId,
    language: from === 'housekeeper' || from === 'boss' ? 'es' : 'en',
  });
}

function logOutgoing(from: 'bot', to: ContactRole, channel: 'telegram' | 'sms', content: string, language: 'en' | 'es', appointmentId?: string): void {
  addMessage({
    id: v4Fallback(),
    timestamp: new Date().toISOString(),
    from,
    to,
    channel,
    content,
    appointmentId,
    language,
  });
}

async function sendNotifications(
  notifications: Array<{ to: ContactRole; message: string }>,
  appointmentId?: string
): Promise<void> {
  for (const notif of notifications) {
    try {
      switch (notif.to) {
        case 'nick':
          await notifyNick(notif.message);
          break;
        case 'housekeeper':
          await textHousekeeper(notif.message);
          logOutgoing('bot', 'housekeeper', 'sms', notif.message, 'es', appointmentId);
          break;
        case 'boss':
          await textBoss(notif.message);
          logOutgoing('bot', 'boss', 'sms', notif.message, 'es', appointmentId);
          break;
        case 'lauren':
          await textLauren(notif.message);
          logOutgoing('bot', 'lauren', 'sms', notif.message, 'en', appointmentId);
          break;
      }
    } catch (err) {
      logger.error('Failed to send notification', { to: notif.to, error: err });
    }
  }
}

function findRelevantAppointment(intentData?: Record<string, any>): Appointment | undefined {
  if (intentData?.appointmentId) {
    return getAppointment(intentData.appointmentId);
  }
  if (intentData?.date) {
    return getAppointmentByDate(intentData.date);
  }
  // Default to the next upcoming non-cancelled appointment
  const upcoming = getUpcomingAppointments();
  return upcoming[0];
}

// ── Main handler ─────────────────────────────────────────────────

/**
 * Handle any incoming message from any party.
 * Returns the reply text for the sender.
 */
export async function handleIncomingMessage(
  from: ContactRole,
  channel: 'telegram' | 'sms',
  message: string
): Promise<string> {
  // Log incoming
  logIncoming(from, channel, message);

  // Ask Claude to parse the message
  const parsed = await processMessage(from, message);

  // Handle intent-specific logic
  switch (parsed.intent) {
    // ── Nick intents ─────────────────────────────────────────
    case 'approve_schedule':
      await handleApproveSchedule(false);
      break;

    case 'approve_schedule_changed':
      await handleApproveScheduleChanged(parsed.intentData);
      break;

    case 'decline_schedule':
      await handleDeclineSchedule();
      break;

    case 'cancel':
      await handleCancel(parsed.intentData);
      break;

    case 'reschedule':
      await handleReschedule(parsed.intentData);
      break;

    case 'approve_reschedule':
      await handleApproveReschedule(parsed.intentData);
      break;

    case 'request_apartment_clean':
      await handleApartmentRequest(parsed.intentData);
      break;

    // ── Housekeeper/Boss intents ─────────────────────────────
    case 'confirm':
      await handleConfirm(parsed.intentData);
      break;

    case 'decline':
      await handleDecline(parsed.intentData);
      break;

    case 'confirm_later':
      await handleConfirmLater(parsed.intentData);
      break;

    case 'reschedule_suggest':
      // Just notify Nick (Claude already included nick in messagesToSend)
      break;

    case 'unexpected_cancel':
      await handleUnexpectedCancel(parsed.intentData);
      break;

    case 'day_of_confirm':
      await handleDayOfConfirm(parsed.intentData);
      break;

    case 'day_of_cancel':
      await handleDayOfCancel(parsed.intentData);
      break;

    case 'apartment_suggest':
      // Claude will have generated a "let me check with Nick" reply
      // and a notification to Nick
      break;

    // ── Lauren intents ───────────────────────────────────────
    case 'thanks':
      // Just reply politely (Claude handles the reply)
      break;

    case 'reschedule_request':
      // Claude will have generated a notification to Nick
      break;

    // ── General / status / unknown ───────────────────────────
    case 'check_status':
    case 'general':
    case 'question':
    case 'unknown':
    case 'message_housekeeper':
    case 'message_boss':
    case 'decline_reschedule':
    default:
      break;
  }

  // Send any cross-party notifications Claude generated
  const appt = findRelevantAppointment(parsed.intentData);
  await sendNotifications(parsed.messagesToSend, appt?.id);

  // Log the reply
  const replyLang = from === 'housekeeper' || from === 'boss' ? 'es' : 'en';
  logOutgoing('bot', from, channel, parsed.replyToSender, replyLang as 'en' | 'es', appt?.id);

  return parsed.replyToSender;
}

// ── Intent handlers ──────────────────────────────────────────────

async function handleApproveSchedule(isChanged: boolean, changeDetails?: string): Promise<void> {
  // Find pending_nick_approval appointments and send outreach
  const pending = getPendingNickApproval();
  if (pending.length === 0) {
    // Create standard appointments if none exist
    return;
  }

  // Generate and send outreach messages
  const msgs = await generateOutreachMessages(pending, isChanged, changeDetails);

  await textHousekeeper(msgs.housekeeperMsg);
  logOutgoing('bot', 'housekeeper', 'sms', msgs.housekeeperMsg, 'es');

  await textBoss(msgs.bossMsg);
  logOutgoing('bot', 'boss', 'sms', msgs.bossMsg, 'es');

  // Update all pending appointments to outreach_sent
  for (const appt of pending) {
    updateAppointment(appt.id, {
      status: 'outreach_sent',
      outreachAttempts: appt.outreachAttempts + 1,
      lastOutreachDate: toDateString(new Date()),
    });
  }
}

async function handleApproveScheduleChanged(intentData?: Record<string, any>): Promise<void> {
  // Cancel all current pending_nick_approval appointments
  const pending = getPendingNickApproval();
  for (const appt of pending) {
    updateAppointment(appt.id, { status: 'cancelled', notes: 'Schedule changed by Nick' });
  }

  // Create new appointments from intentData
  const newAppointments: Appointment[] = [];
  const changes = intentData?.changes || 'Schedule changed';

  if (intentData?.appointments && Array.isArray(intentData.appointments)) {
    for (const apt of intentData.appointments) {
      const now = new Date().toISOString();
      const newAppt: Appointment = {
        id: makeAppointmentId(apt.date, apt.cleanType),
        date: apt.date,
        dayOfWeek: apt.dayOfWeek || getDayOfWeek(apt.date),
        cleanType: apt.cleanType || 'full',
        status: 'pending_outreach',
        outreachAttempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      upsertAppointment(newAppt);
      newAppointments.push(newAppt);
    }
  }

  if (newAppointments.length > 0) {
    // Send outreach with change notification
    const msgs = await generateOutreachMessages(newAppointments, true, changes);

    await textHousekeeper(msgs.housekeeperMsg);
    logOutgoing('bot', 'housekeeper', 'sms', msgs.housekeeperMsg, 'es');

    await textBoss(msgs.bossMsg);
    logOutgoing('bot', 'boss', 'sms', msgs.bossMsg, 'es');

    for (const appt of newAppointments) {
      updateAppointment(appt.id, {
        status: 'outreach_sent',
        outreachAttempts: 1,
        lastOutreachDate: toDateString(new Date()),
      });
    }
  }
}

async function handleDeclineSchedule(): Promise<void> {
  const pending = getPendingNickApproval();
  for (const appt of pending) {
    updateAppointment(appt.id, { status: 'cancelled', notes: 'Nick declined cleanings' });
  }
}

async function handleCancel(intentData?: Record<string, any>): Promise<void> {
  const appt = findRelevantAppointment(intentData);
  if (!appt) return;

  if (appt.calendarEventId) {
    try { await deleteCleaningEvent(appt.calendarEventId); } catch { /* logged inside */ }
  }

  updateAppointment(appt.id, { status: 'cancelled', notes: 'Cancelled by Nick' });
}

async function handleReschedule(intentData?: Record<string, any>): Promise<void> {
  if (!intentData?.toDate) return;

  const sourceAppt = findRelevantAppointment(intentData);
  if (!sourceAppt) return;

  // Cancel old
  if (sourceAppt.calendarEventId) {
    try { await deleteCleaningEvent(sourceAppt.calendarEventId); } catch { /* logged */ }
  }
  updateAppointment(sourceAppt.id, { status: 'rescheduled' });

  // Create new
  const cleanType = (intentData.cleanType as CleanType) || sourceAppt.cleanType;
  const newId = makeAppointmentId(intentData.toDate, cleanType);
  const now = new Date().toISOString();
  upsertAppointment({
    id: newId,
    date: intentData.toDate,
    dayOfWeek: getDayOfWeek(intentData.toDate),
    cleanType,
    status: 'pending_outreach',
    outreachAttempts: 0,
    createdAt: now,
    updatedAt: now,
  });

  // Send outreach for the new date
  const newAppt = getAppointment(newId)!;
  const msgs = await generateOutreachMessages([newAppt], true, `Rescheduled from ${sourceAppt.date} to ${intentData.toDate}`);

  await textHousekeeper(msgs.housekeeperMsg);
  logOutgoing('bot', 'housekeeper', 'sms', msgs.housekeeperMsg, 'es');
  await textBoss(msgs.bossMsg);
  logOutgoing('bot', 'boss', 'sms', msgs.bossMsg, 'es');

  updateAppointment(newId, {
    status: 'outreach_sent',
    outreachAttempts: 1,
    lastOutreachDate: toDateString(new Date()),
  });
}

async function handleApproveReschedule(intentData?: Record<string, any>): Promise<void> {
  // Nick approved a date suggested by housekeeper/boss
  if (!intentData?.date) return;

  const cleanType = (intentData.cleanType as CleanType) || 'full';
  const newId = makeAppointmentId(intentData.date, cleanType);
  const existing = getAppointment(newId);

  if (existing) {
    updateAppointment(newId, { status: 'pending_outreach' });
  } else {
    const now = new Date().toISOString();
    upsertAppointment({
      id: newId,
      date: intentData.date,
      dayOfWeek: getDayOfWeek(intentData.date),
      cleanType,
      status: 'pending_outreach',
      outreachAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function handleApartmentRequest(intentData?: Record<string, any>): Promise<void> {
  // Nick wants apartment cleaning — create appointment and reach out
  if (!intentData?.date) return;

  const cleanType = (intentData.cleanType as CleanType) || 'full';
  const newId = makeAppointmentId(intentData.date, cleanType) + '-apt';
  const now = new Date().toISOString();

  upsertAppointment({
    id: newId,
    date: intentData.date,
    dayOfWeek: getDayOfWeek(intentData.date),
    cleanType,
    status: 'outreach_sent',
    isApartment: true,
    outreachAttempts: 1,
    lastOutreachDate: toDateString(new Date()),
    createdAt: now,
    updatedAt: now,
  });
}

async function handleConfirm(intentData?: Record<string, any>): Promise<void> {
  const appt = findRelevantAppointment(intentData);
  if (!appt) return;

  const arrivalTime = intentData?.arrivalTime;

  const updated = updateAppointment(appt.id, {
    status: 'confirmed',
    estimatedArrival: arrivalTime || appt.estimatedArrival,
  });

  if (!updated) return;

  // Create calendar event
  try {
    if (updated.calendarEventId) {
      await updateCleaningEvent(updated.calendarEventId, updated);
    } else {
      const eventId = await createCleaningEvent(updated);
      updateAppointment(updated.id, { calendarEventId: eventId });
    }
  } catch {
    logger.error('Calendar operation failed after confirmation');
  }
}

async function handleDecline(intentData?: Record<string, any>): Promise<void> {
  const appt = findRelevantAppointment(intentData);
  if (!appt) return;

  if (appt.calendarEventId) {
    try { await deleteCleaningEvent(appt.calendarEventId); } catch { /* logged */ }
  }

  updateAppointment(appt.id, {
    status: 'negotiating',
    notes: intentData?.reason || 'Declined by housekeeper',
  });
}

async function handleConfirmLater(intentData?: Record<string, any>): Promise<void> {
  const appt = findRelevantAppointment(intentData);
  if (!appt) return;

  updateAppointment(appt.id, {
    status: 'awaiting_confirmation',
    followUpDate: intentData?.followUpDate,
    followUpReason: intentData?.reason || 'Waiting to confirm',
  });
}

async function handleUnexpectedCancel(intentData?: Record<string, any>): Promise<void> {
  const appt = findRelevantAppointment(intentData);
  if (!appt) return;

  if (appt.calendarEventId) {
    try { await deleteCleaningEvent(appt.calendarEventId); } catch { /* logged */ }
  }

  updateAppointment(appt.id, {
    status: 'negotiating',
    notes: intentData?.reason || 'Unexpected cancellation',
  });
}

async function handleDayOfConfirm(intentData?: Record<string, any>): Promise<void> {
  const appt = findRelevantAppointment(intentData);
  if (!appt) return;

  updateAppointment(appt.id, {
    status: 'day_of_reconfirmed',
    estimatedArrival: intentData?.arrivalTime || appt.estimatedArrival,
  });

  // Update calendar if arrival time changed
  if (intentData?.arrivalTime && appt.calendarEventId) {
    const updated = getAppointment(appt.id);
    if (updated) {
      try { await updateCleaningEvent(appt.calendarEventId, updated); } catch { /* logged */ }
    }
  }
}

async function handleDayOfCancel(intentData?: Record<string, any>): Promise<void> {
  const appt = findRelevantAppointment(intentData);
  if (!appt) return;

  if (appt.calendarEventId) {
    try { await deleteCleaningEvent(appt.calendarEventId); } catch { /* logged */ }
  }

  updateAppointment(appt.id, {
    status: 'negotiating',
    notes: intentData?.reason || 'Day-of cancellation',
  });
}
