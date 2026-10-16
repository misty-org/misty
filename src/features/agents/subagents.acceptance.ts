import { beforeAll, describe, expect, it } from "vitest";
import { liveAcceptanceEnabled } from "@/tests/acceptance/liveEnv";
import { MistyClient, type InvocationRun } from "@/tests/acceptance/mistyClient";
import { writeAcceptanceReport } from "@/tests/acceptance/report";

// Phase 4 of docs/plans/agentic-browser.md, live on the local server: a run
// splits research across sub-agents with agent_delegate, keeps a notebook,
// and merges what they found. No browser is attached, so the sub-agents
// research with web search. The account's first Space is its personal one,
// where the notebook is mirrored as a note.
let client: MistyClient;
let agentId: string;
let spaceId: string;

const last = <T>(items: T[]): T | undefined => items[items.length - 1];
const ran = (run: InvocationRun, name: string) =>
  run.tools.some((tool) => tool.outcome === "completed" && tool.name === name);

describe.skipIf(!liveAcceptanceEnabled)("sub-agents and the notebook on the local server", () => {
  beforeAll(async () => {
    client = await MistyClient.register();
    const agents = await client.json<{ agents: Array<{ id: string }> }>("/misty/agents");
    agentId = agents.agents[0]?.id ?? "";
    const created = await client.json<{ space: { id: string } }>("/spaces", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ name: "Personal", template_id: "", integration_providers: [] }),
    });
    spaceId = created.space.id;
  }, 120_000);

  it("delegates independent research, keeps a notebook and merges the answers", async () => {
    const prompt =
      "Use sub-agents for this, one per country, working at the same time: find the capital " +
      "city and the official currency of France, Japan and Kenya. Keep a plan in the notebook, " +
      "then give me one table.";
    const run = await client.invoke(prompt, { agent_id: agentId }, 600_000);
    const delegations = run.events.filter((event) => event.type === "delegation.updated") as Array<{
      delegation?: { children?: Array<{ state: string; goal: string; summary?: string }> };
    }>;
    const notebooks = run.events.filter((event) => event.type === "notebook.updated") as Array<{
      notebook?: { plan: string; findings: string; noteId?: string };
    }>;
    writeAcceptanceReport("phase4-subagents", {
      prompt,
      terminal: run.terminal,
      text: run.text,
      tools: run.tools,
      delegation: last(delegations)?.delegation,
      notebook: last(notebooks)?.notebook,
    });
    // A run that cannot source a fact reports itself incomplete. Allow that
    // only while web search is down (it needs Gateway credit).
    const searches = run.tools.filter(
      (tool) => tool.name === "web_search" && tool.outcome !== "started",
    );
    const searchDown = searches.length > 0 && searches.every((tool) => tool.outcome === "failed");
    expect(
      searchDown ? ["invocation.completed", "invocation.failed"] : ["invocation.completed"],
    ).toContain(run.terminal);
    expect(ran(run, "agent_delegate")).toBe(true);
    const children = last(delegations)?.delegation?.children ?? [];
    // One per country; a retry after a failed source may add more.
    expect(children.length).toBeGreaterThanOrEqual(3);
    for (const country of ["France", "Japan", "Kenya"])
      expect(children.some((child) => child.goal.includes(country))).toBe(true);
    // Every sub-agent finished with an answer. One may still report itself
    // incomplete when a source was unreachable (web search needs Gateway credit).
    expect(
      children.every(
        (child) => ["completed", "failed"].includes(child.state) && Boolean(child.summary),
      ),
    ).toBe(true);
    expect(children.some((child) => child.state === "completed")).toBe(true);
    for (const answer of ["Paris", "Tokyo", "Nairobi", "euro", "yen", "shilling"])
      expect(run.text.toLowerCase()).toContain(answer.toLowerCase());
    // The sub-agents' findings reached the conversation; the agent's own
    // checklist did not.
    const notebook = last(notebooks)?.notebook;
    expect(notebook?.plan.trim()).toBeFalsy();
    expect(notebook?.findings.trim()).toBeTruthy();
    // The findings are a note in the personal Space.
    expect(notebook?.noteId).toBeTruthy();
    const note = await client.json<{ title: string; markdown?: string }>(
      `/spaces/${spaceId}/notes/${notebook?.noteId}`,
    );
    expect(note.title.startsWith("Notebook")).toBe(true);
    expect(note.markdown ?? "").toContain("## Findings");
  }, 660_000);
});
