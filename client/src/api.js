const TOKEN_KEY = 'purpose-partner.token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable - session-only login */ }
}

/** The member's local calendar date, so "today" matches their timezone. */
export function localToday(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.status = status;
    this.code = data.code;
    this.data = data;
  }
}

const listeners = new Set();
/** Subscribe to auth failures (expired/revoked session) app-wide. */
export const onUnauthorized = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

async function request(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`/api${path}${sep}today=${localToday()}`, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function api(path, opts = {}) {
  const res = await request(path, opts);
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && getToken() && !path.startsWith('/auth/')) listeners.forEach((fn) => fn());
    throw new ApiError(data.error || 'Something went wrong.', res.status, data);
  }
  return data;
}

export async function apiText(path) {
  const res = await request(path);
  if (!res.ok) throw new ApiError('Could not load.', res.status);
  return res.text();
}

/** Save a JSON response from the API as a file (used for data export). */
export async function downloadJson(path, filename) {
  const data = await api(path);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const money = (minor, currency) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
};

export const fmtDate = (iso, opts = { day: 'numeric', month: 'short' }) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, opts);
export const fmtDateTime = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const timeAgo = (sqlTime) => {
  const t = Date.parse(sqlTime.includes('T') ? sqlTime : `${sqlTime.replace(' ', 'T')}Z`);
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Read an image file, downscale it and return a JPEG data: URL (keeps uploads small). */
export function imageToDataUrl(file, maxSide = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Please choose an image.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
    img.src = url;
  });
}

/** Human labels for profile option values, by field. */
export const LABELS = {
  church_attendance: { several_weekly: 'Several times a week', weekly: 'Weekly', monthly: 'Monthly', occasionally: 'Occasionally' },
  wants_children: { yes: 'Wants children', no: 'Does not want children', open: 'Open to children' },
  marriage_timeline: { within_1_year: 'Within a year', '1_2_years': 'In 1-2 years', '2_plus_years': 'In 2+ years' },
  drinks: { never: 'Does not drink', occasionally: 'Drinks occasionally' },
  relationship_status: { never_married: 'Never married', divorced: 'Divorced', widowed: 'Widowed', annulled: 'Marriage annulled' },
  gender: { man: 'Man', woman: 'Woman' },
  attachment: { secure: 'Secure', anxious: 'Anxious', avoidant: 'Avoidant', fearful: 'Fearful-avoidant' },
};
export const label = (field, value) => LABELS[field]?.[value] ?? value;
