# Privacy and compliance notes (for legal review)

These notes describe how the MVP handles personal data so your lawyers can check it against the Data
Protection Act, 2012 (Act 843) and advise on registration with the Data Protection Commission.

## Sensitive personal data

Religious beliefs and relationship history are sensitive data. Members give explicit consent at sign-up, and
consent to identity verification separately before submitting a Ghana Card. Every acceptance is stored in the
`consents` table with its document version and time.

## Data minimisation

| Data | Stored as | Retention |
| --- | --- | --- |
| Password | scrypt hash | Until account deletion |
| Phone | AES-256-GCM encrypted, plus a keyed hash for "one account per number" | Until deletion |
| Ghana Card number and images | Encrypted while pending review | Images and number **erased when an analyst decides**; a masked number (`GHA-*****6789-0`) and a keyed hash remain |
| Liveness selfie, status evidence | Encrypted while pending | Erased after the decision |
| Reference and trusted-contact details | Encrypted | Until deletion |
| Messages | Plain text (scanned for scam patterns) | Until deletion of either account |

## Member rights

- **Access:** Me → Privacy & data → Download my data (JSON).
- **Correction:** profile editing.
- **Objection / restriction:** pause profile.
- **Erasure:** Delete account removes the profile, photos, verifications, references, matches and messages they
  sent. If the account was suspended or had upheld reports, only keyed hashes of the email, phone and Ghana
  Card are kept to stop banned members re-registering.

## Who can see what

- Other members: first name, age, city, approved photos, faith and values answers, declared status, trust badges.
- Church leaders: first name, age, city and declared status of people who ask that church to confirm them.
- Moderators: photos, reports, appeals.
- Trust analysts and admins: identity documents and risk flags. Every view of a document is written to the audit log.

## Open questions for lawyers

1. Lawful basis and wording for the automated scam scanning of messages.
2. Retention period for upheld safety reports and the ban-evasion hashes.
3. Cross-border transfer if hosting is outside Ghana (Railway regions are in the US/EU/Asia).
4. Requirements for using NIA data through a third-party verification provider.
5. Liability wording for church attestations and verification badges.
