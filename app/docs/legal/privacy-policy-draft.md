# Misty Privacy Policy — public beta draft

**Status:** Draft for owner and legal review. Replace every bracketed field and
publish at a stable public URL before accepting public-beta registrations.

**Effective date:** [DATE]  
**Controller:** [LEGAL NAME AND ADDRESS]  
**Privacy contact:** [PRIVACY EMAIL]

## What Misty is

Misty is a desktop workspace for local and connected files, collaborative
Spaces, Journal notes and drawings, messages, automations, and optional AI
features. This policy describes data processed by the Misty service. Files that
remain solely on a device are not uploaded unless the user chooses a feature
that requires server processing, synchronization, sharing, or a remote
provider.

## Data we process

- Account data: name, username, email address, password hash, profile image,
  settings, subscription and entitlement records.
- Collaboration data: Space membership, messages, Journal document state,
  drawings, permissions, presence, and uploaded attachments.
- Connected-service data: provider account identifiers, granted scopes, and
  encrypted OAuth credentials for services a user connects. Misty does not ask
  users to provide provider passwords.
- AI data: prompts, selected context, outputs, usage, and safety/approval
  records when an AI feature is invoked.
- Operational data: security events, request identifiers, coarse device/app
  version, errors, performance measurements, and support correspondence.
- Payment data: Stripe customer, subscription, invoice, and transaction
  identifiers. Full card details are handled by Stripe, not Misty.

Misty does not sell personal information or use private workspace content for
advertising. [OWNER MUST CONFIRM BEFORE PUBLICATION.]

## Why we process it

We process data to provide and secure the service, synchronize authorized
collaboration, fulfill user requests, operate connected providers, process
payments, prevent abuse, offer support, comply with law, and improve Misty when
the user enables optional analytics or error reporting.

The legal bases, where applicable, are performance of a contract, legitimate
interests in operating and securing the service, consent for optional
telemetry, and compliance with legal obligations.

## Storage and collaboration

Journal text/drawing state is stored in Cloudflare Durable Objects. Journal
images and other binary assets are stored in a private Cloudflare R2 bucket.
Clients upload and download assets through short-lived, exact-object signed
URLs. The collaboration Worker and API do not receive image bodies. PostgreSQL
stores accounts, authorization, metadata, audit records, and object references.

Space content is available to the members and roles authorized in that Space.
Private notes are available only to their creator and explicitly authorized
members. Removing access closes active collaboration sessions and prevents new
tickets.

## Connected providers and AI

Provider access occurs only after authorization. Credentials are encrypted at
rest and erased when disconnected. Where supported, Misty also calls the
provider's revocation endpoint. Microsoft delegated tokens do not offer an
equivalent per-token endpoint; Misty erases its copy and the user may also
remove consent in their Microsoft account.

When a user invokes an AI feature, the selected prompt and context may be sent
to the configured AI gateway/model provider. Misty must identify the active
providers and their retention/training settings in the subprocessor notice.

## Analytics and error reporting

Usage analytics and error reporting are off by default and controlled
separately. If enabled, Misty sends only the documented event fields to the
configured telemetry service. Document content, passwords, OAuth tokens,
presigned URLs, and raw file bodies must not be included. Disabling a setting
stops future collection from that device/account; it does not retroactively
delete records already required for security or operations.

## Retention and deletion

- Active account and workspace data is retained while needed to provide Misty.
- Abandoned upload reservations expire automatically.
- Unreferenced Journal assets receive a minimum 24-hour safety window before
  reference-aware deletion.
- Account deletion immediately revokes Misty sessions and begins provider and
  storage cleanup. The account enters a 30-day retention period, after which
  direct identifiers are anonymized.
- Shared Space content a user contributed may remain for other members, with
  the contributor displayed as a deleted user where retention is necessary to
  preserve the shared record.
- Billing, fraud, security, backup, and legal-hold records may be retained for
  the minimum period required by law or legitimate operational need.
- Backup copies age out according to the published backup schedule rather than
  being edited in place.

Before deletion, users can download a portable ZIP from Account settings. The
desktop obtains Journal state directly from the collaboration service and
binary assets directly from R2, verifies asset checksums, and packages the
export locally.

## Sharing and subprocessors

We disclose data to service providers only as needed to operate Misty, to
connected providers at the user's direction, to collaborators the user
authorizes, in a corporate transaction subject to appropriate safeguards, or
when law requires it. Current categories and locations are listed in the
Subprocessor Notice.

## Security

Misty uses encrypted transport, private object storage, hashed passwords and
session tokens, encrypted provider credentials, short-lived signed transfers,
least-privilege authorization, rate limits, and audited deletion workflows.
No system is perfectly secure. Report suspected vulnerabilities to
[SECURITY EMAIL].

## User choices and rights

Users can update their profile, control optional telemetry, disconnect
providers, export their data, leave Spaces, and request deletion in the app.
Depending on location, users may also have rights to access, correct, delete,
restrict, object, or obtain a portable copy of personal data, and to appeal or
complain to a supervisory authority. Contact [PRIVACY EMAIL].

## Children, international transfers, and changes

Misty is not directed to children under [MINIMUM AGE]. [DEFINE AGE/REGIONS.]
International transfers use [TRANSFER MECHANISM]. Material policy changes will
be announced in the app or by email before they take effect when required.

## Contact

[LEGAL NAME]  
[POSTAL ADDRESS]  
[PRIVACY EMAIL]

