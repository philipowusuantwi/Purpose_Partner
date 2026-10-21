import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Schema is managed by numbered migrations tracked in PRAGMA user_version.
// Never edit a released migration - append a new one.
// ---------------------------------------------------------------------------

const V1 = `
-- Accounts ------------------------------------------------------------------
CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'member',   -- member | moderator | trust_analyst | admin
  status         TEXT NOT NULL DEFAULT 'active',   -- active | suspended
  suspended_reason TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  phone_enc      TEXT,                             -- encrypted E.164 number
  phone_index    TEXT UNIQUE,                      -- keyed hash, one account per phone
  phone_verified INTEGER NOT NULL DEFAULT 0,
  token_version  INTEGER NOT NULL DEFAULT 0,       -- bump to revoke all sessions
  last_active_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single-use email tokens (only hashes stored).
CREATE TABLE auth_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('reset', 'verify')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phone one-time codes (hash only).
CREATE TABLE otp_codes (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_enc   TEXT NOT NULL,
  phone_index TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL
);

-- Development capture of emails and SMS (never written in production).
CREATE TABLE outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel    TEXT NOT NULL DEFAULT 'email',
  recipient  TEXT NOT NULL,
  subject    TEXT,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Consent log: every acceptance or withdrawal is recorded.
CREATE TABLE consents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document   TEXT NOT NULL,
  version    TEXT NOT NULL,
  action     TEXT NOT NULL DEFAULT 'accept',      -- accept | withdraw
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_consents_user ON consents(user_id, document);

-- Profile -------------------------------------------------------------------
CREATE TABLE profiles (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name        TEXT NOT NULL,
  gender            TEXT NOT NULL CHECK (gender IN ('man', 'woman')),
  birth_date        TEXT NOT NULL,
  country           TEXT NOT NULL DEFAULT 'Ghana',
  region            TEXT,
  city              TEXT,
  denomination      TEXT NOT NULL,
  church_attendance TEXT NOT NULL,      -- several_weekly | weekly | monthly | occasionally
  faith_statement   TEXT,               -- short "my walk with God"
  about             TEXT,
  occupation        TEXT,
  education         TEXT,
  has_children      INTEGER NOT NULL DEFAULT 0,
  wants_children    TEXT NOT NULL DEFAULT 'open',   -- yes | no | open
  marriage_timeline TEXT NOT NULL DEFAULT '1_2_years', -- within_1_year | 1_2_years | 2_plus_years
  open_to_relocate  INTEGER NOT NULL DEFAULT 0,
  drinks            TEXT NOT NULL DEFAULT 'never',  -- never | occasionally
  seeking_age_min   INTEGER NOT NULL DEFAULT 22,
  seeking_age_max   INTEGER NOT NULL DEFAULT 55,
  same_denomination INTEGER NOT NULL DEFAULT 0,     -- only show my denomination
  visible           INTEGER NOT NULL DEFAULT 1,     -- member can pause their profile
  hidden_reason     TEXT,                           -- set by safety systems
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Photos are only shown to others once a moderator approves them.
CREATE TABLE photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,                 -- data: URL (jpeg/png/webp)
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reason      TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_user ON photos(user_id, status);

-- Trust stack ---------------------------------------------------------------
-- Document checks reviewed by trust analysts. Images are encrypted and erased after review.
CREATE TABLE verifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('ghana_card', 'liveness', 'status_evidence')),
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  payload_enc  TEXT,                            -- encrypted submission, NULL after review
  meta         TEXT NOT NULL DEFAULT '{}',      -- non-sensitive (masked card number, challenge)
  doc_index    TEXT,                            -- keyed hash of the Ghana Card number
  reason       TEXT,
  reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_verifications_user ON verifications(user_id, kind);
CREATE INDEX idx_verifications_queue ON verifications(status, created_at);

CREATE TABLE status_declarations (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('never_married', 'divorced', 'widowed', 'annulled')),
  declared_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE churches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  denomination TEXT NOT NULL,
  region       TEXT,
  city         TEXT NOT NULL,
  address      TEXT,
  phone        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE church_admins (
  church_id INTEGER NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title     TEXT NOT NULL DEFAULT 'Church admin',  -- e.g. Pastor, Church admin
  PRIMARY KEY (church_id, user_id)
);

-- A member's home church claim, confirmed by that church's pastor or admin.
CREATE TABLE church_memberships (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  church_id       INTEGER NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_since    INTEGER,
  ministry        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | declined
  status_attested TEXT,                            -- confirms_single | cannot_confirm
  note            TEXT,
  reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Character references, invited by email with a single-use link.
CREATE TABLE references_ (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  contact_enc  TEXT NOT NULL,
  relationship TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'sent',  -- sent | completed | declined
  answers      TEXT,
  positive     INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);

CREATE TABLE readiness_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers    TEXT NOT NULL,
  scores     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Matching & messaging -------------------------------------------------------
CREATE TABLE interests (
  from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('interest', 'pass')),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX idx_interests_to ON interests(to_id, kind);

CREATE TABLE matches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- lower id
  user_b            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'active',  -- active | closed
  stage             TEXT NOT NULL DEFAULT 'getting_to_know',
  proposed_stage    TEXT,
  proposed_by       INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at         TEXT,
  UNIQUE (user_a, user_b)
);

CREATE TABLE messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id     INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  risk         TEXT NOT NULL DEFAULT 'none',  -- none | caution | high
  risk_reasons TEXT NOT NULL DEFAULT '[]',
  read_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_match ON messages(match_id, id);

-- Safety ---------------------------------------------------------------------
CREATE TABLE blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reported_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  message_id  INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'open',  -- open | upheld | dismissed
  resolution  TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reports_reported ON reports(reported_id, status);

-- Automated risk signals for human review (fraud escalation SOP).
CREATE TABLE risk_flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,   -- message | reference | duplicate_document | reports
  ref         TEXT,
  level       TEXT NOT NULL,   -- caution | high
  detail      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',  -- open | confirmed | dismissed
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_flags_user ON risk_flags(user_id, status);

CREATE TABLE appeals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',  -- open | reinstated | denied
  decision    TEXT,
  decided_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT
);

-- Safe meet-up plans shared with a trusted contact.
CREATE TABLE safety_plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id     INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  place        TEXT NOT NULL,
  starts_at    TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_enc  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'planned',  -- planned | safe | alert
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Keyed hashes of identifiers from removed accounts with upheld safety reports, so banned
-- members cannot simply sign up again. No other personal data is kept.
CREATE TABLE banned_identities (
  kind        TEXT NOT NULL,   -- email | phone | ghana_card
  value_index TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, value_index)
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Community -----------------------------------------------------------------
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  church_id   INTEGER REFERENCES churches(id) ON DELETE CASCADE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  starts_at   TEXT NOT NULL,
  venue       TEXT NOT NULL,
  city        TEXT,
  capacity    INTEGER,
  status      TEXT NOT NULL DEFAULT 'published',  -- published | cancelled
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE event_rsvps (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, id);

-- Billing -------------------------------------------------------------------
CREATE TABLE subscriptions (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan               TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  plan         TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  provider     TEXT NOT NULL,
  reference    TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | failed
  paid_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const MIGRATIONS = [V1];

export function openDatabase(path = process.env.PP_DB || 'purpose-partner.db') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Run fn inside a transaction (nested calls join the outer one). */
export function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const parseJson = (s, fallback) => {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
};
