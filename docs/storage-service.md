# Embedded cloud storage service

Misty builds the pinned source in `service/` as `libmisty_service` and calls it directly from Rust. There is no loopback HTTP server or separately managed storage process.

## Development

```sh
npm run service:archive
MISTY_SERVICE_GO_LIB_DIR=src-tauri/target/misty-service/host \
  cargo check --manifest-path src-tauri/Cargo.toml --features embedded-storage-go
```

`npm run tauri:desktop` performs the archive build automatically.

## OAuth applications

Advanced onboarding accepts user-provided credentials. Misty-owned defaults can be supplied at build/runtime with:

- `MISTY_GOOGLE_DRIVE_CLIENT_ID` and `MISTY_GOOGLE_DRIVE_CLIENT_SECRET`
- `MISTY_ONEDRIVE_CLIENT_ID` and `MISTY_ONEDRIVE_CLIENT_SECRET`
- `MISTY_DROPBOX_CLIENT_ID` and `MISTY_DROPBOX_CLIENT_SECRET`

Google Drive requires either Misty's configured client ID or a client ID entered under Advanced; Misty does not fall back to a shared upstream client.

## Operation policy

- Supported provider types are `drive`, `onedrive`, and `dropbox` only.
- At most four storage jobs may run globally and at most two against one connection.
- Each operation uses one attempt. Failed and cancelled jobs are terminal until the user explicitly starts or retries an operation.
- Rust cancellation maps directly to the embedded engine's `job/stop` call.
- Completed job metadata is bounded to prevent unbounded process memory growth.
