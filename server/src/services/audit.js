// Append-only record of staff and church-admin decisions.
export function createAudit(db) {
  const insert = db.prepare('INSERT INTO audit_log (actor_id, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)');
  return (actorId, action, targetType, targetId, detail = null) => {
    insert.run(actorId ?? null, action, targetType ?? null, targetId ?? null, detail === null ? null : JSON.stringify(detail));
  };
}
