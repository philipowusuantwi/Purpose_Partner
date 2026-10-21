import { transaction } from '../db.js';
import { devotionalFor } from '../content/devotionals.js';
import { badRequest, notFound } from '../errors.js';

export default function communityRoutes(app, ctx) {
  const { db, auth, today } = ctx;

  app.get('/api/devotional', auth, (req, res) => res.json({ devotional: devotionalFor(today(req)) }));

  app.get('/api/events', auth, (req, res) => {
    const rows = db.prepare(`SELECT e.*, c.name AS church_name,
        (SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id) AS rsvps,
        EXISTS (SELECT 1 FROM event_rsvps WHERE event_id = e.id AND user_id = ?) AS going
      FROM events e LEFT JOIN churches c ON c.id = e.church_id
      WHERE e.status = 'published' AND e.starts_at > ? ORDER BY e.starts_at LIMIT 50`).all(req.user.id, new Date().toISOString());
    res.json({ events: rows.map((e) => ({ ...e, going: Boolean(e.going), full: e.capacity !== null && e.rsvps >= e.capacity })) });
  });

  app.post('/api/events/:id/rsvp', auth, (req, res) => {
    const id = Number(req.params.id);
    transaction(db, () => {
      const e = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published' AND starts_at > ?").get(id, new Date().toISOString());
      if (!e) throw notFound('This event is not available.');
      if (db.prepare('SELECT 1 FROM event_rsvps WHERE event_id = ? AND user_id = ?').get(id, req.user.id)) return;
      const n = db.prepare('SELECT COUNT(*) AS n FROM event_rsvps WHERE event_id = ?').get(id).n;
      if (e.capacity !== null && n >= e.capacity) throw badRequest('Sorry, this event is full.');
      db.prepare('INSERT INTO event_rsvps (event_id, user_id) VALUES (?, ?)').run(id, req.user.id);
    });
    res.status(201).json({ going: true });
  });

  app.delete('/api/events/:id/rsvp', auth, (req, res) => {
    db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    res.status(204).end();
  });
}
