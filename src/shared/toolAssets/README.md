# Shared website tools

Browser, Chat, and Inbox are built-in features under `src/features`. Their shared provider routing, account controls, and website components live here and compile with Misty. `@misty/browser-view` resolves to the built-in browser component.

Provider sign-in popups remain in the originating app with the originating account selected. Host-only metadata transfers the native popup handle and profile; transient authorization URLs are never persisted. Blocked frame navigations cannot create tabs. Only explicit website popup requests can open another view.

Browser SDK handles are opaque and belong to one app mount. Website cookies and credentials stay in native WebKit profiles; saved app metadata contains account labels/IDs and mail-connection associations only. Default sessions share a provider-family profile across apps, scoped to the deployment and Misty account. Explicit and legacy separate accounts retain their original app/provider/account profile. Removing a default integration unlinks it without deleting the shared sign-in. Website sign-in is independent of API authorization. See [shared provider accounts](../../../docs/implementation/shared-provider-accounts.md).

`createProviderTools` exposes provider-independent read/draft/inbox/send operations. Visible-page reading and draft preparation use shared browser primitives; known login routes report reauthentication. Complete-history inbox adapters and automatic sends remain unavailable until verified. The SDK's bounded same-origin GET bridge runs only on the Mac, and there is no server cookie transfer or arbitrary-script SDK method.

See [the verification report](../../../docs/tools/provider-websites-verification.md) for completed checks, local preview commands and remaining real-login/native checks.
