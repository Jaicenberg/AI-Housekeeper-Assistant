import fs from 'fs';
import path from 'path';
import { AppStore, Appointment, ConversationMessage } from '../types';
import { logger } from '../utils/logger';
import { toDateString } from '../utils/date';

const STORE_PATH = path.join(process.cwd(), 'data', 'store.json');

const DEFAULT_STORE: AppStore = {
  appointments: [],
  conversationHistory: [],
};

function ensureDirectory(): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readStore(): AppStore {
  ensureDirectory();
  if (!fs.existsSync(STORE_PATH)) {
    writeStore(DEFAULT_STORE);
    return DEFAULT_STORE;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw) as AppStore;
  } catch (err) {
    logger.error('Failed to read store, resetting', { error: err });
    writeStore(DEFAULT_STORE);
    return DEFAULT_STORE;
  }
}

function writeStore(data: AppStore): void {
  ensureDirectory();
  const tmpPath = STORE_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, STORE_PATH);
}

// ── Appointment CRUD ─────────────────────────────────────────────

export function getAppointments(): Appointment[] {
  return readStore().appointments;
}

export function getAppointment(id: string): Appointment | undefined {
  return readStore().appointments.find(a => a.id === id);
}

export function getAppointmentByDate(date: string): Appointment | undefined {
  return readStore().appointments.find(a => a.date === date && a.status !== 'cancelled' && a.status !== 'rescheduled');
}

export function getUpcomingAppointments(): Appointment[] {
  const today = toDateString(new Date());
  return readStore().appointments
    .filter(a => a.date >= today && a.status !== 'cancelled' && a.status !== 'rescheduled')
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getPendingNickApproval(): Appointment[] {
  return readStore().appointments.filter(a => a.status === 'pending_nick_approval');
}

export function getTodayAppointments(): Appointment[] {
  const today = toDateString(new Date());
  return readStore().appointments.filter(
    a => a.date === today && a.status !== 'cancelled' && a.status !== 'rescheduled'
  );
}

export function getAppointmentsNeedingFollowUp(): Appointment[] {
  const today = toDateString(new Date());
  return readStore().appointments.filter(
    a => a.status === 'awaiting_confirmation' && a.followUpDate && a.followUpDate <= today
  );
}

export function upsertAppointment(appointment: Appointment): void {
  const store = readStore();
  const idx = store.appointments.findIndex(a => a.id === appointment.id);
  if (idx >= 0) {
    store.appointments[idx] = appointment;
  } else {
    store.appointments.push(appointment);
  }
  writeStore(store);
  logger.info('Appointment upserted', { id: appointment.id, status: appointment.status });
}

export function updateAppointment(id: string, updates: Partial<Appointment>): Appointment | null {
  const store = readStore();
  const idx = store.appointments.findIndex(a => a.id === id);
  if (idx < 0) return null;
  store.appointments[idx] = {
    ...store.appointments[idx]!,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  logger.info('Appointment updated', { id, updates: Object.keys(updates) });
  return store.appointments[idx]!;
}

// ── Conversation history ─────────────────────────────────────────

export function addMessage(message: ConversationMessage): void {
  const store = readStore();
  store.conversationHistory.push(message);
  if (store.conversationHistory.length > 200) {
    store.conversationHistory = store.conversationHistory.slice(-200);
  }
  writeStore(store);
}

export function getRecentMessages(limit = 20): ConversationMessage[] {
  const store = readStore();
  return store.conversationHistory.slice(-limit);
}
