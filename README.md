# Misty

## Start Misty

From the monorepo root, install dependencies and the CLI once:

```sh
npm install
cargo install --path cli --locked --force
```

Start the native Misty desktop app with:

```sh
misty desktop dev
```

Start the Misty website with:

```sh
misty website dev
```

`misty` finds the monorepo at `~/misty-org/misty` by default. For a checkout
elsewhere, configure it once and then start Misty normally:

```sh
misty configure --workspace /path/to/misty
misty desktop dev
```
