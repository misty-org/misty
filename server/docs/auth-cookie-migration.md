# JWT cookies and local credential files

Account login now uses `misty_session` (a five-minute access JWT) and
`misty_refresh` (a rotating refresh JWT with a 30-day absolute lifetime).
Both are host-scoped, HttpOnly cookies, Secure over HTTPS. Login and registration
responses contain account metadata only. Access JWTs are verified with HS256,
an explicit algorithm allowlist, issuer, audience, expiry, token purpose and key ID.
Account credentials are no longer accepted in Authorization headers. Restricted
app-runtime bearer credentials keep their existing capability checks.

POST `/auth/refresh` (also under `/api` and `/v1`) replaces both cookies. PostgreSQL
stores the hash of the session ID and the current refresh JWT, never the raw
credential. Rotation locks the session row. Reusing an old refresh token deletes
the family, including its latest refresh token. Logout and password reset revoke
refresh sessions; an already issued access JWT can remain valid for up to five
minutes. Browser tabs serialize refreshes with Web Locks; desktop account changes
share the same lock. Failed refreshes caused by outages do not sign users out.

Cookie-authenticated mutations and login/enrollment require `X-Misty-CSRF: 1`.
An Origin header, when present, must match the server's CORS allowlist. Native
clients without Origin must still supply the header. Public webhooks without
account cookies are unaffected. Browser and desktop HTTP helpers add the header
only for configured Misty API destinations, and retry once after a successful
refresh. Scoped app credentials and third-party downloads do not trigger refresh.

## Rollout

1. Set `MISTY_AUTH_SIGNING_KEY` to base64 encoding of at least 32 cryptographically
   random bytes, consistently on every API instance. Production refuses startup
   without this key. Keep it in the deployment secret store. Development without
   a key uses a process-local random key and signs users out on restart.
   For `compose.dev.yml`, persist this key in the ignored
   `.env/dev/crypto/services.env` file, which the API already loads. Generate it
   once, retain it across rebuilds, and recreate only the API service to apply it.
   A 30-day refresh-token expiry cannot preserve a session after its signing
   key has been lost.
2. Apply `20270206000000_jwt_refresh_sessions.sql` using the normal migration role.
3. Release the server, desktop and website changes together. Old opaque account
   sessions do not authenticate against this version: users must sign in again.
4. To rotate signing keys, put the old key in `MISTY_AUTH_SIGNING_KEY_PREVIOUS`
   while deploying the new current key. Keep the previous key for the refresh
   lifetime, or deliberately force remaining old sessions to sign in again.

These changes have not deployed or altered a running development/production
database. Test migrations were applied only to an isolated disposable database.

## Desktop credentials

Misty's native host and keystore plugin use the same `misty-credential-store`
library. Runtime credentials live in `~/.misty/.auth/`: login cookies, provider API
keys, device identities, backup passwords, permission encryption keys, folder
bookmarks and self-host entitlement credentials. File names hash the profile,
service and account. Login cookie records additionally bind the API origin and
account. Files use mode 0600 and directories 0700 on macOS/Unix. Writes use a
private temporary file, fsync and atomic replacement; reads reject symlinks and
nonregular files. The files are readable by other processes running as the same
OS user; they do not have Keychain's application-access controls.

The renderer receives only account handles and metadata. Native HTTP clients manage and persist cookie jars without returning JWTs to
JavaScript. This avoids WebKit third-party cookie restrictions. Requests use
binary IPC for uploads, upload progress notifications, streamed response reads,
and cancellation. Redirects cannot forward credentials or request bodies to
another origin. Browser builds keep credentials exclusively in browser cookies.
Native mobile builds use the same transport and store files in their private
app-data directory rather than the desktop home directory.

Existing debug-build credential files migrate on first use. Runtime code never
opens macOS Keychain, including the former legacy permission migration. Existing
Keychain items are left untouched. Provider keys must be re-entered or imported,
device identities may need re-pairing, and permission grants may need to be made
again. **Preserve an existing encrypted backup's password before upgrading.**
Misty does not generate a replacement password for a marked existing repository.
To retain an old identity or encryption key, export that credential yourself and
import its exact service/account/value using the native store's
`import_credentials` utility (see the desktop credential-storage document).

Misty apps obtain their credentials through the host's existing native commands,
so downloaded apps use the new backend after the host is rebuilt and restarted.
The legacy native mobile keystore bridge is also retired. Apple release-signing
and notarization tooling is separate from application credential storage.
