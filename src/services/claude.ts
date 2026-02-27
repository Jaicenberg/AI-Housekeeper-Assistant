import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ParsedResponse, Appointment, ContactRole } from '../types';
import { getUpcomingAppointments, getRecentMessages } from '../store/store';
import { toDateString, nowCentral } from '../utils/date';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Nick's AI scheduling assistant, managing his housekeeper appointments.

PEOPLE:
- Nick: Homeowner. Communicates via Telegram. Language: ENGLISH only.
- Lauren: Nick's wife. Communicates via SMS. Language: ENGLISH only.
- Gilma: The housekeeper. Communicates via SMS. Language: SPANISH only (casual, warm).
- Gilma's Boss (no name): Manages Gilma's schedule. Communicates via SMS. Language: SPANISH only (polite, warm).

REGULAR SCHEDULE:
- Monday: Full clean (~4 hours), arrival window 10am-2pm
- Friday: Half clean (~2 hours), arrival window 10am-2pm

WEEKLY FLOW:
1. Every Friday morning, the system asks Nick if next week's schedule stays the same.
2. Nick says yes → Contact BOTH Gilma AND her boss separately in Spanish to confirm times.
3. Nick says no cleanings → Don't contact anyone.
4. Nick changes schedule → Contact BOTH Gilma AND her boss, EXPLICITLY tell them the schedule changed and provide new days/times. They assume the regular schedule unless told otherwise.

WHEN HOUSEKEEPER/BOSS RESPONDS:
- Confirmed with time → We will notify Nick and Lauren and create a calendar event (code handles this)
- Can't make it → Tell Nick, ask housekeeper/boss when they could come, relay to Nick for approval
- "Need to confirm later" / "Wait until X day" → Tell Nick the situation. We will follow up before the scheduled date.
- Suggests apartment cleaning → Say you'll check with Nick, then notify Nick

DAY-OF RECONFIRMATION:
- Morning of cleaning day, we reconfirm with BOTH Gilma and boss
- If confirmed → Tell Nick, remind Lauren
- If can't make it → Tell Nick AND Lauren, ask for new date, get Nick's approval

APARTMENT/OFFICE CLEANING:
- Only at Nick's explicit request
- If housekeeper/boss suggests it, say you'll ask Nick first

LANGUAGE & STYLE:
- To Gilma: Casual, warm Spanish. Example: "Hola Gilma, que tal está? Quería saber como a que hora podría llegar el Lunes a la casa de Nick para un Full Clean! Quedo a la espera."
- To Boss: Polite, warm Spanish. Example: "Hola que tal se encuentra? Quería saber a que hora podría llegar Gilma a la casa de Nick para un full clean el lunes?"
- To Nick: Concise, helpful English. "Hey Nick, Gilma confirmed for Monday at 11am."
- To Lauren: Friendly, brief English. "Hey Lauren! Nick's assistant here, just wanted to let you know the housekeeper is scheduled for Monday at 11am."

CRITICAL RULES:
- NEVER mix languages in a single message
- When schedule changes, you MUST explicitly tell Gilma AND boss about the change
- Always contact BOTH Gilma AND her boss separately (not just one)
- If Lauren just says "thank you" or similar, reply once politely ("You're welcome!") and that's it
- Calendar event names: "Housekeeper Full Clean" or "Housekeeper Half Clean"
- Only include messagesToSend for people OTHER than the sender (the sender gets replyToSender)`;

function buildContext(): string {
  const now = nowCentral();
  const todayStr = toDateString(now);
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const appointments = getUpcomingAppointments();
  const recent = getRecentMessages(20);

  let ctx = `TODAY: ${todayStr} (${dayName})\n\n`;

  ctx += 'UPCOMING APPOINTMENTS:\n';
  if (appointments.length === 0) {
    ctx += 'None\n';
  } else {
    for (const apt of appointments) {
      ctx += `- ID: ${apt.id} | Date: ${apt.date} (${apt.dayOfWeek}) | Type: ${apt.cleanType} clean | Status: ${apt.status}`;
      if (apt.estimatedArrival) ctx += ` | Arrival: ${apt.estimatedArrival}`;
      if (apt.followUpDate) ctx += ` | Follow-up by: ${apt.followUpDate}`;
      if (apt.followUpReason) ctx += ` | Reason: ${apt.followUpReason}`;
      if (apt.isApartment) ctx += ' | APARTMENT';
      if (apt.notes) ctx += ` | Notes: ${apt.notes}`;
      ctx += '\n';
    }
  }

  if (recent.length > 0) {
    ctx += '\nRECENT CONVERSATION:\n';
    for (const msg of recent) {
      ctx += `[${msg.timestamp}] ${msg.from} → ${msg.to} (${msg.channel}): ${msg.content}\n`;
    }
  }

  return ctx;
}

const INTENT_INSTRUCTIONS = `
Respond with ONLY a valid JSON object (no markdown fences, no extra text):
{
  "intent": "intent_type",
  "intentData": { ...extracted data relevant to the intent },
  "replyToSender": "reply in the sender's language",
  "messagesToSend": [
    { "to": "recipient_role", "message": "message in recipient's language" }
  ],
  "summary": "brief English summary of what happened"
}

INTENT TYPES BY SENDER:

Nick: approve_schedule, approve_schedule_changed, decline_schedule, cancel, reschedule, approve_reschedule, decline_reschedule, request_apartment_clean, check_status, message_housekeeper, message_boss, general

Housekeeper/Boss: confirm, decline, confirm_later, reschedule_suggest, apartment_suggest, unexpected_cancel, day_of_confirm, day_of_cancel, general

Lauren: thanks, reschedule_request, question, general

INTENTDATA EXAMPLES:
- confirm: { "arrivalTime": "11:00", "appointmentId": "2026-03-02-full" }
- confirm_later: { "followUpDate": "2026-03-01", "reason": "Don't have next week's schedule yet" }
- approve_schedule_changed: { "changes": "Only Monday this week", "appointments": [{ "date": "2026-03-02", "dayOfWeek": "monday", "cleanType": "full" }] }
- cancel: { "appointmentId": "2026-03-02-full" } or { "date": "2026-03-02" }
- reschedule: { "fromDate": "2026-03-06", "toDate": "2026-03-05", "cleanType": "half" }
- decline: { "reason": "sick", "appointmentId": "2026-03-02-full" }
- day_of_confirm: { "arrivalTime": "11:00", "appointmentId": "2026-03-02-full" }
- unexpected_cancel: { "reason": "car broke down", "appointmentId": "2026-03-02-full" }

Only include messagesToSend for people who NEED to be notified. Don't include the sender.
When housekeeper/boss confirms, include messages to both nick AND lauren.
When something is cancelled or changed, include nick (and lauren if she was already notified).`;

/** Process any incoming message and return structured response */
export async function processMessage(
  from: ContactRole,
  message: string
): Promise<ParsedResponse> {
  const context = buildContext();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `${context}\nMESSAGE FROM: ${from}\n"${message}"\n${INTENT_INSTRUCTIONS}`,
      },
    ],
  });

  try {
    const text = response.content[0]!.type === 'text' ? response.content[0]!.text : '';
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr) as ParsedResponse;
    if (!parsed.messagesToSend) parsed.messagesToSend = [];
    logger.info('Parsed message', { from, intent: parsed.intent, summary: parsed.summary });
    return parsed;
  } catch (err) {
    logger.error('Failed to parse Claude response', { error: err, from });
    const isSpanish = from === 'housekeeper' || from === 'boss';
    return {
      intent: 'unknown',
      replyToSender: isSpanish
        ? 'Gracias por su mensaje. Le confirmo pronto.'
        : "Got it, let me look into that.",
      messagesToSend: [],
      summary: 'Failed to parse message',
    };
  }
}

/** Generate Spanish outreach messages for both Gilma and boss */
export async function generateOutreachMessages(
  appointments: Appointment[],
  isChanged: boolean,
  changeDetails?: string
): Promise<{ housekeeperMsg: string; bossMsg: string }> {
  const daysDescription = appointments
    .map(a => {
      const dayEs = a.dayOfWeek === 'monday' ? 'lunes' : a.dayOfWeek === 'friday' ? 'viernes' : a.dayOfWeek;
      const typeEs = a.cleanType === 'full' ? 'full clean' : 'media limpieza';
      return `${dayEs} para ${typeEs}`;
    })
    .join(' y ');

  const changeNote = isChanged && changeDetails
    ? `IMPORTANT: The schedule has changed from the usual. Changes: ${changeDetails}. You MUST mention this change in your message.`
    : '';

  const [hkResp, bossResp] = await Promise.all([
    client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: 'You write brief, casual, warm SMS messages in Spanish to Gilma the housekeeper. Keep it natural and friendly like a real person texting.',
      messages: [{
        role: 'user',
        content: `Write a short SMS in Spanish to Gilma confirming if she can come to Nick's house: ${daysDescription}. Ask what time she'd arrive. ${changeNote}\nRespond with ONLY the message text.`,
      }],
    }),
    client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: "You write brief, polite, warm SMS messages in Spanish to the housekeeper's boss. Keep it natural like a real person texting.",
      messages: [{
        role: 'user',
        content: `Write a short SMS in Spanish to Gilma's boss confirming if Gilma can come to Nick's house: ${daysDescription}. Ask what time she'd arrive. ${changeNote}\nRespond with ONLY the message text.`,
      }],
    }),
  ]);

  const hkText = hkResp.content[0]!.type === 'text' ? hkResp.content[0]!.text.trim() : '';
  const bossText = bossResp.content[0]!.type === 'text' ? bossResp.content[0]!.text.trim() : '';

  return { housekeeperMsg: hkText, bossMsg: bossText };
}

/** Generate day-of reconfirmation messages in Spanish */
export async function generateReconfirmation(
  appointment: Appointment
): Promise<{ housekeeperMsg: string; bossMsg: string }> {
  const dayEs = appointment.dayOfWeek === 'monday' ? 'lunes' : appointment.dayOfWeek === 'friday' ? 'viernes' : appointment.dayOfWeek;
  const timeStr = appointment.estimatedArrival || 'la hora acordada';

  const [hkResp, bossResp] = await Promise.all([
    client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: 'You write brief, casual SMS messages in Spanish.',
      messages: [{
        role: 'user',
        content: `Write a very short, friendly reconfirmation SMS in Spanish to Gilma checking she's still coming today (${dayEs}) around ${timeStr} for cleaning at Nick's house. 1-2 sentences max. Respond with ONLY the message text.`,
      }],
    }),
    client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: 'You write brief, polite SMS messages in Spanish.',
      messages: [{
        role: 'user',
        content: `Write a very short, polite reconfirmation SMS in Spanish to Gilma's boss checking that Gilma is still coming today (${dayEs}) around ${timeStr} for cleaning at Nick's house. 1-2 sentences max. Respond with ONLY the message text.`,
      }],
    }),
  ]);

  const hkText = hkResp.content[0]!.type === 'text' ? hkResp.content[0]!.text.trim() : '';
  const bossText = bossResp.content[0]!.type === 'text' ? bossResp.content[0]!.text.trim() : '';

  return { housekeeperMsg: hkText, bossMsg: bossText };
}
