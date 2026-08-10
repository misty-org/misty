# Misty Subprocessor and Data-Use Notice — draft

Publish this only after the owner confirms vendors, regions, contracts,
retention, and production configuration.

| Provider/category | Purpose | Data categories | Owner confirmation |
| --- | --- | --- | --- |
| Cloudflare | Tunnel/edge security, Journal Worker/Durable Objects, private R2 object storage | Network metadata, collaboration state, encrypted/signed asset transfers | Account, regions, retention, deletion protection |
| [API host] | Misty API runtime | Account, authorization, operational request data | Vendor, region, logs |
| [PostgreSQL host] | Primary database and backups | Account, Space metadata, authorization, audit and billing references | Vendor, region, PITR/backup retention |
| Stripe | Checkout, subscriptions, billing portal, fraud/payment operations | Account and transaction identifiers; payment details handled by Stripe | Legal entity, live mode, retention |
| PostHog, if enabled | Opt-in product analytics and error telemetry | Pseudonymous account/device/app events; no document bodies or credentials | Project/region, replay disabled, retention |
| Mailjet/[email provider] | Transactional email | Email address, delivery metadata, message template fields | Provider, region, suppression retention |
| [AI gateway and model providers] | User-invoked AI and embeddings | Selected prompts, context, outputs, usage | Models, training/retention settings, regions |
| Google | User-authorized Drive/OAuth features | OAuth scopes, provider identifiers, selected files/actions | Production verification and scopes |
| Dropbox | User-authorized file features | OAuth scopes, provider identifiers, selected files/actions | Production app and scopes |
| Microsoft | User-authorized OneDrive features | OAuth scopes, provider identifiers, selected files/actions | Production app and scopes |

Misty does not use legacy rclone credentials for these three remote providers.
The service uses provider OAuth, including a user-supplied OAuth client option
where supported. Credentials are encrypted at rest and removed on disconnect.

## Telemetry field policy

Allowed fields: stable pseudonymous user identifier after consent, platform,
release version/channel, feature/event name, duration, success/failure code,
and coarse counts.

Forbidden fields: note or message content, filenames, raw paths, passwords,
session or OAuth tokens, authorization headers, presigned URLs, Worker room
IDs, full IP addresses, and binary file bodies.

## Publication checklist

- [ ] Confirm each active production provider and remove inactive rows.
- [ ] Link each provider privacy/DPA page.
- [ ] Record processing region and international transfer mechanism.
- [ ] Record service and backup retention.
- [ ] Confirm AI training and zero-retention settings.
- [ ] Confirm PostHog autocapture/session replay remain disabled.
- [ ] Add notice-change contact and effective date.

