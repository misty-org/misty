# Misty Docs

Documentation for the Misty CLI, extension platform, and server contract.

## Development

```sh
npm install
npm run dev
```

The local site runs at `http://127.0.0.1:5175`. Production builds use
`https://docs.mistysys.com` for canonical metadata; development builds use
`https://dev-docs.mistysys.com`.

## Validate

```sh
npm run typecheck
npm run build
```

## Content sources

- CLI pages follow `misty-cli/src/cli.rs` and its command implementations.
- Extension pages follow the manifests, catalog, and typed host bridge in
  `misty-extensions`.
- Server pages follow the public route mounts, instance descriptor, and
  self-host feature gate in `misty-server`.

When a source contract changes, update the corresponding page in
`src/content.ts` in the same change.
