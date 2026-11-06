# Native browser sync core

Records and keys for Misty's sync, native only: secrets never reach a web renderer.
[docs/sync/README.md](../../../docs/sync/README.md) is the design.

- `local.rs`: each account's encrypted record store, which works with no vault and no account.
- `vault/`: seals records (`keys`, `codec`), exchanges them with the server (`exchange`, `client`)
  and keeps that going in the background (`link`).
- `document/`: what a record holds. Stored kind and field names never change; `renderer` maps them
  to the renderer's names.
- `secure_store.rs`: the keys kept under the OS keychain's protection.
- `recovery.rs`: the renderer's workspace recovery, sealed for this computer.
- `transport.rs`: the account's HTTP client (`SessionAuth` lends it the session) and the device
  channel's socket.

From the repository root:

```sh
cargo test --manifest-path src-tauri/crates/browser-sync/Cargo.toml
```

`tests/vault_live.rs` runs real sessions against a real server. The server's contract test
`misty-server/test/contract/http/api/sync_vaults_rust_test.go` drives it; run alone, it does nothing.
