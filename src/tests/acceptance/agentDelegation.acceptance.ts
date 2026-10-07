import { describe, expect, it } from "vitest";
import { liveAcceptanceEnabled } from "./liveEnv";
import { MistyClient, seedSpaceMember, type InvocationRun } from "./mistyClient";
import { writeAcceptanceReport } from "./report";

// Agents for other members, live: Alice's agent asks Bob's agent, which Bob
// published to a Space they share. Bob's listing asks first, so the work waits
// for his approval, runs as his agent in that Space, and Alice's agent reads
// the reply. See "Agents for other members" in the agent architecture brief.

interface RequestView {
  state: string;
  view: { reply?: string; error?: string };
}

const ran = (run: InvocationRun, name: string) =>
  run.tools.some((tool) => tool.outcome === "completed" && tool.name === name);

function record(name: string, prompt: string, run: InvocationRun) {
  writeAcceptanceReport(name, {
    prompt,
    terminal: run.terminal,
    text: run.text,
    tools: run.tools,
    events: run.events.map((event) => event.type),
  });
}

async function finished(client: MistyClient, requestId: string, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let current = await client.json<RequestView>(`/agent-requests/${requestId}`);
  while (!["completed", "failed", "canceled"].includes(current.state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    current = await client.json<RequestView>(`/agent-requests/${requestId}`);
  }
  return current;
}

describe.skipIf(!liveAcceptanceEnabled)("agents ask other members' agents", () => {
  it("answers through Bob's agent after Bob approves", async () => {
    const alice = await MistyClient.register();
    const bob = await MistyClient.register();
    const created = await alice.json<{ space: { id: string } }>("/spaces", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ name: "Launch team", template_id: "", integration_providers: [] }),
    });
    const space = created.space.id;
    seedSpaceMember(space, bob.userId);
    await bob.json(`/spaces/${space}/notes`, {
      method: "POST",
      body: JSON.stringify({ title: "Launch date: Friday, October 9" }),
    });
    const researcher = await bob.json<{ id: string }>("/misty/agents", {
      method: "POST",
      body: JSON.stringify({
        name: "Researcher",
        role: "Research",
        instructions: "Answer questions from the notes in the Space you are working in.",
        enabled: true,
      }),
    });
    await bob.json(`/spaces/${space}/agent-listings/${researcher.id}`, {
      method: "PUT",
      body: JSON.stringify({ description: "Answers questions from the Launch team notes" }),
    });
    const aliceAgents = await alice.json<{ agents: Array<{ id: string }> }>("/misty/agents");
    const aliceAgent = aliceAgents.agents[0]?.id ?? "";

    const prompt = "Ask Bob's Researcher agent in the Launch team Space what the launch date is.";
    const ask = await alice.invoke(prompt, { agent_id: aliceAgent });
    record("delegation-ask", prompt, ask);
    expect(ask.terminal).toBe("invocation.completed");
    expect(ran(ask, "agents_request")).toBe(true);

    const pending = await bob.json<{ requests: Array<{ id: string; requester_name: string }> }>(
      "/me/agent-requests",
    );
    expect(pending.requests).toHaveLength(1);
    const requestId = pending.requests[0].id;
    expect((await alice.json<RequestView>(`/agent-requests/${requestId}`)).state).toBe(
      "awaiting_approval",
    );
    await bob.json(`/agent-requests/${requestId}/approve`, { method: "POST" });

    const done = await finished(alice, requestId);
    writeAcceptanceReport("delegation-reply", { request: done });
    expect(done.state).toBe("completed");
    expect(done.view.reply ?? "").toMatch(/Friday|October 9/i);

    const followUp = "Did Bob's agent answer? What is the launch date?";
    const read = await alice.invoke(followUp, {
      agent_id: aliceAgent,
      conversation_id: ask.conversationId,
    });
    record("delegation-follow-up", followUp, read);
    expect(read.terminal).toBe("invocation.completed");
    expect(read.text).toMatch(/Friday|October 9/i);
  }, 600_000);
});
