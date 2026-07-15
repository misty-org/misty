# Misty Agents production deployment

Misty Agents stores only device-encrypted ciphertext in object storage. Do not
use a public bucket for agent documents: an R2 public development URL or custom
domain bypasses Misty's authenticated download path. Either make the existing
bucket private if nothing else depends on its public URLs, or create a dedicated
private bucket in the same R2 account.

## 1. Configure a private Cloudflare R2 bucket

1. Create or choose a **Standard storage** bucket dedicated to agent
   attachments. Do not use Infrequent Access: its 30-day minimum storage charge
   is a poor match for Misty's 24-hour retention.
2. Disable its `r2.dev` public URL and remove any public custom domain.
3. Create an R2 API token scoped to **Object Read & Write** for that bucket only.
4. Add a lifecycle rule for prefix `agents/` that deletes objects after at most
   two days. Misty's worker deletes expired rows and ciphertext after exactly 24
   hours; the R2 rule is the provider-side backstop.
5. Do not expose browser upload access. The desktop sends encrypted bytes to
   `misty-server`, which validates the signed job grant and relays only the
   ciphertext to R2. The private bucket does not require a CORS policy.

Set these server secrets and assertions:

```dotenv
MISTY_ENVIRONMENT=production
MISTY_AGENT_DOCUMENTS_ENABLED=true
DOCUMENT_STORE=r2
S3_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=misty-agent-attachments
S3_ACCESS_KEY=YOUR_BUCKET_SCOPED_ACCESS_KEY
S3_SECRET_KEY=YOUR_BUCKET_SCOPED_SECRET
S3_PRIVATE=true
S3_LIFECYCLE_DAYS=2
DOCUMENT_SIGNING_KEY=GENERATE_A_RANDOM_SECRET_OF_AT_LEAST_32_BYTES
DOCUMENT_KEY_ID=2026-07
DOCUMENT_PRIVATE_KEY_B64=BASE64_PEM
```

Generate the two application secrets outside the repository:

```sh
openssl rand -base64 48
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 | base64 | tr -d '\n'
```

Rotate the RSA wrapping key by changing `DOCUMENT_KEY_ID` and the
current private key. Keep the preceding key in
`DOCUMENT_PREVIOUS_KEYS_JSON` for at least 24 hours, then remove it.
R2 never receives the plaintext AES key; losing all wrapping keys before the
retention window ends makes in-flight attachments unrecoverable.

## 2. Enable rollout flags

Enable each phase independently on the server:

```dotenv
MISTY_DEVICE_JOBS_ENABLED=true
MISTY_FOLDER_AGENTS_ENABLED=true
MISTY_AGENT_DOCUMENTS_ENABLED=true
```

Build the desktop with the corresponding Vite flags:

```dotenv
VITE_MISTY_AGENTS_ENABLED=true
VITE_MISTY_DEVICE_JOBS_ENABLED=true
VITE_MISTY_FOLDER_AGENTS_ENABLED=true
VITE_MISTY_DOCUMENTS_ENABLED=true
```

The server's minute worker enqueues schedules. Every ten minutes it purges
expired attachment objects/keys and 30-day conversation data. Run at least one
continuously available server instance; multiple workers are safe because
claims and deletes are idempotent.

## 3. Deploy and verify

Apply every database migration before switching on flags. A production smoke
test should cover:

- Upload a scanned PDF and verify the result contains accurate page citations
  and no local path in any server payload.
- Trigger a new-file workflow and verify it creates a collision-free summary.
- Attempt the same agent ID from an unlisted Misty account and verify it is
  denied without revealing the agent name.
- Request a mutation, alter its parameters, and verify the approval digest is
  rejected. Verify an untouched approval expires after 24 hours.
- Confirm an expired attachment is deleted from R2 and its wrapped key is
  removed from Postgres. Also verify the R2 lifecycle rule independently.

Do not log or paste R2 secrets, RSA private keys, signed upload URLs, device
private keys, or attachment envelopes into support tickets.
