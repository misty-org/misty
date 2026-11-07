// Sub-agents on this computer: a run starts a child, the child runs here, its answer comes
// back to the parent, the chat shows it, and stopping the parent stops the child.
import { inWindow } from "./bridge.mjs";
import { cancelTurn, finish, mock, replyOf, runState, settled, sleep, startChat, untilHeld, waitForState } from "./run.mjs";

const subagentsOf = (runId) =>
  inWindow(
    `const { aiSurfaceApi } = await __smoke.module("features/ai-surface/api.ts");
     return (await aiSurfaceApi.invocationProgress(${JSON.stringify(runId)})).subagents ?? [];`,
  );

const delegate = (id, goal, extra = {}) => ({
  ...extra,
  tools: [{ id, name: "agent_delegate", args: { tasks: [{ goal }], browser: false } }],
});

export const subagentSteps = {
  async subAgents({ check }) {
    const answer = "The child counted seven moons.";
    await mock.reset();
    await mock.script([
      delegate("call_sa1", "Count the moons"),
      { tools: [{ id: "call_sa2", name: "log_work_write", args: { section: "findings", content: "Seven moons, from the child.", mode: "append" } }] },
      finish("call_sa3", answer),
      { tools: [{ id: "call_sa4", name: "agent_wait", args: {} }] },
      finish("call_sa5", "The parent merged it."),
    ]);
    const run = await startChat("Use a sub-agent");
    check("subAgents", "the parent run completes", (await waitForState(run.invocationId, undefined, 120_000)) === "completed");
    await settled();

    const turns = await mock.turns();
    const child = turns.filter((turn) => turn.raw.includes("You are a sub-agent"));
    const parent = turns.filter((turn) => !turn.raw.includes("You are a sub-agent"));
    check("subAgents", "the parent is offered agent_delegate and agent_wait", parent[0]?.tools.includes("agent_delegate") && parent[0]?.tools.includes("agent_wait"), parent[0]?.tools.join());
    check("subAgents", "the child's turns went to the model from this computer", child.length === 2, `${child.length} child turns of ${turns.length}`);
    check("subAgents", "the child can't start children of its own", child[0] && !child[0].tools.includes("agent_delegate"), child[0]?.tools.join());
    check("subAgents", "the child sees its goal, not the parent's chat", child[0]?.raw.includes("Count the moons") && !child[0]?.raw.includes("Use a sub-agent"), child[0]?.raw.slice(0, 400));
    const toolResult = (await mock.toolResults());
    const said = (id) => toolResult.find((item) => item.id === id)?.content ?? "";
    check("subAgents", "agent_delegate returns the child's answer", said("call_sa1").includes(answer) && /"state":"completed"/.test(said("call_sa1")), said("call_sa1"));
    check("subAgents", "agent_wait returns the child's answer", said("call_sa4").includes(answer) && /"still_running":0/.test(said("call_sa4")), said("call_sa4"));

    const reply = await replyOf(run.conversationId, run.invocationId);
    const shown = reply?.subagents?.[0];
    check("subAgents", "delegation.updated reached the chat", reply?.subagents?.length === 1 && shown.goal === "Count the moons", JSON.stringify(reply?.subagents));
    check("subAgents", "the chat shows the child finished, with its answer", shown?.state === "completed" && shown?.summary?.includes("seven moons"), JSON.stringify(shown));
    check("subAgents", "the parent's reply reads as the parent's", reply?.content === "The parent merged it.", reply?.content);
    const childState = shown ? await runState(shown.invocationId) : "";
    check("subAgents", "the child is its own run on this computer", shown?.invocationId !== run.invocationId && childState === "completed", childState);
  },

  async subAgentCancel({ check }) {
    await mock.reset();
    await mock.script([delegate("call_sc1", "Take a long time"), { hold: true, text: "too late" }, finish()]);
    const run = await startChat("Stop me and my sub-agent");
    check("subAgentCancel", "the child is thinking", await untilHeld());
    let children = [];
    for (let tries = 0; tries < 60 && !children.length; tries++) {
      children = await subagentsOf(run.invocationId);
      if (!children.length) await sleep(250);
    }
    check("subAgentCancel", "the chat lists the running child", children[0]?.state === "running", JSON.stringify(children));
    if (!children[0]) return;
    const started = Date.now();
    await cancelTurn();
    check("subAgentCancel", "the parent is canceled", (await waitForState(run.invocationId, ["canceled", "completed", "failed"], 30_000)) === "canceled");
    const child = await waitForState(children[0].invocationId, ["canceled", "completed", "failed"], 30_000);
    check("subAgentCancel", "the child is canceled with it", child === "canceled", `${child} after ${Date.now() - started} ms`);
    await sleep(1500);
    check("subAgentCancel", "the child's model call was dropped", (await mock.held()) === 0);
    check("subAgentCancel", "no turn came after it", (await mock.turns()).length === 2, `${(await mock.turns()).length} turns`);
    await settled();
    const reply = await replyOf(run.conversationId, run.invocationId);
    check("subAgentCancel", "the chat says the turn was canceled", reply?.state === "canceled", JSON.stringify(reply?.state));
  },
};
