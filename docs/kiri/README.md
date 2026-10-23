# Kiri

Kiri (霧, "mist") is Misty's native web platform layer. The OS webviews (WKWebView, WebView2,
WebKitGTK) render pages but do not supply the browser layer on top: permission prompts,
WebAuthn, device APIs, extension APIs. Kiri supplies that layer from Rust, one capability at a
time. It never renders anything and never replaces the engine.

The full internals (the four ways in, how a page call flows, passkeys, status and open items)
are in [`kiri/README.md`](../../kiri/README.md), next to the code in `kiri/`.

## Extensions

Kiri's WebExtension layer is what runs browser extensions in Misty. The current direction
(Chrome MV3 extensions on every platform; ad blocking and passwords are extensions, not native
features) and what is left are in [extensions-sync-plan.md](../plans/extensions-sync-plan.md).
How the interface works is in `src/features/extensions/DESIGN.md`. The Windows checklist is
[extensions-windows-test.md](../plans/extensions-windows-test.md).

When the extension plan ships, its facts move into this folder.
