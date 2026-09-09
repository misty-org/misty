# Provider app ownership

`apps/chat/index.tsx` and `apps/inbox/index.tsx` are the downloaded desktop app entry points. Provider routing, account controls, persistence metadata, search, mail results and provider-neutral actions belong here in `misty-apps`.

The host build binds `@misty/browser-view` to the SDK-only shared Browser component. Browser and both provider apps therefore reuse the same lifecycle, geometry, overlays and controls. This is a build-time binding, not a host component mounted as a built-in Social or Inbox app. The package boundary still rejects native/host imports. The two legacy bindings preserve the previous SDK app implementations for explicit fallback and other platforms.

Social and Inbox own their native website views and account profiles. They do not require the Browser app to be installed or present in the catalog. Availability checks the native platform and isolated-profile support; provider mode renders the website inside its owning app without Browser's address bar or toolbar.

Provider sign-in popups remain in the originating app with the originating account selected. Host-only metadata transfers the native popup handle and profile; transient authorization URLs are never persisted. Blocked frame navigations cannot create tabs. Only explicit website popup requests can open another view.

Browser SDK handles are opaque and belong to one app mount. Website cookies and credentials stay in native WebKit profiles; saved app metadata contains account labels/IDs and mail-connection associations only. Native profiles include deployment, Misty account, app, provider and website-account identity. Website sign-in is independent of API authorization.

`createProviderTools` exposes provider-independent read/draft/inbox/send operations. Visible-page reading and draft preparation use shared browser primitives; known login routes report reauthentication. Complete-history inbox adapters and automatic sends remain unavailable until verified. The SDK's bounded same-origin GET bridge runs only on the Mac, and there is no server cookie transfer or arbitrary-script SDK method.

See [the verification report](../../docs/provider-websites-verification.md) for completed checks, local preview commands and remaining real-login/native checks.
