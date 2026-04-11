/**
 * Pure validators for the Forms module.
 *
 * - `validateFieldDef`        — checks a FormField definition is structurally sound
 * - `validateSubmission`      — coerces + validates a user-submitted payload against
 *                               the form's field list, returns normalized data
 * - `pickContactFromSubmission` — heuristic mapping of submission fields to Contact
 *                               fields (phone, email, name) so auto-lead creation
 *                               can populate a Contact without the form designer
 *                               having to name their fields exactly
 * - `slugify`                 — URL-safe slug generator (non-unique; caller adds suffix)
 */

import type { FormField, FormFieldType } from './forms.types';

const FIELD_TYPES: FormFieldType[] = [
  'text',
  'email',
  'phone',
  'number',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'date',
  'url',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/i;
const PHONE_RE = /^\+?[\d\s\-()]{7,}$/;

/**
 * Validate a single field definition. Returns an array of human-readable
 * error messages; empty array means the field is valid.
 */
export function validateFieldDef(field: FormField): string[] {
  const errors: string[] = [];
  if (!field.key?.trim()) errors.push('field.key is required');
  if (field.key && !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(field.key)) {
    errors.push(`field.key "${field.key}" must match [a-zA-Z_][a-zA-Z0-9_-]*`);
  }
  if (!field.label?.trim()) errors.push(`field "${field.key}": label required`);
  if (!FIELD_TYPES.includes(field.type)) {
    errors.push(`field "${field.key}": unknown type "${field.type}"`);
  }
  if ((field.type === 'select' || field.type === 'radio') && (!field.options || field.options.length === 0)) {
    errors.push(`field "${field.key}": ${field.type} requires at least one option`);
  }
  if (field.options) {
    for (const opt of field.options) {
      if (!opt.value || !opt.label) {
        errors.push(`field "${field.key}": option {value, label} both required`);
        break;
      }
    }
  }
  if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
    errors.push(`field "${field.key}": minLength > maxLength`);
  }
  if (field.validation?.pattern) {
    try {
      new RegExp(field.validation.pattern);
    } catch {
      errors.push(`field "${field.key}": validation.pattern is not a valid regex`);
    }
  }
  return errors;
}

/**
 * Validate a submitted payload against the form's fields. Runs per-field
 * type coercion + required check + min/max + regex validation.
 *
 * Returns:
 *   - ok:         true when no errors
 *   - errors:     map of field key → error message (only failed fields)
 *   - normalized: coerced payload with typed values (numbers as numbers, etc.)
 */
export function validateSubmission(
  fields: FormField[],
  payload: Record<string, unknown>,
): {
  ok: boolean;
  errors: Record<string, string>;
  normalized: Record<string, unknown>;
} {
  const errors: Record<string, string> = {};
  const normalized: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = payload[field.key];
    const hasValue = raw !== undefined && raw !== null && raw !== '';

    if (!hasValue) {
      if (field.required) {
        errors[field.key] = `${field.label} is required`;
      } else if (field.defaultValue !== undefined) {
        normalized[field.key] = field.defaultValue;
      }
      continue;
    }

    let value: unknown = raw;

    switch (field.type) {
      case 'text':
      case 'textarea': {
        value = String(raw);
        const s = value as string;
        if (field.minLength !== undefined && s.length < field.minLength) {
          errors[field.key] = `${field.label} must be at least ${field.minLength} characters`;
          continue;
        }
        if (field.maxLength !== undefined && s.length > field.maxLength) {
          errors[field.key] = `${field.label} must be at most ${field.maxLength} characters`;
          continue;
        }
        break;
      }
      case 'email': {
        value = String(raw).trim().toLowerCase();
        if (!EMAIL_RE.test(value as string)) {
          errors[field.key] = `${field.label} must be a valid email`;
          continue;
        }
        break;
      }
      case 'phone': {
        value = String(raw).trim();
        if (!PHONE_RE.test(value as string)) {
          errors[field.key] = `${field.label} must be a valid phone number`;
          continue;
        }
        break;
      }
      case 'url': {
        value = String(raw).trim();
        if (!URL_RE.test(value as string)) {
          errors[field.key] = `${field.label} must be an http(s) URL`;
          continue;
        }
        break;
      }
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          errors[field.key] = `${field.label} must be a number`;
          continue;
        }
        if (typeof field.min === 'number' && n < field.min) {
          errors[field.key] = `${field.label} must be at least ${field.min}`;
          continue;
        }
        if (typeof field.max === 'number' && n > field.max) {
          errors[field.key] = `${field.label} must be at most ${field.max}`;
          continue;
        }
        value = n;
        break;
      }
      case 'date': {
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) {
          errors[field.key] = `${field.label} must be a valid date`;
          continue;
        }
        value = d.toISOString();
        break;
      }
      case 'checkbox': {
        value = Boolean(raw) && raw !== 'false' && raw !== '0';
        break;
      }
      case 'select':
      case 'radio': {
        const s = String(raw);
        if (!field.options?.some((o) => o.value === s)) {
          errors[field.key] = `${field.label} must be one of: ${field.options?.map((o) => o.value).join(', ') ?? ''}`;
          continue;
        }
        value = s;
        break;
      }
    }

    if (field.validation?.pattern && typeof value === 'string') {
      try {
        const re = new RegExp(field.validation.pattern);
        if (!re.test(value)) {
          errors[field.key] = field.validation.errorMessage ?? `${field.label} is invalid`;
          continue;
        }
      } catch {
        // Pattern was already validated at design time; ignore runtime regex error.
      }
    }

    normalized[field.key] = value;
  }

  return { ok: Object.keys(errors).length === 0, errors, normalized };
}

/**
 * Map a submission payload to Contact fields using name heuristics.
 * Looks for common key patterns so form designers don't have to use
 * exact canonical names.
 */
export function pickContactFromSubmission(
  payload: Record<string, unknown>,
): {
  phoneNumber?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
} {
  const out: ReturnType<typeof pickContactFromSubmission> = {};
  const lower = Object.fromEntries(
    Object.entries(payload).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const pick = (keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = lower[k];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
    return undefined;
  };

  out.phoneNumber = pick(['phone', 'phonenumber', 'phone_number', 'mobile', 'whatsapp', 'contact']);
  out.email = pick(['email', 'emailaddress', 'email_address', 'mail']);
  out.firstName = pick(['firstname', 'first_name', 'fname', 'givenname']);
  out.lastName = pick(['lastname', 'last_name', 'lname', 'surname', 'familyname']);
  out.displayName = pick(['name', 'fullname', 'full_name', 'displayname']);
  if (!out.displayName && (out.firstName || out.lastName)) {
    out.displayName = [out.firstName, out.lastName].filter(Boolean).join(' ');
  }
  return out;
}

/**
 * URL-safe slug generator. Not unique by itself — callers must append a
 * short random suffix or check uniqueness against the DB.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}
