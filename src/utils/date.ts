const TIMEZONE = 'America/Chicago';

/** Get current date/time in Chicago timezone */
export function nowCentral(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

/** Format a date as ISO date string (YYYY-MM-DD) in Chicago timezone */
export function toDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: TIMEZONE }); // en-CA gives YYYY-MM-DD
}

/** Format a date with time in Chicago timezone for display */
export function toDisplayString(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Get the next occurrence of a specific day of week (0=Sun, 1=Mon, 5=Fri) */
export function getNextDayOfWeek(dayOfWeek: number): Date {
  const now = nowCentral();
  const current = now.getDay();
  let daysUntil = dayOfWeek - current;
  if (daysUntil <= 0) daysUntil += 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Get next Monday */
export function getNextMonday(): Date {
  return getNextDayOfWeek(1);
}

/** Get next Friday */
export function getNextFriday(): Date {
  return getNextDayOfWeek(5);
}

/** Build an ISO datetime string from a date string and time string in Chicago time */
export function buildCentralDateTime(dateStr: string, timeStr: string): string {
  // Parse as central time by appending the offset
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  // Format back with timezone info
  return dt.toISOString();
}

/** Check if a date string is today in Chicago timezone */
export function isToday(dateStr: string): boolean {
  return dateStr === toDateString(new Date());
}

/** Get day of week name from a date string */
export function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long', timeZone: TIMEZONE }).toLowerCase();
}

/** Generate an appointment ID from date and clean type */
export function makeAppointmentId(dateStr: string, cleanType: 'full' | 'half'): string {
  return `${dateStr}-${cleanType}`;
}
