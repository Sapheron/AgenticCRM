/**
 * Thrown by `normalizePhone` when the input contains letters or otherwise
 * cannot be interpreted as a phone number. NestJS can map this to a 400.
 */
export class InvalidPhoneError extends Error {
  constructor(message = 'Invalid phone number') {
    super(message);
    this.name = 'InvalidPhoneError';
  }
}

/**
 * Normalize a phone number to E.164 format: +[country code][number]
 * Strips spaces, dashes, parentheses, etc.
 * Defaults to India (+91) if no country code is detected.
 *
 * Throws `InvalidPhoneError` when the input contains alphabetic characters
 * or does not contain enough digits to form a usable subscriber number.
 */
export function normalizePhone(raw: string, defaultCountryCode = '91'): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    throw new InvalidPhoneError('Phone number is required');
  }

  // Reject anything with letters — the old behaviour silently stripped them
  // (e.g. "ABC123" became "+91123"), which let bogus numbers into the CRM.
  if (/[A-Za-z]/.test(trimmed)) {
    throw new InvalidPhoneError('Phone number must not contain letters');
  }

  // Remove all non-digit characters except leading +
  let digits = trimmed.replace(/[^\d+]/g, '');

  // Already E.164
  if (digits.startsWith('+')) {
    if (digits.replace(/\D/g, '').length < 7) {
      throw new InvalidPhoneError('Phone number is too short');
    }
    return digits;
  }

  // Remove leading zeros
  digits = digits.replace(/^0+/, '');

  if (digits.length < 7) {
    throw new InvalidPhoneError('Phone number is too short');
  }

  // If starts with country code (e.g. 91XXXXXXXXXX for India)
  if (digits.startsWith(defaultCountryCode) && digits.length > 10) {
    return `+${digits}`;
  }

  return `+${defaultCountryCode}${digits}`;
}

/** Extract the JID (phone@s.whatsapp.net) from a Baileys JID. */
export function jidToPhone(jid: string): string {
  return jid.split('@')[0].split(':')[0];
}

/** Convert a phone number to a Baileys JID. */
export function phoneToJid(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}
