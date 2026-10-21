// Demo data for development and pilots: a partner church, an event and six demo members.
// All demo accounts use the password "purposepartner". Safe to run more than once.
import { fileURLToPath } from 'node:url';
import { openDatabase, transaction } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { DOCUMENTS, REQUIRED_DOCUMENTS } from '../src/content/legal.js';
import { scoreReadiness, QUESTIONS } from '../src/engines/readiness.js';

const COLOURS = ['#7a4e9c', '#2f6f8f', '#b5654a', '#3f7d58', '#9c4e6e', '#5a5fa8'];

/** A simple illustrated avatar so demo profiles have an approved photo. */
const avatar = (initial, i) => `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 360"><rect width="300" height="360" fill="${COLOURS[i % COLOURS.length]}"/><circle cx="150" cy="140" r="62" fill="#fff" opacity=".85"/><rect x="60" y="220" width="180" height="140" rx="90" fill="#fff" opacity=".85"/><text x="150" y="160" font-size="60" text-anchor="middle" font-family="Georgia" fill="${COLOURS[i % COLOURS.length]}">${initial}</text></svg>`,
).toString('base64')}`;

const DEMO = [
  { first: 'Kwame', gender: 'man', birth: '1993-04-12', city: 'Accra', region: 'Greater Accra', denom: 'Pentecostal', att: 'weekly', job: 'Civil engineer', kids: 'yes', time: '1_2_years', about: 'I love worship, football and building things that last. Looking for a friend first and a wife in God\'s time.', faith: 'Saved at 19; I serve in the ushering ministry.', a: 4 },
  { first: 'Yaw', gender: 'man', birth: '1989-09-30', city: 'Kumasi', region: 'Ashanti', denom: 'Methodist', att: 'several_weekly', job: 'Teacher', kids: 'yes', time: 'within_1_year', about: 'Choir tenor, lover of jollof debates and long walks. Ready to settle down with a God-fearing woman.', faith: 'Raised in church, walking with Christ personally since university.', a: 5 },
  { first: 'Kofi', gender: 'man', birth: '1996-01-22', city: 'Accra', region: 'Greater Accra', denom: 'Charismatic', att: 'weekly', job: 'Software developer', kids: 'open', time: '2_plus_years', about: 'Tech, gospel music and serving in youth ministry. Intentional and patient.', faith: 'Youth ministry volunteer.', a: 3 },
  { first: 'Ama', gender: 'woman', birth: '1995-06-03', city: 'Accra', region: 'Greater Accra', denom: 'Pentecostal', att: 'weekly', job: 'Nurse', kids: 'yes', time: '1_2_years', about: 'Caring, cheerful and family-oriented. I enjoy cooking, prayer meetings and travel.', faith: 'Prayer warrior; I lead a women\'s Bible study.', a: 4 },
  { first: 'Akosua', gender: 'woman', birth: '1991-11-18', city: 'Kumasi', region: 'Ashanti', denom: 'Methodist', att: 'several_weekly', job: 'Accountant', kids: 'yes', time: 'within_1_year', about: 'Organised, warm and honest. My family and faith mean everything to me.', faith: 'Sunday school teacher for 6 years.', a: 5 },
  { first: 'Efua', gender: 'woman', birth: '1998-02-27', city: 'Cape Coast', region: 'Central', denom: 'Catholic', att: 'weekly', job: 'Graphic designer', kids: 'open', time: '2_plus_years', about: 'Creative, curious and joyful. I love the beach and choir music.', faith: 'Member of the parish youth choir.', a: 3 },
];

export function seedDemo(db) {
  transaction(db, () => {
    let church = db.prepare("SELECT id FROM churches WHERE name = 'Grace Chapel International'").get();
    if (!church) {
      const { lastInsertRowid } = db.prepare("INSERT INTO churches (name, denomination, region, city, address, status) VALUES ('Grace Chapel International', 'Pentecostal', 'Greater Accra', 'Accra', 'East Legon', 'approved')").run();
      church = { id: Number(lastInsertRowid) };
      const start = new Date(Date.now() + 14 * 86_400_000);
      start.setUTCHours(14, 0, 0, 0);
      db.prepare('INSERT INTO events (church_id, title, description, starts_at, venue, city, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(church.id, 'Singles Fellowship & Purpose Talk', 'An afternoon of worship, teaching on godly courtship and refreshments. Open to all Purpose Partner members.', start.toISOString(), 'Grace Chapel main auditorium', 'Accra', 150);
    }
    const hash = hashPassword('purposepartner');
    DEMO.forEach((d, i) => {
      const email = `demo.${d.first.toLowerCase()}@purposepartner.test`;
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return;
      const { lastInsertRowid } = db.prepare("INSERT INTO users (email, password_hash, email_verified, phone_verified, created_at) VALUES (?, ?, 1, 1, datetime('now', '-60 days'))").run(email, hash);
      const id = Number(lastInsertRowid);
      for (const doc of REQUIRED_DOCUMENTS) db.prepare('INSERT INTO consents (user_id, document, version) VALUES (?, ?, ?)').run(id, doc, DOCUMENTS[doc].version);
      db.prepare(`INSERT INTO profiles (user_id, first_name, gender, birth_date, region, city, denomination, church_attendance, faith_statement, about, occupation, wants_children, marriage_timeline)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, d.first, d.gender, d.birth, d.region, d.city, d.denom, d.att, d.faith, d.about, d.job, d.kids, d.time);
      db.prepare("INSERT INTO photos (user_id, data, status) VALUES (?, ?, 'approved')").run(id, avatar(d.first[0], i));
      db.prepare("INSERT INTO status_declarations (user_id, status) VALUES (?, 'never_married')").run(id);
      const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.r ? 6 - d.a : d.a]));
      db.prepare('INSERT INTO readiness_results (user_id, answers, scores) VALUES (?, ?, ?)').run(id, JSON.stringify(answers), JSON.stringify(scoreReadiness(answers).scores));
      if (i % 3 !== 2) {
        for (const kind of ['ghana_card', 'liveness']) {
          db.prepare("INSERT INTO verifications (user_id, kind, status, meta, reviewed_at) VALUES (?, ?, 'approved', '{\"masked\":\"GHA-*****0000-0\",\"demo\":true}', datetime('now'))").run(id, kind);
        }
      }
      if (i % 3 === 0) {
        db.prepare("INSERT INTO church_memberships (user_id, church_id, status, status_attested, reviewed_at) VALUES (?, ?, 'confirmed', 'confirms_single', datetime('now'))").run(id, church.id);
        db.prepare("INSERT INTO references_ (user_id, name, contact_enc, relationship, token_hash, status, positive, responded_at) VALUES (?, 'Demo reference', 'demo', 'Friend', ?, 'completed', 1, datetime('now'))").run(id, `demo-${id}`);
      }
    });
  });
  console.log('Demo data ready: Grace Chapel International, one event and six members (password "purposepartner").');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) seedDemo(openDatabase());
