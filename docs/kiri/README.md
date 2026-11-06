# Kiri

Kiri (霧, "mist") is Misty's native web platform layer. The OS webviews (WKWebView, WebView2,
WebKitGTK) render pages but do not supply the browser layer on top: permission prompts,
WebAuthn, device APIs, extension APIs. Kiri supplies that layer from Rust, one capability at a
time. It never renders anything and never replaces the engine.

The full internals (the four ways in, how a page call flows, passkeys, status and open items)
are in [`kiri/README.md`](../../kiri/README.md), next to the code in `kiri/`.

## Extensions

Kiri's WebExtension layer is what runs browser extensions in Misty: Chrome MV3 extensions on every
platform, and ad blocking and password managers are extensions, not native features. How the
interface works is in `src/features/extensions/DESIGN.md`. What is left is trying real extensions in
the app on each platform; the Windows checklist is
[extensions-windows-test.md](../plans/extensions-windows-test.md). The live intake test
(`windows_limited_apis_for_chrome_store_extensions`, run with `--ignored`) shows which APIs WebView2
doesn't offer.
