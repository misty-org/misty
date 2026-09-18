# Shared provider accounts

Default embedded website sessions now belong to a provider family within a
Misty account and server deployment. App ownership still controls which services
an app can open; it no longer creates a separate default sign-in for each service.

| Account family | Services sharing the default browser session |
| --- | --- |
| Google | Gmail, Drive, Docs, Calendar, YouTube, YouTube Music |
| Microsoft | Outlook, OneDrive, Word, OneNote, Outlook Calendar, To Do, Teams |
| Apple | iCloud Mail, Apple Music |
| Atlassian | Jira, Trello |

Other providers retain their own session. An unrelated site's “Sign in with
Google” button does not give that integration the Google profile.

The host's `providerAccounts.ts` resolves profiles and maintains a persistent
directory under `misty:provider-account-v1:<opaque-profile-id>` in host storage.
Records contain the family and integration references, never tokens or cookies.
Actual website credentials remain in the native browser's persistent data store.
OAuth API connections already belong to the Misty account on the server and keep
their existing token storage and capability checks. Website sign-in does not
grant API permissions; additional OAuth scopes may still require consent.

## Continuity and multiple accounts

New automatic website records use `default-<service>`. The host maps these to
the original default Gmail, Outlook, iCloud, or Jira profile, preserving existing
primary sessions even when another app opens first. Subsequent launches and app
restarts derive the same profile. Metadata is not trusted to select a profile.

Existing named accounts, UUID profiles, and profiles previously created from
mail connection IDs keep their exact native identities. They are not silently
merged by email, display name, or position in an account list. They therefore
remain separate; this change does not migrate their cookies into the shared
default. Newly connected API mail accounts no longer create empty, separate
website profiles. Existing website selections and pins remain valid.

Removing a shared integration closes its views and unlinks it from the directory
without deleting the provider's browser store or closing another service's views.
Re-adding it resumes the same sign-in. Removing an explicitly isolated account
still deletes its native store. Signing out *on the provider website* affects
other services using the shared session, subject to the provider's behavior.

## Verification

Regression tests cover family sharing, reuse of original profile identities,
Misty-account/server isolation, unrelated providers, separate legacy accounts,
directory linking and unlinking, automatic session creation, and connected API
mail accounts. The native-backend test checks that Gmail and Drive receive the
same profile and that removing Drive leaves Gmail open without issuing native
profile deletion.

These tests verify host routing and lifecycle behavior. A live provider login
is still needed to verify each provider's current SSO flow and consent behavior.
