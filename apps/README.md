# Misty apps

First-party app source lives here as part of the main Misty repository. Each app owns an `index.tsx` SDK component entry and its implementation. Apps retain independent versions in `catalog.json`; extensions have their own manifests and catalog versions.

From the Misty repository root:

```sh
misty setup
misty apps build planner --desktop-only
misty desktop dev
```

Build both configured platforms with `misty apps build planner`, then create a signed development package with `misty apps package planner`. Run `misty apps official build` to build, package, and validate all downloadable apps. No server checkout or Git submodule is required.

Production packages contain compiled code, assets, a manifest, and signatures. The runtime verifies installation grants, compatibility and capabilities before mounting through `@misty/sdk`. Agents are a host-owned surface; they are not a downloadable app package.

The SDK and method schemas live in `../packages/sdk` and `../packages/contracts`. Dependencies are installed from the root workspace lockfile. Native service source lives in `native-services/`; the CLI builds services required by each app on supported platforms. Release packaging requires both supported macOS architectures and production signing credentials.

`interface/` contains catalog types and shared presentation components. `extensions/`, `catalog/`, and `src/` contain the extension catalog and panels. Internal build and packaging implementation lives under `../cli/tasks/apps/`.
