// What the smoke test checks of a run in progress (README.md): the app dying under it, canceling it,
// its modes, voice, memory, and what the window's console said along the way.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inWindow } from "./bridge.mjs";
import { finish, findInWorkspaces, mock, notAllowed, output, runState, shell, sleep, startChat, waitForState } from "./run.mjs";

async function untilHeld(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !(await mock.held())) await sleep(150);
  return mock.held();
}

const pending = () =>
  inWindow(
    `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
     const state = misty.getState();
     const chat = state.conversations.find((item) => item.id === state.invocationConversationId);
     return chat?.messages.at(-1)?.appRequest ?? null;`,
  );
const decide = (id, decision) =>
  inWindow(
    `const { appsApi } = await __smoke.module("features/agents/apps/api.ts");
     return (await appsApi.decide(${JSON.stringify(id)}, ${JSON.stringify(decision)})).request.state;`,
  );
const cancel = () =>
  inWindow(
    `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
     await misty.getState().cancelResponse();
     return true;`,
  );

export const runSteps = {
  async restart({ check, app }) {
    await mock.reset();
    await mock.script([
      shell("call_r1", "echo first >> journal.txt; wc -l < journal.txt"),
      shell("call_r2_never_seen", "echo never-sent >> journal.txt", { hold: true }),
      shell("call_r3", "echo second >> journal.txt; cat journal.txt"),
      finish("call_r4"),
    ]);
    const run = await startChat("Survive a restart");
    check("restart", "the mock holds the second turn's reply", await untilHeld());
    await app.kill();
    await app.start();
    await inWindow("return true");
    check("restart", "the run finishes after the relaunch", (await waitForState(run.invocationId, undefined, 120_000)) === "completed");
    const turns = await mock.turns();
    const results = await mock.toolResults();
    const held = turns.findIndex((turn) => turn.step.hold);
    check("restart", "the same turn is sent again, byte for byte", held >= 0 && turns[held + 1]?.raw === turns[held].raw, `${turns.length} turns`);
    check("restart", "call IDs are the ones from before", results.map((result) => result.id).join() === "call_r1,call_r3", results.map((result) => result.id).join());
    check("restart", "the finished command didn't run again", /"stdout":"first\\nsecond\\n"/.test(results.at(-1)?.content), results.at(-1)?.content);
  },

  // The command's process can outlive the app: nothing kills it when the app dies. This records that,
  // and checks the part that matters to the run: the command isn't run a second time.
  async killDuringCommand({ check, app, dataRoot }) {
    const marker = `smoke-kill-${Date.now() % 100000}`;
    await mock.reset();
    await mock.script([
      shell("call_k1", `: ${marker}; echo ran >> once.txt; sleep 8; echo end >> once.txt`),
      shell("call_k2", "cat once.txt"),
      finish(),
    ]);
    const run = await startChat("Die during a command");
    const running = () => execSync(`pgrep -f '${marker}' || true`).toString().trim();
    for (let tries = 0; tries < 200 && !running(); tries++) await sleep(100);
    await sleep(1500);
    await app.kill();
    console.log(`      the command ${running() ? "outlived" : "died with"} the app`);
    await app.start();
    const state = await waitForState(run.invocationId, undefined, 120_000);
    check("killDuringCommand", "the run reaches an end after the relaunch", ["completed", "failed"].includes(state), state);
    console.log(`      the run ended as ${state}: ${(await mock.turns()).length} turns`);
    await sleep(8000);
    const file = findInWorkspaces(dataRoot, "once.txt");
    const lines = file ? readFileSync(file, "utf8").match(/ran/g)?.length : 0;
    check("killDuringCommand", "the command ran once, not twice", lines === 1, `${lines} runs`);
  },

  async cancel({ check, dataRoot }) {
    await mock.reset();
    await mock.script([{ hold: true, text: "too late" }, finish()]);
    let run = await startChat("Cancel me while thinking");
    check("cancel", "the mock holds the reply", await untilHeld());
    let started = Date.now();
    await cancel();
    check("cancel", "the run is canceled while thinking", (await waitForState(run.invocationId, ["canceled", "completed", "failed"], 30_000)) === "canceled");
    await sleep(1500);
    check("cancel", "the model's connection was dropped", (await mock.held()) === 0, `${Date.now() - started} ms`);
    check("cancel", "no turn came after it", (await mock.turns()).length === 1);

    const marker = `smoke-cancel-${Date.now() % 100000}`;
    await mock.reset();
    await mock.script([shell("call_c1", `: ${marker}; sleep 45; echo finished > late.txt; echo done`), finish()]);
    run = await startChat("Cancel me while the shell runs");
    const running = () => execSync(`pgrep -f '${marker}' || true`).toString().trim();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !running()) await sleep(150);
    check("cancel", "the command is running", running());
    started = Date.now();
    await cancel();
    check("cancel", "the run is canceled while the shell runs", (await waitForState(run.invocationId, ["canceled", "completed", "failed"], 30_000)) === "canceled");
    while (Date.now() < started + 40_000 && running()) await sleep(250);
    const stoppedAfter = Date.now() - started;
    check("cancel", "the command stops at once", !running() && stoppedAfter < 5_000, `after ${stoppedAfter} ms`);
    console.log(`      the command stopped ${stoppedAfter} ms after the cancel`);
    check("cancel", "the command never got to its last line", !findInWorkspaces(dataRoot, "late.txt"));
    check("cancel", "the command's result never went back to the model", (await mock.turns()).length === 1);
  },

  async modes({ check, dataRoot }) {
    await mock.reset();
    await mock.script([{ text: "Here is the plan." }, finish()]);
    let run = await startChat("Plan something", { mode: "plan" });
    await waitForState(run.invocationId, undefined, 40_000);
    const offered = (await mock.turns())[0]?.tools ?? [];
    check("modes", "Plan doesn't offer shell_run", offered.length && !offered.includes("shell_run"), offered.join());

    const stopFor = async (decision, file) => {
      await mock.reset();
      await mock.script([shell(`call_${decision}`, `echo manual > ${file}; cat ${file}`), finish()]);
      const started = await startChat(`Manual ${decision}`, { permission: "ask" });
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && !(await pending())?.id) await sleep(200);
      const request = await pending();
      check("modes", `Manual pauses before shell_run (${decision})`, request?.subject === "tool.shell.run" && !findInWorkspaces(dataRoot, file), JSON.stringify(request));
      check("modes", `Manual offers shell_run (${decision})`, (await mock.turns())[0]?.tools.includes("shell_run"));
      await decide(request.id, decision);
      return started;
    };
    run = await stopFor("continue", "manual.txt");
    check("modes", "approved: the run completes", (await waitForState(run.invocationId, undefined, 40_000)) === "completed");
    check("modes", "approved: the command ran", findInWorkspaces(dataRoot, "manual.txt"));
    run = await stopFor("deny", "denied.txt");
    await waitForState(run.invocationId, undefined, 40_000);
    check("modes", "denied: the command never ran", !findInWorkspaces(dataRoot, "denied.txt"));
    check("modes", "denied: the model is told", /declined/.test(await output()) || (await mock.turns()).some((turn) => /declined/.test(turn.raw)));
  },

  async voice({ check }) {
    await mock.reset();
    const answer = await inWindow(
      `const { RuntimeSocket } = await __smoke.module("api/runtimeSocket.ts");
       const live = new RuntimeSocket({ kind: "live", channels: ["mic"], language: "en" });
       const liveOpened = await live.opened.then(() => "opened", (error) => error.message);
       const heard = [];
       const voice = new RuntimeSocket({ kind: "voice" });
       voice.onmessage = (event) => heard.push(String(event.data));
       const opened = await voice.opened.then(() => "opened", (error) => error.message);
       voice.send(JSON.stringify({ type: "ping" }));
       await __smoke.sleep(300);
       voice.send(JSON.stringify({ type: "turn.begin" }));
       await __smoke.sleep(300);
       voice.send(JSON.stringify({ type: "text.commit", text: "Say hello" }));
       await __smoke.until(() => heard.some((line) => line.includes('"error"') || line.includes("turn.done")), "the turn", 20000);
       voice.close();
       return { liveOpened, opened, heard };`,
      { timeoutMs: 40_000 },
    );
    const types = answer.heard.map((line) => JSON.parse(line).type);
    check("voice", "a live session with no Soniox key is refused as it opens", /couldn't connect/.test(answer.liveOpened), answer.liveOpened);
    check("voice", "a voice session opens on a real channel", answer.opened === "opened", answer.opened);
    check("voice", "messages go both ways in order", ["ready", "pong", "turn.ready", "transcript"].every((type, at) => types[at] === type), types.join());
    const requests = await mock.requests();
    check("voice", "the turn reached the fast model", requests.some((request) => request.model === "mock-fast" && /conversational companion/.test(request.raw)), requests.map((request) => request.model).join());
    console.log(`      the session said: ${types.join(", ")} (speech needs a provider the mock can't stand in for)`);
  },

  async memory({ residentMB, app, check, runtime, scratch }) {
    const nodePattern = "services/agent-runtime/.output";
    const read = () => ({ app: residentMB(app.pattern), node: residentMB(nodePattern) });
    await sleep(30_000);
    const idle = read();
    await mock.reset();
    await mock.script([
      shell("call_m1", "for n in 1 2 3 4 5; do echo $n; done"),
      shell("call_m2", "sleep 1; echo slept", { hold: true }),
      finish(),
    ]);
    const run = await startChat("Measure me");
    await untilHeld();
    const samples = [];
    for (let at = 0; at < 10; at++) {
      samples.push(read());
      await sleep(500);
    }
    await mock.release();
    for (let at = 0; at < 6; at++) {
      samples.push(read());
      await sleep(500);
    }
    await waitForState(run.invocationId, undefined, 60_000);
    const peak = (key) => Math.max(...samples.map((sample) => sample[key]));
    const memory = { runtime, idle, during: { app: peak("app"), node: peak("node") }, after: read() };
    writeFileSync(resolve(scratch, `memory-${runtime}.json`), JSON.stringify(memory, null, 2));
    console.log(`      ${JSON.stringify(memory)}`);
    check("memory", "a reading came back", memory.idle.app > 0);
  },

  async errors({ check, scratch, seenErrors }) {
    const errors = [...seenErrors.values()];
    check("errors", "nothing in the window was refused", !notAllowed(errors).length, JSON.stringify(notAllowed(errors)));
    const log = readFileSync(resolve(scratch, "app.log"), "utf8");
    const lines = log.split("\n").filter((line) => /not allowed/i.test(line));
    check("errors", 'the app log has no "not allowed"', !lines.length, lines.slice(0, 5).join("\n"));
    console.log(`      console errors and warnings seen: ${errors.length}`);
    for (const entry of errors.slice(0, 10)) console.log(`      ${entry.kind}: ${entry.text.slice(0, 200)}`);
  },
};
