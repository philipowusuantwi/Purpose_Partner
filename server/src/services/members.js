import { DOCUMENTS, REQUIRED_DOCUMENTS } from '../content/legal.js';
import { ageOn } from '../engines/matching.js';
import { parseJson } from '../db.js';
import { decrypt } from './secure.js';

// Shared reads about members: the signed-in user's own view, consent state, premium status and
// the public profile card other members see.
export function createMembers(db, trust) {
  const q = {
    profile: db.prepare('SELECT * FROM profiles WHERE user_id = ?'),
    photos: db.prepare("SELECT id, data FROM photos WHERE user_id = ? AND status = 'approved' ORDER BY id"),
    latestConsents: db.prepare(`SELECT document, version, action FROM consents c WHERE user_id = ?
      AND id = (SELECT MAX(id) FROM consents WHERE user_id = c.user_id AND document = c.document)`),
    sub: db.prepare('SELECT * FROM subscriptions WHERE user_id = ?'),
    readiness: db.prepare('SELECT scores FROM readiness_results WHERE user_id = ? ORDER BY id DESC LIMIT 1'),
    church: db.prepare(`SELECT c.name, c.city, m.status FROM church_memberships m JOIN churches c ON c.id = m.church_id WHERE m.user_id = ?`),
    churchAdmin: db.prepare('SELECT church_id FROM church_admins WHERE user_id = ?'),
    declaration: db.prepare('SELECT status FROM status_declarations WHERE user_id = ?'),
    block: db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'),
  };

  function missingConsents(userId) {
    const latest = Object.fromEntries(q.latestConsents.all(userId).map((r) => [r.document, r]));
    return REQUIRED_DOCUMENTS.filter((d) => latest[d]?.action !== 'accept' || latest[d].version !== DOCUMENTS[d].version)
      .map((d) => ({ id: d, title: DOCUMENTS[d].title, version: DOCUMENTS[d].version }));
  }

  function premiumUntil(userId) {
    const s = q.sub.get(userId);
    return s && s.current_period_end > new Date().toISOString() ? s.current_period_end : null;
  }

  const readiness = (userId) => parseJson(q.readiness.get(userId)?.scores, null);

  /** Profile row with derived age and readiness scores, as used by the matching engine. */
  function matchProfile(userId) {
    const p = q.profile.get(userId);
    return p && { ...p, age: ageOn(p.birth_date), readiness: readiness(userId) };
  }

  /** The signed-in member's own account view. */
  function me(user) {
    const profile = q.profile.get(user.id) ?? null;
    let phone = null;
    if (user.phone_enc) { try { phone = decrypt(user.phone_enc); } catch { phone = null; } }
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        suspendedReason: user.suspended_reason,
        emailVerified: Boolean(user.email_verified),
        phone,
        phoneVerified: Boolean(user.phone_verified),
        onboarded: Boolean(profile),
        premiumUntil: premiumUntil(user.id),
        churchAdmin: q.churchAdmin.all(user.id).map((r) => r.church_id),
        createdAt: user.created_at,
      },
      profile,
      trust: profile ? trust.report(user.id) : null,
      consentRequired: missingConsents(user.id),
    };
  }

  /** What another member sees. Never includes surname, contact details or exact birth date. */
  function card(userId) {
    const p = q.profile.get(userId);
    if (!p) return null;
    const church = q.church.get(userId);
    return {
      id: userId,
      firstName: p.first_name,
      age: ageOn(p.birth_date),
      gender: p.gender,
      city: p.city,
      region: p.region,
      country: p.country,
      denomination: p.denomination,
      churchAttendance: p.church_attendance,
      church: church?.status === 'confirmed' ? { name: church.name, city: church.city } : null,
      faithStatement: p.faith_statement,
      about: p.about,
      occupation: p.occupation,
      education: p.education,
      hasChildren: Boolean(p.has_children),
      wantsChildren: p.wants_children,
      marriageTimeline: p.marriage_timeline,
      openToRelocate: Boolean(p.open_to_relocate),
      drinks: p.drinks,
      relationshipStatus: q.declaration.get(userId)?.status ?? null,
      attachment: readiness(userId)?.attachment ?? null,
      photos: q.photos.all(userId),
      trust: trust.badge(userId),
    };
  }

  const blocked = (a, b) => Boolean(q.block.get(a, b, b, a));

  return { me, card, missingConsents, premiumUntil, matchProfile, readiness, blocked, profile: (id) => q.profile.get(id) };
}
