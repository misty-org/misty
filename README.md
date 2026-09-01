# misty

`misty` is the development and release interface for the Misty repositories.
Desktop commands use Tauri's operating-system WebView and do not prepare or bundle a separate browser runtime.

## Install and start Misty

From the CLI repository:

```sh
cargo install --path . --locked --force
misty desktop dev
```

Start the website with:

```sh
misty website dev
```

The default workspace is `~/misty-org`, containing sibling `misty`,
`misty-server`, `misty-website`, `misty-extensions`, and `misty-cli`
repositories. Configure another location with:

```sh
misty configure --workspace /path/to/misty-org
```

## Commands

```sh
misty doctor
misty check app
misty check server
misty check website
misty check extensions
misty check cli
misty check all

misty env init dev
misty env init prod
misty env status dev
misty env check dev
misty env check prod

misty home generate
misty home generate --destination ./portable/.misty --source ~/.misty
misty home check

misty desktop dev
misty desktop dev --profile owner --route /spaces
misty desktop build
misty desktop clean
misty desktop clean --apply
misty desktop icons sync

misty website dev

misty server up --detach
misty server url
misty server logs
misty server down
misty server prod check
misty server prod up
misty server prod logs
misty server prod down

misty release start 0.2.0
misty release build 0.2.0
misty release upload 0.2.0
misty release verify 0.2.0
misty release publish 0.2.0
```

Run `misty --help` or add `--help` after any command group for the complete
option reference.

## Misty home

Desktop Misty uses `~/.misty` on macOS, Linux, and Windows instead of Library
or AppData. Create the current layout on a device with:

```sh
misty home generate
misty home check
```

Generation is idempotent and never replaces existing files. To prepare a
portable seed from an existing installation, generate into a separate path:

```sh
misty home generate \
  --source ~/.misty \
  --destination ./portable/.misty
```

Only portable plugin web files are copied. Product assets ship inside the app.
Databases, credentials, note attachments, mounts, caches, logs, platform
binaries, and release keys stay device-local. Install the platform's Misty
application separately, then place the generated `.misty` directory in the
user's home.

The CLI stores its own workspace selection in `~/.misty/cli/config.toml` and
continues to read older platform-specific config locations during migration.
Development-only desktop profiles live under `~/.misty/cli/profiles` so they
cannot be mistaken for production application state.
