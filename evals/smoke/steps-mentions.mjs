// `@mention` in a Space's chat: your own agent runs on your computer and its reply posts under
// your message. Nobody else's mention asks your agent for anything, and yours asks nothing of theirs.
import { inWindow } from "./bridge.mjs";
import { mock, serverRequests, sleep } from "./run.mjs";

const composer = 'textarea[placeholder="Write a message…"]';

/** Opens a Space's chat page, fresh, so it reads who's listed as it does when a person goes to it. */
const openChat = (spaceId) =>
  inWindow(
    `const ws = (await __smoke.module("features/workspace/useWorkspaceStore.ts")).useWorkspaceStore;
     const { workspaceSurfaceFromRoute } = await __smoke.module("features/workspace/routeSurface.ts");
     const { spaceChatPath } = await __smoke.module("features/spaces/chat/chatRoute.ts");
     const go = (route) => { history.pushState(null, "", route); window.dispatchEvent(new PopStateEvent("popstate")); };
     go("/browser");
     await __smoke.sleep(300);
     const tab = ws.getState().addSurface(workspaceSurfaceFromRoute(spaceChatPath(${JSON.stringify(spaceId)})));
     go(tab.route);
     await __smoke.until(() => document.querySelector(${JSON.stringify(composer)}), "the chat's composer", 20000);
     await __smoke.sleep(800);
     return tab.route;`,
  );

const typeAndSend = (text) =>
  inWindow(
    `await __smoke.type(${JSON.stringify(composer)}, ${JSON.stringify(text)});
     await __smoke.sleep(150);
     await __smoke.submit(${JSON.stringify(composer)});
     return true;`,
  );

const seesText = (text, timeoutMs = 40_000) =>
  inWindow(
    `await __smoke.until(() => document.body.innerText.includes(${JSON.stringify(text)}), ${JSON.stringify(`"${text}" on the page`)}, ${timeoutMs});
     return true;`,
    { timeoutMs: timeoutMs + 5000 },
  ).catch(() => false);

const messages = (spaceId) =>
  inWindow(
    `const { apiRequest } = await __smoke.module("api/client/index.ts");
     return (await apiRequest("/spaces/${spaceId}/messages")).messages;`,
  );

const spanText = (message) => (message?.content ?? []).map((span) => span.text ?? (span.label ? `@${span.label}` : "")).join("");

/** A second person on the server, signed up from an invitation to this Space, as their own computer would. */
async function secondPerson(server, spaceId) {
  const stamp = Date.now();
  const email = `other-${stamp}@example.test`;
  const invited = await inWindow(
    `const { apiRequest } = await __smoke.module("api/client/index.ts");
     return apiRequest("/spaces/${spaceId}/invitations", { method: "POST", body: JSON.stringify({ email: ${JSON.stringify(email)} }) });`,
  );
  const api = `${server}/v1`;
  const headers = { "content-type": "application/json", "x-misty-csrf": "1", origin: "http://localhost:5199" };
  const signedUp = await fetch(`${api}/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username: `other_${stamp}`, email, password: `made!up-${stamp}` }),
  });
  if (!signedUp.ok) throw new Error(`The second person couldn't sign up: ${signedUp.status}`);
  const cookie = signedUp.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");
  const account = await signedUp.json();
  const call = async (method, path, body) => {
    const answer = await fetch(`${api}${path}`, { method, headers: { ...headers, cookie }, body: body && JSON.stringify(body) });
    if (!answer.ok) throw new Error(`${method} ${path}: ${answer.status} ${await answer.text()}`);
    return answer.json().catch(() => ({}));
  };
  // The server hands out a link to pass on (misty://open/invite/<token>), and that's what's accepted.
  const token = /invite\/([^"\\]+)/.exec(JSON.stringify(invited))?.[1];
  if (!token) throw new Error(`The invitation came with no link: ${JSON.stringify(invited)}`);
  await call("POST", `/space-invitations/${token}`, { accept: true });
  return { call, id: account.user?.id ?? account.id };
}

export const mentionSteps = {
  async mentions({ check, server, scratch }) {
    const instructions = "Scout-instructions-only-on-this-computer";
    const setup = await inWindow(
      `const { apiRequest } = await __smoke.module("api/client/index.ts");
       const { personalAgentsApi } = await __smoke.module("features/agents/personalAgentsApi.ts");
       const { spaceAgentsApi } = await __smoke.module("api/spaces/space-agents.ts");
       const { usePersonalAgentsStore } = await __smoke.module("features/agents/personalAgentsStore.ts");
       const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
       const { spaces } = await apiRequest("/spaces");
       const home = spaces.find((space) => space.is_default);
       const { agents } = await personalAgentsApi.list();
       const agent = agents.find((item) => item.name === "Scout") ?? await personalAgentsApi.save({
         name: "Scout", role: "Researcher", description: "", instructions: ${JSON.stringify(instructions)}, icon: "misty",
         avatar: { kind: "preset", preset_id: "misty", accent: "blue" }, model_mode: "pinned", model_id: "", reasoning_effort: "",
         enabled: true, default_run_mode: "auto",
       });
       await usePersonalAgentsStore.getState().load(misty.getState().accountId);
       const listed = await spaceAgentsApi.add(home.id, agent.id, agent.name);
       return { spaceId: home.id, agentId: agent.id, listed, account: misty.getState().accountId };`,
      { timeoutMs: 30_000 },
    );
    const { spaceId, agentId, account } = setup;
    check("mentions", "your agent comes into a Space with no agent row on the server", setup.listed.agent_id === agentId && setup.listed.owner_user_id === account, JSON.stringify(setup.listed));

    const answer = "Scout looked and found three things.";
    const logStart = serverRequests(scratch).length;
    await mock.reset();
    await mock.script([{ text: answer }]);
    await openChat(spaceId);
    const asked = "@Scout what did you find?";
    await typeAndSend(asked);
    const reply = `Scout: ${answer}`;
    check("mentions", "the reply shows in the chat", await seesText(reply), reply);
    const turns = await mock.turns();
    check("mentions", "the agent's run went to the model from this computer", turns.length === 1 && turns[0].raw.includes(asked), `${turns.length} turns`);
    check("mentions", "it ran as that agent", turns[0]?.raw.includes(instructions), turns[0]?.body.messages[0].content.slice(0, 300));
    const all = await messages(spaceId);
    const mine = all.find((message) => spanText(message) === asked);
    const posted = all.find((message) => spanText(message) === reply);
    check("mentions", "the message names the agent", mine?.content.some((span) => span.agent_id === agentId), JSON.stringify(mine?.content));
    check("mentions", "the reply posts under the message", posted && posted.reply_to_message_id === mine?.id, JSON.stringify(posted));
    const state = await inWindow(
      `const { runIdFor } = await __smoke.module("features/ai-surface/localRun/runIdentity.ts");
       const { aiSurfaceApi } = await __smoke.module("features/ai-surface/api.ts");
       const runId = await runIdFor(${JSON.stringify(account)}, ${JSON.stringify(`mention:${mine?.id}:${agentId}`)});
       return (await aiSurfaceApi.invocationState(runId)).state;`,
    );
    check("mentions", "the run is known on this computer, and ended", state === "completed", state);
    const seen = serverRequests(scratch, logStart).filter((request) => request.method !== "GET");
    const carried = seen.filter((request) => request.body.includes(answer));
    check("mentions", "the answer reached the server only as the posted message", carried.length === 1 && /\/messages$/.test(carried[0].path), carried.map((request) => request.path).join());
    console.log(`      writes the server saw: ${seen.map((request) => `${request.method} ${request.path.replace(spaceId, ":space")}`).join(", ")}`);

    // Somebody else's agent, and somebody else asking for yours.
    const other = await secondPerson(server, spaceId);
    await other.call("PUT", `/spaces/${spaceId}/agents/agent-on-their-computer`, { name: "Reviewer" });
    await mock.reset();
    await openChat(spaceId);
    const toTheirs = "@Reviewer please act on this";
    await typeAndSend(toTheirs);
    check("mentions", "a message to someone else's agent posts", await seesText("please act on this"));
    await sleep(6000);
    let after = await messages(spaceId);
    const theirs = after.find((message) => spanText(message) === toTheirs);
    check("mentions", "their agent is a name here, so it stays plain words", theirs && !theirs.content.some((span) => span.agent_id), JSON.stringify(theirs?.content));
    check("mentions", "mentioning their agent starts nothing here", !(await mock.total()), `${await mock.total()} model calls`);
    check("mentions", "and posts no reply", !after.some((message) => message.reply_to_message_id === theirs?.id));

    const fromThem = "Scout, please do this for me";
    const message = (content) => ({
      content,
      file_node_ids: [],
      attachment_ids: [],
      library_item_ids: [],
      reply_to_message_id: "",
      client_nonce: `smoke-from-them-${Date.now()}`,
    });
    // Nobody else can ask your agent to act, and the server won't even carry the mention.
    const refused = await other
      .call("POST", `/spaces/${spaceId}/messages`, message([{ type: "mention", agent_id: agentId, label: "Scout" }, { type: "text", text: ` ${fromThem}` }]))
      .then(() => "", (error) => error.message);
    check("mentions", "the server refuses their mention of your agent", refused.includes("400"), refused);
    await other.call("POST", `/spaces/${spaceId}/messages`, message([{ type: "text", text: `@Scout ${fromThem}` }]));
    check("mentions", "their message reaches this window", await seesText(fromThem));
    await sleep(6000);
    after = await messages(spaceId);
    const request = after.find((message) => spanText(message).includes(fromThem));
    check("mentions", "their mention of your agent starts nothing", !(await mock.total()), `${await mock.total()} model calls`);
    check("mentions", "and gets no reply", request && !after.some((message) => message.reply_to_message_id === request.id));
  },
};
