/**
 * Moving a project's commits to and from GitHub (docs/plans/agent-git-projects.md,
 * route B). The native side reads and writes Git objects; the server relays
 * each GitHub API call through the person's Composio connection. Hashes stay
 * identical on both sides, so this is real Git history, not a file copy.
 *
 * Everything goes through a `GitTransport`, so the same steps run in the app
 * and in the live test against a scratch repository.
 */

export interface GitTransport {
  /** One native Git step (`code_git`) for the project. */
  native<T = Record<string, unknown>>(
    operation: string,
    input?: Record<string, unknown>,
  ): Promise<T>;
  /** One GitHub step through the server (`/integrations/github/git`). */
  github<T = Record<string, unknown>>(op: string, args?: Record<string, unknown>): Promise<T>;
}

export interface GitHubRepo {
  owner: string;
  name: string;
}

export interface ProjectGitStatus {
  repository: boolean;
  branch?: string | null;
  head?: string | null;
  github?: GitHubRepo | null;
  published?: boolean;
  defaultBranch?: string;
  ahead?: number;
  behind?: number;
  clean?: boolean;
  files?: { path: string; kind: string; staged: boolean }[];
}

interface Person {
  name: string;
  email: string;
  date: string;
}

export interface CommitData {
  sha: string;
  tree: string;
  parents: string[];
  author: Person;
  committer: Person;
  message: string;
  signature?: string;
  payload?: string;
}

interface TreeData {
  sha: string;
  entries: { path: string; mode: string; type: string; sha: string }[];
}

interface PushPlan {
  github: GitHubRepo;
  branch: string;
  head: string;
  upToDate: boolean;
  commits: CommitData[];
  trees: TreeData[];
  blobs: { sha: string; size: number }[];
}

/** Objects per request, and bytes of file content per request. */
const BATCH = 60;
const PUSH_BYTES = 6 * 1024 * 1024;
const FETCH_BYTES = 2_500_000;
/** Commits brought in for a pull or clone; older history stays on GitHub. */
export const HISTORY_DEPTH = 50;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

/** Groups items so each group stays under a byte budget and a count. */
function bySize<T extends { size: number }>(items: T[], bytes: number): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let total = 0;
  for (const item of items) {
    if (current.length && (total + item.size > bytes || current.length >= BATCH)) {
      groups.push(current);
      current = [];
      total = 0;
    }
    current.push(item);
    total += item.size;
  }
  if (current.length) groups.push(current);
  return groups;
}

export async function gitStatus(transport: GitTransport): Promise<ProjectGitStatus> {
  return transport.native<ProjectGitStatus>("status");
}

function requireGitHub(status: ProjectGitStatus): GitHubRepo & { branch: string } {
  if (!status.repository) throw new Error("This project isn't a Git repository yet.");
  if (!status.github) throw new Error("This project isn't on GitHub yet. Publish it first.");
  if (!status.branch) throw new Error("The project isn't on a branch.");
  return { ...status.github, branch: status.branch };
}

export interface PushResult {
  branch: string;
  sha: string;
  upToDate: boolean;
  commits: number;
  url: string;
}

/** Sends the current branch's new commits to GitHub. Never force-pushes,
 * except over the seed commit of a repository Misty just created. */
export async function push(transport: GitTransport): Promise<PushResult> {
  const status = await gitStatus(transport);
  const { owner, name, branch } = requireGitHub(status);
  const repo = { owner, name };
  let ref = await transport.github<{ sha: string | null; seed?: boolean; empty?: boolean }>("ref", {
    ...repo,
    branch,
  });
  if (!ref.sha && ref.empty) {
    // A repository created elsewhere and never pushed takes no objects yet.
    await transport.github("seed", repo);
    ref = await transport.github("ref", { ...repo, branch });
  }
  const remoteHead = ref.sha && !ref.seed ? ref.sha : null;
  const plan = await transport.native<PushPlan>("push_plan", { remoteHead });
  const url = `https://github.com/${owner}/${name}/tree/${encodeURIComponent(branch)}`;
  if (plan.upToDate) {
    await transport.native("record_push", { branch, sha: plan.head });
    return { branch, sha: plan.head, upToDate: true, commits: 0, url };
  }
  for (const group of bySize(plan.blobs, PUSH_BYTES)) {
    let pending = group.map((blob) => blob.sha);
    while (pending.length) {
      const read = await transport.native<{ blobs: { sha: string; content: string }[] }>(
        "read_blobs",
        {
          shas: pending,
        },
      );
      if (!read.blobs.length) throw new Error("A file couldn't be read for the push.");
      await transport.github("push_blobs", { ...repo, blobs: read.blobs });
      pending = pending.slice(read.blobs.length);
    }
  }
  for (const trees of chunks(plan.trees, BATCH))
    await transport.github("push_trees", { ...repo, trees });
  for (const commits of chunks(plan.commits, BATCH))
    await transport.github("push_commits", { ...repo, commits });
  await transport.github("update_ref", {
    ...repo,
    branch,
    sha: plan.head,
    create: !ref.sha,
    replaceSeed: Boolean(ref.sha && ref.seed),
  });
  await transport.native("record_push", { branch, sha: plan.head });
  return { branch, sha: plan.head, upToDate: false, commits: plan.commits.length, url };
}

/** Brings in GitHub's history down to `depth` commits from `tip`, writing
 * commits, folders and files the project doesn't have. Returns the commits
 * whose parents weren't brought in (the shallow boundary). */
export async function fetchHistory(
  transport: GitTransport,
  repo: GitHubRepo,
  tip: string,
  depth = HISTORY_DEPTH,
): Promise<string[]> {
  const commits: CommitData[] = [];
  const seen = new Set<string>();
  let queue = [tip];
  while (queue.length && commits.length < depth) {
    const batch = queue
      .filter((sha) => !seen.has(sha))
      .slice(0, Math.min(BATCH, depth - commits.length));
    queue = queue.filter((sha) => !batch.includes(sha));
    batch.forEach((sha) => seen.add(sha));
    const { missing } = await transport.native<{ missing: string[] }>("missing", { shas: batch });
    if (!missing.length) continue;
    const got = await transport.github<{ commits: CommitData[] }>("commits", {
      ...repo,
      shas: missing,
    });
    for (const commit of got.commits) {
      commit.parents ??= [];
      commits.push(commit);
      queue.push(...commit.parents.filter((parent) => !seen.has(parent)));
    }
  }
  const trees: TreeData[] = [];
  const blobs = new Map<string, number>();
  const treeShas = [...new Set(commits.map((commit) => commit.tree))];
  const { missing: missingTrees } = await transport.native<{ missing: string[] }>("missing", {
    shas: treeShas,
  });
  for (const sha of missingTrees) {
    const listing = await transport.github<{
      trees: TreeData[];
      blobs: { sha: string; size: number }[];
    }>("tree", { ...repo, sha });
    trees.push(...listing.trees);
    for (const blob of listing.blobs) blobs.set(blob.sha, blob.size);
  }
  const { missing: missingBlobs } = await transport.native<{ missing: string[] }>("missing", {
    shas: [...blobs.keys()],
  });
  const wanted = missingBlobs.map((sha) => ({ sha, size: blobs.get(sha) ?? 0 }));
  for (const group of bySize(wanted, FETCH_BYTES)) {
    const got = await transport.github<{ blobs: { sha: string; content: string }[] }>("blobs", {
      ...repo,
      shas: group.map((blob) => blob.sha),
    });
    await transport.native("write_objects", { blobs: got.blobs });
  }
  for (const group of chunks(trees, 500)) await transport.native("write_objects", { trees: group });
  const written = await transport.native<{ unmatched: string[] }>("write_objects", { commits });
  const unmatched = new Set(written.unmatched);
  if (unmatched.has(tip)) {
    throw new Error(
      "GitHub's latest commit couldn't be recreated exactly, so Misty can't sync it.",
    );
  }
  const kept = commits.filter((commit) => !unmatched.has(commit.sha));
  const keptShas = new Set(kept.map((commit) => commit.sha));
  const parents = [...new Set(kept.flatMap((commit) => commit.parents))].filter(
    (sha) => !keptShas.has(sha),
  );
  const { missing: absentParents } = await transport.native<{ missing: string[] }>("missing", {
    shas: parents,
  });
  const absent = new Set(absentParents);
  return kept
    .filter((commit) => commit.parents.some((parent) => absent.has(parent)))
    .map((commit) => commit.sha);
}

export interface PullResult {
  state: "updated" | "up_to_date" | "ahead" | "diverged" | "blocked" | "not_on_github";
  branch: string;
}

/** Brings the current branch up to GitHub's when that's a fast-forward. */
export async function pull(transport: GitTransport): Promise<PullResult> {
  const status = await gitStatus(transport);
  const { owner, name, branch } = requireGitHub(status);
  const ref = await transport.github<{ sha: string | null; seed?: boolean }>("ref", {
    owner,
    name,
    branch,
  });
  if (!ref.sha || ref.seed) return { state: "not_on_github", branch };
  if (ref.sha === status.head) return { state: "up_to_date", branch };
  const boundary = await fetchHistory(transport, { owner, name }, ref.sha);
  const result = await transport.native<{ state: PullResult["state"] }>("update_branch", {
    branch,
    sha: ref.sha,
    boundary,
  });
  return { state: result.state, branch };
}

/** Fills a project prepared by `code_clone_project` with GitHub's history. */
export async function cloneInto(
  transport: GitTransport,
  repo: GitHubRepo,
  branch: string,
): Promise<PullResult> {
  const ref = await transport.github<{ sha: string | null; seed?: boolean }>("ref", {
    ...repo,
    branch,
  });
  if (!ref.sha || ref.seed) return { state: "not_on_github", branch };
  const boundary = await fetchHistory(transport, repo, ref.sha);
  const result = await transport.native<{ state: PullResult["state"] }>("update_branch", {
    branch,
    sha: ref.sha,
    boundary,
  });
  return { state: result.state, branch };
}

/** Creates a GitHub repository for a local project and pushes it. */
export async function publish(
  transport: GitTransport,
  options: { name: string; private: boolean; description?: string },
): Promise<PushResult & { repo: GitHubRepo }> {
  const status = await gitStatus(transport);
  if (!status.repository) throw new Error("Turn on Git for this project first.");
  if (status.github) throw new Error("This project is already on GitHub.");
  if (!status.head) throw new Error("Commit the project's files before publishing.");
  const created = await transport.github<{ owner: string; name: string; defaultBranch: string }>(
    "create_repo",
    { name: options.name, private: options.private, description: options.description ?? "" },
  );
  const repo = { owner: created.owner, name: created.name };
  await transport.native("set_origin", { ...repo, defaultBranch: created.defaultBranch });
  return { ...(await push(transport)), repo };
}

/** Opens a pull request from the current branch into the default branch. */
export async function openPullRequest(
  transport: GitTransport,
  options: { title: string; body?: string },
): Promise<{ number: number; url: string; existing?: boolean }> {
  const status = await gitStatus(transport);
  const { owner, name, branch } = requireGitHub(status);
  const base = status.defaultBranch || "main";
  if (branch === base)
    throw new Error(`You're on ${base}; push a separate branch to open a pull request.`);
  return transport.github("pull_request", {
    owner,
    name,
    head: branch,
    base,
    title: options.title,
    body: options.body ?? "",
  });
}
