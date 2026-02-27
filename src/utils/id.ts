import crypto from 'crypto';

/** Generate a simple unique ID */
export function v4Fallback(): string {
  return crypto.randomUUID();
}
