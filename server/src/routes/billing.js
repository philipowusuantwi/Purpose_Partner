import express from 'express';
import { badRequest, notFound } from '../errors.js';

const PERKS = [
  'Unlimited interests every day',
  'See who is interested in you',
  'Support a safer Christian community: Premium funds verification and moderation',
];

export default function billingRoutes(app, ctx) {
  const { config, auth, members, payments } = ctx;

  app.get('/api/billing/plans', auth, (req, res) => {
    const cfg = config();
    res.json({
      currency: cfg.currency,
      plans: Object.entries(cfg.plans).map(([id, p]) => ({ id, label: p.label, amountMinor: p.amountMinor, days: p.days })),
      perks: PERKS,
      premiumUntil: members.premiumUntil(req.user.id),
      provider: payments.provider(),
    });
  });

  app.post('/api/billing/checkout', auth, async (req, res) => {
    res.status(201).json(await payments.createCheckout(req.user, req.body?.plan));
  });

  /** Development and pilot checkout: completes a sandbox payment the member owns. */
  app.post('/api/billing/sandbox/complete', auth, (req, res) => {
    const p = payments.getPayment(String(req.body?.reference ?? ''));
    if (!p || p.user_id !== req.user.id) throw notFound('Payment not found.');
    if (p.provider !== 'sandbox' || !config().allowSandboxPayments) throw badRequest('This is not a test payment.');
    payments.fulfill(p.reference);
    res.json({ status: 'paid', premiumUntil: members.premiumUntil(req.user.id) });
  });

  app.get('/api/billing/payments/:reference', auth, async (req, res) => {
    const p = payments.getPayment(req.params.reference);
    if (!p || p.user_id !== req.user.id) throw notFound('Payment not found.');
    const result = p.provider === 'paystack' ? await payments.verifyPaystack(p.reference) : p;
    res.json({ status: result.status, premiumUntil: members.premiumUntil(req.user.id) });
  });
}

billingRoutes.webhooks = (app, ctx) => {
  app.post('/api/billing/webhook/paystack', express.raw({ type: '*/*', limit: '200kb' }), (req, res) => {
    const ok = ctx.payments.handlePaystackWebhook(req.body, req.get('x-paystack-signature'));
    res.status(ok ? 200 : 401).end();
  });
};
