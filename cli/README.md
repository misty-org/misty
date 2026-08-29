# misty

`misty` is the development and release interface for the Misty monorepo.
Desktop commands use Tauri's operating-system WebView and do not prepare or bundle a separate browser runtime.

## Install and start Misty

From the monorepo root:

```sh
npm install
cargo install --path cli --locked --force
misty desktop dev
```

Start the website with:

```sh
misty website dev
```

The default checkout is `~/misty-org/misty`. Configure another location with:

```sh
misty configure --workspace /path/to/misty
```

## Commands

```sh
misty doctor
misty check app
misty check server
misty check all

misty env init dev
misty env init prod
misty env status dev
misty env check dev
misty env check prod

misty desktop dev
misty desktop dev --profile owner --route /spaces
misty desktop build
misty desktop clean
misty desktop clean --apply
misty desktop icons sync
misty desktop windows stage-assets

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
