// Sending a real message from the app's own store, and reading back what the mock model received.
import { execSync } from "node:child_process";
import { bridge, inWindow } from "./bridge.mjs";

const mockPort = process.env.MISTY_SMOKE_MOCK_PORT ?? 18098;
const mockAddress = `http://127.0.0.1:${mockPort}`;
export const mockBase = `${mockAddress}/v1`;

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const finish = (id = undefined) => ({
  tools: [{ id, name: "agent_finish", args: { outcome: "completed", summary: "The smoke step is done.", remaining: [] } }],
});
export const shell = (id, command, extra = {}) => ({ ...extra, tools: [{ id, name: "shell_run", args: { command } }] });
export const findInWorkspaces = (root, name) =>
  execSync(`find '${root}/.misty/agent-workspaces' -name '${name}' 2>/dev/null || true`).toString().trim();
export const notAllowed = (errors) => errors.filter((entry) => /not allowed/i.test(entry.text));

export const mock = {
  async script(steps) {
    await fetch(`${mockAddress}/__script`, { method: "POST", body: JSON.stringify({ steps }) });
  },
  async reset() {
    await fetch(`${mockAddress}/__reset`, { method: "POST" });
  },
  async release() {
    return (await fetch(`${mockAddress}/__release`, { method: "POST" })).json();
  },
  async held() {
    return (await (await fetch(`${mockAddress}/__held`)).json()).held;
  },
  async total() {
    return (await (await fetch(`${mockAddress}/__log`)).json()).total;
  },
  /** Requests from `since` on, each with its parsed body. */
  async requests(since = 0) {
    const log = await (await fetch(`${mockAddress}/__log?since=${since}`)).json();
    return log.requests.map((request) => ({ ...request, body: JSON.parse(request.raw) }));
  },
  /** Only the run's own turns: the calls that offer agent_finish. */
  async turns(since = 0) {
    return (await this.requests(since)).filter((request) => request.tools.includes("agent_finish"));
  },
  /** What each tool answered, from the last turn's messages. */
  async toolResults(since = 0) {
    const turns = await this.turns(since);
    const last = turns.at(-1);
    return (last?.body.messages ?? [])
      .filter((message) => message.role === "tool")
      .map((message) => ({ id: message.tool_call_id, content: String(message.content) }));
  },
};

/**
 * Starts a new chat as the composer would: its modes and folder are the draft choice, and the
 * message goes through `submitAnswer`. Resolves with the invocation once it is admitted.
 */
export async function startChat(prompt, { permission = "auto", mode = "act", folder = null, writable = false, answered = writable } = {}) {
  // "Allow changes" is a native question a test can't click, so the bridge records the yes, after
  // choosing the folder, which clears any earlier answer.
  await inWindow(
    `const folders = (await __smoke.module("features/agents/store/useConversationFolder.ts")).useConversationFolder;
     folders.getState().chooseFolder(undefined, ${JSON.stringify(folder)});
     await __smoke.sleep(300);
     return true;`,
  );
  if (answered && folder) await bridge("/allow-folder-changes", { key: "draft", scopeId: folder });
  return inWindow(
    `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
     const collaboration = (await __smoke.module("features/agents/collaboration/store.ts")).useCollaborationStore;
     const folders = (await __smoke.module("features/agents/store/useConversationFolder.ts")).useConversationFolder;
     await __smoke.until(() => misty.getState().accountId && !misty.getState().conversationsLoading, "the account's chats", 30000);
     await misty.getState().newConversation?.();
     collaboration.setState({ draftPermissionMode: ${JSON.stringify(permission)}, draftMode: ${JSON.stringify(mode)} });
     folders.setState({ draft: ${JSON.stringify(folder)}, draftWrites: null });
     if (${JSON.stringify(writable)} && ${JSON.stringify(folder)}) folders.getState().setWritable(undefined, ${JSON.stringify(folder)}, true);
     void misty.getState().submitAnswer(${JSON.stringify(prompt)}, [], undefined, "panel").catch((error) => __smoke.errors.push({ kind: "submit", text: String(error) }));
     const invocationId = await __smoke.until(() => misty.getState().invocationId, "the run to be admitted", 20000);
     return { invocationId, conversationId: misty.getState().invocationConversationId };`,
    { timeoutMs: 60_000 },
  );
}

/** Sends another message in the chat that's open, once its last turn has settled. */
export function sendInChat(prompt) {
  return inWindow(
    `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
     await __smoke.until(() => !misty.getState().working, "the turn to settle", 30000);
     const before = misty.getState().invocationId;
     void misty.getState().submitAnswer(${JSON.stringify(prompt)}, [], undefined, "panel");
     const invocationId = await __smoke.until(() => misty.getState().invocationId !== before && misty.getState().invocationId, "the run to be admitted", 20000);
     return { invocationId, conversationId: misty.getState().invocationConversationId };`,
    { timeoutMs: 60_000 },
  );
}

/** The run's state on the server, as the app reads it. */
export function runState(invocationId) {
  return inWindow(
    `const { aiSurfaceApi } = await __smoke.module("features/ai-surface/api.ts");
     return (await aiSurfaceApi.invocationState(${JSON.stringify(invocationId)})).state;`,
  );
}

/** Waits for a state that ends the wait; every other state is still working. */
export async function waitForState(invocationId, wanted = ["completed", "failed", "canceled"], timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let state = "";
  while (Date.now() < deadline) {
    state = await runState(invocationId).catch(() => state);
    if (wanted.includes(state)) return state;
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Error(`Run ${invocationId} stayed in ${state}, not ${wanted.join(" or ")}.`);
}

/** Errors the window's console reported since the helpers went in, minus known noise. */
export async function windowErrors(window) {
  const errors = await inWindow("return __smoke.errors", { window });
  return errors.filter((entry) => !entry.text.startsWith("Browser pages are hidden"));
}

/** What the last turn's tools answered, as one text. */
export const output = async () => (await mock.toolResults()).map((result) => result.content).join("\n");
