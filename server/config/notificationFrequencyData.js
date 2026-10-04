// ---------------------------------------------------------------------------
// Notification email frequency vocabulary (W6-07 / BRD NTF-01).
//
// Source of truth: the Phase-1 BRD, Notifications - "Notification email
// frequency (immediate / daily digest)" with accept criteria "User-selectable
// frequency; entity isolation respected".
//
// A user chooses whether event email is delivered as it happens or batched into
// a single daily digest. The choice is per user; the digest only ever contains
// the rows addressed to that user, so the entity isolation that governs the
// notification itself is preserved.
//
// This module is vocabulary only; the pure resolution and validation functions
// live in config/notificationFrequency.js and the HTTP route in
// server/notificationFrequency.js.
// ---------------------------------------------------------------------------

export const NOTIFICATION_FREQUENCY_KEY = 'notification_frequency_config';
export const NOTIFICATION_FREQUENCY_VERSION = 'NTF-01.1';
export const NOTIFICATION_FREQUENCY_VERSION_PREFIX = 'NTF-01.';
export const NOTIFICATION_FREQUENCY_DEFAULT_REVISION = 1;
export const NOTIFICATION_FREQUENCY_OWNER = 'Platform / Group IT';

// How a user receives event email.
export const NOTIFICATION_FREQUENCIES = [
  { key: 'immediate', label: 'Immediate', description: 'Send each event email as it happens.' },
  { key: 'daily_digest', label: 'Daily digest', description: 'Batch the day\u2019s event email into one digest.' },
];
export const NOTIFICATION_FREQUENCY_KEYS = NOTIFICATION_FREQUENCIES.map((f) => f.key);

export const DEFAULT_NOTIFICATION_FREQUENCY = 'immediate';

// The hour (local, 0-23) at which the daily digest is composed. The digest is
// on demand, so this is the advertised send window rather than a scheduler.
export const DEFAULT_DIGEST_HOUR = 7;

export const NOTIFICATION_FREQUENCY_MESSAGES = {
  config_invalid: 'The notification frequency configuration is invalid.',
  invalid_frequency: 'A notification frequency must be immediate or daily digest.',
  disclaimer:
    'Each user chooses whether event email is delivered immediately or batched into a daily digest. The digest ' +
    'contains only the notifications addressed to that user, so entity isolation is preserved.',
};

export default {
  NOTIFICATION_FREQUENCY_KEY,
  NOTIFICATION_FREQUENCY_VERSION,
  NOTIFICATION_FREQUENCY_VERSION_PREFIX,
  NOTIFICATION_FREQUENCY_DEFAULT_REVISION,
  NOTIFICATION_FREQUENCY_OWNER,
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_FREQUENCY_KEYS,
  DEFAULT_NOTIFICATION_FREQUENCY,
  DEFAULT_DIGEST_HOUR,
  NOTIFICATION_FREQUENCY_MESSAGES,
};
