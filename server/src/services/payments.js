// Payments: Paystack (cards and mobile money in Ghana) in production, and a sandbox provider
// for development and pilots. Amounts are always in minor units (pesewas).
import crypto from 'node:crypto';
import { config } from '../config.js';
import { transaction } from '../db.js';
import { HttpError } from '../errors.js';

const PAYSTACK = 'https://api.paystack.co';

export function createPayments(db, { notifier }) {
  const getPayment = db.prepare('SELECT * FROM payments WHERE reference = ?');

  function provider() {
    const cfg = config();
    if (cfg.paystackSecret) return 'paystack';
    return cfg.allowSandboxPayments ? 'sandbox' : null;
  }

  async function createCheckout(user, planId) {
    const cfg = config();
    const plan = cfg.plans[planId];
    if (!plan) throw new HttpError(400, 'Unknown plan.');
    const p = provider();
    if (!p) throw new HttpError(503, 'Payments are not available right now.');
    const reference = `pp_${crypto.randomBytes(10).toString('hex')}`;
    db.prepare('INSERT INTO payments (user_id, plan, amount_minor, currency, provider, reference) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, planId, plan.amountMinor, cfg.currency, p, reference);

    if (p === 'sandbox') return { provider: p, reference, checkoutUrl: `#/billing/sandbox?ref=${reference}` };

    const res = await fetch(`${PAYSTACK}/transaction/initialize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.paystackSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, amount: plan.amountMinor, currency: cfg.currency, reference, callback_url: `${cfg.appUrl}/#/billing/return?ref=${reference}`, metadata: { plan: planId } }),
    }).catch(() => null);
    const data = res && (await res.json().catch(() => null));
    if (!res?.ok || !data?.status) {
      db.prepare("UPDATE payments SET status = 'failed' WHERE reference = ?").run(reference);
      throw new HttpError(502, 'We could not start the payment. Please try again.');
    }
    return { provider: p, reference, checkoutUrl: data.data.authorization_url };
  }

  /** Mark a payment paid and extend Premium. Idempotent. */
  function fulfill(reference, { amountMinor, currency } = {}) {
    const pending = getPayment.get(reference);
    if (!pending) throw new HttpError(404, 'Payment not found.');
    if (pending.status === 'pending'
      && ((amountMinor !== undefined && amountMinor !== pending.amount_minor) || (currency && currency !== pending.currency))) {
      db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(pending.id);
      console.error(`[payments] amount mismatch for ${reference}`);
      throw new HttpError(400, 'Payment amount mismatch.');
    }
    return transaction(db, () => {
      const payment = getPayment.get(reference);
      if (payment.status === 'paid') return payment;
      if (payment.status !== 'pending') throw new HttpError(400, 'This payment can no longer be completed.');
      db.prepare("UPDATE payments SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(payment.id);
      const plan = config().plans[payment.plan];
      if (payment.user_id && plan) {
        const existing = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(payment.user_id);
        const now = new Date();
        const base = existing && existing.current_period_end > now.toISOString() ? new Date(existing.current_period_end) : now;
        base.setUTCDate(base.getUTCDate() + plan.days);
        db.prepare(`INSERT INTO subscriptions (user_id, plan, current_period_end) VALUES (?, ?, ?)
          ON CONFLICT (user_id) DO UPDATE SET plan = excluded.plan, current_period_end = excluded.current_period_end, updated_at = datetime('now')`)
          .run(payment.user_id, payment.plan, base.toISOString());
        notifier.notify(payment.user_id, { type: 'premium', title: 'Welcome to Purpose Partner Premium', body: `Premium is active until ${base.toISOString().slice(0, 10)}.`, link: '#/premium' });
      }
      return { ...payment, status: 'paid' };
    });
  }

  async function verifyPaystack(reference) {
    const payment = getPayment.get(reference);
    if (!payment) throw new HttpError(404, 'Payment not found.');
    if (payment.status === 'paid' || payment.provider !== 'paystack') return payment;
    const res = await fetch(`${PAYSTACK}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { authorization: `Bearer ${config().paystackSecret}` },
    }).catch(() => null);
    const data = res && (await res.json().catch(() => null));
    if (data?.data?.status === 'success') return fulfill(reference, { amountMinor: data.data.amount, currency: data.data.currency });
    return payment;
  }

  /** Verify x-paystack-signature (HMAC-SHA512 of the raw body) and process the event. */
  function handlePaystackWebhook(rawBody, signature) {
    const secret = config().paystackSecret;
    if (!secret || typeof signature !== 'string') return false;
    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const event = JSON.parse(rawBody.toString('utf8'));
    if (event.event === 'charge.success' && event.data?.reference && getPayment.get(event.data.reference)) {
      try {
        fulfill(event.data.reference, { amountMinor: event.data.amount, currency: event.data.currency });
      } catch (err) {
        console.error('[payments] webhook fulfillment failed:', err.message);
      }
    }
    return true;
  }

  return { provider, createCheckout, fulfill, verifyPaystack, handlePaystackWebhook, getPayment: (ref) => getPayment.get(ref) };
}
