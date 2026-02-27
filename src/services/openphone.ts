import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ContactRole } from '../types';

const API_BASE = 'https://api.openphone.com/v1';

const headers = {
  Authorization: config.OPENPHONE_API_KEY,
  'Content-Type': 'application/json',
};

/** Resolve a contact role to their phone number */
function getPhoneForRole(role: ContactRole): string {
  switch (role) {
    case 'housekeeper':
      return config.HOUSEKEEPER_PHONE;
    case 'boss':
      return config.BOSS_PHONE;
    case 'lauren':
      return config.LAUREN_PHONE;
    default:
      throw new Error(`No phone number for role: ${role}`);
  }
}

/** Identify who a phone number belongs to */
export function identifyCaller(phone: string): ContactRole | null {
  if (phone === config.HOUSEKEEPER_PHONE) return 'housekeeper';
  if (phone === config.BOSS_PHONE) return 'boss';
  if (phone === config.LAUREN_PHONE) return 'lauren';
  return null;
}

/** Send an SMS via OpenPhone */
export async function sendSMS(to: ContactRole, message: string): Promise<string> {
  const toPhone = getPhoneForRole(to);

  logger.info('Sending SMS', { to, toPhone: toPhone.slice(-4), messageLength: message.length });

  try {
    const response = await axios.post(
      `${API_BASE}/messages`,
      {
        content: message,
        from: config.OPENPHONE_FROM_NUMBER,
        to: [toPhone],
      },
      { headers }
    );

    const messageId = response.data?.data?.id || 'unknown';
    logger.info('SMS sent successfully', { to, messageId });
    return messageId;
  } catch (err: any) {
    logger.error('Failed to send SMS', {
      to,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}

/** Send SMS to housekeeper in Spanish */
export async function textHousekeeper(message: string): Promise<string> {
  return sendSMS('housekeeper', message);
}

/** Send SMS to boss in Spanish */
export async function textBoss(message: string): Promise<string> {
  return sendSMS('boss', message);
}

/** Send SMS to Lauren in English */
export async function textLauren(message: string): Promise<string> {
  return sendSMS('lauren', message);
}
