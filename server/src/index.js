import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Settings can live in a .env file next to package.json (works the same on Windows, macOS and Linux).
for (const file of [path.resolve(here, '../../.env'), path.resolve(here, '../.env')]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
// `npm run demo`: pilot mode with demo data and a demo admin account, no setup needed.
if (process.argv.includes('--demo')) {
  process.env.PP_PILOT ??= '1';
  process.env.PP_SEED_DEMO ??= '1';
}
const db = openDatabase();
if (process.env.PP_SEED_DEMO === '1') {
  const { seedDemo } = await import('../scripts/seed.js');
  seedDemo(db);
}
const app = createApp(db);

// Serve the built client (npm run build) from the same origin in production.
const clientDist = path.resolve(here, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Purpose Partner API listening on http://localhost:${port}`);
  if (config().pilot) console.log('Pilot mode: accounts are auto-verified, OTP codes are shown in the app and test payments are enabled.');
});
