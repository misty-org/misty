# Misty Mobile App Store Screenshot Manifest

Generated for the iOS readiness pass on 2026-07-09.

Apple's current screenshot specification accepts 1320 x 2868 PNG portrait assets for the 6.9-inch iPhone display class. The 6.5-inch iPhone display class accepts 1242 x 2688 PNG portrait assets and is only required if 6.9-inch screenshots are not provided. Source: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/

## Source Captures

All accepted raw captures came from the actual Misty iOS simulator app on iPhone 17, iOS 26.5. Raw capture size is 1206 x 2622.

| Slot | Raw source | Screen | Intended safe copy | Notes |
| --- | --- | --- | --- | --- |
| 1 | `raw/accepted/01-files.png` | Files | Browse files without losing context | Clean Files screen from the live app. |
| 2 | `raw/accepted/02-remotes.png` | Remotes/provider setup | Connect storage you already use | Clean provider setup state from the live app. |
| 3 | `raw/accepted/03-transfers.png` | Transfers | Track uploads, downloads, and sync | Clean mobile Transfers screen from the live app. |
| 4 | `raw/accepted/04-settings-account.png` | Settings/account | Keep account and privacy controls close | Clean settings/account state from the live app. |
| 5 | `raw/accepted/05-account-setup.png` | Account setup/onboarding | Create your Misty login on iPhone | Clean account setup state from the live app after mobile overflow fixes. |

## Exports

`final/iphone-6-9/en-US/fallback-direct-resize` contains direct-resized PNGs at 1320 x 2868 for App Store Connect compatibility.

`final/iphone-6-9/en-US/designed-fallback` contains locally designed store-page-ready PNGs at 1320 x 2868. These use the actual simulator captures as the device screens, with consistent Misty framing, copy, background, and device treatment. Rebuild them with:

`final/iphone-6-5/en-US/fallback-direct-resize` contains optional direct-resized PNGs at 1242 x 2688 for the 6.5-inch iPhone display class.

`final/iphone-6-5/en-US/designed-fallback` contains optional store-page-ready PNGs at 1242 x 2688 derived from the same actual simulator captures and local designs.

```sh
npm run screenshots:mobile:design
```

The designed fallback exports are not Butterkit MCP exports. Butterkit MCP was initially unreachable, then became reachable after the accepted raw captures were staged. Direct Butterkit exports were produced, but they include a `Made with ButterKit` watermark and generic Butterkit template headline copy, so they are quarantined in `final/iphone-6-9/en-US/butterkit-watermarked-draft`; do not upload those drafts to App Store Connect. Stage the accepted raw captures into Butterkit's MCP import folder with:

```sh
npm run screenshots:mobile:stage-butterkit
```

After mobile UI approval, use those staged captures to export a final no-watermark screenshot set. If Butterkit uses a custom Agent Import Folder, run the staging command with `BUTTERKIT_MCP_ASSETS_DIR=/path/to/folder`.

## Butterkit Design Direction

Use a restrained Misty treatment:

| Slot | Composition direction |
| --- | --- |
| 1 | Lead with Files. Device centered, warm Misty yellow header, copy: "Browse files without losing context". |
| 2 | Provider setup. Same frame and background, copy: "Connect storage you already use". |
| 3 | Transfers. Same frame and background, copy: "Track uploads, downloads, and sync". |
| 4 | Settings/account. Same frame and background, copy: "Control account and privacy". |
| 5 | Account setup. Same frame and background, copy: "Create your Misty login on iPhone". |

Keep all claims functional and verifiable. Do not mention prices, subscriptions, external purchase paths, upgrades, or unsupported automation.
