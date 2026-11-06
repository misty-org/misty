// What the smoke test checks first (README.md): the app's permissions, signing in, choosing models and
// the agent's tools. Each step works the app's real interface or its real modules through the debug
// bridge, and reads what the mock model received.
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { bridge, inWindow, waitForWindow } from "./bridge.mjs";
import { finish, findInWorkspaces, mock, mockBase, notAllowed, output, sendInChat, shell, sleep, startChat, waitForState, windowErrors } from "./run.mjs";

const tryCalls = (commands) =>
  `const out = {};
   for (const command of ${JSON.stringify(commands)}) {
     try { await window.__TAURI_INTERNALS__.invoke(command, {}); out[command] = "ok"; }
     catch (error) { out[command] = String(error?.message ?? error).slice(0, 200); }
   }
   return out;`;

export const firstSteps = {
  async boot({ check }) {
    const person = await inWindow(tryCalls(["model_keys_saved", "agents_device_snapshot", "definitely_not_a_command"]));
    check("boot", "a person's window runs common commands", person.model_keys_saved === "ok" && person.agents_device_snapshot === "ok", JSON.stringify(person));
    check("boot", "an unknown command is refused", /not allowed/.test(person.definitely_not_a_command), person.definitely_not_a_command);
    await inWindow(`await __smoke.invoke("profile_incognito_open", {}); return true;`);
    await sleep(3000);
    const { windows } = await bridge("/windows");
    const incognito = windows.find((label) => label.startsWith("incognito-"));
    check("boot", "an incognito window opens", incognito, JSON.stringify(windows));
    if (!incognito) return;
    await waitForWindow(30_000, incognito);
    const refused = ["agents_device_snapshot", "model_keys_saved", "agent_runtime_voice_open", "agent_runtime_call", "agents_share_folder"];
    const answers = await inWindow(tryCalls(refused), { window: incognito });
    check("boot", "an incognito window is refused agents, keys and voice", refused.every((command) => /not allowed on window/.test(answers[command])), JSON.stringify(answers));
    const started = await windowErrors(incognito);
    check("boot", "an incognito window hit no refusals of its own after opening", !notAllowed(started).length, JSON.stringify(notAllowed(started)));
    await inWindow(`void window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: ${JSON.stringify(incognito)} }); return true;`, { window: incognito, timeoutMs: 3000 }).catch(() => undefined);
    await sleep(1000);
  },

  async signin({ check, scratch, server }) {
    const account = { username: "smoke_tester", email: "smoke-tester@example.test", password: `made!up-${Date.now()}` };
    writeFileSync(resolve(scratch, "signin.json"), JSON.stringify(account), { mode: 0o600 });
    const landed = await inWindow(
      `await __smoke.click("Sign in");
       await __smoke.click("Self-hosted");
       await __smoke.until(() => document.querySelector("#setup-server"), "the address field");
       await __smoke.type("#setup-server", ${JSON.stringify(server)});
       await __smoke.sleep(100);
       await __smoke.submit("#setup-server");
       await __smoke.until(() => document.querySelector("#signin-email"), "the sign-in form");
       const { useServerChoice } = await __smoke.module("api/deployment/serverChoice.ts");
       const choice = useServerChoice.getState().choice;
       await __smoke.click("Don't have an account? Create one");
       await __smoke.until(() => document.querySelector("#register-email"), "the register form");
       await __smoke.type("#register-username", ${JSON.stringify(account.username)});
       await __smoke.type("#register-email", ${JSON.stringify(account.email)});
       await __smoke.type("#register-password", ${JSON.stringify(account.password)});
       await __smoke.sleep(150);
       await __smoke.submit("#register-email");
       await __smoke.until(() => location.pathname === "/browser", "the browser after sign-in", 30000);
       return { choice, text: __smoke.text().slice(0, 200) };`,
      { timeoutMs: 60_000 },
    );
    check("signin", "the server was chosen through the setup screen", landed.choice?.url === `${server}/v1`, JSON.stringify(landed.choice));
    check("signin", "the first account registered and reached the browser", landed.text.includes(account.username), landed.text);
  },

  async models({ check }) {
    const answer = await inWindow(
      `const store = (await __smoke.module("features/settings/store/useSettingsStore.ts")).useSettingsStore;
       const accounts = await __smoke.module("features/settings/models/modelAccounts.ts");
       const { deviceModelCall } = await __smoke.module("api/device-models.ts");
       const set = async (key, value) => { store.getState().updateSetting("models", key, value); await __smoke.sleep(150); };
       await set("provider", "openai-compatible");
       await set("openai_compatible_base_url", ${JSON.stringify(mockBase)});
       const added = await accounts.addModelKey("throwaway-smoke-key", "openai-compatible");
       const listed = await __smoke.invoke("model_keys_models", { provider: "openai-compatible" });
       await set("agent_model", "openai-compatible/mock-agent");
       await set("fast_model", "openai-compatible/mock-fast");
       await set("embedding_model", "openai-compatible/mock-embedding");
       await __smoke.sleep(600);
       return { added, listed, test: await deviceModelCall("model-test", {}) };`,
      { timeoutMs: 90_000 },
    );
    check("models", "the key saved", answer.added.saved.includes("openai-compatible"), JSON.stringify(answer.added));
    check("models", "the provider's models listed", answer.listed.some((model) => model.id === "openai-compatible/mock-agent"), JSON.stringify(answer.listed));
    check("models", "Check the agent model passes tools and images", answer.test.tools.ok && answer.test.images.ok, JSON.stringify(answer.test));
    const { runtime } = await bridge("/models");
    check("models", "the app reports its runtime", ["rust", "typescript"].includes(runtime), runtime);
  },

  async agent({ check, dataRoot, scratch, runtime }) {
    mkdirSync(resolve(scratch, "victim"), { recursive: true });
    const victim = resolve(scratch, "victim/keep.txt");
    const homeVictim = resolve(homedir(), `.misty-smoke-victim-${process.pid}/keep.txt`);
    mkdirSync(resolve(homeVictim, ".."), { recursive: true });
    writeFileSync(victim, "keep");
    writeFileSync(homeVictim, "keep");
    try {
      await mock.reset();
      await mock.script([{ text: "Hello from the mock model." }]);
      let run = await startChat("Say hello");
      check("agent", "a text reply completes", (await waitForState(run.invocationId)) === "completed");
      const reply = await inWindow(
        `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
         await __smoke.until(() => !misty.getState().working, "the turn to settle");
         const state = misty.getState();
         return state.conversations.find((chat) => chat.id === state.invocationConversationId)?.messages.at(-1)?.content;`,
      );
      check("agent", "the reply reached the chat", reply === "Hello from the mock model.", reply);

      await mock.reset();
      await mock.script([
        { tools: [{ id: "call_a1", name: "web_fetch", args: { url: "https://example.com/", question: "what is this" } }] },
        { tools: [{ id: "call_a2", name: "web_fetch", args: { url: `${mockBase}/models` } }] },
        shell("call_a3", "echo smoke-content > made.txt && cat made.txt"),
        shell("call_a4", `rm -rf '${victim}' '${homeVictim}'; echo rm=$?; ls '${homedir()}' > /dev/null; echo ls=$?; curl -s -m 3 https://example.com > /dev/null; echo curl=$?`),
        finish("call_a5"),
      ]);
      run = await startChat("Run the smoke steps");
      check("agent", "the tool run completes", (await waitForState(run.invocationId, undefined, 120_000)) === "completed");
      const turns = await mock.turns();
      const results = await mock.toolResults();
      const result = (id) => results.find((item) => item.id === id)?.content ?? "";
      const shellTool = turns[0]?.body.tools.find((tool) => tool.function.name === "shell_run");
      check("agent", "the system prompt names Misty", turns[0]?.body.messages[0].content.startsWith("You are Misty"), turns[0]?.body.messages[0].content.slice(0, 100));
      check("agent", "shell_run is offered with its description", /private workspace folder/.test(shellTool?.function.description) && /There's no network/.test(shellTool?.function.description), shellTool?.function.description);
      check("agent", "every turn sends the same keys and tools", turns.every((turn) => Object.keys(turn.body).join() === Object.keys(turns[0].body).join() && JSON.stringify(turn.body.tools) === JSON.stringify(turns[0].body.tools)), turns.map((turn) => Object.keys(turn.body).join()).join(" | "));
      check("agent", "the prompt only grows between turns", turns.every((turn, at) => !at || JSON.stringify(turn.body.messages).startsWith(JSON.stringify(turns[at - 1].body.messages).slice(0, -1))), "");
      check("agent", "web_fetch reads a public page", /Example Domain/.test(result("call_a1")), result("call_a1"));
      check("agent", "web_fetch refuses a private address", /private_address/.test(result("call_a2")), result("call_a2"));
      check("agent", "shell_run writes and reads in its workspace", /"stdout":"smoke-content/.test(result("call_a3")), result("call_a3"));
      check("agent", "rm -rf outside is refused", /rm=1/.test(result("call_a4")) && /Operation not permitted/.test(result("call_a4")), result("call_a4"));
      check("agent", "the files outside survive", existsSync(victim) && existsSync(homeVictim));
      check("agent", "the home folder can't be listed", /ls=1/.test(result("call_a4")), result("call_a4"));
      check("agent", "commands have no network", !/curl=0/.test(result("call_a4")), result("call_a4"));
      check("agent", "the file is in the chat's workspace", findInWorkspaces(dataRoot, "made.txt"));
      writeFileSync(resolve(scratch, `requests-${runtime}.json`), JSON.stringify(await mock.requests(), null, 1));
    } finally {
      rmSync(resolve(homeVictim, ".."), { recursive: true, force: true });
    }
  },

  async folder({ check, scratch }) {
    const root = resolve(scratch, "shared");
    mkdirSync(root, { recursive: true });
    writeFileSync(resolve(root, "existing.txt"), "original\n");
    await bridge("/share-folder", { path: root });
    const folder = await inWindow(
      `const stores = await __smoke.module("features/agents/store/useAgentsStore.ts");
       await stores.republishDeviceFolders();
       return (await stores.agentsDeviceSnapshot()).scopes.find((scope) => scope.displayName === "shared").id;`,
    );
    await mock.reset();
    await mock.script([
      shell("call_f1", "cat shared-folder/existing.txt; echo cat=$?; echo x > shared-folder/ro-new.txt; echo add=$?; echo x >> shared-folder/existing.txt; echo edit=$?; rm shared-folder/existing.txt; echo rm=$?"),
      { tools: [{ id: "call_f2", name: "folder_list", args: { folder: "shared" } }] },
      { tools: [{ id: "call_f4", name: "folder_read", args: { folder: "shared", path: "existing.txt" } }] },
      finish(),
    ]);
    let run = await startChat("Read only folder", { folder });
    check("folder", "the read-only run completes", (await waitForState(run.invocationId)) === "completed");
    let out = await output();
    check("folder", "read-only: reading works", /cat=0/.test(out), out);
    check("folder", "read-only: adding and editing are refused", /add=1/.test(out) && /edit=1/.test(out) && !existsSync(resolve(root, "ro-new.txt")), out);
    check("folder", "read-only: folder_list answers", /existing\.txt/.test((await mock.toolResults()).find((result) => result.id === "call_f2")?.content), out);
    check("folder", "read-only: folder_read answers", /original/.test((await mock.toolResults()).find((result) => result.id === "call_f4")?.content), out);

    await mock.reset();
    await mock.script([
      shell("call_f3", "echo x > shared-folder/rw-new.txt; echo add=$?; echo edited >> shared-folder/existing.txt; echo edit=$?; rm shared-folder/existing.txt; echo rm=$?; rm -rf shared-folder/rw-new.txt; echo rmrf=$?; mv shared-folder/existing.txt shared-folder/moved.txt; echo mv=$?; find shared-folder/ -name rw-new.txt -delete; echo find=$?"),
      finish(),
    ]);
    run = await startChat("Writable folder", { folder, writable: true });
    check("folder", "the writable run completes", (await waitForState(run.invocationId)) === "completed");
    out = await output();
    check("folder", "writable: adding and editing work", /add=0/.test(out) && /edit=0/.test(out) && readFileSync(resolve(root, "existing.txt"), "utf8").includes("edited"), out);
    check("folder", "writable: delete, rm -rf, mv and find -delete are refused", /rm=1/.test(out) && /rmrf=1/.test(out) && /mv=1/.test(out) && /unlink\(.*not permitted/.test(out), out);
    check("folder", "writable: the files survived", existsSync(resolve(root, "existing.txt")) && existsSync(resolve(root, "rw-new.txt")) && !existsSync(resolve(root, "moved.txt")));
  },

  async tools({ check, dataRoot }) {
    await mock.reset();
    await mock.script([
      { tools: [{ id: "call_b1", name: "screen_open", args: { url: "https://example.com/", reason: "read it" } }] },
      { tools: [{ id: "call_b2", name: "browser_run", args: { code: "const tabs = await listTabs(); log(tabs.length); return (await tabs[0].text({ maxChars: 300 })).text;" } }] },
      { tools: [{ id: "call_b3", name: "log_work_write", args: { section: "findings", content: "Read the page.", mode: "append" } }] },
      finish(),
    ]);
    let run = await startChat("Open a page and read it");
    check("tools", "a run with its own browser tab completes", (await waitForState(run.invocationId, undefined, 90_000)) === "completed");
    let out = await output();
    check("tools", "screen_open opens the agent's own tab", /Your own browser tab is open/.test(out), out);
    check("tools", "browser_run reads that tab", /Example Domain|documentation examples/.test(out), out);
    check("tools", "the notebook saves", /"saved":true/.test(out), out);

    await mock.reset();
    await mock.script([{ text: "Mock says the first answer is forty two." }, { text: "Second answer." }]);
    run = await startChat("First question");
    await waitForState(run.invocationId);
    await waitForState((await sendInChat("A second message")).invocationId);
    const second = (await mock.turns()).at(-1);
    check("tools", "a second message carries the chat so far", /forty two/.test(second?.raw) && /A second message/.test(second?.raw), second?.raw.slice(-600));

    await mock.reset();
    await mock.script([shell("call_s1", "echo steered", { hold: true }), finish()]);
    run = await startChat("Steer me");
    for (let tries = 0; tries < 100 && !(await mock.held()); tries++) await sleep(150);
    await inWindow(
      `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
       await misty.getState().submitAnswer("Also check the other thing", [], undefined, "panel");
       return true;`,
      { timeoutMs: 20_000 },
    );
    await sleep(800);
    await mock.release();
    await waitForState(run.invocationId, undefined, 40_000);
    check("tools", "a message during a run reaches its next turn", (await mock.turns()).at(-1)?.raw.includes("Also check the other thing"));

    await mock.reset();
    await mock.script([shell("call_i1", "echo mine > mine.txt; pwd"), finish()]);
    run = await startChat("Chat one");
    await waitForState(run.invocationId);
    const one = run.conversationId;
    const workspace = JSON.parse((await mock.toolResults())[0].content).stdout.trim();
    await mock.reset();
    await mock.script([shell("call_i3", "cat mine.txt"), finish()]);
    await waitForState((await sendInChat("Read it back")).invocationId);
    out = await output();
    check("tools", "a chat keeps one workspace across its runs", /"stdout":"mine/.test(out), out);
    await mock.reset();
    await mock.script([shell("call_i2", `cat '${workspace}/mine.txt'; echo cat=$?; ls ..; echo ls=$?`), finish()]);
    run = await startChat("Chat two");
    await waitForState(run.invocationId);
    out = await output();
    check("tools", "one chat can't read another's workspace", /cat=1/.test(out) && /ls=1/.test(out), out);
    await inWindow(
      `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
       await misty.getState().deleteConversation(${JSON.stringify(one)});
       return true;`,
    );
    await sleep(2500);
    check("tools", "deleting a chat deletes its workspace", !existsSync(`${workspace}/mine.txt`) && !findInWorkspaces(dataRoot, "mine.txt"), workspace);
  },
};
