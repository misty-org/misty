// What stays on the computer: Memory, connected apps with no key, a window reloading under a
// run, and what the server sees of a whole run.
import { execSync } from "node:child_process";
import { inWindow, waitForWindow } from "./bridge.mjs";
import { finish, mock, replyOf, serverRequests, settled, shell, sleep, startChat, untilHeld, waitForState } from "./run.mjs";

/** Opens a page in a person's tab, reads it for a moment, then moves on, as a person does. */
const visitPage = (url) =>
  inWindow(
    `const ws = (await __smoke.module("features/workspace/useWorkspaceStore.ts")).useWorkspaceStore;
     const view = ws.getState().openBrowserView({ url: ${JSON.stringify(url)} });
     await __smoke.until(() => /Example/.test(ws.getState().layout && JSON.stringify(ws.getState().layout)), "the page's title", 15000).catch(() => undefined);
     await __smoke.sleep(1500);
     ws.getState().openBrowserView({});
     return view.id;`,
    { timeoutMs: 30_000 },
  );

const memoryEvents = (site) =>
  inWindow(
    `const { deviceMemory } = await __smoke.module("api/device-memory.ts");
     return deviceMemory.events({ space_id: "", site: ${JSON.stringify(site)}, limit: 20 });`,
  );

const untilQuestion = async () => {
  for (let tries = 0; tries < 60; tries++) {
    const question = await inWindow(
      `const { useActionQuestions } = await __smoke.module("features/agents/actionQuestions.ts");
       return useActionQuestions.getState().items[0] ?? null;`,
    );
    if (question) return question;
    await sleep(500);
  }
  return null;
};
const answerQuestion = (id) =>
  inWindow(
    `const { answerActionQuestion } = await __smoke.module("features/agents/actionQuestions.ts");
     await answerActionQuestion(${JSON.stringify(id)}, true);
     return true;`,
  );

export const localSteps = {
  async memorySearch({ check, scratch }) {
    const logStart = serverRequests(scratch).length;
    const stamp = `smokevisit${Date.now()}`;
    const url = `https://example.com/?visit=${stamp}`;
    await visitPage(url);
    let events = [];
    for (let tries = 0; tries < 40 && !events.some((event) => event.url === url); tries++) {
      await sleep(500);
      events = await memoryEvents("example.com");
    }
    const visit = events.find((event) => event.url === url);
    check("memorySearch", "opening a page records a visit on this computer", visit?.kind === "page", JSON.stringify(events).slice(0, 500));
    console.log(`      the visit was kept with the title "${visit?.title}"`);
    // Page text waits for the next hour so vectors are made in one batch. This is that hour arriving.
    execSync(`sqlite3 '${scratch}/data/.misty/data/misty.db' "UPDATE memory_chunks SET due_at = 0, lease_until = NULL WHERE embedded = 0"`);
    const waiting = await inWindow(
      `const { memoryBatch } = await __smoke.module("features/agents/deviceEmbeddings.ts");
       const { deviceMemory } = await __smoke.module("api/device-memory.ts");
       await memoryBatch();
       return (await deviceMemory.status()).waiting;`,
      { timeoutMs: 30_000 },
    );
    check("memorySearch", "the embedding model made its vector", waiting === 0, `${waiting} waiting`);
    await mock.reset();
    await mock.script([
      { tools: [{ id: "call_ms1", name: "memory_history_search", args: { query: `example domain ${stamp}` } }] },
      { tools: [{ id: "call_ms2", name: "memory_history_forget", args: { site: "example.com" } }] },
      { tools: [{ id: "call_ms3", name: "memory_history_search", args: { query: `example domain ${stamp}` } }] },
      finish("call_ms4"),
    ]);
    const run = await startChat("What did I read, then forget it");
    // Reading your Memory asks, and forgetting deletes, so each stops at the person even in Auto.
    const asked = [];
    for (let times = 0; times < 3; times++) {
      const question = await untilQuestion();
      if (!question) break;
      asked.push(question.kind);
      await answerQuestion(question.id);
      await sleep(300);
    }
    check("memorySearch", "each search and the forget asks first, even in Auto", asked.join() === "action,delete,action", asked.join());
    check("memorySearch", "the run completes", (await waitForState(run.invocationId, undefined, 60_000)) === "completed");
    const results = await mock.toolResults();
    const said = (id) => results.find((item) => item.id === id)?.content ?? "";
    check("memorySearch", "memory_history_search finds the visit", said("call_ms1").includes(stamp), said("call_ms1"));
    check("memorySearch", "memory_history_forget forgets it", /"forgotten":[1-9]/.test(said("call_ms2")), said("call_ms2"));
    check("memorySearch", "the search no longer finds it", !said("call_ms3").includes(stamp), said("call_ms3"));
    events = await memoryEvents("example.com");
    check("memorySearch", "the Memory page's list has no such visit", !events.some((event) => event.url === url), JSON.stringify(events).slice(0, 300));
    const embeddings = (await mock.requests()).length;
    await settled();
    await sleep(1000);
    const seen = serverRequests(scratch, logStart);
    const leaks = seen.filter((request) => /memory|recall/i.test(request.path) || [stamp, "example.com", "Example Domain"].some((text) => `${request.path} ${request.body}`.includes(text)));
    check("memorySearch", "nothing about it reached the server", !leaks.length, leaks.map((request) => `${request.method} ${request.path}`).join());
    console.log(`      the server saw during this step: ${summary(seen)} (${embeddings} calls to the mock)`);
  },

  // No Composio key on this computer: the apps aren't offered, and nothing is the worse for it.
  async noAppKey({ check, scratch }) {
    const logStart = serverRequests(scratch).length;
    const saved = await inWindow(`return __smoke.invoke("model_keys_saved", {});`);
    check("noAppKey", "this computer has no Composio key", !saved.includes("composio"), saved.join());
    const page = await inWindow(
      `const { localAppsApi } = await __smoke.module("features/agents/apps/localApi.ts");
       return localAppsApi.list();`,
    );
    check("noAppKey", "the apps list says none are available, without failing", page.available === false && !page.apps.length, JSON.stringify(page));
    await mock.reset();
    await mock.script([
      { tools: [{ id: "call_na1", name: "integration_search", args: { queries: ["send an email"] } }] },
      finish("call_na2", "It finished without the apps."),
      // A call the catalog doesn't have sends the run back for one more look before it may finish.
      finish("call_na3", "It finished without the apps."),
    ]);
    const run = await startChat("Is there anything new in my app?");
    check("noAppKey", "a run still completes", (await waitForState(run.invocationId, undefined, 40_000)) === "completed");
    const turns = await mock.turns();
    const offered = turns[0]?.tools ?? [];
    check("noAppKey", "integration_* isn't offered", offered.length && !offered.some((name) => name.startsWith("integration_")), offered.join());
    check("noAppKey", "the prompt says nothing about connecting apps", !turns[0]?.body.messages[0].content.includes("integration_search"), "");
    const result = (await mock.toolResults()).find((item) => item.id === "call_na1")?.content ?? "";
    check("noAppKey", "a model that tries one anyway is told it isn't there", result && !/composio/i.test(result), result);
    const reply = await replyOf(run.conversationId, run.invocationId);
    check("noAppKey", "the chat shows the answer, not a failure", reply?.content === "It finished without the apps.", JSON.stringify(reply?.content));
    const seen = serverRequests(scratch, logStart);
    check("noAppKey", "nothing about apps reached the server", !seen.some((request) => /composio|integration|\/apps/i.test(request.path)), summary(seen));
  },

  // Reloading the window takes everything the store held: it reads what the run said back from native code.
  async reload({ check }) {
    const once = (text, part) => text.split(part).length - 1;
    await mock.reset();
    await mock.script([
      { text: "Part one of the answer.", tools: [{ id: "call_rl1", name: "log_work_write", args: { section: "findings", content: "Before the reload.", mode: "append" } }] },
      { hold: true, text: "Part two of the answer.", tools: [{ id: "call_rl2", name: "log_work_write", args: { section: "findings", content: "After the reload.", mode: "append" } }] },
      finish("call_rl3", "All of it, once."),
    ]);
    const run = await startChat("Survive a reload");
    check("reload", "the second turn is thinking", await untilHeld());
    await sleep(1500); // Past the moment the chat is saved.
    await inWindow(`setTimeout(() => location.reload(), 400); return true;`);
    await sleep(800);
    await waitForWindow(60_000);
    // Chats load when the agent panel opens, which is what brings a reloaded window back to the run.
    await inWindow(
      `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
       await __smoke.until(() => misty.getState().accountId, "the account", 20000);
       await misty.getState().loadConversations();
       return true;`,
      { timeoutMs: 30_000 },
    );
    const caughtUp = await inWindow(
      `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
       const reply = () => misty.getState().conversations.find((chat) => chat.id === ${JSON.stringify(run.conversationId)})?.messages.find((message) => message.invocationId === ${JSON.stringify(run.invocationId)});
       await __smoke.until(() => misty.getState().working && misty.getState().invocationId === ${JSON.stringify(run.invocationId)}, "the window to rejoin the run", 30000);
       await __smoke.until(() => reply()?.content.includes("Part one"), "what the run has said", 20000);
       const { state, content, progress } = reply();
       return { state, content, tools: (progress ?? []).filter((item) => item.type === "tool").map((item) => item.toolCallId ?? item.id) };`,
      { timeoutMs: 60_000 },
    );
    check("reload", "the chat picks the run back up", ["pending", "streaming"].includes(caughtUp.state), JSON.stringify(caughtUp));
    check("reload", "what it said so far shows once", once(caughtUp.content, "Part one") === 1, caughtUp.content);
    check("reload", "the tool that already ran shows once", new Set(caughtUp.tools).size === caughtUp.tools.length && caughtUp.tools.length >= 1, caughtUp.tools.join());
    await mock.release();
    check("reload", "the run finishes", (await waitForState(run.invocationId, undefined, 40_000)) === "completed");
    await settled();
    await sleep(800);
    const reply = await replyOf(run.conversationId, run.invocationId);
    const allText = JSON.stringify(reply?.progress ?? []) + reply?.content;
    check("reload", "the ending reached the reloaded chat", reply?.state === "completed" && reply?.content === "All of it, once.", JSON.stringify(reply?.content));
    check("reload", "nothing is doubled in the chat", once(allText, "Part one") <= 1 && once(allText, "Part two") <= 1, allText.slice(0, 800));
    const tools = (reply?.progress ?? []).filter((item) => item.type === "tool").map((item) => item.toolCallId ?? item.id);
    check("reload", "no tool shows twice", new Set(tools).size === tools.length, tools.join());
    const saved = await inWindow(
      `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
       const { localChats } = await __smoke.module("features/misty/localChats.ts");
       await __smoke.sleep(800);
       const chats = await localChats.conversations(misty.getState().accountId);
       return chats.find((chat) => chat.id === ${JSON.stringify(run.conversationId)})?.messages.at(-1)?.content;`,
    );
    check("reload", "the saved chat has it once too", saved === "All of it, once.", saved);

    // Reloading during a call the window itself is answering: a sub-agent the parent waits on.
    await mock.reset();
    await mock.script([
      { tools: [{ id: "call_rl4", name: "agent_delegate", args: { tasks: [{ goal: "Outlast the reload" }], browser: false } }] },
      { hold: true, ...finish("call_rl5", "The child outlasted it.") },
      finish("call_rl6", "The parent carried on."),
    ]);
    const parent = await startChat("Reload while waiting on a child");
    check("reload", "the child is thinking", await untilHeld());
    await sleep(800);
    await inWindow(`setTimeout(() => location.reload(), 400); return true;`);
    await sleep(800);
    await waitForWindow(60_000);
    await sleep(2500);
    await mock.release();
    const ended = await waitForState(parent.invocationId, undefined, 90_000);
    check("reload", "the parent gets its child's answer after the reload", ended === "completed" && (await mock.toolResults()).some((item) => item.id === "call_rl4" && item.content.includes("The child outlasted it.")), `${ended}: ${JSON.stringify(await mock.toolResults()).slice(0, 500)}`);
  },

  // The plan's "Done when": a whole run with tools, a sub-agent and memory, and what the server saw of it.
  async noServerContact({ check, scratch }) {
    await settled();
    await sleep(2000);
    const stamp = Date.now();
    const words = {
      prompt: `prompt-${stamp}-only-on-this-computer`,
      modelText: `model-text-${stamp}-only-on-this-computer`,
      toolResult: `tool-result-${stamp}-only-on-this-computer`,
      notebook: `notebook-${stamp}-only-on-this-computer`,
      childGoal: `child-goal-${stamp}-only-on-this-computer`,
      childAnswer: `child-answer-${stamp}-only-on-this-computer`,
      memory: `memory-${stamp}-only-on-this-computer`,
      finish: `final-${stamp}-only-on-this-computer`,
    };
    const logStart = serverRequests(scratch).length;
    const startedAt = new Date().toISOString();
    await mock.reset();
    await mock.script([
      { text: words.modelText, ...shell("call_ns1", `printf '${words.toolResult}'`) },
      { tools: [{ id: "call_ns2", name: "log_work_write", args: { section: "findings", content: words.notebook, mode: "append" } }] },
      { tools: [{ id: "call_ns3", name: "memory_pref_remember", args: { content: words.memory, kind: "fact", scope: "space", reason: "Asked to" } }] },
      { tools: [{ id: "call_ns4", name: "agent_delegate", args: { tasks: [{ goal: words.childGoal }], browser: false } }] },
      finish("call_ns5", words.childAnswer),
      finish("call_ns6", words.finish),
    ]);
    const run = await startChat(words.prompt);
    check("noServerContact", "a whole run completes", (await waitForState(run.invocationId, undefined, 120_000)) === "completed");
    await settled();
    await sleep(3000);
    const results = await mock.toolResults();
    const ranAll = ["call_ns1", "call_ns2", "call_ns3", "call_ns4"].every((id) => results.some((item) => item.id === id));
    check("noServerContact", "its shell, notebook, memory and sub-agent all ran", ranAll && results.find((item) => item.id === "call_ns1")?.content.includes(words.toolResult) && results.find((item) => item.id === "call_ns4")?.content.includes(words.childAnswer), JSON.stringify(results).slice(0, 800));
    const seen = serverRequests(scratch, logStart);
    const reached = (word) => seen.filter((request) => `${request.path}\n${request.body}`.includes(word));
    for (const [name, word] of Object.entries(words))
      check("noServerContact", `the server never saw the ${name}`, !reached(word).length, reached(word).map((request) => `${request.method} ${request.path}`).join());
    const removed = seen.filter((request) => /\/ai\/invocations|\/mcp|agent-runtime|\/misty\/conversations/.test(request.path));
    check("noServerContact", "no request went to a route the run once used", !removed.length, removed.map((request) => request.path).join());
    const lines = seen.map((request) => `${request.at} ${request.method} ${request.path} ${request.status ?? ""}`.trim());
    console.log(`      from ${startedAt}, the server saw ${seen.length} requests:`);
    for (const line of lines) console.log(`        ${line}`);
    return { seen };
  },
};

function summary(requests) {
  const counts = new Map();
  for (const request of requests) {
    const key = `${request.method} ${request.path.split("?")[0].replace(/(space|device)_[0-9a-f-]+/g, ":$1")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => `${key}${count > 1 ? ` x${count}` : ""}`).join(", ") || "nothing";
}
