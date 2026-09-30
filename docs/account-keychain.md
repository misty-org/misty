# Desktop account credentials on macOS

Misty's server still issues `misty_session` and `misty_refresh` JWT cookies. Rust
owns the live HTTP cookie jar; website WebKit stores are separate. Saved Misty
account cookies now use the macOS login Keychain through
`misty_credential_store::account`. Other credential APIs and other platforms keep
their existing storage behavior.

Each Keychain item uses service `com.misty.auth.cookies.v1` and an account key
derived from the deployment origin, account ID, and desktop profile. No JWT is
returned to renderer JavaScript or printed in diagnostics.

## Prompt policy

- The first restore for an account can authorize Keychain access. Both successful
  reads and failures are cached for the process lifetime. Canceling or denying
  access cannot cause another prompt on each startup retry or polling request.
- Ordinary API requests use the in-memory jar. Unchanged saves are skipped.
- Creation, refresh-token writes, verification reads, and deletion use
  `kSecUseAuthenticationUIFail`. They fail instead of opening authorization UI.
  This is a per-operation setting; Misty does not toggle global Keychain UI.
- An access failure explains how to unlock/authorize the login keychain and
  restart Misty. There is no automatic plaintext fallback or authorization loop.
- A new explicit sign-in can replace the cached failure if its noninteractive
  save succeeds. Account switching does not discard the process cache.

Credential operations run off the UI thread. On the desktop Tokio runtime they
use `block_in_place`, retaining the account-change barrier while allowing other
runtime work to proceed during authorization.

## Existing logins

On first restore, Keychain is authoritative if an item already exists. Otherwise,
the old account file under `~/.misty/.auth/` is copied to Keychain. The file is
removed only after a successful write and matching read-back. Failed migration
preserves the file and returns an error. Signing in also removes a stale legacy
file after verifying the new Keychain value. Forgetting an account clears both
stores; failures are reported rather than claiming the account was removed.

## Verification

Run the deterministic denial, migration, rotation, account-isolation, and deletion
tests with:

```sh
cargo test --manifest-path src-tauri/vendor/misty-credential-store/Cargo.toml --lib
```

An opt-in macOS test creates one disposable item and uses fresh subprocesses to
verify persistence, rotation, and deletion. Every operation forbids prompts and
the test does not read any real saved login:

```sh
cargo test --manifest-path src-tauri/vendor/misty-credential-store/Cargo.toml --lib account::macos::tests::keychain_persists_across_processes_without_prompts -- --ignored
```

Before release, verify the packaged app using its real signing identity: migrate
an existing login, quit/relaunch, refresh an expired access token, switch accounts,
remove an account, deny an initial access request, and upgrade from the previous
signed build. Ad-hoc development rebuilds can change the code identity trusted by
Keychain and may need authorization on the next launch. Do not broaden the item's
access list to all applications to avoid that authorization. The process cache
and noninteractive writes prevent repeated prompts during the same run.
