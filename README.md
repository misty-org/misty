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

Start the documentation site with:

```sh
misty docs dev
```

On macOS, prepare and run the Apple mobile app with:

```sh
misty mobile doctor
misty mobile devices
misty mobile open
misty mobile setup
misty mobile dev --open
```

After Xcode signing is configured, launch a connected device directly by name:

```sh
misty mobile dev --device "My iPhone"
```

That command discovers the Mac's LAN address, selects an available development
port, starts Vite and Tauri, builds and installs Misty, and keeps hot reload
running. It uses Apple's CoreDevice path automatically for paired wireless
iPhones and exits immediately with an unlock instruction when the device is
locked. The mobile command also starts the local server stack, so it is the only
command needed for an ordinary iPhone development session. Desktop and website
development servers can remain open.

Misty contributors working on the first-party Apps can compile, development-sign,
validate, and synchronize all official packages explicitly:

```sh
misty apps official build
```

Ordinary desktop and mobile development commands consume the existing App
catalog and packages; they never rebuild official Apps implicitly.

The default workspace is `~/misty-org`, containing sibling `misty`,
`misty-server`, `misty-website`, `misty-apps`, and `misty-cli`
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

misty apps official build

misty desktop dev
misty desktop dev --profile owner --route /spaces
misty desktop build
misty desktop clean
misty desktop clean --apply
misty desktop icons sync

misty mobile doctor
misty mobile devices
misty mobile open
misty mobile setup
misty mobile dev --open
misty mobile dev --device "My iPhone"
misty mobile run --device "My iPhone" --release
misty mobile build --target simulator --no-sign
misty mobile build --build-number 42 --export-method app-store-connect

misty docs dev
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
