import { describe, expect, it, vi } from "vitest";
import { fetchHistory, openPullRequest, pull, push, type GitTransport } from "./gitSync";

type Call = [string, Record<string, unknown>];

function fake(
  native: Record<string, (input: Record<string, unknown>) => unknown>,
  github: Record<string, (args: Record<string, unknown>) => unknown>,
) {
  const calls: Call[] = [];
  const transport: GitTransport = {
    native: vi.fn(async (operation: string, input: Record<string, unknown> = {}) => {
      calls.push([`native:${operation}`, input]);
      const handler = native[operation];
      if (!handler) throw new Error(`unexpected native ${operation}`);
      return handler(input) as never;
    }),
    github: vi.fn(async (op: string, args: Record<string, unknown> = {}) => {
      calls.push([`github:${op}`, args]);
      const handler = github[op];
      if (!handler) throw new Error(`unexpected github ${op}`);
      return handler(args) as never;
    }),
  };
  return { transport, calls, names: () => calls.map(([name]) => name) };
}

const status = {
  repository: true,
  branch: "feature",
  head: "c2",
  github: { owner: "o", name: "r" },
  defaultBranch: "main",
};
const commit = (sha: string, parents: string[], tree = `t-${sha}`) => ({
  sha,
  tree,
  parents,
  author: { name: "A", email: "a@x", date: "2026-10-12T03:00:00Z" },
  committer: { name: "A", email: "a@x", date: "2026-10-12T03:00:00Z" },
  message: sha,
});

describe("push", () => {
  it("creates a new branch: files in size batches, then folders, commits and the ref", async () => {
    const big = 4 * 1024 * 1024;
    const { transport, calls, names } = fake(
      {
        status: () => status,
        push_plan: () => ({
          github: status.github,
          branch: "feature",
          head: "c2",
          upToDate: false,
          blobs: [
            { sha: "b1", size: big },
            { sha: "b2", size: big },
            { sha: "b3", size: 10 },
          ],
          trees: [{ sha: "t1", entries: [] }],
          commits: [commit("c1", []), commit("c2", ["c1"])],
        }),
        // The native side may return fewer files than asked (its 8 MB cap).
        read_blobs: ({ shas }) => ({ blobs: [{ sha: (shas as string[])[0], content: "eA==" }] }),
        record_push: () => ({}),
      },
      {
        ref: () => ({ sha: null, empty: false }),
        push_blobs: () => ({}),
        push_trees: () => ({}),
        push_commits: () => ({}),
        update_ref: () => ({}),
      },
    );
    const result = await push(transport);
    expect(result).toMatchObject({ branch: "feature", sha: "c2", commits: 2, upToDate: false });
    const pushed = calls
      .filter(([name]) => name === "github:push_blobs")
      .flatMap(([, args]) => (args.blobs as { sha: string }[]).map((blob) => blob.sha));
    expect(pushed).toEqual(["b1", "b2", "b3"]);
    expect(names().indexOf("github:push_trees")).toBeGreaterThan(
      names().lastIndexOf("github:push_blobs"),
    );
    expect(names().indexOf("github:push_commits")).toBeGreaterThan(
      names().indexOf("github:push_trees"),
    );
    expect(calls.find(([name]) => name === "github:update_ref")?.[1]).toMatchObject({
      branch: "feature",
      sha: "c2",
      create: true,
      replaceSeed: false,
    });
    expect(names()[names().length - 1]).toBe("native:record_push");
  });

  it("replaces the seed of a repository Misty created, and seeds an empty one first", async () => {
    let seeded = false;
    const { transport, calls } = fake(
      {
        status: () => ({ ...status, branch: "main" }),
        push_plan: ({ remoteHead }) => {
          expect(remoteHead).toBeNull();
          return {
            github: status.github,
            branch: "main",
            head: "c1",
            upToDate: false,
            blobs: [],
            trees: [],
            commits: [commit("c1", [])],
          };
        },
        record_push: () => ({}),
      },
      {
        ref: () => (seeded ? { sha: "seed", seed: true } : { sha: null, empty: true }),
        seed: () => {
          seeded = true;
          return {};
        },
        push_trees: () => ({}),
        push_commits: () => ({}),
        update_ref: () => ({}),
      },
    );
    await push(transport);
    expect(calls.find(([name]) => name === "github:update_ref")?.[1]).toMatchObject({
      create: false,
      replaceSeed: true,
    });
  });

  it("does nothing more when GitHub already has the branch", async () => {
    const { transport, names } = fake(
      {
        status: () => status,
        push_plan: () => ({
          github: status.github,
          branch: "feature",
          head: "c2",
          upToDate: true,
          blobs: [],
          trees: [],
          commits: [],
        }),
        record_push: () => ({}),
      },
      { ref: () => ({ sha: "c2", seed: false }) },
    );
    expect((await push(transport)).upToDate).toBe(true);
    expect(names()).not.toContain("github:update_ref");
  });

  it("refuses a project that isn't on GitHub", async () => {
    const { transport } = fake({ status: () => ({ ...status, github: null }) }, {});
    await expect(push(transport)).rejects.toThrow(/Publish it first/);
  });
});

describe("fetchHistory and pull", () => {
  it("walks parents until commits the project has, writes everything, and finds the boundary", async () => {
    const have = new Set(["c0"]);
    const github = {
      commits: ({ shas }: Record<string, unknown>) => ({
        commits: (shas as string[]).map((sha) =>
          sha === "c2"
            ? commit("c2", ["c1"])
            : sha === "c1"
              ? commit("c1", ["c0"])
              : commit(sha, []),
        ),
      }),
      tree: ({ sha }: Record<string, unknown>) => ({
        trees: [{ sha, entries: [] }],
        blobs: [{ sha: `blob-${sha}`, size: 3 }],
      }),
      blobs: ({ shas }: Record<string, unknown>) => ({
        blobs: (shas as string[]).map((sha) => ({ sha, content: "eA==" })),
      }),
    };
    const written: Record<string, unknown>[] = [];
    const { transport } = fake(
      {
        missing: ({ shas }) => ({ missing: (shas as string[]).filter((sha) => !have.has(sha)) }),
        write_objects: (input) => {
          written.push(input);
          return { unmatched: [] };
        },
      },
      github,
    );
    const boundary = await fetchHistory(transport, { owner: "o", name: "r" }, "c2");
    expect(boundary).toEqual([]);
    const commits = written.flatMap(
      (input) => (input.commits as { sha: string }[] | undefined) ?? [],
    );
    expect(commits.map((item) => item.sha).sort()).toEqual(["c1", "c2"]);

    // With a depth of one, the tip's parent stays on GitHub: a boundary.
    const shallow = await fetchHistory(transport, { owner: "o", name: "r" }, "c2", 1);
    expect(shallow).toEqual(["c2"]);
  });

  it("stops when GitHub's latest commit can't be recreated exactly", async () => {
    const { transport } = fake(
      { missing: ({ shas }) => ({ missing: shas }), write_objects: () => ({ unmatched: ["c2"] }) },
      { commits: () => ({ commits: [commit("c2", [])] }), tree: () => ({ trees: [], blobs: [] }) },
    );
    await expect(fetchHistory(transport, { owner: "o", name: "r" }, "c2")).rejects.toThrow(
      /recreated exactly/,
    );
  });

  it("reports pulls that are up to date or not on GitHub without fetching", async () => {
    const upToDate = fake({ status: () => status }, { ref: () => ({ sha: "c2" }) });
    expect((await pull(upToDate.transport)).state).toBe("up_to_date");
    const missing = fake({ status: () => status }, { ref: () => ({ sha: null }) });
    expect((await pull(missing.transport)).state).toBe("not_on_github");
  });
});

describe("openPullRequest", () => {
  it("opens from the current branch into the default branch", async () => {
    const { transport, calls } = fake(
      { status: () => status },
      { pull_request: () => ({ number: 7, url: "https://github.com/o/r/pull/7" }) },
    );
    await openPullRequest(transport, { title: "Add contact page" });
    expect(calls[calls.length - 1]?.[1]).toMatchObject({
      head: "feature",
      base: "main",
      title: "Add contact page",
    });
  });

  it("refuses from the default branch itself", async () => {
    const { transport } = fake({ status: () => ({ ...status, branch: "main" }) }, {});
    await expect(openPullRequest(transport, { title: "x" })).rejects.toThrow(/separate branch/);
  });
});
