# Device control

The desktop Control pill replaces Sync in the existing top row. The traffic-light inset uses the same workspace background as the tab strip, rather than exposing the native window's page-colored resize background. It does not introduce transparency to the desktop wallpaper.

The panel lists the account's enrolled browser-sync devices, including offline devices. Presence comes from authenticated WebSocket connections and their server heartbeat expiry, not an unrelated device registry or last-login timestamp. A disconnected observer reports unknown remote connection state. Revoked devices are omitted.

Switch requests are account-owned and delivered in the device roster. A connected, capable target with Full sync enabled signs its own activation. The panel waits for the active-device record before showing success. Requests expire after 30 seconds; the server consumes delayed or superseded signed requests without activating them, preserving device counter ordering. Existing local activation remains supported. The Control pill stays reachable above the nonmodal sleep screen.

Full sync is a server-persisted device preference. Turning it off preserves independent local browsing while leaving the WebSocket connection and encrypted-log catch-up running. Workspace publication, renderer projection, website-state capture/import, and cloud session-storage injection pause. Turning it on rejoins the shared workspace. Devices must advertise support before the controls become available; older clients cannot be remotely opted out. The server also rejects publication from devices whose policy is off. Pending operations retain the previous confirmed toggle value and show a status announcement.

Upload/download rates sample this device's native WebSocket application-byte counters while the panel is open. Counters cover successful outgoing and incoming text payloads, remain cumulative across reconnects, and reset with the account session. They exclude website downloads, HTTP transfers, WebSocket framing, TLS, and ping/pong overhead. A first or reset sample displays a dash rather than invented bandwidth.

## Rollout and evidence

Deploy the sibling `misty-server` change with migration `20270215120000_browser_sync_controls.sql`, then rebuild/restart native clients. The additive roster fields remain compatible with old clients. A server rollback retains preference columns and request records. Changes have not been deployed by this task.

Validation includes 48 focused UI/controller tests, the Rust sync suite (66 tests), native Rust test compilation on macOS, TypeScript checking, PostgreSQL account/policy/expiry tests, and a real WebSocket request/signature/confirmation integration test. UI captures under `.impeccable/review/device-control/` use simulated devices; the bounded visual review accepted the pending-state correction. Packaged macOS/Windows titlebar behavior and a handoff between two real desktop installations remain unverified.
