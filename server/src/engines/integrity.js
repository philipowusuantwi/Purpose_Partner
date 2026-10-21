// Covenant Integrity Score and Trust Stack.
//
// Weights follow the concept note's risk-scoring framework:
//   Identity 30 · Relationship integrity 20 · Behaviour 25 · Community trust 15 · Stability 10
// Public tiers: Platinum 90-100, Gold 75-89, Silver 60-74, Bronze 40-59, Limited < 40.

export const TIERS = [
  { id: 'platinum', label: 'Platinum', min: 90 },
  { id: 'gold', label: 'Gold', min: 75 },
  { id: 'silver', label: 'Silver', min: 60 },
  { id: 'bronze', label: 'Bronze', min: 40 },
  { id: 'limited', label: 'Limited verification', min: 0 },
];
export const TIER_RANK = Object.fromEntries(TIERS.map((t, i) => [t.id, TIERS.length - 1 - i]));

export const tierFor = (score) => TIERS.find((t) => score >= t.min);

const daysSince = (sqlTime) => (Date.now() - Date.parse(`${sqlTime.replace(' ', 'T')}Z`)) / 86_400_000;

export function createTrust(db) {
  const q = {
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    verification: db.prepare("SELECT status FROM verifications WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT 1"),
    declaration: db.prepare('SELECT * FROM status_declarations WHERE user_id = ?'),
    church: db.prepare('SELECT status, status_attested FROM church_memberships WHERE user_id = ?'),
    refs: db.prepare("SELECT COUNT(*) AS n FROM references_ WHERE user_id = ? AND status = 'completed' AND positive = 1"),
    upheld: db.prepare("SELECT COUNT(*) AS n FROM reports WHERE reported_id = ? AND status = 'upheld' AND resolved_at > datetime('now', ?)"),
    flags: db.prepare("SELECT COUNT(*) AS n FROM risk_flags WHERE user_id = ? AND status = 'confirmed' AND created_at > datetime('now', '-365 days')"),
    photo: db.prepare("SELECT 1 FROM photos WHERE user_id = ? AND status = 'approved' LIMIT 1"),
    profile: db.prepare('SELECT about, faith_statement FROM profiles WHERE user_id = ?'),
    readiness: db.prepare('SELECT 1 FROM readiness_results WHERE user_id = ? LIMIT 1'),
  };

  function checks(userId) {
    const user = q.user.get(userId);
    if (!user) return null;
    const v = (kind) => q.verification.get(userId, kind)?.status ?? 'none';
    const church = q.church.get(userId);
    const evidence = v('status_evidence');
    return {
      user,
      email: Boolean(user.email_verified),
      phone: Boolean(user.phone_verified),
      ghanaCard: v('ghana_card'),
      liveness: v('liveness'),
      statusDeclared: q.declaration.get(userId)?.status ?? null,
      statusEvidence: evidence,
      church: church?.status ?? 'none',
      statusConfirmed: (church?.status === 'confirmed' && church.status_attested === 'confirms_single') || evidence === 'approved',
      positiveReferences: q.refs.get(userId).n,
      upheldReports: q.upheld.get(userId, '-365 days').n,
      recentUpheld: q.upheld.get(userId, '-180 days').n,
      confirmedFlags: q.flags.get(userId).n,
      approvedPhoto: Boolean(q.photo.get(userId)),
      profile: q.profile.get(userId),
      readiness: Boolean(q.readiness.get(userId)),
    };
  }

  /** Full trust report for a member (score, tier, shield, components). */
  function report(userId) {
    const c = checks(userId);
    if (!c) return null;
    const identity = (c.email ? 5 : 0) + (c.phone ? 5 : 0) + (c.ghanaCard === 'approved' ? 12 : 0) + (c.liveness === 'approved' ? 8 : 0);
    const relationship = (c.statusDeclared ? 8 : 0) + (c.statusConfirmed ? 12 : 0);
    const behaviour = Math.max(0, 25 - 10 * c.upheldReports - 5 * c.confirmedFlags);
    const community = (c.church === 'confirmed' ? 7 : 0) + Math.min(2, c.positiveReferences) * 4;
    const stability = Math.min(6, Math.floor(daysSince(c.user.created_at) / 15))
      + (c.approvedPhoto && c.profile?.about ? 2 : 0) + (c.readiness ? 2 : 0);

    const score = identity + relationship + behaviour + community + stability;
    const tier = tierFor(score);
    const identityVerified = c.ghanaCard === 'approved' && c.liveness === 'approved';
    const shield = identityVerified && Boolean(c.statusDeclared) && c.church === 'confirmed'
      && c.positiveReferences >= 1 && c.recentUpheld === 0 && c.user.status === 'active';

    return {
      score,
      tier: tier.id,
      tierLabel: tier.label,
      shield,
      identityVerified,
      components: [
        { id: 'identity', label: 'Identity', score: identity, max: 30 },
        { id: 'relationship', label: 'Relationship integrity', score: relationship, max: 20 },
        { id: 'behaviour', label: 'Behaviour', score: behaviour, max: 25 },
        { id: 'community', label: 'Community trust', score: community, max: 15 },
        { id: 'stability', label: 'Stability', score: stability, max: 10 },
      ],
      steps: [
        { id: 'email', label: 'Email verified', status: c.email ? 'done' : 'todo' },
        { id: 'phone', label: 'Phone verified', status: c.phone ? 'done' : 'todo' },
        { id: 'ghana_card', label: 'Ghana Card', status: stepStatus(c.ghanaCard) },
        { id: 'liveness', label: 'Liveness selfie', status: stepStatus(c.liveness) },
        { id: 'status', label: 'Relationship status declared', status: c.statusDeclared ? 'done' : 'todo' },
        { id: 'church', label: 'Church confirmation', status: c.church === 'confirmed' ? 'done' : c.church === 'pending' ? 'pending' : c.church === 'declined' ? 'rejected' : 'todo' },
        { id: 'references', label: 'Character references', status: c.positiveReferences >= 2 ? 'done' : c.positiveReferences === 1 ? 'partial' : 'todo', count: c.positiveReferences },
        { id: 'readiness', label: 'Readiness assessment', status: c.readiness ? 'done' : 'todo' },
      ],
      statusConfirmed: c.statusConfirmed,
    };
  }

  /** What other members may see. */
  function badge(userId) {
    const r = report(userId);
    return r && { score: r.score, tier: r.tier, tierLabel: r.tierLabel, shield: r.shield, identityVerified: r.identityVerified, churchVerified: r.steps.find((s) => s.id === 'church').status === 'done' };
  }

  return { report, badge };
}

const stepStatus = (s) => ({ approved: 'done', pending: 'pending', rejected: 'rejected' })[s] ?? 'todo';
