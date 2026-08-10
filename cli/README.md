# misty-cli

`misty-cli` is the local developer and release interface for the Misty desktop
application, standalone file manager, and server. GitHub Actions runs repository-native checks on Ubuntu;
platform builds and releases run through this CLI on the developer machines
that will ship the artifacts.

## Install

```bash
rustup target add x86_64-apple-darwin # on Apple Silicon Macs
cargo install cargo-cyclonedx --version 0.5.9 --locked
cargo install --path ~/misty-org/misty-cli --locked --force
misty-cli configure --workspace ~/misty-org
misty-cli doctor
```

Configuration is written to the platform configuration directory. Existing
shell variables take precedence over the ignored `~/misty-org/misty-cli/.env`
file. GitHub authentication comes from `gh auth`; macOS notarization should use
an Apple Keychain notary profile.

## Common commands

```bash
misty-cli check all
misty-cli file-manager
misty-cli desktop dev --profile owner
misty-cli desktop build
misty-cli server up --detach
misty-cli server url
misty-cli server logs
misty-cli server image build --tag misty-server:local
misty-cli server worker generate-secrets --target production
misty-cli server worker deploy --target production --dry-run
```

`misty-cli file-manager` opens the standalone file manager from the
`misty-file-manager` checkout. The npm workspace commands used to start Vite and
Tauri are implementation details of that repository.

The server commands always select `misty-server/compose.dev.yml` with
`misty-server/.env.dev`. Detached startup prints the temporary Cloudflare API
URL; `misty-cli server url` prints it again for use by the desktop frontend or
another local client. To rebuild from a completely fresh local database:

```bash
misty-cli server down --volumes
misty-cli server up --detach
```

Desktop releases are deliberately staged:

```bash
misty-cli release start 0.2.0
misty-cli release build 0.2.0
misty-cli release upload 0.2.0
misty-cli release verify 0.2.0
misty-cli release publish 0.2.0
```

Releases include both desktop platforms by default. For a platform-only
release, lock that intent at the start:

```bash
misty-cli release start 0.2.0 --no-windows # macOS only
misty-cli release start 0.2.0 --no-macos   # Windows only
```

Later build, upload, verify, and publish stages accept only the platforms
recorded at release start. A release cannot exclude both platforms.

The release manifest records both the application source commit and CLI commit.
Mac and Windows uploads are rejected if either checkout differs or is dirty.
Draft releases temporarily contain build manifests, signatures, SBOMs, notices,
and verification reports. `release publish` verifies that complete draft, removes
the internal assets, re-downloads and verifies the final public set, and only
then publishes. The public release contains one installer per selected platform,
the signed Tauri updater payloads, and `latest.json`. Updater signatures are
cryptographically checked against Misty's configured public key before their
contents are embedded in `latest.json`.

## Documentation website

The comprehensive command reference lives in [`docs/`](docs/). Run it locally
with:

```bash
cd ~/misty-org/misty-cli/docs
npm ci
npm run dev
```
