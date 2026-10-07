import { beforeAll, describe, expect, it } from "vitest";
import { liveAcceptanceEnabled } from "./liveEnv";
import { MistyClient, seedSpaceMember, type InvocationRun } from "./mistyClient";
import { writeAcceptanceReport } from "./report";

// Phases 1–3, live: the acceptance prompts from docs/design/agent-architecture
// BRIEF.md, sent to the local development server (its runtime, model and
// Composio project) as a fresh account with known notes and a team chat.
// Phase 4 runs separately in screenAct.acceptance.ts.

const refusal =
  /\b(I can(?:'|’|no)t|I(?:'m|’m| am) (?:unable|not able)|I don(?:'|’)t have (?:access|the ability))\b/i;

let client: MistyClient;
let agentId: string;
const seeded = { latest: [] as string[], checklist: "" };

async function note(spaceId: string, title: string) {
  await client.json(`/spaces/${spaceId}/notes`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  // Distinct creation times make "latest" unambiguous.
  await new Promise((resolve) => setTimeout(resolve, 1100));
}

async function space(name: string) {
  const created = await client.json<{ space: { id: string } }>("/spaces", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ name, template_id: "", integration_providers: [] }),
  });
  return created.space.id;
}

function ran(run: InvocationRun, ...names: string[]) {
  return run.tools.some((tool) => tool.outcome === "completed" && names.includes(tool.name));
}
const has = (run: InvocationRun, type: string) => run.events.some((event) => event.type === type);

function record(name: string, prompt: string, run: InvocationRun) {
  writeAcceptanceReport(name, {
    prompt,
    terminal: run.terminal,
    text: run.text,
    tools: run.tools,
    events: run.events.map((event) => event.type),
    requests: run.events.filter((event) => /\.request$|approval/.test(event.type)),
  });
}

async function ask(name: string, prompt: string, options: Record<string, unknown> = {}) {
  const run = await client.invoke(prompt, { agent_id: agentId, ...options });
  record(name, prompt, run);
  return run;
}

describe.skipIf(!liveAcceptanceEnabled)("acceptance prompts on the local server", () => {
  beforeAll(async () => {
    client = await MistyClient.register();
    const agents = await client.json<{ agents: Array<{ id: string }> }>("/misty/agents");
    agentId = agents.agents[0]?.id ?? "";
    const personal = await space("Personal");
    const launch = await space("Launch team");
    await note(personal, "Grocery list");
    await note(launch, "Launch checklist");
    await note(personal, "Trip ideas");
    await note(launch, "Launch retro notes");
    seeded.latest = ["Launch retro notes", "Trip ideas"];
    const teammate = await MistyClient.register();
    seedSpaceMember(launch, teammate.userId);
    await client.json(`/spaces/${launch}/conversations`, {
      method: "POST",
      body: JSON.stringify({
        title: "Launch team",
        participants: [{ kind: "person", user_id: teammate.userId }],
      }),
    });
  }, 120_000);

  it("phase 1: finds the two latest notes across spaces", async () => {
    const run = await ask("phase1-latest-notes", "find my two latest notes across spaces");
    expect(run.terminal).toBe("invocation.completed");
    expect(ran(run, "notes_search")).toBe(true);
    for (const title of seeded.latest) expect(run.text).toContain(title);
    expect(run.text).not.toMatch(refusal);
  });

  it("phase 1: updates the note it just read", async () => {
    const read = await ask(
      "phase1-read-note",
      "Open my note Launch checklist and tell me what it says.",
    );
    expect(ran(read, "notes_read", "notes_search")).toBe(true);
    const run = await ask(
      "phase1-update-note",
      "update the note I just read: add a line saying Book the venue.",
      { conversation_id: read.conversationId },
    );
    expect(run.terminal).toBe("invocation.completed");
    expect(ran(run, "notes_update")).toBe(true);
    expect(run.text).not.toMatch(refusal);
  });

  it("phase 1: tells the team without word-overlap checks", async () => {
    const run = await ask("phase1-tell-team", "tell the team the launch moved to Friday");
    expect(run.terminal).toBe("invocation.completed");
    expect(ran(run, "messages_send") || has(run, "approval.required")).toBe(true);
    expect(run.text).not.toMatch(refusal);
  });

  it("phase 2: reaches Gmail through Composio, with a connect card when needed", async () => {
    const run = await ask("phase2-gmail", "just tell me what emails I missed");
    expect(run.terminal).toBe("invocation.completed");
    expect(has(run, "app.request") || ran(run, "apps_execute")).toBe(true);
  });

  it("phase 2: the Google Drive request uses notes and Composio Drive", async () => {
    const run = await ask(
      "phase2-drive",
      'check spaces, gather my two latest notes and upload them to my google drive and move them to a folder called "misty space notes"',
    );
    expect(run.terminal).toBe("invocation.completed");
    expect(ran(run, "notes_search", "notes_read")).toBe(true);
    expect(has(run, "app.request") || ran(run, "apps_execute")).toBe(true);
  });

  it("phase 2–3: researches with Composio or a screen, never a refusal", async () => {
    const run = await ask("phase23-research", "Research GothamChess's latest uploads", {
      window_label: "main",
    });
    expect(run.terminal).toBe("invocation.completed");
    expect(
      has(run, "screen.request") ||
        has(run, "app.request") ||
        ran(run, "apps_execute", "apps_search"),
    ).toBe(true);
    expect(run.text).not.toMatch(refusal);
  });

  it("phase 3: asks for a screen to open example.com", async () => {
    const run = await ask("phase3-open-screen", "Open example.com and tell me the heading", {
      window_label: "main",
    });
    expect(run.terminal).toBe("invocation.completed");
    const request = run.events.find((event) => event.type === "screen.request") as
      { screenRequest?: { kind?: string; url?: string } } | undefined;
    expect(request?.screenRequest?.kind).toBe("open");
    expect(request?.screenRequest?.url ?? "").toContain("example.com");
  });

  it("phase 4: asks for the desktop to work in another Mac app", async () => {
    const run = await ask(
      "phase4-desktop-handoff",
      "Add a row with Rent and 1200 to the budget sheet open in Numbers",
      {
        window_label: "main",
      },
    );
    expect(run.terminal).toBe("invocation.completed");
    const request = run.events.find((event) => event.type === "screen.request") as
      { screenRequest?: { kind?: string } } | undefined;
    expect(request?.screenRequest?.kind).toBe("desktop");
  });
});
