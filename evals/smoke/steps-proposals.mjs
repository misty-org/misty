// Reviewable proposals: a run asked for a draft ends with a proposal the person approves or
// rejects, and nothing changes until they do.
import { inWindow } from "./bridge.mjs";
import { mock, runState, sleep, waitForState } from "./run.mjs";

const stores = `
  const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
  const surface = (await __smoke.module("features/ai-surface/store.ts")).useAiSurfaceStore;
  const { readRunFollow } = await __smoke.module("features/ai-surface/invocationSubscription.ts");
  const { localDocuments } = await __smoke.module("features/misty/localChats.ts");
  const { aiSurfaceApi } = await __smoke.module("features/ai-surface/api.ts");
  const account = misty.getState().accountId;
`;

/** Sends what the surface put in the composer, as pressing send does. */
const sendDraft = () =>
  inWindow(
    `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
     await __smoke.until(() => !misty.getState().working, "the last turn to settle", 30000);
     const before = misty.getState().invocationId;
     void misty.getState().submitAnswer(misty.getState().query, [], undefined, "panel").catch((error) => __smoke.errors.push({ kind: "submit", text: String(error) }));
     const invocationId = await __smoke.until(() => misty.getState().invocationId !== before && misty.getState().invocationId, "the run to start", 20000);
     return { invocationId, conversationId: misty.getState().invocationConversationId };`,
    { timeoutMs: 40_000 },
  );

/** How a proposal stands: what the run said, what the chat holds, and the kept copy. */
const proposalOf = (runId) =>
  inWindow(
    `${stores}
     await __smoke.until(() => !misty.getState().working, "the turn to settle", 30000);
     const { events, state } = await readRunFollow(${JSON.stringify(runId)});
     const kinds = events.map((event) => event.type);
     const proposed = events.find((event) => event.type === "artifact.proposed")?.artifact;
     const raw = proposed ? await localDocuments.get(account, "artifact", proposed.id) : null;
     return { state, kinds, proposed, pending: misty.getState().pendingArtifact ?? null, kept: raw ? JSON.parse(raw) : null, error: misty.getState().error ?? null };`,
    { timeoutMs: 40_000 },
  );

const keptState = (artifactId) =>
  inWindow(
    `${stores}
     const raw = await localDocuments.get(account, "artifact", ${JSON.stringify(artifactId)});
     return raw ? JSON.parse(raw).state : null;`,
  );

/** Presses Approve or Reject on the card in the conversation. */
const press = (label) =>
  inWindow(
    `${stores}
     const conversationId = misty.getState().artifactConversationId;
     const agent = misty.getState().selectedAgentId;
     history.pushState(null, "", "/agents?agent=" + encodeURIComponent(agent) + "&conversation=" + encodeURIComponent(conversationId));
     window.dispatchEvent(new PopStateEvent("popstate"));
     await __smoke.click(${JSON.stringify(label)}, 15000);
     await __smoke.until(() => !misty.getState().pendingArtifact || document.body.innerText.match(/moved to another Space|no longer available|couldn|could not/i), "the card to answer", 15000);
     await __smoke.sleep(300);
     return { pending: misty.getState().pendingArtifact?.id ?? null, page: document.body.innerText.slice(0, 1500) };`,
    { timeoutMs: 40_000 },
  ).catch((error) => ({ failed: String(error) }));

/** A note open in an editor, with its words selected, registered as the pane a person is looking at. */
const openNote = (text, id) =>
  inWindow(
    `${stores}
     const { apiRequest } = await __smoke.module("api/client/index.ts");
     const { notesApi } = await __smoke.module("api/notes/api.ts");
     const { createNoteAiAdapter, updateAiSelection, noteSelectionActions } = await __smoke.module("features/journal/notes/components/noteAiAdapter.ts");
     const { openNoteEditor } = await import(\`/@fs\${window.__smokeRepo}/evals/smoke/note-editor.js\`);
     const { spaces } = await apiRequest("/spaces");
     const home = spaces.find((space) => space.is_default);
     const created = await notesApi.create(home.id, ${JSON.stringify(id)});
     const noteId = created.note?.id ?? created.id;
     const { editor, element } = openNoteEditor(${JSON.stringify(text)});
     const aiContext = { kind: "note", id: noteId, title: ${JSON.stringify(id)}, privacy: "shared", spaceId: home.id, href: "/spaces/" + home.id + "/notes/" + noteId, revision: "1" };
     let selection = null;
     updateAiSelection(editor, aiContext, (value) => { selection = value; });
     const adapter = createNoteAiAdapter(editor, { aiContext, editable: true, runtime: {} }, selection);
     const paneId = "smoke-pane-" + ${JSON.stringify(id)};
     const stop = surface.getState().registerPane({ accountId: account, paneId, adapter, element });
     (window.__smokeNotes ??= {})[${JSON.stringify(id)}] = { editor, element, stop };
     await misty.getState().newConversation?.();
     await surface.getState().submit(account, paneId, adapter, noteSelectionActions[0]);
     return { noteId, spaceId: home.id, selected: selection?.snapshot?.content, prompt: misty.getState().query };`,
    { timeoutMs: 30_000 },
  );

const noteText = (id) => inWindow(`return window.__smokeNotes[${JSON.stringify(id)}].editor.getText();`);
const closeNote = (id) =>
  inWindow(
    `const note = window.__smokeNotes[${JSON.stringify(id)}];
     note.stop(); note.editor.destroy(); note.element.remove();
     delete window.__smokeNotes[${JSON.stringify(id)}];
     return true;`,
  );

const hasBoth = (kinds) => ["artifact.proposed", "approval.required", "invocation.completed"].every((kind) => kinds.includes(kind));

export const proposalSteps = {
  // A requested kind, with nothing to apply it to yet: the draft comes back and can be turned down.
  async proposalDraft({ check }) {
    const draft = { summary: "A short hello for the channel.", operations: { conversation_id: "everyone", text: "Hello from the draft." } };
    await mock.reset();
    await mock.script([{ text: JSON.stringify(draft) }]);
    await inWindow(
      `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
       const { openMisty } = await __smoke.module("features/misty/handoff.ts");
       await misty.getState().newConversation?.();
       await openMisty({ surfaceId: "space.chat", prompt: "Draft a hello for the channel", requestedArtifactKind: "message_draft", context: [] });
       return true;`,
    );
    const run = await sendDraft();
    check("proposalDraft", "the run completes", (await waitForState(run.invocationId, undefined, 40_000)) === "completed");
    const shape = (await mock.turns())[0]?.body.messages.at(-1).content;
    check("proposalDraft", "the model was asked for that kind of draft", JSON.stringify(shape).includes("Draft a Space message for review"), JSON.stringify(shape).slice(0, 400));
    let found = await proposalOf(run.invocationId);
    check("proposalDraft", "artifact.proposed and approval.required both reach the chat", hasBoth(found.kinds), found.kinds.join());
    check("proposalDraft", "the proposal carries the draft and waits for the person", found.pending?.kind === "message_draft" && found.pending?.operations?.text === draft.operations.text && found.kept?.state === "proposed", JSON.stringify(found.pending));
    check("proposalDraft", "the reply reads as the summary", found.kinds.includes("assistant.message"), found.kinds.join());
    const answer = await press("Reject");
    check("proposalDraft", "Reject clears the card", !answer.failed && !answer.pending, JSON.stringify(answer).slice(0, 600));
    check("proposalDraft", "the kept proposal is rejected", (await keptState(found.proposed?.id)) === "rejected");
    const second = await inWindow(
      `${stores}
       return aiSurfaceApi.decideArtifact(${JSON.stringify(found.proposed?.id)}, "accept", "again").then(() => "accepted", (error) => error.code);`,
    );
    check("proposalDraft", "a decided proposal can't be decided again", second === "artifact_already_decided", second);

    // An answer that isn't a proposal ends the run, and doesn't leave it hanging.
    await mock.reset();
    await mock.script([{ text: "Not a proposal at all." }]);
    await inWindow(
      `const misty = (await __smoke.module("features/misty/useMistyStore.ts")).useMistyStore;
       const { openMisty } = await __smoke.module("features/misty/handoff.ts");
       await misty.getState().newConversation?.();
       await openMisty({ surfaceId: "space.chat", prompt: "Draft another", requestedArtifactKind: "message_draft", context: [] });
       return true;`,
    );
    const bad = await sendDraft();
    check("proposalDraft", "an answer that can't be a proposal fails the run", (await waitForState(bad.invocationId, undefined, 40_000)) === "failed", await runState(bad.invocationId));
  },

  // A selection on a note: accepting changes the words, rejecting leaves them.
  async proposalNote({ check }) {
    const original = "The first draft of this sentence.";
    const better = "A clearer sentence.";
    for (const [decision, label] of [["reject", "Reject"], ["accept", "Approve"]]) {
      const id = `smoke-note-${decision}`;
      await mock.reset();
      await mock.script([{ text: better }]);
      const opened = await openNote(original, id);
      check("proposalNote", `the selection is what the person chose (${decision})`, opened.selected === original, opened.selected);
      const run = await sendDraft();
      check("proposalNote", `the run completes (${decision})`, (await waitForState(run.invocationId, undefined, 40_000)) === "completed");
      const turn = (await mock.turns())[0];
      check("proposalNote", `the model sees the selected words (${decision})`, turn?.raw.includes(original), turn?.raw.slice(-500));
      const found = await proposalOf(run.invocationId);
      check("proposalNote", `artifact.proposed and approval.required both reach the chat (${decision})`, hasBoth(found.kinds), found.kinds.join());
      check("proposalNote", `it's a text_patch on that note (${decision})`, found.proposed?.kind === "text_patch" && found.proposed?.target?.id === opened.noteId && found.proposed?.operations?.replacement === better, JSON.stringify(found.proposed));
      check("proposalNote", `nothing shows as an error while it runs (${decision})`, !found.error, found.error);
      check("proposalNote", `the note is untouched until the person decides (${decision})`, (await noteText(id)) === original, await noteText(id));
      const answer = await press(label);
      await sleep(500);
      check("proposalNote", `${label} clears the card`, !answer.failed && !answer.pending, JSON.stringify(answer).slice(0, 800));
      if (decision === "reject") {
        check("proposalNote", "rejecting leaves the words", (await noteText(id)) === original, await noteText(id));
        check("proposalNote", "the kept proposal is rejected", (await keptState(found.proposed?.id)) === "rejected");
      } else {
        check("proposalNote", "approving replaces the selected words", (await noteText(id)) === better, await noteText(id));
        check("proposalNote", "the kept proposal is applied", (await keptState(found.proposed?.id)) === "applied", await keptState(found.proposed?.id));
      }
      await closeNote(id);
    }
  },
};
