# App Review Notes Draft

Misty is a file browsing and storage companion/client for iPhone. Reviewers should use the supplied demo account to inspect account state, provider setup, file browsing, transfer history, and settings.

The iOS app does not include in-app purchases, external purchase prompts, pricing, subscription calls to action, or extension/plugin functionality.

Local network access is used for Misty's local secure runtime services on the device to browse and transfer files. Provider authorization may open the system browser and return through the `misty` URL scheme.

## Reviewer Test Path

1. Launch Misty on iPhone.
2. Sign in with the reviewer demo account.
3. Open Files and browse the on-device files view.
4. Open Remotes and inspect provider setup.
5. Open Transfers and review transfer activity states.
6. Open Account and Settings to verify sign-out, account state, privacy controls, and device settings.

## Demo Credentials

Username/email: supply in App Store Connect before submission.

Password: supply in App Store Connect before submission.

## Notes For Provider Testing

If a provider requires OAuth, use a reviewer-safe provider account and return to Misty through the registered `misty` URL scheme. If provider credentials are not supplied, reviewers can still inspect the provider setup flow and account/settings surfaces.
