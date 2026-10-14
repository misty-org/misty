# Git for projects: build in Misty, publish to GitHub

Status: built 2026-10-11, all phases, and checked live against GitHub (see As built at the end). This builds on
code projects (`docs/plans/agent-code-projects.md`, on `main` as `a9e7d3e0f`).

## Goal

Someone can start building in Misty with nothing set up, and put the work
online when they want to:

- **New project** makes a local folder that is already a Git repository.
  Agents build in it and commit as they go. Nothing leaves the computer.
- **Publish to GitHub** turns it into a GitHub repository with the GitHub
  account the person connected through Composio, and pushes it.
- **From GitHub** clones one of their repositories into a new project.
- From then on, agents and the person can commit, push, pull and open pull
  requests from inside Misty.

## Decisions

- **GitHub connects through Composio**, like every other app (2026-10-11). No
  native GitHub sign-in. A project works fully without GitHub; Git itself is
  local.
- **Git runs in Misty, not in the sandbox.** Sandboxed commands still can't
  write `.git` (hooks or config written there would run unsandboxed later).
  Misty does Git work itself through `git2`, the Rust bindings for libgit2,
  as new `git_*` tools. libgit2 never runs hooks, `core.fsmonitor` or other
  repository-configured commands, so a malicious repository can't run code
  through it.
- **Answered 2026-10-11:**
  - **Token:** if Composio returns the GitHub token, the server may hand it to
    the person's own computer for one transfer, in memory only (route A).
    Otherwise use GitHub's API through Composio (route B).
  - **Agent pushes:** opt-in per project, off by default. When on, agents push
    to branches and open a pull request; the default branch needs a second
    switch.
  - **Commit author:** the connected GitHub account's name and email; the
    Misty account's before GitHub is connected.
  - **New project location:** asked every time with the folder picker.
- **One Git library.** `git2` covers init, status, diff, commit, branches,
  clone, fetch and push. gitoxide (`gix`) still lacks push (its own crate
  status page lists it unchecked), and running the Mac's `git` would run
  hooks. HTTPS only (no SSH feature), which keeps the build lean and is all
  GitHub tokens need.

## What the person sees

### Starting

The composer's Project menu and Integrations › Projects get two entries
beside **Add a project…** (an existing folder):

- **New project…**: a name, then the system folder picker for where it goes
  (with its own New Folder button). Misty creates `<chosen folder>/<name>`,
  runs `git init` with a starter `.gitignore`, and picks it for the chat.
  Local only. Folders the project rules refuse (home itself, system folders,
  Library, Misty's data) are refused here too.
- **From GitHub…** (shown once GitHub is connected): a list of the account's
  repositories, then the folder picker for where to put it; Misty clones the
  chosen one into `<chosen folder>/<repo>` and picks it.

### A project's Git row (Integrations › Projects)

- Branch, and whether there are uncommitted changes.
- Not on GitHub yet: **Publish to GitHub** (name, private by default), which
  creates the repo with the connected account, sets it as `origin` and pushes.
- On GitHub: the repository link, how far ahead or behind it is, **Push** and
  **Pull**.
- **Agents can push**, off by default, with the help text "Agents can send
  this project's commits to <owner/repo>. Anyone with access to that
  repository sees them." A second option underneath, **Including the default
  branch**, is off by default; without it, agents push only to other branches
  and open a pull request.

### In a chat

- Agents commit with clear messages as they finish pieces of work. Commits
  carry the connected GitHub account's name and email (its no-reply address
  when the account hides its email), or the Misty account's before GitHub is
  connected.
- When pushing is allowed, agents push and open a pull request through the
  existing Composio GitHub tools; the answer links it.
- Work lines read "Committed", "Pushed to <branch>", "Opened a pull request".

## Agent tools

Device jobs on the project grant, like `code.*`. The server registers them
only for projects that are Git repositories.

| Tool         | Does                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `git.status` | Branch, upstream, ahead/behind, staged/unstaged/untracked files                                  |
| `git.diff`   | Diff of the working tree or staged changes, or between two commits; capped like command output   |
| `git.log`    | Recent commits (hash, author, date, subject)                                                     |
| `git.commit` | Stage paths (or all changes) and commit with a message                                           |
| `git.branch` | Create or switch branches; switching refuses with uncommitted changes                            |
| `git.push`   | Push the current branch to `origin` (only when Agents can push is on)                            |
| `git.pull`   | Fetch and fast-forward the current branch; anything else is reported, never merged automatically |

Opening pull requests, issues and repository settings stay with the existing
Composio GitHub tools through `apps_execute`; the agent passes the branch it
pushed.

### Rules enforced natively

- **Never committed:** files the code tools refuse (`.env*` except
  templates, keys, `.npmrc`, `.netrc`, `.pypirc`), files over 50 MB, and
  anything `.gitignore` excludes. A refused file is named in the result.
- **Push targets:** only the project's own `origin`, only
  `https://github.com/<owner>/<repo>`, never a force push, never a deleted
  branch, and the default branch only when allowed.
- **No merges, rebases or history rewrites** by agents. The person does those
  in their own tools.
- **Identity:** agents can't change the commit author, remotes or Git config.

### Undo with Git

Undo already restores a project's files to how they were before a run. With
Git it also does the following:

- Each checkpoint records the branch and commit at the start of the run.
- If the run made commits that were **not pushed**, Undo moves the branch back
  to that commit (keeping nothing from the run), so history matches the
  restored files.
- If they **were pushed**, Undo restores the files and says the commits are
  still on GitHub; reverting them there is the person's call.

## Moving commits to and from GitHub

Pushing, pulling and cloning private repositories need a GitHub credential on
the computer for the moment of the transfer. Composio holds the token. Two
ways to use it, decided by phase 0:

**A. Short-lived token from Composio (preferred).** Composio's connected
account response carries the connection's credentials in `state.val`. If it
returns a usable GitHub token for Composio-managed GitHub auth:

1. For a push, pull or clone, the desktop asks the server for a credential for
   that project's remote, through its signed device request.
2. The server checks: the request comes from this account's own device; the
   remote is `github.com`; the account's GitHub connection is active. Then it
   reads the token from Composio and returns it. It never stores or logs it.
3. The desktop hands it to libgit2's credential callback, uses it for that one
   transfer, and drops it. It never reaches disk, the sandbox, or the model.

**B. GitHub's API through Composio (fallback, no token on the computer).** If
Composio won't return the token:

- Push replays new local commits with GitHub's Git Data API through Composio
  tools: create blobs, a tree, the commit, then move the branch.
- Clone downloads the repository archive (current files, no history) and
  starts a fresh local history linked to that commit.
- Pull fetches the changed files the same way.

This is slower and loses clone history, which is why it's the fallback.

## Phases

0. **Try the token (half a day).** With a test GitHub account connected
   through Composio in dev, read the connected account and check whether
   `state.val` holds a usable token, whether it's masked, and its scopes
   (`repo` is needed for private repositories). Push to a scratch repository
   with `git2` using it. This chooses A or B.
1. **Native Git engine.** A `git` module in `src-tauri/crates/agent-code`
   using `git2` (HTTPS, vendored libgit2, no SSH): init, status, diff, log,
   commit, branch, clone, fetch and push with an in-memory credential
   callback, plus the rules above. Tests cover: hooks and fsmonitor never run;
   secret files are never committed; force pushes and other remotes are
   refused; history matches after Undo; push and pull against a local bare
   repository.
2. **Projects and lifecycle.** "New project" (a name, then the folder picker,
   `git init`, starter `.gitignore`), "From GitHub", and
   "Publish to GitHub" (create the repo through Composio, set `origin`, push).
   Per-project settings for agents pushing and the default branch, stored
   beside the package-installs switch.
3. **Server.** `git.*` capabilities on `project_folder` grants; tool
   registrations; the credential broker (A) or the Composio Git Data API path
   (B); an audit event per push. A migration only if the device-context
   capability list needs it.
4. **Agents.** Guidance: commit at meaningful points with plain messages;
   never push without the switch; open a pull request after pushing a branch.
   Work-line phrases. Code eval tasks: "commit the change", "publish this site
   and open a pull request" against a local bare remote.
5. **UI.** Project Git rows, the Publish, Push and Pull actions, the new
   menu entries, and pull-request links in answers. Brief for approval first.

## Security notes

- **Pushing is a way out for data.** It stays opt-in per project, limited to
  the project's own GitHub remote, and never includes secret files.
- **A prompt-injected agent with pushing on** could push project content to
  that repository. This is the same trust decision as package installs; the
  help text says so.
- **Credentials:** route A briefly gives the token to the person's own
  computer for one transfer. Route B never does.
- **Untrusted repositories:** cloning someone's repo runs nothing (libgit2).
  Sandboxed commands still can't write `.git`, so a cloned repository's
  scripts can't plant hooks for the person's own `git` later.

## As built (2026-10-11)

**Phase 0 result: route B.** Composio always redacts `access_token` for
connections on its managed auth configs (its changelog, April 22, 2026),
whatever the project's masking setting. Route A would need Misty's own
GitHub OAuth app in Composio. Route B works through Composio's proxy
(`POST /api/v3.1/tools/execute/proxy`), with full history:

- **Push:** each new blob, tree and commit goes to GitHub's Git Data API with
  exactly its local content, so GitHub computes identical hashes; the server
  checks each one. Tested live: commit `5005bb3` matched byte for byte.
- **Pull and clone:** GitHub's API reports commit times in UTC and trims
  messages. The native side rebuilds each commit, trying every real timezone
  offset and message ending until the hash matches, which proves the rebuild
  is exact. Signed commits rebuild from GitHub's signed payload. Anything
  that can't be matched becomes a shallow boundary (`.git/shallow`).
  Fetches stop at 50 commits of history.
- **Empty repositories:** GitHub refuses objects until a repository has a
  commit, so Misty seeds it with a one-file commit ("Created by Misty") and
  the first push replaces the seed. This is the only forced ref update, and
  the server allows it only when the branch's commit really is that seed.
- **Limits:** files up to about 2.9 MB come in (Composio's 4 MB response
  cap); files up to 20 MB go out.

**Where things are**

- Native: `src-tauri/crates/agent-code/src/git/` (`mod.rs` repository,
  status, branches, diffs, undo; `commit.rs`; `transfer.rs` push plans and
  exact rebuilds; `time.rs`), `diff.rs` (shared diff shape), `run_diff.rs`
  (an answer's own changes, from undo copies). Desktop commands are in
  `src-tauri/src/app/code_commands.rs`: `code_new_project`,
  `code_clone_project`, `code_git`, `code_git_job` (the grant, switch and
  default-branch check) and `code_set_project_push`.
- Server: `github_git.go`, `github_git_repos.go`, `github_git_objects.go`
  (`POST /integrations/github/git`), and `composio/proxy.go`. The `git_*` tools
  are in `code_agent_tools.go`, and the Git guidance is in
  `ai_invocation_system_prompt.go`.
- Desktop: `src/features/agents/git/gitSync.ts` (push, pull, clone, publish
  and pull requests behind a transport), `projectGit.ts` (app transport and
  commit author). The UI is in `components/changes/` (`DiffView`,
  `AnswerChanges`, `ProjectReview` sheet, `PublishDialog`),
  `ProjectGitRows.tsx` and `collaboration/ProjectDialogs.tsx`.

**Checks**

- Native: hooks never run, secret files are never committed or shown in a
  diff, hash-exact round trips, unusual timezones, shallow fetches, refusal
  over diverged history, undo of unpushed commits only.
- Server: unit tests, the route inventory and agent decision gates, and a
  Postgres round trip.
- Frontend: the transfer logic against fakes, the job handler (commit author
  and push gating), the diff, changes card, review panel and dialogs.
- Live (`gitSync.acceptance.ts` with `TestGitHubGitLiveBridge`, opt-in):
  - push a new branch, clone it, push from the clone, pull back;
  - a push over newer GitHub commits is refused;
  - publish, with the seed replaced;
  - a pull request opened, and an existing one found again.
- Eval: `commit-fix`, where both models fix and commit without pushing.
