# Personal app ownership

Apps are owned by the signed-in account within a deployment. Installing or selecting an app never depends on the active Space. Discover offers personal Install, Review permissions, Open, Update and Uninstall actions. The host's built-in Chat, Journal, Planner and Library use Space membership and roles directly. Space app allowlists and `apps.manage` no longer grant authority.

## Data and authority migration

The server migration `20270208000000_personal_apps.sql` consolidates prior Space installations into `user_app_installations`. It preserves old installation rows as provenance, copies every original personal record into `app_personal_record_imports`, and chooses the newest record deterministically for each account/app/key. The follow-up migration `20270210000000_remove_app_connection_selection_and_exports.sql` retires that temporary archive and the old app connection-selection tables. App details no longer exposes account selection or previous-Space exports.

Migrated apps require personal permission review. Old grants are cleared, runtime credentials are revoked, and provider registrations are disabled. Re-consent verifies the same signed SDK publisher and immutable version; it does not require inventing a new package version. Grants for collaborative content are excluded. Agent assignments migrate to their owners, but cannot execute before review. Apps with the required connection capabilities use their owner’s connected accounts; agent access is managed in Agents. Changing grants or installation state advances authority generation and revokes live sessions and provider authority.

New installation controls and session issuance use `/me/apps`. Personal records use account/app/key. SDK provider registrations and agent assignments retain an empty legacy `space_id` field for schema compatibility, with account installation foreign keys. Device presence uses the fixed `personal` protocol context and checks the owner's reviewed Files installation. The old Space installation mutation methods fail closed.

Browser storage moves from v3 Space namespaces to v4 deployment/account/app namespaces. Existing personal values take precedence; old keys remain intact, including conflicts. A migration marker prevents deleted personal values from being resurrected. Native permissions use account/deployment ownership and current authority generation. Previous Space-native grants are not automatically copied or broadened; users review them again.

## Release sequence

Deploy this as a coordinated server, SDK, app package and frontend release. Back up the database before applying the forward-only migration. Drain old app runtimes, apply the migration, and serve matching app catalog/package metadata with the updated host. Older clients using Space app routes are intentionally incompatible. Do not roll the application back to Space authorization after migrating the database.

Implementation validation used the complete migration chain in a disposable PostgreSQL database with pre-migration records, conflicting keys, multiple users and an old runtime credential. The local implementation does not deploy the server or apply migrations to a live database.
