# Coding tools: capability spike

Misty agents delegate coding to the coding command-line tools a person installed.
This note records, per engine, how Misty talks to the tool and which tier of work
it may receive. It was written from the tools' documented wire formats and the
MIT-licensed ccgui project (architecture reference only); none of the tools could
be run in the environment where this was written, so every row needs a live check
on a machine with the tool installed and signed in before the engine ships.

## Tiers

- **Interactive asks.** The tool asks before acting mid-turn, so Ask and Auto both
  work fully: every change reaches `bridge::decide`, which answers in the tool's
  own protocol.
- **Launch-time only.** No mid-turn channel. In Ask chats these engines get only
  Plan / read-only launches; in Auto chats an auto-edit launch inside the attached
  project. They never get work that could need a pause: if push or install is not
  remembered, the Misty agent asks separately.
- **Full access only.** No asks and no read-only mode. Auto only, and only on a
  project where the person remembered `project.edit`, `project.install` and
  `git.push`; a refusing pre-push hook is injected unless push is remembered.

Routed work never passes a bypass flag (`--dangerously-skip-permissions`,
`bypassPermissions`, Codex `approvalPolicy: never` or `danger-full-access`, and so
on). `runners::tests::routed_work_never_passes_bypass_flags` pins this for every
adapter.

## Engines

| Engine | Binary | Transport | Mid-turn asks | Plan / read-only | Todos | Rate limit | Tier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude | `claude` | stream-json child; stdin control (`--permission-prompt-tool stdio`, `control_request` `can_use_tool`) | yes | `--permission-mode plan` | TodoWrite input | not reported | interactive (built) |
| codex | `codex app-server` | JSON-RPC stdio | yes: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` with `approvalPolicy: on-request` | `sandbox: read-only` | `turn/plan/updated` | `account/rateLimits/updated` (best effort) | interactive (built) |
| minimax | `mcode acp` | ACP | yes: `session/request_permission` | `session/set_mode plan`; `permissionMode default` | ACP `plan` update | not reported | interactive |
| kimi | `kimi acp` | ACP | `session/request_permission` exposed | `session/set_mode plan` | ACP `plan` update | not reported | interactive if the request reaches the client in its default mode; confirm |
| omp | `omp --mode acp` (plan) / `rpc-ui` | ACP / NDJSON | `extension_ui_request` confirm dialogs | `session/set_mode plan` | `op`/`list` todos | not reported | interactive if confirm dialogs cover every change; confirm |
| opencode | `opencode serve` | HTTP + SSE | `permission.asked` → `/permission/:id/reply` | `agent: plan` | not reported | not reported | interactive (HTTP host session); confirm |
| dsh | `dsh web` | HTTP + WebSocket | `approval/request` waterfall | `/plan` command | not reported | not reported | interactive (host session); confirm |
| pi | `pi --mode rpc` | NDJSON | no | `--tools read,grep,find,ls` | none | not reported | launch-time only |
| agy | `agy --print` | stream-json child | no | `--mode plan`; `--mode accept-edits` | none | not reported | launch-time only |
| qoder / qoder-cn | `qodercli --acp` / `qoderclicn` | ACP | requests exist but the tool expects bypass mode | none | none | not reported | launch-time only at best; confirm a non-bypass mode exists, else exclude |
| grok | `grok agent stdio` | ACP | no (`--always-approve` only) | none | none | not reported | full access only |

Engines that report no usage limit show "Usage cap unavailable for this tool" in
Settings › Agents › Coding tools; only Codex reports one today.

## Sign-in detection

None of the tools offers a status command; Misty checks for the credential files
they write (`detect.rs`). A tool that keeps credentials only in the system
keychain reads as signed out until a live check proves otherwise, which routes
work to the fallback rather than failing mid-run.
