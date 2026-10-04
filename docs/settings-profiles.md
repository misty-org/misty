# Account settings

Misty is a desktop application. Settings belong to the signed-in account on the server. The public/account website is a separate administration surface; the desktop app opens it through the configured website helper.

## Ownership and resolution

`src/features/settings/profiles/definitions.json` declares stable keys, value types, defaults, validation constraints, ownership, desktop availability, and search labels. `registry.ts` adapts values for runtime consumers. The Go service embeds the same manifest; a contract test rejects schema drift.

Preferences resolve from the account record and pending account mutations, with built-in defaults for absent keys. There are no profile selectors, local-only preferences, or device overrides. Legacy profiles migrate into the account record. Device identities and OS-vault secrets remain distinct from preferences and are never uploaded as ordinary settings.

## Persistence and synchronization

The native account/deployment-scoped cache is `settings-profiles.sqlite`. SQLite transactions and compare-and-swap revisions preserve an ordered outbox. Changes reach runtime adapters after a durable local commit. The renderer has no alternate IndexedDB settings backend.

The original native settings file is backed up before normalization. Legacy data needed for migration remains recoverable. Registered account preferences, including navigation order, synchronize through the authenticated `/settings/preferences` API. Server revisions and mutation receipts make retries safe; the authoritative server order resolves edits to the same key.

Account event invalidations, reconnect, foreground events, and bounded retries refresh the account record. Offline edits remain in the durable outbox. Account/deployment transitions detach subscriptions and ignore stale replies. Settings synchronization is independent of encrypted browser workspace sharing; native browser data and unlock secrets do not travel through the settings API.

## Verification and rollout

Ship matching client/server definitions and the native settings persistence commands together. The desktop-only device-platform migration normalizes retired registrations to `unknown` while retaining their identities and grants; applied migration history remains intact.

Frontend tests cover registered ownership, migration, offline restart, stale replies, retry IDs, native persistence and storage failures. Native tests cover SQLite compare-and-swap and account isolation. Database integration checks must use a disposable settings test database:

```sh
cd server
MISTY_SETTINGS_TEST_DSN=postgres://localhost/misty_settings_test go test ./internal/platform/postgres -run TestSettingsProfilesPostgres
```

Review desktop navigation, search focus, preference synchronization, and account/deployment switching before rollout. Source changes do not deploy the server or modify live infrastructure.
