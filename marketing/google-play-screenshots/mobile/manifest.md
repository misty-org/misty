# Google Play Screenshot Manifest

Generated for Android readiness on 2026-07-09.

Google Play allows up to 8 screenshots for each supported device type. For phone screenshots, the current requirements are JPEG or 24-bit PNG without alpha, minimum 320px, maximum 3840px, and the maximum side cannot be more than twice the minimum side. For apps, Google recommends at least four screenshots at minimum 1080px resolution in 9:16 portrait or 16:9 landscape. Source: https://support.google.com/googleplay/android-developer/answer/9866151

This set targets phone portrait screenshots at 1080 x 1920.

## Source Captures

Raw captures are stored in `raw/phone` and must come from the actual Android emulator app UI.

| Slot | Raw source | Screen | Final copy | Intended Play slot |
| --- | --- | --- | --- | --- |
| 1 | `raw/phone/00-welcome.png` | First-launch welcome | Welcome to Misty | Phone screenshot 1 |
| 2 | `raw/phone/01-files.png` | Files | Browse files anywhere | Phone screenshot 2 |
| 3 | `raw/phone/02-remotes.png` | Remotes/provider setup | Connect storage you use | Phone screenshot 3 |
| 4 | `raw/phone/03-transfers.png` | Transfers | Track every transfer | Phone screenshot 4 |
| 5 | `raw/phone/04-settings.png` | Settings/security/account management | Control privacy settings | Phone screenshot 5 |
| 6 | `raw/phone/05-account.png` | Account sign-in/account state | Sign in to Misty | Phone screenshot 6 |

## Final Exports

Final upload-ready exports are stored in `final/phone-1080x1920/en-US`. All six are 1080 x 1920 24-bit RGB PNGs without alpha.

## Butterkit Working Set

Butterkit MCP document: `untitled--7290922020754050731`.

The document contains six 1080 x 1920 artboards with the final compositions attached. Butterkit-rendered working exports are preserved in `butterkit-export`; they retain Butterkit's watermark and are not submission assets. Use only the no-watermark files in `final/phone-1080x1920/en-US` for Google Play.

The welcome source was captured from the running API 36 emulator WebView debugging surface after Android's outer emulator compositor returned a blank frame. It is the actual packaged app UI, not a mockup.
