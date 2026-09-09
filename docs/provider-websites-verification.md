# Provider websites: local implementation and verification

Date: 2026-09-07. Status: **automatic Browser-tab bug fixed and checked with Instagram's real login page in a signed native test window. Authenticated provider operation in the user's saved session remains pending. No production update or package publication.**

## Existing provider rollout: Messenger, X, Discord, and Outlook

Messenger, X, and Discord now use the shared website view by default on macOS. Outlook already used this view; this pass checks its real Microsoft sign-in flow and adds it to the same lifecycle regression matrix. Gmail, Instagram, and native Misty messaging retain their existing routes. `experience=api` still selects the existing app implementation. Other platforms retain their prior implementation.

Public-page inspection in disposable native windows reached Messenger's login controls, Discord's password/QR login with `/channels/@me` as its return destination, X's current `/i/jf/onboarding/web` login with `/messages` as its return destination, and Microsoft's sign-in page from Outlook. No account credentials were entered. Public login rendering is not proof of authenticated message access, successful sending, or complete history.

The X Google sign-in button exposed an overly narrow provider boundary. X now allows Google's and Apple's sign-in hosts inside its isolated account profile; authenticated message requests remain limited to X/Twitter domains. These options are documented by [X's single sign-on guide](https://help.x.com/en/managing-your-account/sso). Login detection now handles X's new onboarding path, identity-provider pages, Facebook's `login.php`, and Messenger's root login form. Page tools report authentication required instead of treating those forms as message history. Automated sending remains explicitly unavailable until outcome verification exists; users can use the actual provider UI.

The SDK test matrix covers all six providers, tab hide/reveal without recreation, and intentional account replacement. Shared provider contract tests are now included in the host test runner rather than silently excluded by its app-directory list. The final focused run passes 67 tests across seven suites; two native boundary/callback tests and both typechecks also pass.

Public evidence: `/tmp/misty-expand-messenger-public.log`, `/tmp/misty-expand-discord-public.log`, `/tmp/misty-expand-outlook-public.log`. The first X public probe intentionally clicked Google and exposed the boundary failure in `/tmp/misty-expand-x-public.log`; it must not be counted as a passing authenticated check. The rebuilt packages passed native fixture checks for Messenger, Discord, and X in `/tmp/misty-expand-messenger-native.log`, `/tmp/misty-expand-discord-native.log`, and `/tmp/misty-expand-x-native.log`. Each retains the draft through three tab switches, preserves native popup opener and account storage, isolates separate accounts, and restores storage across view recreation. The expanded authentication-popup host suite passes 14 tests, including X Google and Apple popups retaining the originating account. Completed Google/Apple consent remains pending real sign-in. Outlook also passes the same native fixture checks in `/tmp/misty-expand-outlook-native.log`. Final computer-use inspection of X's default Social route shows its actual login page and the Google sign-in iframe loading from `accounts.google.com` after the boundary fix. The public-page run is `/tmp/misty-expand-x-final-public.log`; it does not submit credentials or verify completed consent. Local packages were rebuilt and development-signed, and source catalog artifact metadata refreshed. No production deployment or package publication.

## Workspace tab switches preserve the live page

The global browser visibility manager only recognized the Browser app. When switching from Browser to an Inbox/Social website tab, it could queue a global hide after the provider's own visibility update and leave that live page hidden. The host now uses the same provider website route selection as the installable packages, including API/native view exclusions. Provider tabs count as active browser owners, so switching to them does not globally park their page.

Twenty-four focused tests pass, including three hide/reveal cycles through each app's real shared React component and SDK: the original view stays alive, with no create/close/navigation/reload calls. Host and native-probe TypeScript checks pass. Native checks use disposable fixture pages and verify that an unfinished draft remains in the same view over repeated hide/reveal cycles. Closing a tab, changing its website account, or explicitly pressing Reload retains its existing behavior. This change does not claim full-process restart restoration of an unsent draft.

Evidence: `/tmp/misty-tab-retention-tests.log`, `/tmp/misty-tab-retention-inbox.log`, `/tmp/misty-tab-retention-social.log`.

## Inbox and Social stay in their embedded account views

The Gmail screenshot showed the external-URL validator's protocol error. The provider popup router could send an unadopted `about:blank` setup frame to that validator. It now ignores that frame, and reports unsupported external destinations inside the current app instead of launching another browser.

`Connect mail search` now navigates the selected Inbox webview to provider consent. It ignores a delayed authorization response after the account changes. Google/Microsoft consent can return to an exact callback on the current Misty deployment, with the matching flow state and a ten-minute native lifetime. The allowance is local to the account view, follows its genuine native authentication popups, and is cleared by explicit subsequent navigation. Other origins, paths, providers, duplicate/wrong states, and non-HTTPS callback URLs are rejected. The completion page remains embedded; **Return to mailbox** restores the provider inbox and refreshes API mail accounts without claiming that consent succeeded. Website sign-in and API authorization remain independent.

Provider compatibility recovery retries the current webview. Genuine popups requiring `window.opener` still use a view owned by the same app and account; ordinary navigations and mail consent use the original view. The general Browser app retains its existing external-opening controls.

Verification for this change: 29 focused tests and two native boundary/callback tests pass; host and provider-probe typechecks pass. The signed native Inbox and Social fixtures pass popup opener/account storage, account isolation, draft preparation, and persistence across view recreation. Computer-use inspection of the real Gmail sign-in page showed Inbox controls above Google's native page with no protocol-error banner; its public-page probe completed without any additional destination. Real authenticated consent, account identity, and mail operations remain pending user sign-in.

Evidence: `/tmp/misty-current-provider-tests.log`, `/tmp/misty-current-provider-native.log`, `/tmp/misty-current-gmail-public.log`, `/tmp/misty-current-inbox-native.log`, and `/tmp/misty-current-social-native.log`. These use disposable test profiles, not the user's signed-in session. Both source packages were rebuilt and development-signed, and local catalog artifact metadata was refreshed. No server permission change or publication was needed.

## Automatic Facebook/Browser tabs: actual navigation fix

The second screenshot established that removing Browser's installation dependency did not fix automatic Browser tabs. The native navigation callback was promoting blocked provider navigations to `misty://browser-popup`. Wry 0.55.1 invokes that callback for embedded frames too, without a main-frame discriminator. Instagram's Facebook requests therefore could become Browser tabs. Facebook was also missing from Instagram's allowed authentication domains.

Blocked provider navigations now stay blocked without creating tabs. Facebook is allowed in Instagram's account profile for linked-account sign-in; [Meta documents cross-account login](https://about.fb.com/news/2022/09/accounts-center-facebook-and-instagram/amp/). Genuine provider popups are adopted into the originating Social or Inbox app, retaining the original native webview, opener, provider restrictions, and account profile. Their account selector follows the originating account rather than whichever account another tab selected most recently. Unrelated explicit new-window destinations stay blocked with a message in the current app; they never open an external browser. Blank setup frames are ignored. Transient native handles are consumed after adoption, and authentication URLs are not persisted in popup metadata.

Verification after the fix:

- 35 focused host/RPC/provider/popup/Browser-bridge tests pass; host and provider-probe TypeScript checks pass.
- The native provider-boundary regression passes, including Facebook login/checkpoint URLs and deceptive-domain rejection.
- Signed native Social and Inbox fixtures pass: a blocked external iframe opens no additional destination; a genuine popup stays in its owning app and retains `window.opener` and same-account storage; draft preparation, separate accounts, and storage across view recreation continue to pass.
- Computer-use inspection of the signed native Social package showed Instagram's actual login page beneath Social's account/search controls, with no Browser toolbar. Clicking the real **Log in with Facebook** button reached Facebook's login form in that same provider view. No additional destination event occurred during the public-page run. No credentials were entered.
- Source packages were rebuilt and development-signed. The desktop development process rebuilt with the native change. Source/catalog artifact metadata was refreshed; no new server permission contract was needed.

Evidence logs: `/tmp/misty-provider-popup-final-regression.log`, `/tmp/misty-provider-popup-native-tests.log`, `/tmp/misty-instagram-real-page.log`, `/tmp/misty-instagram-popup-final-native.log`, and `/tmp/misty-inbox-popup-final-native.log`. The real-page inspection used a disposable native verification window, not the user's saved login session. Full sign-in, authenticated messages, and full app restart persistence are still unverified.

## Provider view ownership correction

The user clarified that Instagram should behave as Social's own website view without depending on the Browser app. The host's Browser-installation/package check was removed from provider availability, and Social/Inbox no longer declare `requires_apps: ["browser"]`. The unavailable screen now checks website support and offers retry rather than directing users to install Browser. The shared implementation remains a build-time dependency; native platform support, app permissions, provider-domain restrictions, and isolated account profiles remain enforced.

Fifteen targeted integration/RPC tests pass, including native-backend checks that Social and Inbox create their own provider-restricted views while Browser is absent from both the catalog and installations. No Browser tab is created. The full shared-component Instagram test also confirms there is no Browser toolbar. Host TypeScript checking, both rebuilt app packages, development signing, and catalog validation pass.

The development API now runs `misty-server:provider-independent-20260907`, with the revised app contracts and signed-package metadata. Both the loopback health check and public release endpoint were verified after replacement. The existing development service configuration was preserved again. The dev frontend was sent a catalog reload after the server update. Live clicking and signed-in Instagram behavior were not observed through the UI automation tool.

## Authorized development server update

The user approved updating the running development server after the mismatch below was explained. The development API now runs `misty-server:provider-catalog-20260907`. It was built in `/tmp/misty-provider-catalog-update` from the running server's exact revision, `964aa11f71c4b4f390bdf6e6798bd17c283aea2f`, with only the Social, Inbox, and Browser catalog entries replaced and `requires_apps` serialization/copying added. Unrelated changes in the server checkout were excluded. The container retained its existing environment, mounts, network configuration, and entrypoint. No database migrations were run against the development database.

Both the loopback API and `https://dev-api.mistysys.com/v1/apps/release` return catalog digest `a603c6cd756273af5d7ecfbc35a219d10651c034654a68685164c3462a60c860`. The container is healthy. All three app contracts match the local development catalog, including versions, permissions, dependencies, and host requirements.

Two additional tests passed against a disposable database using the isolated build's HTTP handlers: Social and Inbox reject stale permission consent, preserve existing restricted grants until review, retire old sessions after an accepted update, and issue every current catalog scope in new sessions. The test database was removed afterward. Existing catalog tests also pass. Test output: `/tmp/misty-provider-catalog-permissions.log`. Catalog patch: `.build/provider-preview/server-catalog.patch`. Previous image retained: `misty-server:beta-catalog-964aa11`.

The installed apps still need the normal update review in Discover, followed by reopening Social and Inbox. The UI automation tool cannot attach to the user's unbundled Misty development process, so that review and the real-window Instagram/Gmail/Outlook clicks were not completed. This server update resolves the confirmed contract mismatch; it does not establish authenticated provider functionality.

## Live app recheck after the reported storage error

The user's Social screenshot shows `The App did not declare the storage.read capability.` The local development asset endpoint serves Social and Inbox `1.2.0-beta.1`, permission version 4. Read-only inspection of the compiled catalog in the running `misty-api` container (`misty-server:beta-catalog-964aa11`) confirms that it still offers both apps at `1.1.0-beta.1`, permission version 3:

| App | Running server contract | Consequence for the newer local code |
| --- | --- | --- |
| Social (`chat`) | No `storage.read` / `storage.write`; no Browser scopes | Local storage is denied, matching the screenshot; provider views also lack Browser access. |
| Inbox | Storage scopes present; no `browser.navigate`, `browser.inspect`, or `browser.interact` | Storage can initialize, but the new provider website cannot obtain the required Browser capabilities. This contract failure was verified; a new live Inbox click was not observed. |

The development component loader was constructing a local URL from the app ID even when the catalog loader had rejected the local release as incompatible. This ran new local code under old server grants. The host fix requires the local entry selected by the matching catalog loader; otherwise it retains the server's signed release. Catalog matching now includes required apps and the minimum host version as well as release, permissions, and origins. No grants were expanded or permission checks bypassed.

Current checks: 24 focused host/catalog/loader/SDK integration tests passed, including regressions for both mismatched apps and a matching-contract case. Six app-owned provider contract tests passed. Host TypeScript checking passed. A broad `misty-apps` test invocation did not pass: migrated host-dependent tests lack the host aliases, dependencies, and DOM setup when invoked from that repository directly (119 failed files, 47 passed). This is not a passing full-regression result.

The native UI automation tool could not attach to the running unbundled development app, so the local loader fix has not been confirmed by clicking through that window. Previous signed native probes supplied their own catalog and session scopes; they missed this real-server mismatch and must not be treated as live installation verification.

At the initial recheck the development API was left unchanged because deployment was excluded from the approved plan. The subsequent user-authorized update is recorded above. To finish: complete the normal app update/permission review (and Browser dependency installation), reopen both apps, and verify Social → Instagram and Inbox → Gmail/Outlook with their real server-issued sessions. Real provider sign-in, authenticated mail/message behavior, and full restart persistence remain pending.

## What selecting Instagram does

On macOS 14 or later, Social → Instagram selects the installable Social app in `misty-apps/apps/chat`. It mounts Misty’s shared Browser view at `https://www.instagram.com/direct/inbox/`, beneath Social’s account and search controls. Instagram owns the page and sign-in. Each website account has its own persistent native profile, scoped to the Misty user and deployment. Adding or selecting another account changes the profile; it does not connect the Instagram API.

Search currently finds matching text on the selected account’s visible page. It explicitly reports that other accounts, other Social providers, and complete history are not covered. Native Misty messaging remains available under Misty. An explicit “Existing Social view” action retains the previous implementation.

## Provider report

| Provider | Local implementation | Verification status |
| --- | --- | --- |
| Instagram | Actual DM starting URL; account bar; isolated account profiles; visible-page search/read and draft preparation | Signed native lifecycle/account/popup/draft fixtures pass. Computer-use inspection confirmed Instagram’s real login form with the DM inbox retained as the post-login destination. Real sign-in and authenticated operation remain pending. |
| Gmail | Gmail website; separate website profiles; combined API mail search; email-specific message link when the thread identifier is supported | Signed native lifecycle/account/popup/draft fixtures and API search tests pass. Computer-use inspection confirmed Google’s real Gmail sign-in form. Real login, Gmail message links and full restart persistence remain pending. |
| Outlook | Personal and work/school website choices; separate website profiles; combined API search; message details plus explicit provider-account opening | Work/school navigation reached Microsoft’s actual sign-in form. Personal Outlook’s original inbox deep link stalled; the documented personal sign-in entry now reaches Microsoft’s sign-in form too. Existing website account identifiers are preserved when updating the old starting URL. API search and explicit message-detail fallback pass. Real sign-in and message opening remain pending. |
| Messenger | Shared website structure available as a local preview; existing view remains the default | Website/login verification pending; replacement not enabled by default. |
| X | Shared website structure available as a local preview; existing view remains the default | Website/login verification pending; replacement not enabled by default. |
| Discord | Shared website structure available as a local preview; existing view remains the default | Website/login verification pending; replacement not enabled by default. |
| Misty messaging | Existing native messaging implementation retained | Native/website mount switching and existing Social regressions pass. |

## Checks completed

- Host type checking passes after the app-source migration; provider-probe type checking also passes.
- Latest focused host/provider/Browser integration run: 27 tests passed across six suites after the migration. The moved test files needed the sibling Apps directory added to the test server’s filesystem roots.
- Latest native Browser capability/grant/lifecycle/profile/navigation unit run: 22 tests passed, including explicit support for provider draft typing and same-origin requests.
- Latest app-owned provider contract suite: 6 tests passed, including preservation of an existing Outlook website account when its starting URL changes.
- Earlier broad regression run: 181 host/UI tests passed across Browser, app integration, Inbox, Discover, icon consistency and device execution. The account/click-flow component tests substitute the native rendering component; they do not prove provider compatibility.
- Earlier broad app regression run: 39 `misty-apps` tests passed, including provider routes, concurrent account-record persistence, combined mail search, per-account failures, scope/revision checks, draft/send separation and reauthentication.
- 55 SDK tests and SDK type checking/build pass in an isolated checkout containing the provider change. The initial SDK checkout contained unrelated in-progress changes, so vendor packages were built from that isolated snapshot. The packed SDK check also passed during the sync.
- 22 native Browser unit tests pass. They cover profile identifiers, navigation boundaries, stale inspection references and grants, alongside existing native Browser logic.
- Six DOM/request tests pass: inspected-node identity, stale/replaced controls, password filtering, draft retention without form submission, same-origin GET restrictions and bounded responses without response headers.
- Targeted backend Browser, mail, Inbox and toolbox regressions pass. Existing API-backed tools remain available. `browser.type` executes on the device and reports preparation, not delivery.
- Social, Inbox and Browser build as SDK-only downloaded packages. Local development signatures and catalog validation pass.
- Final signed Browser, Social and Inbox native runs all pass against the rebuilt candidate. Seven package-factory tests also pass, including mixed helper/default exports with independent state for each mount.
- The signed native Social and Inbox verification harnesses pass. Their controlled fixtures are confined to disposable installations and website profiles.
- The native Browser regression passed after increasing the cold-start timeout on the unlocked Mac: signed loading, inspection/click, stale-document and password filtering, overlays, visibility, popups, downloads, profile isolation/persistence, cleanup and tamper repair.
- A full shared-component integration test exposed and now covers provider navigation-command ownership: Social and Inbox can register Browser navigation with `browser.navigate`; provider mode does not register annotation commands.

## Checks still pending

The Mac is unlocked and the native Browser regression passed with the extended cold-start timeout. Signed native Social and Inbox controlled fixtures pass: shared native mount, draft retention, original-popup adoption with opener and same-account storage, account isolation, and persistence across view recreation. The corrected native authentication-popup path retains WebKit’s original target configuration/data store and adopts the original view into the originating Social or Inbox app. **Opener retention and account storage continuity passed native Social and Inbox runs.** The preview uses the same macOS title-bar coordinate system as Misty; its native page is positioned beneath the account bar. A same-origin `about:blank` opener/storage fixture passed for both installable apps. These fixtures do not prove a provider’s real OAuth handshake.

Real-login checks require the user to sign in to Gmail, Outlook and Instagram in the native Browser/provider views. Verify two accounts, account switching, full app quit/relaunch, internal navigation, external links, authentication popups, sign-out/reauthentication and reconnect behavior. Do not infer success from the unit fixtures. Provider identity must also be checked when opening real mail search results.

Full-history website adapters and automated social sending remain explicitly unavailable. No undocumented provider endpoint is enabled. Sending stays in the actual website until an adapter can verify delivery; a successful click or prepared text is not treated as a sent message. Existing authorized API mail actions remain accessible through “Existing mailbox.”

## Local preview and reproduction

The preview lives under `.build/provider-preview`; generated packages are development-signed. The running development server now advertises matching contracts as recorded above; the public package host was not updated. Local app artifacts require the configured development checkout. The three preview package directories are Social (`chat`), Inbox and Browser, version `1.2.0-beta.1`.

From the sibling `misty` checkout, on an unlocked Mac:

```sh
MISTY_SDK_PROBE_TIMEOUT_SECONDS=180 node scripts/sdk-package-probe-run.mjs browser ../misty-apps/.build/provider-preview
MISTY_SDK_PROBE_TIMEOUT_SECONDS=180 node scripts/sdk-package-probe-run.mjs chat ../misty-apps/.build/provider-preview
MISTY_SDK_PROBE_TIMEOUT_SECONDS=180 MISTY_SDK_PROBE_PROVIDER=1 node scripts/sdk-package-probe-run.mjs inbox ../misty-apps/.build/provider-preview
```

The provider probe checks signed loading, the app-owned provider mount, device-local draft preparation, popup adoption/opener storage, account isolation and persistence across native view recreation using controlled content. It does not test real login or full process restart. It neither publishes packages nor uses saved user accounts.

Provider routes such as `/apps/social?provider=messenger` open their embedded websites on macOS; `x` and `discord` use the same structure. Both Social and Inbox accept `experience=api` to select their preserved existing app implementation explicitly.

Provider website availability requires native macOS webview and isolated-profile support, independently of the Browser app installation. Earlier macOS versions receive an explicit unavailable state because they cannot provide persistent isolated website stores. Windows and mobile retain their existing app implementations; only macOS was compiled for native verification here.

The Outlook navigation boundary includes `outlook.cloud.microsoft`, consistent with [Microsoft’s domain transition documentation](https://learn.microsoft.com/en-us/microsoft-365/enterprise/cloud-microsoft-domain?view=o365-worldwide). The personal sign-in entry is the URL linked by [Microsoft Support](https://support.microsoft.com/en-US/accounts-billing/manage/how-to-sign-in-to-outlook-com); the prior `/mail/0/inbox` entry stalled on the loading splash in the native preview.

Public-site checks (no sign-in): `MISTY_SDK_PROBE_WEBSITE=instagram` with `chat`, or `MISTY_SDK_PROBE_WEBSITE=google` / `microsoft` with `MISTY_SDK_PROBE_PROVIDER=1` and `inbox`. The page remains visible briefly for computer-use inspection, then the disposable preview closes. Authentication URL query parameters are omitted from the final test report.

## Account-first integration directory (September 7, 2026)

On macOS, the installable Social and Inbox root routes now open an integrations list. Available websites are Instagram, Messenger, X and Discord in Social, and Gmail and Outlook in Inbox. Misty messaging remains directly available. Other platforms retain their existing implementation. This change does not add Slack, Teams, Telegram, or other unimplemented providers.

Opening a provider creates or resumes its isolated website profile inside the owning app. Historical `default-*` profiles are setup records, not evidence of an account. Website shortcuts appear only after the user chooses **I’ve signed in**; that is a user confirmation, not an automated verification of provider authentication. Existing API-connected mail accounts are included independently. **Hide** removes a shortcut without deleting the account or its website session; **Show in sidebar** restores it. Each provider appears once even with multiple accounts.

Confirmation and visibility are stored separately from website profiles so updates from another mounted tab cannot overwrite them. Notifications contain no account data; each instance rereads its own SDK storage. The host retains the last account/Space-scoped provider menu when its view closes or the app restarts, and a mounted app refreshes it from its account data. Only the new account-aware menu is cached. Social and Inbox titles open the integrations directory; provider child links open their own embedded views.

Gmail and Outlook use the existing user-supplied brand assets in the directory, toolbar, downloaded-app navigation, and provider tabs, tinted for the current theme. Root app icons keep their app identity.

Validation: 86 tests across eight provider, shared Browser, navigation, tab-icon and disclosure suites passed. Host TypeScript and native probe TypeScript passed. Signed macOS directory-to-provider checks passed for Inbox/Gmail and Social/Instagram, including no browser creation before a provider is selected, three tab hide/reveal cycles without reload or losing an in-page draft, isolated account views, same-account popup opener preservation, and persistence across native view recreation. These lifecycle checks use synthetic content in disposable profiles. Existing real-login and full-process authenticated persistence checks remain pending; no messages were sent and no sign-in credentials were entered. Local package builds only; nothing published or deployed.

## Curated major-provider additions — September 7, 2026

Added the four names the user selected: **Slack** and **Microsoft Teams** in Social, **iCloud Mail** and **Yahoo Mail** in Inbox. Their logos share the existing provider icon path for the directory, navbar, toolbar, and tabs. Telegram and WhatsApp were not added.

The shared public SDK registry owns each provider’s app, starting URL, website domains and authentication domains; the native host uses its generated snapshot. Provider account isolation, restored views, setup confirmation and hidden shortcuts use the existing implementation. Website-only providers do not expose unsupported legacy/API controls. iCloud/Yahoo’s notice identifies Gmail and Outlook as the providers covered by Misty’s combined API mail search. Provider tools reject the new sign-in and public mail welcome pages as unauthenticated; complete history and automated sending remain unavailable.

Official starting-point references: [Slack browser sign-in](https://slack.com/help/articles/212681477-Sign-in-to-Slack), [Teams on the web](https://support.microsoft.com/en-us/teams/meetings/use-microsoft-teams-on-the-web), [Mail on iCloud.com](https://support.apple.com/en-ca/guide/icloud/mm6b1a17e3/icloud), and [Yahoo sign-in](https://help.yahoo.com/kb/new-mail-for-desktop/sign-yahoo-sln3407.html).

| Provider | Actual macOS page observed without credentials | Verification limit |
| --- | --- | --- |
| Slack | `app.slack.com/workspace-signin`, with workspace URL field | Workspace selection, organization SSO and signed-in messaging remain pending. |
| Microsoft Teams | Microsoft’s `login.microsoftonline.com` account sign-in | Signed-in chat, organization policies, calls and meetings remain pending. |
| iCloud Mail | Apple’s iCloud Mail welcome page with Sign In | Apple Account sign-in, 2FA and mailbox access remain pending. |
| Yahoo Mail | Yahoo Mail welcome page with Sign in | Yahoo sign-in, account recovery and mailbox access remain pending. |

All four public-page probes completed without opening an additional destination. A separate Yahoo sign-in-button probe did not finish loading the verification host, so it provides no evidence about that button or authentication. The original public-page check passed; this incomplete attempt is not counted as a successful login check.

Validation: 70 focused host/app tests passed, including each new provider’s real shared component through three tab hide/reveal cycles, separate account identities, directory choices, matching icons and unavailable API controls. Six SDK provider tests and two native provider-boundary tests passed. Host and probe TypeScript checks passed. The signed Slack and Yahoo Mail packages also passed the native synthetic lifecycle fixture (draft retention, popup opener/profile continuity, account switching and storage persistence across view recreation). Native fixture results concern disposable synthetic content, not provider authentication. Local packages only; no publication or deployment.
