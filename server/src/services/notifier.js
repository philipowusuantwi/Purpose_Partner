// In-app notifications.
export function createNotifier(db) {
  const insert = db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)');
  return {
    notify(userId, { type, title, body = null, link = null }) {
      if (userId) insert.run(userId, type, title, body, link);
    },
  };
}
