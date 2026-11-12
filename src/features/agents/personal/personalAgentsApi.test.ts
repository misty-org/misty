import { beforeEach, expect, it, vi } from "vitest";

// Saved documents by kind, then id, as misty.db keeps them.
const rows = new Map<string, string>();
const key = (kind: string, id: string) => `${kind}:${id}`;
vi.mock("../conversations/state/localChats", () => ({
  localDocuments: {
    list: async (_account: string, kind: string) =>
      [...rows].filter(([at]) => at.startsWith(`${kind}:`)).map(([, row]) => row),
    get: async (_account: string, kind: string, id: string) => rows.get(key(kind, id)) ?? null,
    swap: async (
      _account: string,
      kind: string,
      id: string,
      expected: string | null,
      next: string,
    ) => {
      if ((rows.get(key(kind, id)) ?? null) !== expected) return false;
      rows.set(key(kind, id), next);
      return true;
    },
    remove: async (_account: string, kind: string, id: string) => void rows.delete(key(kind, id)),
  },
}));
const engines = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../engines/enginesApi", () => ({ listEngines: engines.list, mistyEngine: "misty" }));
vi.mock("./agentAccount", () => ({ agentAccountId: () => "acct" }));
// The device's settings rows: a commit lands only on the revision it read, as natively.
const note = { revision: 0, state: null as { engines: string[] } | null };
vi.mock("@/native/invoke", () => ({
  invoke: async (
    command: string,
    input: { revision?: number; document?: { engines: string[] } },
  ) => {
    if (command === "settings_session_commit") {
      if (input.revision !== note.revision) throw new Error("SETTINGS_REVISION_CONFLICT");
      note.revision += 1;
      note.state = input.document ?? null;
    }
    return { revision: note.revision, state: note.state };
  },
}));

import { listPersonalAgents, newAgentOn, personalAgentsApi } from "./personalAgentsApi";

beforeEach(() => {
  rows.clear();
  note.revision = 0;
  note.state = null;
  engines.list.mockResolvedValue([
    { id: "claude", name: "Claude Code", installed: true, version: "2" },
    { id: "codex", name: "Codex", installed: false, version: null },
  ]);
});

it("makes an agent for each engine found installed, once", async () => {
  const first = await listPersonalAgents("acct");
  expect(first.map((agent) => agent.name)).toEqual(["Misty", "Claude Code"]);
  expect(first[1]).toMatchObject({ engine: "claude", default_run_mode: "ask" });
  // Codex is installed later: it gets its agent then, and Claude Code is not made twice.
  engines.list.mockResolvedValue([
    { id: "claude", name: "Claude Code", installed: true, version: "2" },
    { id: "codex", name: "Codex", installed: true, version: "1" },
  ]);
  const second = await listPersonalAgents("acct");
  expect(second.map((agent) => agent.name)).toEqual(["Misty", "Claude Code", "Codex"]);
});

it("does not bring back an engine's agent the person removed", async () => {
  const [, claude] = await listPersonalAgents("acct");
  await personalAgentsApi.remove(claude!.id);
  expect((await listPersonalAgents("acct")).map((agent) => agent.name)).toEqual(["Misty"]);
});

it("still lists the agents when the engines can't be asked", async () => {
  engines.list.mockRejectedValue(new Error("no native side"));
  expect((await listPersonalAgents("acct")).map((agent) => agent.name)).toEqual(["Misty"]);
});

it("makes one agent when two listings run at once", async () => {
  await Promise.all([listPersonalAgents("acct"), listPersonalAgents("acct")]);
  const agents = await listPersonalAgents("acct");
  expect(agents.filter((agent) => agent.engine === "claude")).toHaveLength(1);
});

it("leaves the person's own agent on an engine as the only one, even after a reinstall", async () => {
  await listPersonalAgents("acct");
  // A rebuilt app has lost nothing: the note is in misty.db, so nothing is offered a second time.
  expect(
    (await listPersonalAgents("acct")).filter((agent) => agent.engine === "claude"),
  ).toHaveLength(1);
});

/** A Codex agent made by hand before the engine's own one was. */
const handMade = (id: string, created_at: string) => ({
  id,
  owner_user_id: "acct",
  name: "Codex",
  instructions: "",
  engine: "codex",
  enabled: true,
  system_managed: false,
  version: 1,
  created_at,
  updated_at: created_at,
});

it("merges the copy made when the engine was found into the person's own agent", async () => {
  engines.list.mockResolvedValue([{ id: "codex", name: "Codex", installed: true, version: "1" }]);
  const own = handMade("personal_own", "2026-01-01T00:00:00.000Z");
  const copy = handMade("personal_engine_codex", "2026-02-01T00:00:00.000Z");
  rows.set(key("agent", own.id), JSON.stringify(own));
  rows.set(key("agent", copy.id), JSON.stringify(copy));
  rows.set(key("conversation", "c1"), JSON.stringify({ id: "c1", agentId: copy.id }));
  const agents = await listPersonalAgents("acct");
  expect(agents.filter((agent) => agent.engine === "codex").map((agent) => agent.id)).toEqual([
    own.id,
  ]);
  expect(JSON.parse(rows.get(key("conversation", "c1"))!)).toMatchObject({ agentId: own.id });
});

it("keeps every agent the person made, even two alike on one engine", async () => {
  engines.list.mockResolvedValue([{ id: "codex", name: "Codex", installed: true, version: "1" }]);
  for (const agent of [
    handMade("personal_a", "2026-01-01T00:00:00.000Z"),
    handMade("personal_b", "2026-02-01T00:00:00.000Z"),
  ])
    rows.set(key("agent", agent.id), JSON.stringify(agent));
  expect(
    (await listPersonalAgents("acct")).filter((agent) => agent.engine === "codex"),
  ).toHaveLength(2);
});

it("keeps a copy that is named elsewhere", async () => {
  engines.list.mockResolvedValue([{ id: "codex", name: "Codex", installed: true, version: "1" }]);
  const own = handMade("personal_own", "2026-01-01T00:00:00.000Z");
  const copy = handMade("personal_engine_codex", "2026-02-01T00:00:00.000Z");
  rows.set(key("agent", own.id), JSON.stringify(own));
  rows.set(key("agent", copy.id), JSON.stringify(copy));
  rows.set(key("tutor_job", "j1"), JSON.stringify({ kind: "brief", agentId: copy.id }));
  expect(
    (await listPersonalAgents("acct")).filter((agent) => agent.engine === "codex"),
  ).toHaveLength(2);
});

it("names a new agent after its engine unless given a name", async () => {
  const codex = { id: "codex", name: "Codex", installed: true, version: "1" };
  expect(await newAgentOn("acct", codex)).toMatchObject({ name: "Codex", engine: "codex" });
  expect(await newAgentOn("acct", codex, "  Reviewer ")).toMatchObject({ name: "Reviewer" });
});
