import "@/tests/ports/spaces";
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
vi.mock("../engines/enginesApi", () => ({
  listEngines: async () => [],
  mistyEngine: "misty",
}));
vi.mock("./agentAccount", () => ({ agentAccountId: () => "acct" }));
vi.mock("@/shared/platform/nativeInvoke", () => ({
  invoke: async () => ({ revision: 0, state: { engines: [] } }),
}));

import { useSpaceWindowStore } from "@/features/app-windows";
import { useSpacesStore } from "@/features/spaces/core";
import { moveAgentHome } from "./agentHomeSpace";
import { listPersonalAgents, personalAgentsApi } from "./personalAgentsApi";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import { HomeSpaceGone, runHomeSpace } from "../runs/local-run/runSpace";

const input = {
  name: "Reviewer",
  role: "",
  description: "",
  instructions: "",
  icon: "",
  avatar: {},
  model_mode: "automatic" as const,
  model_id: "",
  reasoning_effort: "",
  enabled: true,
  default_run_mode: "ask" as const,
};

const window = (key: string, spaceId: string | null) =>
  useSpaceWindowStore.setState({
    identity: { key, spaceId, personal: key === "personal" },
  });

beforeEach(() => {
  rows.clear();
  usePersonalAgentsStore.setState({ accountId: "", agents: [] });
  useSpaceWindowStore.setState({ personalSpaceId: null, personalSpaceOwner: null });
  window("personal", null);
  useSpacesStore.setState({ spaces: [] });
});

it("gives a new agent the Space the window shows", async () => {
  window("team", "team");
  const made = await personalAgentsApi.save(input);
  expect(made.space_id).toBe("team");
});

it("gives agents with no home Space the person's own, saved once the Spaces load", async () => {
  const before = await listPersonalAgents("acct");
  expect(before.find((agent) => agent.system_managed)?.space_id).toBe("");

  useSpaceWindowStore.setState({ personalSpaceId: "own", personalSpaceOwner: "acct" });
  const after = await listPersonalAgents("acct");
  expect(after.find((agent) => agent.system_managed)?.space_id).toBe("own");
  expect(JSON.parse(rows.get("agent:personal_misty")!)).toMatchObject({ space_id: "own" });
});

it("never takes another account's own Space", async () => {
  useSpaceWindowStore.setState({ personalSpaceId: "theirs", personalSpaceOwner: "someone" });
  const agents = await listPersonalAgents("acct");
  expect(agents.every((agent) => agent.space_id === "")).toBe(true);
});

it("moves an agent's home only from its settings, keeping its version", async () => {
  window("team", "team");
  const made = await personalAgentsApi.save(input);
  const moved = await moveAgentHome("acct", made.id, "other");
  expect(moved).toMatchObject({ space_id: "other", version: made.version });
  // Saving its other settings later keeps the move.
  const saved = await personalAgentsApi.save(
    { ...input, space_id: "team", version: made.version } as typeof input,
    made.id,
  );
  expect(saved.space_id).toBe("other");
});

it("runs in the agent's home Space, whichever Space the window shows", async () => {
  window("team", "team");
  const made = await personalAgentsApi.save(input);
  window("elsewhere", "elsewhere");
  await expect(runHomeSpace("acct", made.id)).resolves.toBe("team");
});

it("runs Misty's own in her home Space when the run names no agent", async () => {
  useSpaceWindowStore.setState({ personalSpaceId: "own", personalSpaceOwner: "acct" });
  useSpacesStore.setState({ spaces: [{ id: "own", name: "Mine" } as never] });
  await expect(runHomeSpace("acct", undefined)).resolves.toBe("own");
});

it("says so when the agent's home Space is gone", async () => {
  window("team", "team");
  const made = await personalAgentsApi.save(input);
  useSpaceWindowStore.setState({ personalSpaceId: "own", personalSpaceOwner: "acct" });
  useSpacesStore.setState({
    spaces: [{ id: "own", name: "Mine" } as never],
  });
  const refused = runHomeSpace("acct", made.id);
  await expect(refused).rejects.toBeInstanceOf(HomeSpaceGone);
  await expect(refused).rejects.toThrow(
    "Reviewer's home Space is gone: it was deleted, or you left it. Pick a new home Space in its settings.",
  );
});
