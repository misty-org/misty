<p align="center">
  <a href="https://discord.gg/B5WgSw6uX"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&amp;logo=discord&amp;logoColor=white" alt="Discord" /></a>
  <a href="https://mistysys.com"><img src="https://img.shields.io/badge/Website-31363F?style=flat" alt="Website" /></a>
  <a href="https://github.com/misty-org/misty/wiki"><img src="https://img.shields.io/badge/Wiki-376873?style=flat&amp;logo=github&amp;logoColor=white" alt="Wiki" /></a>
  <a href="https://github.com/orgs/misty-org/projects/1"><img src="https://img.shields.io/badge/Roadmap-625380?style=flat&amp;logo=github&amp;logoColor=white" alt="Roadmap" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/wiki/misty-org/misty/assets/misty-icon.png" alt="Misty desktop icon" width="180" />
</p>

<h1 align="center">Misty</h1>

Misty is a browser workspace for organizing your tabs, continuing across computers, and working alongside agents in your browsing context. Keep websites in groups, work in split panes, and bring your workspace with you through encrypted sync.
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/misty-org/misty)
Misty is in development. Everyday browser features and cross-device sync are actively being built and verified. See the [wiki](https://github.com/misty-org/misty/wiki/Features) for current capabilities and limits.

## Requirements

Current desktop sync work targets **macOS and Windows**. To build from source, you need **Git, Node.js 24.12+, npm 11+, Rust**, your platform’s native build tools, and access to a running Misty backend. macOS development also requires an Apple Development signing certificate. Running your own backend requires Docker and additional setup.

**[Get started in the wiki →](https://github.com/misty-org/misty/wiki/Getting-started)** · [Full requirements](https://github.com/misty-org/misty/wiki/Requirements)

## Checks

GitHub Actions runs only the code tests: the frontend suite and the server suites (Go with Postgres, the agent runtime, and journal collaboration), plus a secret scan. Everything else runs locally before you push.

- `npm run check` — formatting, types, lint, frontend tests, and the production dependency audit.
- `npm run cli -- check all` — the full local gate: `npm run check`, the release task tests, the native desktop crate (format, clippy, tests), the server (Go format, vet, tests, contracts, app suites), the website, built-in tools, and the CLI.
- `npm run cli -- check app|server|cli|tasks` — one area at a time.
