// ── Appointment state ────────────────────────────────────────────

export type CleanType = 'full' | 'half';

export type AppointmentStatus =
  | 'pending_nick_approval'   // Friday check-in sent, waiting for Nick
  | 'pending_outreach'        // Nick approved, need to contact housekeeper/boss
  | 'outreach_sent'           // Contacted housekeeper/boss, waiting for response
  | 'awaiting_confirmation'   // Housekeeper/boss said "I'll confirm later"
  | 'confirmed'               // Confirmed with arrival time
  | 'day_of_reconfirmed'      // Day-of reconfirmation received
  | 'negotiating'             // Back-and-forth on scheduling
  | 'completed'               // Cleaning done
  | 'cancelled'               // Cancelled
  | 'rescheduled';            // Moved to different date

export interface Appointment {
  id: string;                        // e.g. "2026-03-02-full"
  date: string;                      // ISO date: "2026-03-02"
  dayOfWeek: string;                 // e.g. "monday", "friday", "wednesday"
  cleanType: CleanType;
  status: AppointmentStatus;
  estimatedArrival?: string;         // e.g. "14:00"
  calendarEventId?: string;          // Google Calendar event ID
  notes?: string;
  outreachAttempts: number;
  lastOutreachDate?: string;
  followUpDate?: string;             // When to follow up if awaiting_confirmation
  followUpReason?: string;           // Why they need to confirm later
  isApartment?: boolean;             // Apartment/office clean (not regular house)
  createdAt: string;
  updatedAt: string;
}

export interface AppStore {
  appointments: Appointment[];
  conversationHistory: ConversationMessage[];
}

// ── Conversation tracking ────────────────────────────────────────

export type ContactRole = 'nick' | 'housekeeper' | 'boss' | 'lauren';

export interface ConversationMessage {
  id: string;
  timestamp: string;
  from: ContactRole | 'bot';
  to: ContactRole | 'bot';
  channel: 'telegram' | 'sms';
  content: string;
  appointmentId?: string;
  language: 'en' | 'es';
}

// ── Claude response ──────────────────────────────────────────────

export interface ParsedResponse {
  intent: string;
  intentData?: Record<string, any>;
  replyToSender: string;
  messagesToSend: Array<{ to: ContactRole; message: string }>;
  summary: string;
}

// ── Calendar ─────────────────────────────────────────────────────

export interface CalendarEvent {
  summary: string;
  description?: string;
  startTime: string;
  endTime: string;
}
