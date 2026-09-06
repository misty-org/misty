# macOS beta releases

The release has three explicit phases: prepare a draft, publish immutable assets for installation checks, then publish the catalog and update feed. A tag alone never deploys the Apps site. Windows, mobile, npm publication, and the Hono migration are outside this pipeline.

## Prerequisites and first setup

Use Node 22, Rust 1.91, GitHub CLI authenticated to `misty-org`, and sibling checkouts named `misty`, `misty-sdk`, `misty-apps`, and `misty-server`. Local macOS builds additionally need Xcode. GitHub builds run natively on `macos-15` (Apple Silicon) and `macos-15-intel` (Intel).

The beta uses `https://dev-api.mistysys.com/v1`. Its existing Go server and named development tunnel must stay online. Do not switch the beta to Hono.

Before the first **promotion**, enable GitHub Pages for `misty-org/misty-apps` with GitHub Actions as its source and set the custom domain to `apps.mistysys.com`. Then create the DNS CNAME `apps` pointing to `misty-org.github.io` and wait for HTTPS to work. A missing initial catalog/feed may return 404; DNS, TLS, or other HTTP failures abort promotion. Draft preparation does not need this public site. These settings were not configured during this preparation. Follow [GitHub's custom-domain setup](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

The `misty` repository already has these Apple secrets: `MACOS_DEVELOPER_ID`, `MACOS_DEVELOPER_ID_CERT_P12`, `MACOS_DEVELOPER_ID_CERT_PASSWORD`, `MACOS_NOTARY_APPLE_ID`, `MACOS_NOTARY_APP_PASSWORD`, and `MACOS_NOTARY_TEAM_ID`. The certificate secret is base64-encoded PKCS#12. Signing and notarization must succeed; the workflow never substitutes an unsigned installer.

Run `npm run beta:keys` only on the release maintainer’s computer. It creates or verifies two separate signing keys, configures the GitHub signing secrets, and updates public trust. Private backups live in `~/.config/misty-release/` with owner-only permissions. Back up that directory securely. On another computer, restore those keys first; the command refuses to replace established trust. Apple signing, app-package signing, and desktop-updater signing are separate systems.

## Prepare

1. Verify and commit SDK changes, then run `npm run sdk:sync` in Misty. It checks the SDK and an isolated archive consumer and refreshes both consumers’ pinned archives.
2. Verify and push the SDK, Apps, and Go server branches. Set their full commit hashes in `release/pins.json`. Set the SDK version, each app version, and minimum supported host version there. Set `previousRelease` to the last published beta after the first release. Published app versions must never be reused for changed bytes.
3. Update the host version together in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`; refresh lockfiles. Update `release/validation.json` to that version with checks unset.
4. Push the verified Misty preparation branch and open its PR. Existing main branches remain unmerged. The preparation branch triggers the draft workflow; after the workflow is merged, `workflow_dispatch` supports other branches.
5. Run `npm run beta:prepare`. It waits for the build at this exact source revision, downloads and verifies the draft, and creates the corresponding SDK draft from the same archive bytes. Use `npm run beta:prepare -- --collect` to collect an already completed draft.

The host draft contains two DMGs, two updater archives and signatures, ten app ZIPs, SDK/contracts archives, `official-app-catalog.json`, the generated Go `catalog.go` overlay, `beta-site.tar.gz`, `latest.json`, a source manifest, checksums, and automated native verification records. No private keys are included. The site archive retains earlier published app versions from `previousRelease`.

## Promote and verify

Run `npm run beta:promote -- assets` only when ready to make the prepared assets public. This publishes the host and SDK releases and dispatches the Apps site deployment using the prepared site archive. It preserves the previous feed and catalog, and retains every archive referenced by the live catalog after checking its checksum, including on the first beta. Wait for that deployment to finish; it does not rebuild packages.

Apply the draft’s exact `catalog.go` overlay to a checkout of the pinned Go server revision, review/commit it, and deploy using the existing Go workflow:

```sh
misty env check dev
misty server up
```

This is a server redeploy, not part of draft preparation. The public `/v1/apps/release` endpoint reports the catalog digest. Feed promotion compares it with the prepared catalog and rejects a mismatch. Keep the catalog deployment commit and manifest together as the deployment record.

Install the actual packaged app on Apple Silicon and Intel. Check sign-in, all ten downloaded apps, Code open/edit/save/reopen and language services, Browser dropdown visibility, Files preview/tree labels, and the Discover panel’s Open/Remove behavior. Use a second beta version to exercise the real desktop update with saved data retained. Test an app update with added permissions, bad checksum/signature, and an interrupted install. Record completed checks and evidence in `release/validation.json`; a successful build is not an interactive installation check.

Commit the verification record, then run `npm run beta:promote -- feeds`. It requires the recorded checks, verifies the deployed Go catalog, and dispatches publication of the prepared catalog and update feed. The site workflow checks that app ZIPs are already reachable with matching hashes before publishing the feed. Merge release workflow PRs before using the normal promotion workflow from the default branch.

## Recovery

- Failed preparation leaves feeds and catalogs unchanged. Fix the failure on the preparation branch. If a draft already contains different assets, use a new beta version; never overwrite a published release.
- An Apple `401: Invalid credentials` stops preparation before compilation. Replace `MACOS_NOTARY_APP_PASSWORD` with a fresh app-specific password for `MACOS_NOTARY_APPLE_ID`, confirm `MACOS_NOTARY_TEAM_ID`, and rerun the failed workflow jobs. Do not put credentials in source files or release notes.
- Failed or interrupted app installation restores the previous installation before retrying. A successfully replaced package retains one previous package under the managed app root for recovery. Package bytes and extracted files are verified before execution.
- Open app tabs block replacement; Code’s unsaved buffers block tab closure until saved. Host updates require saving work and closing app tabs before installation.
- If a published beta is bad, stop offering it and ship a corrected higher beta version. Keep existing assets available; do not downgrade users by rewriting signatures or reusing an old version.

References: [Tauri updater signing and feed format](https://v2.tauri.app/plugin/updater/), [macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/), [GitHub native macOS runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
