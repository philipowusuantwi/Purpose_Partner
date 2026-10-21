# Purpose Partner

> Trust-first Christian relationships, courtship and marriage, for Ghana and Africa.

Purpose Partner helps Christian singles build faith-based relationships that lead to marriage. It combines
identity verification, church confirmation, character references, a relationship-readiness assessment, a
Covenant Integrity Score and safety systems, as described in the Purpose Partner concept note, PRD and venture
dossier.

This folder is a working **MVP** (web app plus API). It runs on its own and does not depend on MenoTribe, the
other app in this repository.

> **Before public launch:** the legal texts need review by Ghanaian lawyers, devotional content by your pastoral
> team, and the manual verification steps need trained trust analysts or a verification provider. See
> [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md).

## What's included

| Area | Features |
| --- | --- |
| **Accounts & consent** | Sign-up with explicit statements (18+, single) and consent to Terms, Privacy, Community Guidelines and processing of sensitive data (faith, relationship history); email verification; password reset; login lockout and rate limits; sign out everywhere; versioned legal documents with re-acceptance; full consent log |
| **Profiles** | Faith (denomination, attendance, "my walk with God"), values (children, marriage timeline, alcohol, relocation), preferences (age range, same denomination); up to 6 photos, **each approved by a moderator** before others see it; pause profile |
| **Trust Stack** | Email, **phone OTP** (one account per number), **Ghana Card** (encrypted, reviewed by a trust analyst, images deleted after review, duplicate-card detection), **liveness selfie** with a daily gesture and code challenge, **relationship status declaration** with optional evidence, **church confirmation** by the member's pastor, **character references** via a confidential email link |
| **Covenant Integrity Score** | Identity 30 · Relationship integrity 20 · Behaviour 25 · Community trust 15 · Stability 10, with Platinum / Gold / Silver / Bronze / Limited tiers |
| **Marriage Transparency Shield** | Badge for members with verified ID and selfie, a declared status, church confirmation, at least one positive reference and good standing |
| **Readiness assessment** | 27 items: Big Five, attachment style, communication, conflict, finances, faith maturity. Gives strengths and growth tips; presented as educational, not clinical |
| **PurposeMatch** | Faith 30 · Values 25 · Compatibility 20 · Location 15 · Readiness 10, with plain-language reasons ("Both Pentecostal", "Similar marriage timeline"); hard filters on gender, both members' age ranges and denomination preference; filters for ID-verified and Shield holders |
| **Courtship** | Mutual interest creates a match; messaging; a courtship journey (getting to know → courtship → meeting families → engaged) where each step needs both members to agree |
| **Safety** | **Scam scanner** on every message (money requests, mobile money, gift cards, crypto, "fees", early contact-sharing) that warns the recipient and flags high-risk messages; report and block; profiles hidden automatically after 3 reports; **Safe Meet-up** plans sent to a trusted contact by email/SMS with "I'm home safe" and an **emergency alert** |
| **Trust & Safety console** | Queues for verifications, photos, reports, risk flags and appeals; investigations; suspension and reinstatement; **appeals** by suspended members; every decision in an audit log. Identity documents are visible only to trust analysts and admins |
| **Church portal** | Churches apply and are approved by admins; pastors and admins confirm members and attest their relationship status, publish events, add co-leaders and see a simple impact report |
| **Community** | Daily devotional on love and marriage (KJV), events with RSVP and capacity |
| **Privacy** | Data export (JSON), account deletion, field-level encryption (phone, Ghana Card, references, trusted contacts), data minimisation, ban-evasion protection that keeps only keyed hashes |
| **Premium** | Unlimited daily interests and "see who is interested in you", paid with Paystack (cards and mobile money) or a sandbox. All safety features stay free |
| **Admin** | KPIs (members, verification, Shield holders, matches, courtships, engagements, flagged messages, reports, churches), roles, church approvals, platform events, audit log |

Roles: Member, Verified Member (derived from the Trust Stack), Pastor / Church Admin (per church), Moderator,
Trust Analyst, System Admin.

## Tech stack

- **Server:** Node.js 22.5+ · Express 5 · built-in `node:sqlite` with versioned migrations
- **Client:** React 19 · Vite · hash router · installable web app · plum, gold and cream theme with dark mode
- **Tests:** `node:test`, 27 API and engine tests

## Getting started

```bash
cd purpose-partner
npm install
npm run seed --workspace server     # optional: a partner church, an event and six demo members
PP_PILOT=1 PP_ADMIN_EMAILS=you@example.com npm run dev
# API on :3001, app on http://localhost:5173
```

Demo members sign in with `demo.ama@purposepartner.test`, `demo.kwame@purposepartner.test` (and Yaw, Kofi,
Akosua, Efua), password `purposepartner`.

In development, emails and SMS are printed to the server console. With `PP_PILOT=1`, phone codes are also shown
in the app, sign-ups are auto-verified and payments use the sandbox.

Make someone staff: `npm run make-admin --workspace server -- email@example.com [admin|moderator|trust_analyst]`.

Tests: `npm test`

Production-style run (one process serves the API and the app):

```bash
npm run build
NODE_ENV=production PP_SECRET=… PP_APP_URL=https://your.domain npm start
```

The `Dockerfile` and `railway.json` deploy it the same way as MenoTribe (see `../docs/DEPLOY.md`): in Railway,
set the service's root directory to `purpose-partner` and mount a volume at `/data`.

### Configuration

| Variable | Purpose |
| --- | --- |
| `PP_SECRET` | **Required in production.** Signs sessions and derives the encryption key. Keep it stable and secret. |
| `PP_APP_URL` | Public URL used in emails and payment redirects |
| `PP_DB` | SQLite file (default `purpose-partner.db`) |
| `PP_MAIL_WEBHOOK` | URL that receives `{to, subject, text}` for each email |
| `PP_SMS_WEBHOOK` | URL that receives `{to, text}` for each SMS (e.g. a small function calling Hubtel, Arkesel or mNotify) |
| `PAYSTACK_SECRET_KEY` | Live payments. Set the Paystack webhook to `/api/billing/webhook/paystack` |
| `PP_CURRENCY`, `PP_PRICE_MONTHLY`, `PP_PRICE_ANNUAL` | Pricing in minor units (default GHS 50 / GHS 450) |
| `PP_FREE_DAILY_INTERESTS` | Free interests per day (default 10) |
| `PP_AUTO_HIDE_REPORTS` | Reports from different members before a profile is hidden pending review (default 3) |
| `PP_MIN_AGE` | Minimum age (default 18; the target market is 22–55) |
| `PP_ADMIN_EMAILS` | Comma-separated emails that become admins on sign-up or login |
| `PP_PILOT` | `1` = invited pilot: auto-verified sign-ups, OTP codes shown in-app, test payments, admin reset links |
| `PP_SEED_DEMO` | `1` = load demo data at start-up |
| `TRUST_PROXY` | Set behind a reverse proxy so rate limits see real client IPs |
| `PORT` | API port (default 3001) |

## Project layout

```
server/src/engines/   integrity.js (score, tiers, Shield) · matching.js · readiness.js · scam.js
server/src/routes/    auth · account · profile · verification · matches · safety · churches · community · staff · admin · billing
server/src/content/   legal drafts · devotionals · option lists
client/src/screens/   Auth · Profile · Discover · Matches · Trust · Community · Me · Church · Staff
```
