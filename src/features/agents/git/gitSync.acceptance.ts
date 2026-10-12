import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, describe, expect, it } from "vitest";
import {
  cloneInto,
  gitStatus,
  openPullRequest,
  publish,
  pull,
  push,
  type GitTransport,
} from "./gitSync";

// Git for projects, live (docs/plans/agent-git-projects.md): the same transfer
// steps the app runs, with the real native code (code_eval_bridge) and real
// GitHub through Composio (TestGitHubGitLiveBridge), against a scratch
// repository. Each run pushes to its own new branch.
//
//   MISTY_GITHUB_LIVE_BRIDGE=http://127.0.0.1:47311 \
//   MISTY_GITHUB_LIVE_REPO=kannachi323/misty-git-sync-test \
//   npx vitest run --config .config/vitest.acceptance.config.ts src/features/agents/git/gitSync.acceptance.ts
const bridgeUrl = process.env.MISTY_GITHUB_LIVE_BRIDGE ?? "";
const [owner, name] = (process.env.MISTY_GITHUB_LIVE_REPO ?? "").split("/");
const crate = new URL("../../../../src-tauri/crates/agent-code", import.meta.url).pathname;
const author = { name: "Misty live test", email: "88163196+kannachi323@users.noreply.github.com" };

class Native {
  private next = 0;
  private waiting = new Map<number, (reply: { result?: unknown; error?: string }) => void>();
  constructor(private child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on("line", (line) => {
      const reply = JSON.parse(line) as { id: number; result?: unknown; error?: string };
      this.waiting.get(reply.id)?.(reply);
    });
  }
  call(operation: string, input: unknown, git: boolean) {
    const id = ++this.next;
    return new Promise<unknown>((resolve, reject) => {
      this.waiting.set(id, (reply) =>
        reply.error ? reject(new Error(reply.error)) : resolve(reply.result),
      );
      this.child.stdin.write(`${JSON.stringify({ id, operation, input, git })}\n`);
    });
  }
  close() {
    this.child.kill();
  }
}

const cleanups: (() => void)[] = [];
afterAll(() => cleanups.forEach((cleanup) => cleanup()));

function project(binary: string) {
  const dir = mkdtempSync(join(tmpdir(), "misty-git-live-"));
  const root = join(dir, "project");
  spawnSync("mkdir", [root]);
  const native = new Native(
    spawn(binary, ["--project", root, "--data", join(dir, "data")], {
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams,
  );
  cleanups.push(() => {
    native.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const transport: GitTransport = {
    native: async (operation, input = {}) => {
      const result = (await native.call(operation, input, true)) as {
        status?: string;
        tool_error?: { message: string };
      };
      if (result?.status === "failure") throw new Error(result.tool_error?.message);
      return result as never;
    },
    github: async (op, args = {}) => {
      // eslint-disable-next-line no-restricted-globals -- the live test calls the local GitHub test bridge.
      const response = await fetch(bridgeUrl, {
        method: "POST",
        body: JSON.stringify({ op, args }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      return body;
    },
  };
  const tool = (operation: string, input: unknown) => native.call(operation, input, false);
  return { root, transport, tool };
}

describe.skipIf(!bridgeUrl || !owner || !name)("Git through GitHub's API, live", () => {
  it("pushes a new branch, clones it, and syncs commits both ways with identical hashes", async () => {
    const built = spawnSync("cargo", ["build", "-q", "--example", "code_eval_bridge"], {
      cwd: crate,
      stdio: "inherit",
    });
    expect(built.status).toBe(0);
    const binary = join(crate, "target/debug/examples/code_eval_bridge");
    const branch = `misty-live-${Date.now()}`;

    // A local project with two commits, on a new branch of the scratch repo.
    const first = project(binary);
    await first.transport.native("init");
    await first.tool("code.write", { path: "index.html", content: "<h1>Live test</h1>\n" });
    await first.tool("code.write", { path: "css/site.css", content: "body { margin: 0 }\n" });
    await first.transport.native("commit", { message: "First page", author });
    await first.tool("code.edit", {
      path: "index.html",
      oldText: "Live test",
      newText: "Live test, again",
    });
    await first.transport.native("commit", { message: "Second page\n\nWith a body.", author });
    await first.transport.native("set_origin", { owner, name, defaultBranch: "main" });
    await first.tool("git.branch", { name: branch, create: true });
    const pushed = await push(first.transport);
    expect(pushed.commits).toBe(2);
    const remote = (await first.transport.github("ref", { owner, name, branch })) as {
      sha: string;
    };
    expect(remote.sha).toBe(pushed.sha);

    // A second project clones that branch: same commit, same files.
    const second = project(binary);
    await second.transport.native("prepare_clone", { owner, name, branch });
    const cloned = await cloneInto(second.transport, { owner, name }, branch);
    expect(cloned.state).toBe("updated");
    expect((await gitStatus(second.transport)).head).toBe(pushed.sha);
    expect(readFileSync(join(second.root, "index.html"), "utf8")).toBe(
      "<h1>Live test, again</h1>\n",
    );

    // The clone commits and pushes; the first project pulls it.
    await second.tool("code.write", { path: "about.html", content: "<p>About</p>\n" });
    await second.transport.native("commit", { message: "About page", author });
    const again = await push(second.transport);
    expect(again.commits).toBe(1);
    const pulled = await pull(first.transport);
    expect(pulled.state).toBe("updated");
    expect((await gitStatus(first.transport)).head).toBe(again.sha);
    expect(readFileSync(join(first.root, "about.html"), "utf8")).toBe("<p>About</p>\n");

    // Opt in with MISTY_GITHUB_LIVE_PR=1: from a branch of main, a pull
    // request, then the same one again rather than a duplicate.
    if (process.env.MISTY_GITHUB_LIVE_PR) {
      const third = project(binary);
      await third.transport.native("prepare_clone", { owner, name, branch: "main" });
      expect((await cloneInto(third.transport, { owner, name }, "main")).state).toBe("updated");
      await third.tool("git.branch", { name: `${branch}-pr`, create: true });
      await third.tool("code.write", { path: "contact.html", content: "<p>Contact</p>\n" });
      await third.transport.native("commit", { message: "Contact page", author });
      await push(third.transport);
      const opened = await openPullRequest(third.transport, {
        title: "Misty live test",
        body: "Safe to close.",
      });
      expect(opened.url).toMatch(/^https:\/\/github\.com\/.+\/pull\/\d+$/);
      const again = await openPullRequest(third.transport, { title: "Misty live test" });
      expect(again).toMatchObject({ number: opened.number, existing: true });
    }

    // Pushing over newer GitHub commits is refused, never forced.
    await first.tool("code.write", { path: "x.txt", content: "first\n" });
    await first.transport.native("commit", { message: "From first", author });
    await second.tool("code.write", { path: "y.txt", content: "second\n" });
    await second.transport.native("commit", { message: "From second", author });
    await push(second.transport);
    await expect(push(first.transport)).rejects.toThrow(/Pull first|pull first/);
  }, 600_000);

  // Creates a repository on the account; opt in with MISTY_GITHUB_LIVE_PUBLISH=<new repo name>.
  it.skipIf(!process.env.MISTY_GITHUB_LIVE_PUBLISH)(
    "publishes a local project, replacing GitHub's seed with its own history",
    async () => {
      const binary = join(crate, "target/debug/examples/code_eval_bridge");
      const local = project(binary);
      await local.transport.native("init");
      await local.tool("code.write", { path: "index.html", content: "<h1>Published</h1>\n" });
      const commit = (await local.transport.native("commit", {
        message: "First page",
        author,
      })) as { sha: string };
      const published = await publish(local.transport, {
        name: process.env.MISTY_GITHUB_LIVE_PUBLISH!,
        private: true,
        description: "Misty publish test (safe to delete)",
      });
      expect(published.sha).toBe(commit.sha);
      const ref = (await local.transport.github("ref", { ...published.repo, branch: "main" })) as {
        sha: string;
        seed: boolean;
      };
      expect(ref).toMatchObject({ sha: commit.sha, seed: false });
      const status = await gitStatus(local.transport);
      expect(status).toMatchObject({ published: true, ahead: 0, github: published.repo });
    },
    300_000,
  );
});
