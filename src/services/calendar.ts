import { google } from 'googleapis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { Appointment } from '../types';

const TIMEZONE = 'America/Chicago';

function getAuth() {
  return new google.auth.JWT(
    config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    undefined,
    config.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/calendar']
  );
}

function getCalendar() {
  return google.calendar({ version: 'v3', auth: getAuth() });
}

/** Create a calendar event for a cleaning appointment */
export async function createCleaningEvent(appointment: Appointment): Promise<string> {
  const calendar = getCalendar();

  const durationHours = appointment.cleanType === 'full' ? 4 : 2;
  const startHour = appointment.estimatedArrival
    ? parseInt(appointment.estimatedArrival.split(':')[0]!, 10)
    : 12;

  const startTime = `${appointment.date}T${String(startHour).padStart(2, '0')}:00:00`;
  const endHour = startHour + durationHours;
  const endTime = `${appointment.date}T${String(endHour).padStart(2, '0')}:00:00`;

  const cleanLabel = appointment.cleanType === 'full'
    ? 'Housekeeper Full Clean'
    : 'Housekeeper Half Clean';

  try {
    const event = await calendar.events.insert({
      calendarId: config.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: cleanLabel,
        description: `Gilma${appointment.estimatedArrival ? ` - Arriving around ${appointment.estimatedArrival}` : ''}${appointment.isApartment ? ' (Apartment)' : ''}`,
        start: { dateTime: startTime, timeZone: TIMEZONE },
        end: { dateTime: endTime, timeZone: TIMEZONE },
      },
    });

    const eventId = event.data.id!;
    logger.info('Calendar event created', { eventId, date: appointment.date, summary: cleanLabel });
    return eventId;
  } catch (err: any) {
    logger.error('Failed to create calendar event', { error: err.message });
    throw err;
  }
}

/** Update an existing calendar event */
export async function updateCleaningEvent(
  eventId: string,
  appointment: Appointment
): Promise<void> {
  const calendar = getCalendar();

  const durationHours = appointment.cleanType === 'full' ? 4 : 2;
  const startHour = appointment.estimatedArrival
    ? parseInt(appointment.estimatedArrival.split(':')[0]!, 10)
    : 12;

  const startTime = `${appointment.date}T${String(startHour).padStart(2, '0')}:00:00`;
  const endHour = startHour + durationHours;
  const endTime = `${appointment.date}T${String(endHour).padStart(2, '0')}:00:00`;

  const cleanLabel = appointment.cleanType === 'full'
    ? 'Housekeeper Full Clean'
    : 'Housekeeper Half Clean';

  try {
    await calendar.events.update({
      calendarId: config.GOOGLE_CALENDAR_ID,
      eventId,
      requestBody: {
        summary: cleanLabel,
        description: `Gilma${appointment.estimatedArrival ? ` - Arriving around ${appointment.estimatedArrival}` : ''}${appointment.isApartment ? ' (Apartment)' : ''}`,
        start: { dateTime: startTime, timeZone: TIMEZONE },
        end: { dateTime: endTime, timeZone: TIMEZONE },
      },
    });

    logger.info('Calendar event updated', { eventId });
  } catch (err: any) {
    logger.error('Failed to update calendar event', { error: err.message });
    throw err;
  }
}

/** Delete a calendar event */
export async function deleteCleaningEvent(eventId: string): Promise<void> {
  const calendar = getCalendar();

  try {
    await calendar.events.delete({
      calendarId: config.GOOGLE_CALENDAR_ID,
      eventId,
    });
    logger.info('Calendar event deleted', { eventId });
  } catch (err: any) {
    logger.error('Failed to delete calendar event', { error: err.message });
    throw err;
  }
}
