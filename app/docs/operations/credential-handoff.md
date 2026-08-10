# Public beta credential handoff

Codex can finish repository work without secret values. The owner supplies the
following through the deployment platform or CI secret store.

## API runtime

- PostgreSQL host, port, database, application user, and password
- production R2 endpoint, bucket, access key, and secret key
- `SPACE_LINK_ENCRYPTION_KEY`
- Journal ticket private key, control secret, projection secret, stable room
  salt, and exact `PARTYKIT_HOST`
- public API/reset/invitation URLs and exact CORS origins
- Mailjet credentials and sender identity
- Stripe live secret, webhook secret, price IDs, and return URLs
- enabled OAuth app IDs/secrets and webhook verification secrets
- AI gateway/provider credentials, selected models, and hard budget ceilings
- telemetry project token/host, metrics token, trusted proxy CIDRs, and release
  version/channel

The authoritative names and safe defaults are in
`misty-server/.env.example`. Production startup validates the core database,
R2, public HTTPS URL, and encryption values before serving.

## Cloudflare Worker

- Cloudflare account authorization used only by deployment automation
- Journal public ticket key and matching control/projection secrets
- temporary previous public/control secrets during a no-downtime rotation
- internal API base URL, issuer, and audience
- production and staging Worker/Durable Object names and custom domains

## Desktop release

- Tauri updater signing private key and password, stored outside Git
- updater public key and HTTPS feed URL
- exact production CSP origins in `TAURI_CSP_CONNECT_SOURCES` and
  `TAURI_CSP_IMAGE_SOURCES` (API, Journal WebSocket, R2, telemetry, and any
  enabled catalog host; wildcards are rejected)
- published Privacy Policy, Terms, desktop license, support, and security URLs
  in the corresponding `VITE_*_URL` release variables
- Apple Developer ID certificate, App Store Connect notarization credentials,
  team ID, and signing identity
- Windows Authenticode certificate/provider credentials and timestamp service
- release repository/token permissions needed to upload immutable artifacts

## Owner decisions and enrollments

- production/staging hosting vendors and custom domains
- Apple and Windows signing account enrollment
- OAuth provider production verification
- Stripe live-mode activation
- alert recipients, support/security/privacy/abuse addresses, and service
  expectations
- counsel approval of privacy, terms, license, retention, and incident language
- initial beta cohort and feedback cadence

Never send secret values in a Git commit, issue, screenshot, or this checklist.
After configuration, provide only confirmation that each named value exists;
validation and health checks should diagnose shape or connectivity errors.
