# Apple release checklist

Misty's tracked Apple target is a universal iPhone and iPad app with an iOS 15 minimum. Use this checklist for the external work that cannot be committed to the repository.

## Signing and push

- Select the production Apple Developer team and distribution profile in Xcode.
- Create or select the production APNs key for `com.misty.mobile`.
- Configure the production service to accept signed device registrations and send count-only payloads that navigate to Activity.
- Verify sandbox and production token registration, rotation, deletion on sign-out, and deletion after device revocation.
- Confirm that no notification contains a sender, Space, message, task, filename, or agent output.

## App Store Connect

- Supply the product name, subtitle, description, keywords, support URL, privacy-policy URL, category, age rating, and copyright.
- Upload current iPhone and iPad screenshots in every required App Store Connect size.
- Supply a review account with representative Spaces and an online paired desktop, without production customer data.
- Attach the privacy-manifest answers and export-compliance response to the submitted build.

## Review notes

Misty uses one workspace surface at a time on iPhone and iPad. Downloadable extensions and the extension Store are not present in the iOS app. Code, Terminal, Transfers, and unsupported desktop file operations can ask an explicitly paired, currently online Misty desktop to open an allowlisted route. The request is encrypted, account-bound, expires, and is never queued for an offline computer. Misty's embedded Browser uses `WKWebView`; downloaded files remain in application-controlled storage until the user exports them through an Apple document flow. Push notification text is deliberately generic and opens Activity.

## TestFlight release gate

- Test at least one supported iPhone and one iPad in portrait and landscape.
- Test iPad multitasking widths, software and hardware keyboards, safe areas, rotation, large text, VoiceOver, Switch Control, reduced motion, and offline launch.
- Test sign-in, sign-out purge, notification denial, deep links, Browser background/resume, document import/export, desktop handoff failure, memory pressure, and crash recovery.
- Archive with no private or deprecated API findings and complete App Store validation before submission.
