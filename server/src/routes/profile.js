import { REGIONS, DENOMINATIONS, OPTIONS, REPORT_REASONS, STAGES } from '../content/lists.js';
import { TIERS } from '../engines/integrity.js';
import { badRequest, notFound } from '../errors.js';
import { validateProfile, imageProblem } from '../validation.js';

const MAX_PHOTOS = 6;

export default function profileRoutes(app, ctx) {
  const { db, config, auth, member, members, uploads } = ctx;

  app.get('/api/meta', (_req, res) => {
    res.json({
      regions: REGIONS, denominations: DENOMINATIONS, options: OPTIONS, reportReasons: REPORT_REASONS,
      stages: STAGES, tiers: TIERS, minAge: config().minAge, pilot: config().pilot,
    });
  });

  /** Create (onboarding) or replace the member's profile. */
  app.put('/api/profile', auth, (req, res) => {
    const existing = members.profile(req.user.id);
    const { values, errors } = validateProfile(req.body, { minAge: config().minAge, partial: Boolean(existing) });
    if (errors.length) throw badRequest(errors[0]);
    if (existing) {
      const cols = Object.keys(values);
      if (cols.length) {
        db.prepare(`UPDATE profiles SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE user_id = ?`)
          .run(...cols.map((c) => values[c]), req.user.id);
      }
    } else {
      const cols = Object.keys(values);
      db.prepare(`INSERT INTO profiles (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`)
        .run(req.user.id, ...cols.map((c) => values[c]));
    }
    res.json(members.me(req.user));
  });

  app.get('/api/profile/photos', auth, (req, res) => {
    res.json({ photos: db.prepare('SELECT id, data, status, reason, created_at FROM photos WHERE user_id = ? ORDER BY id').all(req.user.id) });
  });

  app.post('/api/uploads/photo', uploads, ...member, (req, res) => {
    const problem = imageProblem(req.body?.data);
    if (problem) throw badRequest(problem);
    const count = db.prepare("SELECT COUNT(*) AS n FROM photos WHERE user_id = ? AND status != 'rejected'").get(req.user.id).n;
    if (count >= MAX_PHOTOS) throw badRequest(`You can have up to ${MAX_PHOTOS} photos.`);
    const { lastInsertRowid } = db.prepare('INSERT INTO photos (user_id, data) VALUES (?, ?)').run(req.user.id, req.body.data);
    res.status(201).json({ id: Number(lastInsertRowid), status: 'pending' });
  });

  app.delete('/api/profile/photos/:id', auth, (req, res) => {
    const r = db.prepare('DELETE FROM photos WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    if (!r.changes) throw notFound();
    res.status(204).end();
  });

  /** Another member's profile card (not available across a block). */
  app.get('/api/members/:id', ...member, (req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare('SELECT status FROM users WHERE id = ?').get(id);
    if (!target || target.status !== 'active' || (id !== req.user.id && members.blocked(req.user.id, id))) throw notFound('This profile is not available.');
    const card = members.card(id);
    if (!card) throw notFound('This profile is not available.');
    res.json({ member: card });
  });
}
