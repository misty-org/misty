# The sandbox

A bad file, page or agent should never be able to touch the rest of the computer. Misty runs as one
sandbox with three layers of security: actions, grants and permissions. It starts with access to
`.misty` and nothing else. This closes open problems 1 and 2 in
[browser security](../browser/security.md). Misty doesn't use macOS App Sandbox or ship on the App
Store, so `.misty` stays where it is.

## Three layers

| Layer | Who decides | What it answers | Example | Enforced by |
| --- | --- | --- | --- | --- |
| **Actions** | Misty, fixed at build | What can be done at all? | `shell.run`, a command a window can call | Tauri's permissions, the native job check |
| **Grants** | The person, one click at a time | Which of my things can this reach? | The Downloads folder, a shared folder, write access to it | One Rust file gate |
| **Permissions** | Misty's defaults, and the person can add on | Who may use an action, and how far? | How far the shell reaches, camera for a site | Tauri scopes, the OS, Kiri |

A call has to pass every layer that applies: the action must exist, the caller must have permission,
and any of the person's things it touches must be granted.

## Registered in one place

Every action, grant and permission is defined under `src-tauri/sandbox/` and registered through
`tauri_build::AppManifest`, with a name that says which layer it belongs to:

```text
src-tauri/sandbox/
  actions/       action-tabs, action-vault, action-shell-run
  grants/        grant-downloads, grant-shared-folder, grant-shared-folder-write
  permissions/   permission-agent-shell, permission-document-worker, permission-page-reader
  capabilities/  which windows get which sets
```

- `AppManifest::commands` lists every command, and a command with no permission entry is refused for
  every window. Tauri generates an `allow-<command>` entry for each, which the `action-*` sets group.
- `AppManifest::permissions_path_pattern` and `Attributes::capabilities_path_pattern` point Tauri at
  this folder instead of its defaults. Both exist in Tauri's source, but I haven't tried them here.
- Website tabs keep only `kiri:default`, and a test fails when a command belongs to no action set.

### What the manifest can't do

- **Tauri only checks webview calls:** a shell or worker process never passes through it. The Rust gate
  and the OS profiles read the same definitions, and each `permission-*` entry for a process produces
  that process's OS profile. This hasn't been built or tried yet.
- **People's choices are data:** the manifest defines the kinds of grant and the default permissions.
  What someone actually granted or added lives in `misty.db`, on the device, and never syncs. Tauri can
  add a capability while running, but I found no way to remove one, so revoking would need a restart.
- **Names to tidy:** remembered approvals are permissions the person added, but they're stored as
  `agent_grants` on the server and shown by `AgentGrantsSection`. Rename them when they move here.

## Actions: fixed by Misty

Today `build.rs` calls plain `tauri_build::build()`, so about 260 app commands are open to every app
window, and `src-tauri/src/platform/app_command_policy.rs` narrows that by name prefix.

- Replace the prefix rules with `action-*` sets per window.
- Narrow `opener:allow-open-path` and the asset protocol scope in `tauri.conf.json` so neither covers
  whole folders like Documents.
- Agent tools and device jobs are actions too. Move the list of allowed jobs out of `workerExecute.ts`
  and `deviceAgentTools.ts` into one definition the native check enforces, so a compromised page script
  can't add to it.

## Grants: driven by the person

| What | When it's granted |
| --- | --- |
| `.misty` | Always, with no prompt: it's the one folder Misty starts with |
| Downloads folder | A prompt on the first download |
| A shared folder | The person picks it, per chat, read-only |
| Write access to a shared folder | The person turns it on, per folder, per chat |
| A file | The system file picker, for that file only |

- All file access in the Rust app goes through one module that refuses anything without a grant.
  Clippy's `disallowed_methods` bans direct `std::fs` calls elsewhere.
- Only a click in Misty's own interface can create a grant. Websites, files and agents can't.
- macOS also prompts on its own for Downloads, Desktop and Documents, so a person may see two prompts
  there. Windows has no equivalent.
- Downloads are never opened or run automatically. Check that they carry macOS's quarantine flag.

## Permissions: defaults plus what the person adds

| Permission | Default | The person can add |
| --- | --- | --- |
| `permission-document-worker` | The one file it's handed, no network | Nothing |
| `permission-page-reader` | The page it's handed, no network or files | Nothing |
| `permission-agent-shell` | The chat's workspace, system tools, no network | Nothing; folder access comes from grants |
| Agent actions | Ask and Auto as they work today | Remembered approvals |
| Site access | Off | Camera, microphone and location, per site |
| Browser import | Off, asks on first use | On or off in Settings |
| Screen capture and the cursor companion | Off, asks on first use | On or off in Settings |
| Windows desktop control | Off, asks on first use | On or off in Settings |
| Dictation typing into other apps | Off, asks on first use | On or off in Settings |
| Extensions | What the person approves on install, from the store's manifest | Remove or change it per extension |

Extension permissions get audited before the MVP, since the security audit didn't check how they're
enforced. Any fixes may touch Kiri.

## The agent runtime: Rust, inside Misty

The runtime is about 9,000 lines of TypeScript on Node, using 328 MB while idle in one reading. It moves
into the Misty process as one Rust crate, `src-tauri/crates/agent`, with two parts. Agents still run on the
person's computer, on their own keys. Node, the local server, request signing and any key proxy all go
away, because Rust already holds the keys. Local calls were already fast (0.43 ms), so the savings are
disk and memory, not network.

### The crate

| Part | What it holds | Depends on |
| --- | --- | --- |
| `agent::sdk` | Model clients, streaming, tool calls and structured output: what Misty uses from the Vercel AI SDK | Nothing else in the crate |
| `agent::runtime` | The agent loop, context, tool routing and the run store, ported from the TypeScript runtime | `agent::sdk` |

- The SDK is only what Misty needs, not a general library for others.
- A test fails if `sdk` imports `runtime`, since one crate can't enforce that direction by itself.
- The crate has no Tauri dependency. The app gives it what it needs through a small interface, as
  `audio-capture` does, which keeps it testable and able to move to a child process later.

### What gets replaced

| Today | In Rust |
| --- | --- |
| Vercel AI SDK | Our own model clients, ported from how the runtime uses it |
| Workflow library (18 places) | A run store in `.misty`, so runs still resume after a restart |
| Express and Nitro | Nothing: the crate is called directly |
| `linkedom`, `canvas` | Page reading in a confined worker |
| ElevenLabs and Soniox clients | Our own clients |

### Model clients

Port what Misty has rather than adopt a Rust SDK. The current runtime is what the benchmarks are tuned on,
so the Rust version should behave the same. No third-party Rust LLM library, including `aisdk`.

- **Own clients for what Misty uses:** Anthropic, OpenAI, Google, ChatGPT sign-in and the
  OpenAI-compatible format (OpenRouter, NVIDIA, Ollama), plus the Gateway, ElevenLabs and Soniox.
- **Only the parts Misty calls:** text generation, streaming, tool calls, structured output, transcription,
  speech and embeddings. `src/model-provider.ts` and `src/model-calls.ts` show what's needed.
- **The Vercel AI SDK stays the reference:** it's where the provider details live today, and each provider
  behaves differently. Prompt caching and reasoning settings have to carry over, because they affect cost
  and scores.
- **Prove it matches:** record what the TypeScript runtime sends and receives for each provider, and check
  the Rust clients send the same requests and read the same replies. Port the existing runtime tests too.

### Safety

- **No OS wall around agent code:** a bug there runs with Misty's rights. That rests on Rust's memory
  safety and on agents only reaching the fixed actions list.
- **Untrusted input goes to confined workers:** page reading runs under `permission-page-reader`, and
  documents under `permission-document-worker`. The shell stays confined too.
- **A panic must not take down the browser:** the crate's tasks have to fail on their own. Check the
  crate's panic handling, and build it so it could move to a child process later.

### How it gets done

1. Record a baseline: the TypeScript runtime's benchmark scores on fixed tasks and models, since scores
   mean little across different models.
2. A small test: the OpenAI-compatible client and the agent loop in Rust, measuring memory and one
   benchmark task, and comparing its requests with the TypeScript runtime's.
3. Port the rest, one provider at a time, comparing against the baseline.
4. Delete the TypeScript runtime when the Rust one scores the same or better on the same tasks and
   models. Node stays for development until then.

`src-tauri/services/agent-runtime/test/sdk-parity.record.test.ts` records what the Vercel AI SDK sends and
parses against a local mock, and `src-tauri/crates/agent/tests/sdk_parity.rs` replays those fixtures against
the Rust clients, with no model keys.

There's no rush: the target is scores the same or better than the baseline, and the MVP waits for that. No
release ships Node, even temporarily.

## Agents: shell and tools

Agents need real tools, including a shell. Benchmarks show that scripts and batched work finish tasks
in fewer steps, so the goal is to give agents this power inside a tight permission rather than remove
it. The shell is not the coding feature coming back: there are no coding tools, projects or `code.*`
tools.

| Tool | What it's for | Where it runs |
| --- | --- | --- |
| `browser_run` | The only way to script tabs: loops, forms, collecting rows | QuickJS in the app, with no files or network of its own |
| `shell.run` | Scripts and system tools for everything else: files, data, batch work | A real shell, confined by `permission-agent-shell` |

- **Private workspace:** each chat gets its own folder, which commands can read and write freely. They
  can also run system tools and use the chat's shared folder as granted, and nothing else. It lasts until
  the chat is deleted, has a size limit, and no other chat can see it. Agents save anything worth keeping
  to the Library or a shared folder.
- **No network, and no way to add it:** commands can't reach the internet or other machines, so there's
  no proxy to build. Scripts can't install packages or download anything. When an agent needs something
  from the web, it uses its other tools and hands the result to the workspace.
- **No access to tabs:** shell scripts can't drive the browser, and nothing connects the shell to it.
- **Started by Rust:** each command gets its own OS profile, so the main process and the shell stay
  separate.
- **Never holds secrets:** a clean environment, with no keys, sign-ins or `.misty`.
- **Reuse earlier work:**
  - The deleted `src-tauri/crates/agent-code` has macOS profiles and limits (last present in the parent
    of `82aeabd62`), and `windows-confine` still has `Access::Inside`.
  - Its lessons still apply: a profile's `localhost` rule also matches `0.0.0.0`, so commands can't
    listen; a process calling `setsid()` escapes group kills, so descendants must be tracked; `.env` and
    key files stay unreadable, because command output reaches the model.
- **Tools:** Misty won't bundle a scripting language, to keep the app small, so scripts use what's on the
  computer. See [what's been tested](#whats-been-tested) for what works.
- **Check `browser_run`:** confirm it can really work on several tabs at the same time, and benchmark
  it, since that's the parallel case.

### Modes

There's no bypass mode. Grants say what a command can reach and the modes say when it asks:

| Mode | The shell |
| --- | --- |
| Manual | Pauses before each command |
| Auto | Runs without pausing, inside what's granted |
| Plan, Teach | Not offered, since these modes don't change anything |

### Who can start a run

| Started by | The shell | Write access to a shared folder |
| --- | --- | --- |
| A mention in a Misty chat, as that person | Follows their mode | If that chat has the grant |
| A scheduled workflow, with nobody watching | Yes, in its private workspace | Only if turned on for that workflow |

Runs can't start from outside Misty: `+misty` emails and `@misty` Slack tasks are removed for the MVP.
Connected apps like Gmail and Slack stay as tools an agent can use.

### Write access to a shared folder

Once granted, commands can add and edit files there, but can't delete, rename or move anything:

| Works | Refused |
| --- | --- |
| New files and folders, appending, overwriting a file | `rm`, `rm -rf`, `find -delete`, `rmdir`, `mv` |

- **Overwriting isn't protected:** a command can still empty or replace a file's contents, and there's
  no undo, since the undo copies were removed with coding. The grant prompt has to say so.
- **Some tools break:** anything that saves by renaming fails, such as `sed -i`, which also leaves a
  stray temp file that the agent can't remove. Agents need to know this rule, so tell them in the tool's
  description.
- **Windows:** this needs an access rule that leaves out the delete right, which hasn't been built or
  tested. Windows ships only when the shell and this rule both pass, so both platforms behave the same.

## What's been tested

A confined shell on macOS 26.5, on scratch files. An earlier test ran the Node runtime under a similar
profile, and writes, deletes and process starts outside its folder were denied the same way.


| Check | Result |
| --- | --- |
| Delete, rename or move in a folder with write access | Refused, and the files survived |
| Create, append or overwrite there | Worked |
| Read or `rm -rf` outside, list the home folder or `.misty` | Denied |
| `curl` | Failed, no network |
| `sh`, `zsh`, `awk`, `grep`, `sort`, `tar`, `zip`, `jq`, `perl` | Worked |
| `/usr/bin/git`, `/usr/bin/python3` | Failed with a misleading Xcode license message |
| The same two from `/Library/Developer/CommandLineTools/usr/bin` | Worked, but not every Mac has them |
| `ruby` | Failed |

Not tested yet:

- The Rust runtime, including its model clients, memory use and benchmark scores.
- Page reading in a confined worker.
- The real `shell.run` path, the shell on Windows, and whether scripts without network or packages still
  save steps in the benchmarks.

## What this doesn't cover

- **The main process:** agent code now runs in it. A memory bug in it, or a page escaping WebKit, could get
  past the gate, because the main app has no OS sandbox. So the docs should say Misty asks before using files, not that a disk
  wipe is impossible.
- **Prompt injection:** a page can try to talk an agent into running commands, and the sandbox limits
  the damage to the workspace and any folder with write access, where files can be overwritten. A shell
  with no network can't send files out, but the agent's other tools can reach the web, so a tricked agent
  could read a shared file and put it in a web request. Auto doesn't pause for this, by decision, to keep
  it hands-off, so the prompt for sharing a folder has to warn about it. Manual pauses before changes.
- **`sandbox-exec`:** its profile language has no official documentation and it could change in an OS
  update. The workers and the shell depend on it, so test them on each macOS release.

## Old coding data

Coding is removed, and its leftovers get deleted, which can't be undone:

- **On the computer:** an app update deletes the `checkpoints` folder in `.misty`, old `coding_*`
  settings and old local storage keys, once. Original project files aren't touched, only Misty's copies.
- **On the server:** `20271121000000_remove_coding.sql` runs on the dev database first, then production
  once that's checked. It drops coding tables, approvals and coding-tool agents, and the server must be
  on the new code when it runs.

## Order of work

1. The small Rust runtime test, which decides the rest of the runtime work.
2. Port the runtime to Rust and pass the benchmarks. Page reading moves to a confined worker here.
3. `shell.run` under its permission, tested against the benchmarks.
4. The `sandbox/` folder and `AppManifest`, one window at a time.
5. The file gate, the first-download prompt and first-use prompts.
6. Move the allowed job list into native code.
7. Audit extension permissions.
8. Bring Windows level with macOS, then release both.

Update [browser security](../browser/security.md) as each step lands, and fold this plan into it when
the last one ships.
