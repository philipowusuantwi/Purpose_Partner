# Purpose Partner roadmap

The concept note plans: months 1–3 research, 4–6 MVP, 7–9 pilot launch, 10–12 national rollout.
This MVP covers the product scope for the pilot. Below is what still needs people, partners or more engineering.

## Before the pilot (months 6–7)

| Item | Why | Notes |
| --- | --- | --- |
| Legal review | Terms, Privacy Policy and Guidelines are drafts | Ghanaian lawyers; register with the Data Protection Commission (Act 843) |
| Pastoral review | Devotionals, readiness tips and courtship stages | Your pastoral advisory board |
| Trust analyst SOPs and training | Ghana Card, selfie and evidence checks are manual | Write review checklists; aim for review within 24 hours |
| Email and SMS providers | Production needs real delivery | Connect `PP_MAIL_WEBHOOK` and `PP_SMS_WEBHOOK` (Hubtel, Arkesel or mNotify for SMS) |
| Recruit partner churches | Church confirmation powers the Shield | Approve churches in Admin after a call with leadership |
| Paystack account | Premium payments | Set `PAYSTACK_SECRET_KEY` and the webhook URL |

## Next engineering phases

1. **Automated identity checks:** replace manual Ghana Card review with NIA verification through a licensed
   provider (for example Smile ID or a similar KYC partner), and the selfie challenge with automated liveness
   and face matching. The data model already stores only results and masked numbers.
2. **Video calls:** in-app video verification calls between matches (WebRTC through a provider such as Daily,
   Twilio or Agora), so members can confirm each other before meeting.
3. **Mobile apps:** the PRD calls for Flutter or React Native. The current web app is installable on phones.
   Native apps can reuse this API unchanged.
4. **AI trust engine:** add a model-based scam and harassment classifier alongside the current rules, plus
   behaviour analytics (many identical openers, fast contact-sharing, report patterns).
5. **Mentorship:** let couples invite a pastor or mentor couple into their courtship journey; counselling
   bookings.
6. **Paid event tickets** and church subscription plans.
7. **Scale-out architecture:** the PRD's target is an API gateway with separate Auth, Match, Trust, Church
   and Messaging services on PostgreSQL. Today the services are separate route modules in one process on SQLite,
   which is right for a pilot. When moving: port `db.js` to PostgreSQL, move rate limiting to Redis, store
   photos in object storage, add real-time messaging (WebSockets) and precompute match candidates.
8. **Operations:** CI, monitoring, backups of the `/data` volume, SIEM export of the audit log, MFA for staff.
