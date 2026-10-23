# Put Purpose Partner online with Railway (pilot)

This guide gets Purpose Partner running at a public web address, such as
`https://purpose-partner-production.up.railway.app`, for a **small invited pilot group**. You mostly
click buttons and paste settings. It takes about 15 minutes.

> **Before inviting anyone:** this is a pilot. The legal documents and devotional content are drafts
> that still need review by lawyers and your pastoral team (see `COMPLIANCE.md`). Invite only testers
> who know it's a pilot.

## What you need
- Your GitHub account, which has the `Purpose_Partner` repository
- A Railway account: sign up at https://railway.com with "Login with GitHub"
- A payment card. Railway charges by usage; a small pilot usually costs a few dollars a month.
  Check Railway's current pricing page.

## Step 1: Create the project
1. In Railway, click **New Project → Deploy from GitHub repo**.
2. Allow Railway to access your GitHub if asked (including private repositories), then choose **Purpose_Partner**.
3. Railway finds the `Dockerfile` and starts building. The first build takes a few minutes.
   It may fail until you add the settings below; that's expected.

## Step 2: Add a volume, so data is kept
Without this, all accounts and messages are wiped on every restart.
1. Open your service and go to the **Volumes** section (or right-click the service → **Attach volume**).
2. Set the **mount path** to `/data` and create it.

## Step 3: Add the settings (environment variables)
Open the service → **Variables** → **Raw editor**, paste this, and change the parts in `< >`:

```
PP_SECRET=<a long random password: 40+ letters and numbers, keep it secret>
PP_PILOT=1
PP_SEED_DEMO=1
PP_ADMIN_EMAILS=<your email address>
TRUST_PROXY=1
```

- `PP_SECRET` protects every login and the encrypted data (phone numbers, Ghana Card submissions,
  references). Create it once and **never change it**: changing it signs everyone out and makes
  encrypted data unreadable.
- `PP_PILOT=1` is pilot mode:
  - testers count as email-verified, so no email service is needed;
  - phone codes are shown in the app, so no SMS service is needed;
  - payments are **test-only** (no real money);
  - admins can create password-reset links for testers who forget their password.
- `PP_SEED_DEMO=1` adds a demo partner church, an event, six demo members and `admin@purposepartner.test`
  (all with the password `purposepartner`). **Remove it before real people join**, and delete or
  suspend the demo accounts in Admin.
- `PP_ADMIN_EMAILS` makes your own account an admin when you sign up with that email.
- `TRUST_PROXY=1` is needed on Railway so login protection sees each visitor's real address.

## Step 4: Get your web address
1. Open the service → **Settings → Networking → Generate Domain**.
2. Copy the address it gives you, then add one more variable using it:
   ```
   PP_APP_URL=https://<your-address>.up.railway.app
   ```
   This is used in email links (references, password resets) and payment returns.
3. Railway redeploys automatically. When the deployment shows **Active** (green), open the address.

## Step 5: Check it works
- Open `https://<your-address>/api/health`. You should see `"ok":true,"pilot":true`.
- Open the main address and **sign up with the email you put in `PP_ADMIN_EMAILS`**. You'll be the admin.
- Go to **Me → Admin** and check the dashboard loads.

## Step 6: Invite testers
Send them the web address. On phones they can add it to the home screen (browser menu →
"Add to Home screen") so it opens like an app.

**If a tester forgets their password:** Me → Admin → Members → find them → **Reset link**.
Copy the link and send it to them privately. It works once and expires in 24 hours.

## Updating the app
Railway redeploys automatically whenever new code reaches the GitHub branch it watches,
usually `main`. Data on the volume is kept.

## Moving from pilot to public launch
Do these before opening to the public. Each is described in `README.md`:
1. Finish the legal and pastoral reviews, and train your trust analysts.
2. Connect an email provider (`PP_MAIL_WEBHOOK`) and an SMS provider (`PP_SMS_WEBHOOK`).
3. Add Paystack keys (`PAYSTACK_SECRET_KEY`) and set the Paystack webhook to
   `https://<your-address>/api/billing/webhook/paystack`.
4. Remove `PP_PILOT` and `PP_SEED_DEMO`.
5. Optional: a custom domain (Settings → Networking).

## Important limits
- Run **one** copy (replica) of the service. The database is a file on the volume, so it can't be shared between copies.
- Back up the volume regularly (Railway volume backups), especially once real people use it.

## Troubleshooting
| Problem | Fix |
| --- | --- |
| Deploy fails with "PP_SECRET must be set in production" | Add `PP_SECRET` in Variables |
| Accounts disappear after a redeploy | The volume is missing, or not mounted at `/data` |
| Email links point to localhost | Set `PP_APP_URL` to your Railway address |
| Everyone is locked out of login at once | `TRUST_PROXY=1` is missing |
| Phone codes never arrive | Expected without `PP_SMS_WEBHOOK`; in pilot mode the code is shown in the app |
