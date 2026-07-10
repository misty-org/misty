# Google Play Review Notes Draft

Misty is a file browsing and storage companion/client for Android. Reviewers should use the supplied demo account to inspect account state, provider setup, file browsing, transfer history, and settings.

The Android app does not include in-app purchases, external purchase prompts, pricing, subscription calls to action, or extension/plugin functionality.

Provider authorization may open the system browser and return through the `misty` URL scheme. The only user-relevant Android permission is internet access for network-backed account, provider, and file workflows; the package does not request storage or biometric access.

## Reviewer Test Path

1. Launch Misty on Android.
2. Sign in with the reviewer demo account.
3. Open Files and browse the on-device files view.
4. Open Remotes and inspect provider setup.
5. Open Transfers and review transfer activity states.
6. Open Account and Settings to verify sign-out, account state, privacy controls, and device settings.

## Demo Credentials

Username/email: supply in Play Console before submission.

Password: supply in Play Console before submission.

Before submission, confirm the production account API is healthy and validate these credentials in the release build. The endpoint returned Cloudflare 502 during the final local Android QA pass.

## Provider Testing

If a provider requires OAuth, use a reviewer-safe provider account and return to Misty through the registered `misty` URL scheme. If provider credentials are not supplied, reviewers can still inspect the provider setup flow and account/settings surfaces.
