import { OPTIONS, DENOMINATIONS, REGIONS } from './content/lists.js';
import { ageOn } from './engines/matching.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
    && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
}

export const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);

/** Normalise a Ghanaian or international phone number to E.164, or null. */
export function normalisePhone(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[\s()-]/g, '');
  if (/^0\d{9}$/.test(s)) s = `+233${s.slice(1)}`;
  if (/^233\d{9}$/.test(s)) s = `+${s}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** Ghana Card PIN: GHA-123456789-0 */
export const GHANA_CARD_RE = /^GHA-\d{9}-\d$/;

/**
 * Validates a full profile (onboarding) or a partial update.
 * @returns {{values: object, errors: string[]}}
 */
export function validateProfile(b = {}, { minAge = 18, partial = false } = {}) {
  const values = {};
  const errors = [];
  const has = (k) => b[k] !== undefined;
  const need = (k) => !partial || has(k);

  if (need('first_name')) {
    const v = text(b.first_name, 40);
    if (!v || !/^[\p{L}][\p{L}'\- ]*$/u.test(v)) errors.push('Please enter your first name (letters only).');
    else values.first_name = v;
  }
  if (!partial) {
    if (!OPTIONS.gender.includes(b.gender)) errors.push('Please choose man or woman.');
    else values.gender = b.gender;
    if (!isValidDate(b.birth_date)) errors.push('Please enter your date of birth.');
    else if (ageOn(b.birth_date) < minAge) errors.push(`You must be at least ${minAge} to join.`);
    else if (ageOn(b.birth_date) > 100) errors.push('Please check your date of birth.');
    else values.birth_date = b.birth_date;
  }
  if (need('denomination')) {
    if (!DENOMINATIONS.includes(b.denomination)) errors.push('Please choose your denomination.');
    else values.denomination = b.denomination;
  }
  for (const k of ['church_attendance', 'wants_children', 'marriage_timeline', 'drinks']) {
    if (!need(k)) continue;
    if (!OPTIONS[k].includes(b[k])) errors.push(`Please choose an option for ${k.replace(/_/g, ' ')}.`);
    else values[k] = b[k];
  }
  if (need('country')) values.country = text(b.country, 60) || 'Ghana';
  if (has('region') || !partial) {
    if (b.region && !REGIONS.includes(b.region) && (values.country ?? 'Ghana') === 'Ghana') errors.push('Please choose a valid region.');
    else values.region = text(b.region, 40);
  }
  if (need('city')) {
    const v = text(b.city, 60);
    if (!v) errors.push('Please enter your city or town.');
    else values.city = v;
  }
  for (const [k, max] of [['faith_statement', 400], ['about', 1000], ['occupation', 80], ['education', 80]]) {
    if (has(k) || !partial) values[k] = text(b[k], max);
  }
  for (const k of ['has_children', 'open_to_relocate', 'same_denomination']) {
    if (has(k) || !partial) values[k] = b[k] ? 1 : 0;
  }
  if (has('seeking_age_min') || has('seeking_age_max') || !partial) {
    const min = Number(b.seeking_age_min ?? 22);
    const max = Number(b.seeking_age_max ?? 55);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 18 || max > 99 || min > max) errors.push('Please choose a valid age range (18 or over).');
    else Object.assign(values, { seeking_age_min: min, seeking_age_max: max });
  }
  return { values, errors };
}

const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAGIC = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] };

/** Validates a data: URL image up to maxBytes; returns an error message or null. */
export function imageProblem(dataUrl, maxBytes = 1_500_000) {
  const m = typeof dataUrl === 'string' && dataUrl.match(IMAGE_RE);
  if (!m) return 'Please upload a JPEG, PNG or WebP image.';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) return `Images must be under ${Math.round(maxBytes / 1_000_000 * 10) / 10} MB.`;
  if (!MAGIC[m[1]].every((byte, i) => buf[i] === byte)) return 'That file does not look like a valid image.';
  return null;
}
