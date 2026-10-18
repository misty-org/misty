import { describe, expect, it } from "vitest";
import { liveAcceptanceEnabled } from "./liveEnv";
import { MistyClient, seedSpaceMember, type InvocationRun } from "./mistyClient";
import { writeAcceptanceReport } from "./report";

// Agents for other members, live: Alice's agent asks Bob's agent, which Bob
// brought into a Space they share. The work starts at once, runs as his agent
// in that Space, is billed to Alice, and Alice's agent reads the reply.

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

describe.skipIf(!liveAcceptanceEnabled)("agents ask other members' agents", () => {
  it("answers through Bob's agent", async () => {
    const alice = await MistyClient.register();
    const bob = await MistyClient.register();
    const created = await alice.json<{ space: { id: string } }>("/spaces", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ name: "Launch team" }),
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
    await bob.json(`/spaces/${space}/agents/${researcher.id}`, { method: "PUT" });
    const aliceAgents = await alice.json<{ agents: Array<{ id: string }> }>("/misty/agents");
    const aliceAgent = aliceAgents.agents[0]?.id ?? "";

    const prompt = "Ask Bob's Researcher agent in the Launch team Space what the launch date is.";
    const ask = await alice.invoke(prompt, { agent_id: aliceAgent });
    record("delegation-ask", prompt, ask);
    expect(ask.terminal).toBe("invocation.completed");
    expect(ran(ask, "agent_request")).toBe(true);

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
