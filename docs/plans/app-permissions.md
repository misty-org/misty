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
  this folder instead of its defaults.
- Website tabs keep only `kiri:default`, and a test fails when a command belongs to no action set.

### What the manifest can't do

- **Tauri only checks webview calls:** a shell or worker process never passes through it. The Rust gate
  and the OS profiles live beside the definitions in `sandbox/permissions/`, as `.sb` files each process
  loads. Nothing generates them from a shared definition.
- **People's choices are data:** the manifest defines the kinds of grant and the default permissions.
  What someone actually granted or added lives in `misty.db`, on the device, and never syncs. Tauri can
  add a capability while running, but I found no way to remove one, so revoking would need a restart.
- **Names to tidy:** remembered approvals are permissions the person added, but they're stored as
  `agent_grants` on the server and shown by `AgentGrantsSection`. Rename them when they move here.

## Actions: fixed by Misty

- Windows get `action-*` sets, and `app_command_policy.rs` only checks exact labels.
- Windows can't open a path themselves: `opener:allow-open-path` is gone, and a download opens through
  native code that looks up its path. The `asset:` scope starts empty and holds only files the person
  picked or dropped this session and files Misty downloaded.
- Agent tools and device jobs are actions too. The allowed jobs are one list the native check enforces
  (`sandbox/actions/agent_jobs.in`), so a compromised page script can't add to it.

## Grants: driven by the person

| What | When it's granted |
| --- | --- |
| `.misty` | Always, with no prompt: it's the one folder Misty starts with |
| Downloads folder | A prompt on the first download |
| A shared folder | The person picks it, per chat, read-only |
| Write access to a shared folder | The person turns it on, per folder, per chat |
| A file | The system file picker, for that file only. Misty has no folder view of its own |

- All file access in the Rust app goes through one module, `src-tauri/src/infra/file_access`, that
  refuses anything without a grant. Clippy's `disallowed_methods` bans direct `std::fs` calls
  elsewhere. Other crates, such as `misty-browser-sync`, aren't behind it yet.
- Only a click in Misty's own interface can create a grant. Websites, files and agents can't.
- macOS also prompts on its own for Downloads, Desktop and Documents, so a person may see two prompts
  there. Windows has no equivalent.
- Downloads are never opened or run automatically. On macOS 26.5, WKDownload adds the quarantine flag
  by itself, and Misty adds it to what it writes itself. Windows' Mark of the Web hasn't been checked.

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

The audit of how they're enforced is in [browser security](../browser/security.md#extension-permissions).

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
   mean little across different models ([running Odysseys](../agents/evals/odysseys.md#running-it)).
2. A small test: the OpenAI-compatible client and the agent loop in Rust, measuring memory and one
   benchmark task, and comparing its requests with the TypeScript runtime's.
3. Port the rest, one provider at a time, comparing against the baseline.
4. Delete the TypeScript runtime when the Rust one scores the same or better on the same tasks and
   models. Node stays for development until then, and no release has it: only a debug build with
   `MISTY_AGENT_RUNTIME=typescript` starts it (`infra/agent_runtime/typescript_baseline/`).

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
- **`browser_run` on several tabs:** one program with `Promise.all` loaded pages at the same time in
  real tabs (up to 4 at once in the smoke test, on pages that each take 1.5 seconds). It still needs
  benchmarking, since that's the parallel case.
- **Bound to the chat:** a grant is signed for one chat, and the workspace comes from the grant and the
  account, never from the job.

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
| New files and folders, appending, overwriting a file, moving a file in from the workspace | `rm`, `rm -rf`, `find -delete`, `rmdir`, `mv` of what's already there, hard links, changing extended attributes, writing to `.git`, `.githooks`, `.husky` or `.envrc` |

"Allow changes" is a native question, recorded natively and checked before every command, so a window
can't answer it and turning it off holds from the next command. What a command adds or edits there gets
the quarantine flag when it ends.

- **Overwriting isn't protected:** a command can still empty or replace a file's contents, and there's
  no undo, since the undo copies were removed with coding. The grant prompt has to say so.
- **Some tools break:** anything that saves by renaming fails, such as `sed -i`, which also leaves a
  stray temp file that the agent can't remove. Agents need to know this rule, so tell them in the tool's
  description.
- **Windows:** this needs an access rule that leaves out the delete right, which hasn't been built or
  tested. Windows ships only when the shell and this rule both pass, so both platforms behave the same.

## What's been tested

A confined shell on macOS 26.5, on scratch files. An earlier test ran the Node runtime under a similar
profile, and writes, deletes and process starts outside its folder were denied the same way. The page
reader on the same macOS, as the second table says.


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

The page reader's real worker, in its real profile, from its debug build's probes
(`infra/page_reader/macos_tests.rs`):

| Check | Result |
| --- | --- |
| Every page recorded from the TypeScript runtime (84), read in the worker and in-process | Same results |
| Read a file in the home folder or `/etc/passwd`, list the home folder | Denied |
| Write in its own folder, or outside | Denied |
| Connect to a live local listener or `1.1.1.1:443`, resolve a name | Denied |
| Start `/usr/bin/true` | Denied |
| A worker that fails, a page over the limit, a copy changed on disk | The fetch fails or the copy is replaced; nothing reads in-process |

A worker written fresh for each read took about 160 ms, and a kept copy about 9 ms (release build, 30
reads of a small page, median, from a test script rather than the app).

The Rust runtime, with a device model set and idle, in a small program with no model call
(`crates/agent/examples/idle_memory.rs`, release build with the app's size settings): 7.6 MB resident,
against 328 MB for one reading of the Node runtime. That's the crate alone, not the Misty app or a
running agent.

The app's commands and tasks have tests, including a panic inside a call and inside a session.

### The running app

A real agent through the real desktop app on macOS 26.5, in a debug build, with a scripted local model
on `openai-compatible` and a throwaway server. `evals/smoke/` runs all of this again.

| Check | Result |
| --- | --- |
| Common commands from a person's window | Worked; unknown commands and missing plugins were refused |
| Agents, model keys, voice and folder sharing from an incognito window | Refused by Tauri's ACL, "not allowed on window" |
| "not allowed" in the app's output and the window's console, through every step | None |
| Choosing the server, registering the first account, saving a key, listing models, Check the agent model | Worked |
| A run claimed and finished: a text reply, `web_fetch` of a public page, `shell_run` in its workspace | Worked |
| `web_fetch` of a local address | Refused, `private_address` |
| `rm -rf` outside, in the home folder and elsewhere; listing the home folder; `curl` | Refused, and the files survived |
| Between turns: request keys, tools, system prompt | The same on every turn, and the prompt only grew |
| `screen_open`, `browser_run`, the notebook, a second message, a message during a run | Worked |
| One chat reading another's workspace | Refused. A chat kept its workspace across runs, and it went when the chat was deleted |
| Shared folder, read-only | Reading and `folder_read` worked; adding, editing and deleting were refused |
| Shared folder, with write access | Adding and editing worked; `rm`, `rm -rf`, `mv` and `find -delete` were refused, and the files survived |
| The app killed while the model held a reply | The run carried on after a relaunch: the same request byte for byte, the earlier call IDs, and the finished command not run again |
| The app killed during a command | The run ended as failed, saying the outcome couldn't be verified, and the command wasn't run again. The command's process outlived the app and kept running |
| Cancel while the model thinks | The run stopped and the model's connection dropped |
| Cancel during a command | The command stopped about 130 ms later |
| Manual | Paused before `shell_run`. Approved, it ran; denied, it never ran and the model was told |
| Plan | `shell_run` wasn't offered |
| A voice session | Opened on a real channel; ping, a typed turn and its transcript went through, and the turn reached the fast model. It stopped at speech, with no provider key |
| A live session with no Soniox key | Refused as it opened |

Resident memory of the app in the same debug build, read from `ps`, without WebKit's helper processes.
The same scripted run on both runtimes, and the Node process added for TypeScript:

| Runtime | Idle | During a run |
| --- | --- | --- |
| Rust | 158 to 164 MB | 159 to 165 MB |
| TypeScript | 153 to 154 MB + Node 284 to 356 MB | 153 to 154 MB + Node 417 to 422 MB |

On that script the run's own turns matched the TypeScript runtime's byte for byte, with IDs and dates
taken out (`evals/smoke/parity.mjs`). The other three calls, the requirements list, the finish check
and the title, had the same contents but stream in Rust and don't in TypeScript.

Not tested yet:

- Any real provider, spoken audio in or out, and live transcription with a key.
- Benchmark scores, and memory in a release build or on a long run.
- The page reader on Windows, which has only been compiled, and how long each read takes there.
- The shell on Windows, and whether scripts without network or packages still save steps in the
  benchmarks.

## What this doesn't cover

- **Other processes' environments:** a command can read them, so a key in another program's environment
  isn't safe from it ([browser security](../browser/security.md#the-agent-shell)).
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

1. The small Rust runtime test, which decides the rest of the runtime work. Done.
2. Port the runtime to Rust and pass the benchmarks. Page reading moves to a confined worker here.
   Ported, wired in and through the smoke test on a scripted model. **The benchmarks haven't run:**
   they need a model key, and the TypeScript runtime stays until the scores match or beat it.
3. `shell.run` under its permission, tested against the benchmarks. Built and tested on the OS wall.
   Not benchmarked, for the same reason.
4. The `sandbox/` folder and `AppManifest`, one window at a time. Done.
5. The file gate, the first-download prompt and first-use prompts. Done.
6. Move the allowed job list into native code. Done.
7. Audit extension permissions. Done 2026-11-06.
8. Bring Windows level with macOS, then release both. Compiles. **Not run on Windows**, so the shell,
   its write rule and the page reader there are untested. Production's migration also waits.

Update [browser security](../browser/security.md) as each step lands, and fold this plan into it when
the last one ships.
