// Legal documents shown in the app. Every document is a DRAFT that must be reviewed and
// approved by qualified Ghanaian lawyers before launch (see docs/COMPLIANCE.md).
//
// Bump a document's `version` whenever its substance changes: members are then asked to
// re-accept it, and each acceptance is recorded in `consents`.

export const REVIEW_STATUS = 'DRAFT - pending legal review. Not yet approved for public launch.';

export const DOCUMENTS = {
  terms: {
    title: 'Terms of Service',
    version: '2026-10-draft-1',
    requiresAcceptance: true,
    body: `# Terms of Service

These terms govern your use of Purpose Partner ("we", "us"). By creating an account you agree to them.

# 1. Who can join
You must be at least 18 years old, single (never married, divorced, widowed or with an annulled marriage) and not engaged to anyone else. Purpose Partner is for people seeking a Christian relationship that leads to marriage.

# 2. Honesty
You agree that everything you tell us and other members is true: your identity, age, photos, relationship status and church. Misrepresenting your relationship status is a serious breach and will lead to permanent removal.

# 3. Verification
Verification badges, integrity tiers and the Marriage Transparency Shield reflect checks we and partner churches carried out at a point in time. They reduce risk but cannot guarantee anyone's identity, character or intentions. Always use your own judgement and the safety tools.

# 4. Conduct
You agree to follow the Community Guidelines. We may remove content, restrict features and suspend or close accounts that break them. You may appeal a suspension from the app.

# 5. Meeting in person
Any meeting outside Purpose Partner is your own decision and responsibility. Meet in public, tell someone you trust (you can use the Safe Meet-up tool) and never send money to someone you have met online.

# 6. Churches
Partner churches are independent organisations. Their confirmations are made by their own leaders, not by Purpose Partner.

# 7. Premium
Premium is billed in advance for the period you choose (monthly or annual) and does not renew automatically. Prices are shown before you pay.

# 8. Liability
To the extent permitted by law, Purpose Partner is provided "as is", and we are not liable for indirect or consequential losses or for the conduct of other members or churches.

# 9. Ending your account
You can delete your account at any time in Me → Privacy & data.

# 10. Governing law
These terms are governed by the laws of the Republic of Ghana. [Lawyers to confirm jurisdiction and dispute-resolution clause.]

# 11. Contact
support@purposepartner.app [placeholder]`,
  },

  privacy: {
    title: 'Privacy Policy',
    version: '2026-10-draft-1',
    requiresAcceptance: true,
    body: `# Privacy Policy

We respect your privacy and handle your personal data in line with the Data Protection Act, 2012 (Act 843) of Ghana. [Lawyers to confirm registration with the Data Protection Commission and the data controller details.]

# What we collect
• Account data: email, password (stored only as a secure hash), phone number (encrypted).
• Profile data: first name, gender, date of birth, location, church and denomination, faith and lifestyle answers, photos and what you write about yourself.
• Verification data: your Ghana Card number and images, a verification selfie, relationship status and any evidence you submit. Images are encrypted and deleted once a trust analyst has reviewed them; we keep only the result and a masked card number.
• Church and references: the church you name and the people you invite as references.
• Activity: interests, matches, messages, reports and safety plans.

# Sensitive data
Your religious beliefs and relationship history are sensitive personal data. We process them only with your explicit consent, which you give when you sign up, and only to run the service.

# How we use it
To match you with compatible members, verify identities, keep members safe, prevent fraud, run partner-church confirmations, and send service messages. Safety systems scan messages automatically for common scam patterns.

# Who sees what
Other members see your first name, age, approved photos, city, church denomination, profile answers, trust tier and badges. They never see your surname, email, phone, Ghana Card or exact date of birth. Your church's admins see your claim to be a member so they can confirm it. Trust & safety staff see what they need to review reports and verifications.

# We never sell your data
We do not sell your personal information or use it for third-party advertising.

# Your rights
You can view, download (Me → Privacy & data → Export) and correct your data, pause your profile, withdraw consent and delete your account. Deletion removes your profile, photos, messages and verification data. We keep a minimal record of upheld safety reports to stop banned users returning, and payment records for as long as tax law requires.

# Security
Data is encrypted in transit, sensitive fields are encrypted at rest, and staff actions are recorded in an audit log.

# Contact
privacy@purposepartner.app [placeholder]`,
  },

  guidelines: {
    title: 'Community Guidelines',
    version: '2026-10-draft-1',
    requiresAcceptance: true,
    body: `# Community Guidelines

Purpose Partner is a place for honourable, Christ-centred courtship.

# Be truthful
Use your real first name, recent photos of yourself only, and declare your relationship status honestly.

# Be respectful
No sexual content, crude language, pressure, harassment or hate. Treat every member as a brother or sister in Christ.

# Never ask for money
Asking for money, mobile money, gifts, airtime, crypto, "fees" or investments is not allowed, for any reason. Report anyone who asks.

# Keep it on Purpose Partner at first
Get to know someone here before sharing your number or moving to another app.

# Protect yourself and others
Report anything that feels wrong. Reports are confidential.

Breaking these guidelines can lead to warnings, a lower integrity score, suspension or permanent removal.`,
  },
};

export const REQUIRED_DOCUMENTS = Object.keys(DOCUMENTS).filter((k) => DOCUMENTS[k].requiresAcceptance);
