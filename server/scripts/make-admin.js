// Usage: npm run make-admin --workspace server -- email@example.com [admin|moderator|trust_analyst]
import { openDatabase } from '../src/db.js';

const [email, role = 'admin'] = process.argv.slice(2);
if (!email || !['admin', 'moderator', 'trust_analyst', 'member'].includes(role)) {
  console.error('Usage: make-admin <email> [admin|moderator|trust_analyst|member]');
  process.exit(1);
}
const db = openDatabase();
const r = db.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, email.trim().toLowerCase());
console.log(r.changes ? `${email} is now ${role}.` : `No account found for ${email}. Sign up first.`);
