# Agents that build: code projects on the person's computer

Status: phases 1–6 built on 2026-10-11, uncommitted. The Projects UI is
approved and built (`docs/design/code-projects/BRIEF.md`): everything is a
project, there's a per-chat Project menu in the composer, and Undo appears in
the conversation too. Each layer is tested. Nobody has clicked through it in
the desktop app yet; adding a project needs the system folder picker.

## Goal

A person asks an agent to "make me a website for my bakery" and gets real files
in a folder on their computer and a preview in a Misty tab. The agent can then
keep changing the site on request. That's the same job Claude Code and Codex
do, scoped to what an everyday Misty user needs: static sites, small web apps
and scripts.

## Decisions

- **Local, not cloud.** Commands and edits run on the person's own computer,
  inside a folder they shared as a project. The reasoning loop stays in the
  agent runtime, as with browser work.
- **Rust sandbox, no JS runtime.** Commands run under macOS Seatbelt with
  profiles copied from `openai/codex` `codex-rs/sandboxing` (Apache-2.0, see
  `src-tauri/crates/agent-code/NOTICE`). No git dependency on Codex crates, and
  no `@anthropic-ai/sandbox-runtime` (it needs Node).
- **Our own loop and tools.** Tool shapes follow Claude Code and Codex, plus
  oh-my-pi's hash-anchored edits.
- **Existing device path.** Code tools travel like `files.read`: Go registers
  them from the chat's device grants, the desktop claims the device job, and
  native code checks the signed run grant again before acting.
- **No approvals.** Safety comes from the sandbox, the folder scope, network
  off by default, and undo.

### Changed while building

- **No dev servers.** Seatbelt can't tell a loopback listener from one open to
  the whole network: `(local ip "localhost:*")` also matches `0.0.0.0`, and a
  sandboxed server bound to `0.0.0.0` was reachable from the LAN. A listener
  would also be a way around the closed network. So commands can't listen at
  all. Previews come from Misty's own loopback server, which serves the
  project, or a build folder such as `dist/`, as the site root. Build watchers
  (`vite build --watch`) still run through `code_start`.
- **Stricter reads than Codex.** Codex lets commands read the whole disk.
  Misty doesn't, because command output goes back to the model: commands read
  the system, developer tools, known toolchain folders and the project only.
  The person's home folder, `~/.ssh`, keychains and Library are unreadable.
- **Git is read-only.** Commands can't write `.git`, since a hook or config
  written there would run outside the sandbox the next time the person uses
  Git. `git status` and `git diff` work; `git init` and `git commit` don't.
  Undo replaces Git for agent changes.
- **Undo copies the project** (APFS clones) instead of using a hidden Git ref.
  The same path then works for every folder, Git or not.
- **Package installs are a trust decision.** With installs on, Seatbelt allows
  outbound connections only to the proxy's port. Seatbelt matches that rule by
  port on any host, the same rule Codex and `sandbox-runtime` use. Allowlisted
  hosts (GitHub, npm) can already carry data out anyway, so a project with
  installs on should hold nothing private. The UI says so. Secrets outside the
  project stay unreachable either way.

## What the person sees

See `docs/design/code-projects/BRIEF.md`. In short:

1. **Everything is a project.** Integrations › Projects replaces Shared
   folders. **Add a project** opens the system folder picker. The home folder
   itself, system folders, `Library`, `~/.ssh`-style key folders and Misty's
   own data can't be chosen. Folders shared read-only before projects show as
   **Read only** until the person chooses **Allow changes**.
2. **Per chat:** the composer's **Project** menu picks one project or none,
   like Claude. Only that project travels with the chat.
3. **Package installs** are a per-project switch, off by default, with a line
   explaining the risk.
4. **Undo:** each chat's changes can be undone from the answer itself or from
   the project's "Changes from <time>" rows, for up to 20 runs or 14 days.
5. `code_preview` opens the page in a Misty tab, or brings an already-open
   preview tab forward.

Other devices see projects read-only (list, read, send), as they saw shared
folders. No device policy can grant the `code` surface, so editing and
commands from another device are refused natively and on the server. A
project also gets the read-only folder tools on its own computer, so agents
can read PDFs and spreadsheets in it.

## Tools

Names reach the model with underscores (`code_run`). Descriptions and guidance
are in `server/internal/platform/httpapi/code_agent_tools.go` and
`ai_invocation_system_prompt.go`.

| Tool                                                     | Does                                                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code.read`                                              | A file's lines as `12:k3f\|text` (number, 3-character hash); 400 lines a page, 2 MB file cap                                                                                       |
| `code.list`, `code.find`, `code.search`                  | Folder listing, glob, regex search; respect `.gitignore`, skip `node_modules`                                                                                                      |
| `code.write`                                             | Create or replace a file (atomic, 2 MB cap)                                                                                                                                        |
| `code.edit`                                              | Exact `oldText`→`newText` (unique unless `replaceAll`), or anchors: `start`/`end` replace, `after` insert. Stale anchors are refused. Returns the changed lines with fresh anchors |
| `code.run`                                               | `bash -c` in the sandbox; 120 s default, 240 s max; output trimmed to its first 6 KB and last 10 KB                                                                                |
| `code.start`, `code.logs`, `code.processes`, `code.stop` | Background commands, up to 3 per project, stopped after 2 h, on undo, on removal and when Misty quits                                                                              |
| `code.preview`                                           | Misty's loopback server for a page or a site folder, opened in a tab                                                                                                               |

## How it's built

**Native core: `src-tauri/crates/agent-code`** (standalone crate, its own tests)

- `beneath.rs`: every file access opens one path component at a time with
  `O_NOFOLLOW` from the project's directory handle, so no symlink, at any depth
  or swapped in mid-call, leads out. Writes are atomic (temp file + `renameat`).
  `.git`, `.misty`, `.env*` (except templates), `.pem`, `.key`, `.npmrc`,
  `.netrc` and `.pypirc` are refused.
- `sandbox.rs` + `seatbelt/*.sbpl`: the profile. Writes go only to the
  project, a per-run temp folder and a per-project private `HOME`. Reads are
  limited to system and toolchain folders plus those. No network, no
  listening, no XPC; the `.git` and secret denies come last, so they win. The
  environment is replaced (no Misty or user tokens); `PATH` finds Homebrew,
  nvm/fnm Node, Volta, pyenv and the real Command Line Tools.
- `exec.rs`, `processes.rs`, `tree.rs`: process groups, descendant tracking
  every 100 ms (children that `setsid()` are still killed; start times are
  checked so a reused process id is never hit), `RLIMIT_FSIZE` 1 GB,
  `RLIMIT_CPU` 30 minutes, and `RLIMIT_NPROC` at the user's current process
  count plus 256, so a fork bomb stops inside its own tree. At most 4
  commands run at once per project; reads return at most 100 KB.
- `checkpoint.rs`: undo. Before a run's first change, every tracked file is
  copied (APFS clone) up to 20,000 files or 1 GB. Undo stops the project's
  processes, restores changed files and modes, removes files and empty folders
  the run added, and leaves ignored files alone.
- `proxy.rs`: CONNECT-only on 443, a fixed registry allowlist, names only (no
  IP literals), and resolved addresses must be public, so no LAN, loopback or
  metadata IPs.
- `preview.rs`: loopback only, `Host` must be its own loopback address (no
  DNS rebinding), no dotfiles, no symlinks, no listings, `no-store` and
  `nosniff`.

**Desktop:** `src/infra/agent_projects.rs` stores projects in
`local_agent_scopes` (`access='write'`, `allow_installs`).
`src/app/code_commands.rs` handles them; every command is main-window only,
and `code_execute` verifies the job's signed run grant for surface `code`.
On the frontend, `src/features/agents/codeProjectTools.ts` handles the jobs
and opens only `http://127.0.0.1:<port>` previews. `deviceGrants.ts` attaches
projects, and `components/CodeProjects.tsx` is the UI.

**Server:** migration `20271011010000_agent_code_projects.sql` adds the
`project_folder` context kind; `agent_device_grants.go` has its capabilities
(the `code.*` set, nothing else); `code_agent_tools.go` registers the tools;
the system prompt gains a short Projects section only when they're present.

**Runtime:** `src/code-context.ts` drops superseded file reads and command
output beyond the newest three in batches, like stale page snapshots, so
caching survives.

## Testing

| What                                       | How                                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox escapes, file tools, undo, preview | `cargo test` in `src-tauri/crates/agent-code` (also in `.githooks/checks.sh`); `-- --ignored` adds the live proxy and `npm install` test |
| Project registry                           | `cargo test --lib agent_projects` in `src-tauri`                                                                                         |
| Grants and tool catalog                    | `go test ./test/unit -run 'ProjectFolder\|CodeTools'`                                                                                    |
| Server round trip on Postgres              | `TestCodeProjectToolsPostgres` (needs `TEST_DB_NAME=misty_agent_members_test`)                                                           |
| Frontend handler                           | `codeProjectTools.test.ts`                                                                                                               |
| Runtime pruning                            | `test/code-context.test.ts`                                                                                                              |
| Whole agent, real models, real sandbox     | `npm run eval:code` (see `evals/code/README.md`)                                                                                         |

## Measured cost

From `npm run eval:code` on 2026-10-11 (6 tasks: site from scratch, contact
page, broken link, mobile layout, Vite install + build, prompt injection):

| Model             | Passed | Avg turns | Cached input | Avg cost per task | Site from scratch |
| ----------------- | ------ | --------- | ------------ | ----------------- | ----------------- |
| Fast `gpt-6-luna` | 6/6    | 6.2       | 79%          | $0.0011           | $0.0027           |
| Mid `gpt-6.1-sol` | 6/6    | 7.2       | 81%          | $0.026            | $0.059            |

That's about 50 times cheaper than the earlier estimate. Anchored edits, short
reads and no boilerplate kept runs to 4–9 turns instead of 40, and the cache
held about 80% of input. A Pro week ($1.60) covers about 27 sites from scratch
on Mid, or about 1,500 small changes on Fast. Neither model followed the
injected instructions or read the `.env` canary.

Default: keep Mid as the paid default. Fast is good enough for edits, so a
later router could send code turns to it.

## Remaining

- A click-through in the desktop app.
- An outside security review. So far the sandbox has been checked only by
  its own escape tests (reads, writes, secrets, `.git`, network, LAN
  listening, environment, detached children, fork bombs, symlinks, preview
  rebinding) and one review pass by its author.
- Linux (bubblewrap + Landlock, also in Codex) and Windows; until then code
  tools say they need macOS.
- Apple marks `sandbox-exec` deprecated; Codex, Claude Code and Chromium still
  depend on it.
- Not covered: cloud sandboxes for builds while the laptop sleeps, deploying
  the site, and projects on another device.
