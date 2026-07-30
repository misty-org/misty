# misty-cli

`misty-cli` is the local developer and release interface for the Misty desktop
application and server. GitHub Actions runs repository-native checks on Ubuntu;
platform builds and releases run through this CLI on the developer machines
that will ship the artifacts.

## Install

```bash
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
misty-cli desktop dev --profile owner
misty-cli desktop build
misty-cli server up --detach
misty-cli server logs
misty-cli server image build --tag misty-server:local
```

Desktop releases are deliberately staged:

```bash
misty-cli release start 0.2.0
misty-cli release build 0.2.0
misty-cli release upload 0.2.0
misty-cli release verify 0.2.0
misty-cli release publish 0.2.0
```

The release manifest records both the application source commit and CLI commit.
Mac and Windows uploads are rejected if either checkout differs.
