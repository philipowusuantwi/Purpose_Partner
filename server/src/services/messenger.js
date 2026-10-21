import { config } from '../config.js';

// Transactional email and SMS. Delivery transports:
//  - PP_MAIL_WEBHOOK: POST {to, subject, text} as JSON (connect any provider, e.g. a small
//    function calling Mailgun/SendGrid/Postmark).
//  - PP_SMS_WEBHOOK: POST {to, text} as JSON (e.g. Hubtel, Arkesel or mNotify for Ghana).
//  - development: printed to the console and captured in the `outbox` table.
export function createMessenger(db) {
  const capture = db.prepare('INSERT INTO outbox (channel, recipient, subject, body) VALUES (?, ?, ?, ?)');

  async function deliver(channel, url, payload) {
    const cfg = config();
    if (!cfg.production) {
      capture.run(channel, payload.to, payload.subject ?? null, payload.text);
      if (!process.env.PP_QUIET_MAIL) console.log(`[${channel}] to=${payload.to}${payload.subject ? ` subject="${payload.subject}"` : ''}\n${payload.text}\n`);
    }
    if (url) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) console.error(`[${channel}] webhook responded ${res.status}`);
      } catch (err) {
        console.error(`[${channel}] webhook delivery failed:`, err.message);
      }
    } else if (cfg.production) {
      console.error(`[${channel}] no webhook configured - message not delivered`);
    }
  }

  return {
    email: ({ to, subject, text }) => deliver('email', config().mailWebhook, { to, subject, text }),
    sms: ({ to, text }) => deliver('sms', config().smsWebhook, { to, text }),
  };
}
