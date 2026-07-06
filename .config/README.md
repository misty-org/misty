# Project tooling configuration

`.config/tooling.json` is Misty's shared tool registry. The `misty tool` command and root npm scripts both use `cli/tasks/tooling.ts` to select configuration here, validate required files, resolve locally installed tool binaries, and run from the project root. Calling the CLI from a nested directory produces the same lookup.

Examples:

```sh
misty tool vite build --mode desktop
misty tool vitest run src/features/files
misty tool eslint src
misty tool prettier --check src/application/entry.ts
misty tool gitleaks detect
```

`npm run tool -- <name> <arguments>` uses the same resolver without installing the Misty CLI. Existing commands such as `misty desktop dev`, `npm run build:desktop`, `npm test`, and `npm run lint` retain their interfaces.

A missing configuration or unknown tool is an error; tools do not silently fall back to default settings. Config paths belong in the registry rather than individual npm scripts. Explicit config overrides are rejected by the shared runner. Install a tool's npm package before using it; Gitleaks is a separate executable on PATH.

Prettier's package.json field, Tailwind's CSS `@config` directive, and the root `tsconfig.json` are discovery bridges to this directory. TypeScript settings live in `.config/tsconfig.json`; its paths are relative to `.config`, while the root file lets editors and plain `tsc` discover the project. External editor integrations do not use the Misty runner: configure ESLint integrations with `.config/eslint.config.js`. Independent packages, such as the public SDK and server, retain their own project configuration.

Some files still have required root discovery or entry-point roles: npm manifests, the small TypeScript discovery file, Rust and Node version pins, shadcn's `components.json`, HTML entry points, Git rules, and Prettier ignore rules. `.github/workflows`, `.agents/skills`, and `.codex` retain their automatic discovery locations.

Product, design, and roadmap documentation live in `docs/`.
