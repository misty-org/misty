# Settings profiles

The settings navigation has five groups: App, Browser, Spaces, Files, and Agents. Each page has one subject. The website remains the account administration surface; the app uses its configured website helper for Account settings. Legacy section IDs resolve to canonical pages.

## Ownership and resolution

`src/features/settings/profiles/definitions.json` declares stable keys, value types, defaults, validation constraints, ownership, platform availability, and search labels. `registry.ts` supplies value adapters for existing runtime consumers. Dropdown indexes are converted to stable IDs at that boundary. The Go service embeds a matching manifest; a contract test rejects schema drift.

Preferences resolve from built-in defaults, the selected profile, and then that profile's device overrides. Existing installations start in Local only. Profile changes do not restore browser sessions, replace layouts, modify account configuration, or grant access. Shortcut bindings, paths, indexing, telemetry consent, and transfer performance presets remain local. Account AI controls and resource editors continue to call their existing APIs independently.

## Persistence and synchronization

The native cache is `settings-profiles.sqlite` beside the settings document. It uses SQLite transactions, compare-and-swap revisions, WAL, and full synchronous writes. Web uses IndexedDB with strict durability. Both store account/deployment-specific caches, selection, overrides, and an ordered outbox. Preference changes reach runtime adapters only after a durable local commit.

The original native settings file is backed up as `settings.before-profiles.json` before normalization. The backup is created atomically and never overwritten. Each installation also retains a migration baseline. Only allowlisted portable keys can leave the device; unknown local data remains in the backup and local document.

The authenticated `/settings/profiles` API lists, creates, reads, patches, and deletes private profiles. Row locks serialize key-level patches, revisions are server controlled, and durable mutation receipts prevent retries from overwriting later edits. The last server commit wins for the same key, including late offline edits. Patches retain unknown newer fields.

Profile invalidations use the account event stream, independently of encrypted Browser Device Handoff. Reconnect, foreground, online events, and a bounded background retry recover interrupted synchronization. Same-origin windows share state notifications. Account/deployment transitions detach subscriptions and ignore stale replies.

Cloud creation, duplication, renaming, and deletion require connectivity. Cached selection and preference edits work offline. Deleting the active profile preserves effective values as Local only. Unsent edits to deleted inactive profiles have a recovery action on Sync. Storage failures retain pending work and show Needs attention.

## Rollout and verification

Deploy the account service with `20270927000000_settings_profiles.sql` before enabling cloud profiles in the new client. The updated native binary is required for SQLite persistence commands. No production migration or deployment is performed by this code change.

Focused frontend tests cover navigation, aliases, search, ownership, migration, default precedence, offline restart, overrides, stale replies, retry IDs, and storage failures. Native tests cover SQLite persistence/CAS, backup, account isolation, and revoked folder reads. PostgreSQL integration tests cover account isolation, simultaneous writes, conflict order, retries, reset, future fields, and deletion. Run them only against a disposable database named `misty_settings_test`:

```sh
cd server
MISTY_SETTINGS_TEST_DSN=postgres://localhost/misty_settings_test go test ./internal/platform/postgres -run TestSettingsProfilesPostgres
```

This iteration targets desktop and web. Mobile shells, bridges, build targets, and platform-specific branches have been removed. The forward migration `20270927010000_desktop_device_platforms.sql` normalizes retired device platforms to `unknown` without deleting registrations or grants.

After the mobile removal, builds and test execution are left to the developer. Review desktop and web navigation, search focus, profile persistence and synchronization, and account/deployment switching before rollout.
