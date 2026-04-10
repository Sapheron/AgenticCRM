/**
 * Pure template renderer for broadcast messages.
 *
 * Supports `{{firstName}}`, `{{lastName}}`, `{{name}}`, `{{phoneNumber}}`,
 * `{{email}}`, `{{company}}`, plus arbitrary fallback values from a
 * `defaults` map (used for variables defined on the broadcast itself).
 *
 * If a token has no value anywhere, it's replaced with an empty string.
 * Tokens are matched case-sensitively and must be wrapped in double braces.
 */

export interface TemplateContact {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  companyName?: string | null;
  customFields?: unknown;
}

export function renderTemplate(
  template: string,
  contact: TemplateContact,
  defaults: Record<string, string> = {},
): string {
  if (!template) return '';

  // Build a single lookup map.
  const map: Record<string, string> = {
    firstName: contact.firstName ?? splitName(contact.displayName).firstName ?? '',
    lastName: contact.lastName ?? splitName(contact.displayName).lastName ?? '',
    name: contact.displayName ?? [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim(),
    phoneNumber: contact.phoneNumber ?? '',
    email: contact.email ?? '',
    company: contact.companyName ?? '',
  };

  // Custom fields layer in below the built-ins so {{firstName}} always means the contact's name
  if (contact.customFields && typeof contact.customFields === 'object') {
    for (const [k, v] of Object.entries(contact.customFields as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v;
      else if (typeof v === 'number') map[k] = String(v);
    }
  }

  // Defaults from the broadcast.variables column win over custom fields when
  // the user explicitly set them.
  for (const [k, v] of Object.entries(defaults)) {
    if (v !== undefined && v !== null) map[k] = v;
  }

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_full, token: string) => {
    return map[token] ?? '';
  });
}

function splitName(displayName?: string | null): { firstName?: string; lastName?: string } {
  if (!displayName) return {};
  const parts = displayName.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || undefined };
}

/**
 * Quick test for whether a template has any placeholders. Used by the
 * service to short-circuit personalization when the message is just plain
 * text — no need to render per-recipient.
 */
export function hasPlaceholders(template: string): boolean {
  return /\{\{\s*[\w.]+\s*\}\}/.test(template);
}
