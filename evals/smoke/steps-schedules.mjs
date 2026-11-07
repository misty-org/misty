// Schedules on this computer: a saved workflow that comes due starts one run, as a scheduled
// run, and never a second one, whether or not the app closes in between.
import { inWindow, waitForWindow } from "./bridge.mjs";
import { finish, mock, shell, sleep, untilHeld } from "./run.mjs";

const modules = `
  const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
  await __smoke.until(() => misty.getState().accountId && !misty.getState().conversationsLoading, "the account's chats", 30000);
  const account = misty.getState().accountId;
  const { saveMethod } = await __smoke.module("features/agents/workflows/localMethods.ts");
  const { saveSchedule, removeSchedule } = await __smoke.module("features/agents/workflows/scheduleEdits.ts");
  const { listSchedules } = await __smoke.module("features/agents/workflows/localSchedules.ts");
  const { localDocuments } = await __smoke.module("features/misty/localChats.ts");
  const { announceWorkflowChange } = await __smoke.module("features/agents/workflows/workflowChanges.ts");
`;

/** A workflow saved and scheduled as the Workflows page does it, hourly so missed times can be counted. */
const saveWorkflow = (title, instructions) =>
  inWindow(
    `${modules}
     const method = await saveMethod(account, {
       kind: "workflow", agent_id: "personal_misty", enabled: true,
       definition: { title: ${JSON.stringify(title)}, description: "", instructions: ${JSON.stringify(instructions)}, inputs: [], target: "cloud", required_tools: [] },
     });
     const schedule = await saveSchedule(account, method.id, {
       timezone: "UTC", rules: [{ frequency: "hourly", interval: 1, minute: 0 }], skip_dates: [],
     }, Date.now());
     return { methodId: method.id, nextRun: schedule.next_run_at };`,
    { timeoutMs: 40_000 },
  );

/** The computer was away: the schedule's next run is this long ago. Nothing is told, so nothing wakes. */
const dueAgo = (methodId, ms) =>
  inWindow(
    `${modules}
     const raw = await localDocuments.get(account, "workflow_schedule", ${JSON.stringify(methodId)});
     const schedule = JSON.parse(raw);
     const due = new Date(Date.now() - ${ms}).toISOString();
     await localDocuments.swap(account, "workflow_schedule", ${JSON.stringify(methodId)}, raw, JSON.stringify({ ...schedule, next_run_at: due }));
     return due;`,
  );

const scheduleOf = (methodId) =>
  inWindow(
    `${modules}
     return (await listSchedules(account)).find((item) => item.method_id === ${JSON.stringify(methodId)}) ?? null;`,
  );

const poke = () =>
  inWindow(
    `${modules}
     announceWorkflowChange();
     return true;`,
  );

async function untilSchedule(methodId, wanted, timeoutMs = 100_000) {
  const deadline = Date.now() + timeoutMs;
  let schedule;
  while (Date.now() < deadline) {
    schedule = await scheduleOf(methodId).catch(() => schedule);
    if (schedule && wanted(schedule)) return schedule;
    await sleep(500);
  }
  return schedule;
}

const turnsOf = async (marker) => (await mock.turns()).filter((turn) => turn.raw.includes(marker));

/** What's offered and said on a run's first turn that only a scheduled run gets. */
function checkScheduledTurn(check, step, turn) {
  check(step, "the crate read it as a scheduled run", /Where this reply goes: a scheduled run the person reads later/.test(turn?.body.messages[0].content), turn?.body.messages[0].content.slice(-400));
  check(step, "nobody is there to ask, so it can't ask", turn && !turn.tools.includes("conversation_ask_user"), turn?.tools.join());
}

export const scheduleSteps = {
  async schedules({ check }) {
    const marker = "smoke-schedule-due-now";
    const { methodId, nextRun } = await saveWorkflow("Smoke due schedule", `Do the ${marker} work.`);
    check("schedules", "the schedule plans its next run", Date.parse(nextRun) > Date.now(), nextRun);
    await mock.reset();
    await mock.script([shell("call_sd1", "echo scheduled >> scheduled.txt; wc -l < scheduled.txt"), finish("call_sd2", "The scheduled work is done.")]);
    // Whatever the composer was left on must not decide how nobody's run works.
    await inWindow(
      `const collaboration = (await __smoke.module("features/agents/collaboration/store.ts")).useCollaborationStore;
       collaboration.setState({ draftMode: "plan", draftPermissionMode: "ask" });
       return true;`,
    );
    const due = await dueAgo(methodId, 30_000);
    // Nothing pokes it here: the app's own check, once a minute, has to find it.
    const ran = await untilSchedule(methodId, (schedule) => schedule.run_count >= 1 && schedule.state !== "running", 150_000);
    check("schedules", "a due schedule starts on its own and finishes", ran?.state === "idle" && ran?.run_count === 1, JSON.stringify(ran));
    const turns = await turnsOf(marker);
    check("schedules", "it ran once", turns.length === 2, `${turns.length} turns`);
    checkScheduledTurn(check, "schedules", turns[0]);
    check("schedules", "Plan left in the composer didn't stop it", turns[0]?.tools.includes("shell_run"), turns[0]?.tools.join());
    const results = await mock.toolResults();
    check("schedules", "it worked without stopping to ask", /"stdout":"\s*1/.test(results.find((item) => item.id === "call_sd1")?.content), JSON.stringify(results));
    check("schedules", "the next run moved on from the one it claimed", Date.parse(ran?.next_run_at) > Date.parse(due), `${due} then ${ran?.next_run_at}`);

    const chat = await inWindow(
      `${modules}
       const { readConversationState } = await __smoke.module("features/agents/localTools/runState/conversationState.ts");
       const chat = misty.getState().conversations.find((item) => item.id === ${JSON.stringify(ran?.conversation_id ?? "")});
       const state = chat ? await readConversationState(account, chat.id) : null;
       return { title: chat?.title, draft: (await __smoke.module("features/agents/collaboration/store.ts")).useCollaborationStore.getState().draftMode, replies: chat?.messages.filter((message) => message.role === "assistant").map((message) => message.content), permissionMode: state?.permissionMode, mode: state?.mode };`,
    );
    check("schedules", "the workflow's own chat shows the one report", chat.replies?.length === 1 && chat.replies[0] === "The scheduled work is done.", JSON.stringify(chat));
    check("schedules", "the chat keeps the run's explicit modes", chat.permissionMode === "auto" && chat.mode === "act", JSON.stringify(chat));
    check("schedules", "the composer keeps what the person chose", chat.draft === "plan", chat.draft);
    check("schedules", "the chat is named after the workflow", chat.title === "Smoke due schedule", chat.title);

    // Anything that wakes the scheduler must find nothing to do.
    const before = await mock.total();
    for (let times = 0; times < 3; times++) {
      await poke();
      await sleep(700);
    }
    await sleep(2000);
    check("schedules", "waking the scheduler again starts nothing", (await mock.total()) === before, `${(await mock.total()) - before} more calls`);
    check("schedules", "still one run on the schedule", (await scheduleOf(methodId))?.run_count === 1);
    await inWindow(
      `${modules}
       await removeSchedule(account, ${JSON.stringify(methodId)});
       (await __smoke.module("features/agents/collaboration/store.ts")).useCollaborationStore.setState({ draftMode: "act", draftPermissionMode: "" });
       return true;`,
    );
  },

  // Due while the app was closed: it catches up when it opens, once, and the next launch starts nothing.
  async scheduleCatchUp({ check, app }) {
    const marker = "smoke-schedule-while-closed";
    const { methodId } = await saveWorkflow("Smoke missed schedule", `Do the ${marker} work.`);
    // One run first, so there's a thread for the catch-up to continue.
    await mock.reset();
    await mock.script([shell("call_sm0", "echo first >> missed.txt"), finish("call_sm3", "The first run.")]);
    await dueAgo(methodId, 30_000);
    await poke();
    const first = await untilSchedule(methodId, (schedule) => Boolean(schedule.last_invocation_id) && schedule.run_count >= 1 && schedule.state !== "running", 150_000);
    check("scheduleCatchUp", "the first run ends", first?.run_count === 1 && first?.state === "idle", JSON.stringify(first));
    await mock.reset();
    await mock.script([shell("call_sm1", "echo caught-up >> missed.txt; wc -l < missed.txt"), finish("call_sm2", "Caught up.")]);
    await dueAgo(methodId, 3 * 3_600_000);
    await app.kill();
    check("scheduleCatchUp", "nothing ran before the app closed", !(await turnsOf(marker)).length);
    await app.start();
    await waitForWindow(120_000);
    const ran = await untilSchedule(methodId, (schedule) => schedule.run_count >= 2 && schedule.state !== "running", 150_000);
    check("scheduleCatchUp", "the missed schedule ran after the relaunch", ran?.state === "idle" && ran?.run_count === 2, JSON.stringify(ran));
    check("scheduleCatchUp", "it went on in the workflow's one chat", ran?.conversation_id === first?.conversation_id, `${first?.conversation_id} then ${ran?.conversation_id}`);
    const turns = await turnsOf(marker);
    check("scheduleCatchUp", "three missed times became one run", turns.length === 2, `${turns.length} turns`);
    checkScheduledTurn(check, "scheduleCatchUp", turns[0]);
    check("scheduleCatchUp", "the run says it's late and covers the others", /was due .* started now/.test(turns[0]?.raw) && /later runs passed while it waited/.test(turns[0]?.raw), turns[0]?.raw.slice(-900));

    const before = await mock.total();
    await app.kill();
    await app.start();
    await waitForWindow(120_000);
    await poke();
    await sleep(6000);
    check("scheduleCatchUp", "the next launch starts nothing", (await mock.total()) === before, `${(await mock.total()) - before} more calls`);
    const again = await scheduleOf(methodId);
    check("scheduleCatchUp", "the schedule counts no extra run", again?.run_count === 2 && Date.parse(again?.next_run_at) > Date.now(), JSON.stringify(again));
    await inWindow(`${modules} await removeSchedule(account, ${JSON.stringify(methodId)}); return true;`);
  },

  // The app dies during the run: the run goes on after the relaunch, and the schedule doesn't start another.
  async scheduleRestart({ check, app }) {
    const marker = "smoke-schedule-across-restart";
    const { methodId } = await saveWorkflow("Smoke interrupted schedule", `Do the ${marker} work.`);
    await mock.reset();
    await mock.script([
      shell("call_sr0_never_seen", "echo never-sent >> interrupted.txt", { hold: true }),
      shell("call_sr1", "echo once >> interrupted.txt; wc -l < interrupted.txt"),
      finish("call_sr2", "Finished after the restart."),
    ]);
    await dueAgo(methodId, 60_000);
    await poke();
    check("scheduleRestart", "the scheduled run is thinking", await untilHeld(100_000));
    const claimed = await untilSchedule(methodId, (schedule) => Boolean(schedule.last_invocation_id), 20_000);
    await app.kill();
    await app.start();
    await waitForWindow(120_000);
    const ran = await untilSchedule(methodId, (schedule) => schedule.run_count >= 1 && schedule.state !== "running", 150_000);
    check("scheduleRestart", "the run settled once on the schedule", ran?.run_count === 1 && ran?.state === "idle", JSON.stringify(ran));
    check("scheduleRestart", "the same run went on", ran?.last_invocation_id === claimed?.last_invocation_id, `${claimed?.last_invocation_id} then ${ran?.last_invocation_id}`);
    const turns = await turnsOf(marker);
    check("scheduleRestart", "the held turn was sent again, and no other run started", turns.length === 3 && turns[1].raw === turns[0].raw, `${turns.length} turns`);
    const results = await mock.toolResults();
    check("scheduleRestart", "its command ran once", /"stdout":"\s*1\\n/.test(results.find((item) => item.id === "call_sr1")?.content), JSON.stringify(results));
    await inWindow(`${modules} await removeSchedule(account, ${JSON.stringify(methodId)}); return true;`);
  },
};
