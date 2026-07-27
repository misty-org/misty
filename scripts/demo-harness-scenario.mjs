import { createHash } from "node:crypto";
import {
  APIClient, assert, demoRoutes, fixtureData, loginOrRegister, readJSON, statePath, writePrivateJSON,
} from "./demo-harness-core.mjs";

function idsByKey(records) {
  return Object.fromEntries(records.map((record) => [record.key, record.item.id]));
}

async function uploadAsset(client, spaceID, asset) {
  const fixture = await fixtureData(asset);
  const initiated = await client.request("POST", `/spaces/${spaceID}/library/uploads`, {
    body: { filename: asset.displayName, mime_type: asset.mimeType, byte_size: fixture.bytes.length, sha256: fixture.sha256, purpose: "library" },
  });
  const upload = initiated.data.upload;
  const transfer = initiated.data.transfer;
  const uploadToken = transfer.headers?.["X-Misty-Library-Upload-Token"] || transfer.headers?.["x-misty-library-upload-token"];
  if (!upload?.id || !transfer?.url || !uploadToken) throw new Error(`Upload initiation was incomplete for ${asset.key}`);
  await client.request("PUT", transfer.url, {
    body: fixture.bytes,
    headers: { "Content-Type": asset.mimeType, "Content-Length": String(fixture.bytes.length), "X-Misty-Library-Upload-Token": uploadToken },
    timeout: 120_000,
  });
  const finalized = await client.request("POST", `/spaces/${spaceID}/library/uploads/${upload.id}/finalize`, {
    headers: { "X-Misty-Library-Upload-Token": uploadToken }, timeout: 120_000,
  });
  const item = finalized.data.item;
  if (!item?.id) throw new Error(`Upload finalization did not create a Library item for ${asset.key}`);
  const updated = await client.request("PATCH", `/spaces/${spaceID}/library/items/${item.id}`, {
    body: { version: item.version, display_name: asset.displayName, caption: asset.caption, tags: asset.tags, favorite: asset.favorite, hidden: false },
  });
  return { key: asset.key, sha256: fixture.sha256, byte_size: fixture.bytes.length, item: updated.data };
}

async function sendConversationMessage(client, spaceID, conversationID, text, libraryItemIDs) {
  const response = await client.request("POST", `/spaces/${spaceID}/conversations/${conversationID}/messages`, {
    body: { content: [{ type: "text", text }], library_item_ids: libraryItemIDs },
  });
  return response.data.message;
}

async function sendEveryoneMessage(client, spaceID, text, libraryItemIDs) {
  const response = await client.request("POST", `/spaces/${spaceID}/messages`, {
    body: { content: [{ type: "text", text }], library_item_ids: libraryItemIDs },
  });
  return response.data.message;
}

export async function seedScenario(baseURL, credentials, manifest, report) {
  const root = new APIClient(baseURL, "", report);
  const resetPhase = report.start("reset product data");
  const admin = root.withToken(credentials.adminToken);
  const status = await admin.request("GET", "/internal/demo/status");
  assert(status.data.ready === true, "demo server readiness");
  assert(status.data.scenario_version === manifest.scenarioVersion, "server and manifest versions match");
  const ownerSession = await loginOrRegister(root, manifest.users.owner, credentials.ownerPassword, credentials.ownerToken);
  const collaboratorSession = await loginOrRegister(root, manifest.users.collaborator, credentials.collaboratorPassword, credentials.collaboratorToken);
  const reset = await admin.request("POST", "/internal/demo/reset", {
    body: { scenario_version: manifest.scenarioVersion, confirmation: "RESET MISTY DEMO" }, timeout: 120_000,
  });
  const preservedOwner = await root.withToken(ownerSession.token).request("GET", "/me");
  const preservedCollaborator = await root.withToken(collaboratorSession.token).request("GET", "/me");
  const sessionPreserved = preservedOwner.data?.id === ownerSession.user_id && preservedCollaborator.data?.id === collaboratorSession.user_id;
  assert(sessionPreserved, "both active collaborator sessions survive reset");
  report.finish(resetPhase, { deleted_library_objects: reset.data.deleted_library_objects, accounts_preserved: reset.data.accounts_preserved, active_session_preserved: sessionPreserved });

  const accountsPhase = report.start("reuse two preserved demo collaborator sessions");
  const owner = root.withToken(ownerSession.token);
  const collaborator = root.withToken(collaboratorSession.token);
  report.finish(accountsPhase, { owner_user_id: ownerSession.user_id, collaborator_user_id: collaboratorSession.user_id });

  const spacePhase = report.start("create shared Space and accept invitation");
  const createdSpace = await owner.request("POST", "/spaces", { body: { name: manifest.space.name } });
  const spaceID = createdSpace.data.id;
  const invite = await owner.request("POST", `/spaces/${spaceID}/invitations`, { body: { email: manifest.users.collaborator.email } });
  await collaborator.request("POST", `/spaces/invitations/${invite.data.id}/accept`);
  const collaboratorPermissions = ["library.view", "library.upload", "library.add", "library.edit", "library.download", "messages.read", "messages.write"];
  for (const permission of collaboratorPermissions) {
    await owner.request("PUT", `/spaces/${spaceID}/members/${collaboratorSession.user_id}/permissions`, { body: { permission, effect: "allow" } });
  }
  report.finish(spacePhase, { space_id: spaceID, invitation_id: invite.data.id, collaborator_permissions: collaboratorPermissions });

  const assetsPhase = report.start("upload and enrich six committed fixtures");
  const assets = [];
  for (const asset of manifest.assets) {
    const client = asset.contributor === "owner" ? owner : collaborator;
    assets.push(await uploadAsset(client, spaceID, asset));
  }
  const assetIDs = idsByKey(assets);
  report.finish(assetsPhase, { asset_ids: assetIDs });

  const albumPhase = report.start("create Core Evidence album");
  let album = (await owner.request("POST", `/spaces/${spaceID}/library/albums`, { body: manifest.album })).data;
  await owner.request("POST", `/spaces/${spaceID}/library/albums/${album.id}/items`, { body: { item_ids: Object.values(assetIDs) } });
  album = (await owner.request("GET", `/spaces/${spaceID}/library/albums/${album.id}`)).data;
  album = (await owner.request("PATCH", `/spaces/${spaceID}/library/albums/${album.id}`, {
    body: { version: album.version, name: album.name, description: album.description, cover_item_id: assetIDs["research-board"] },
  })).data;
  report.finish(albumPhase, { album_id: album.id });

  const studioPhase = report.start("create enabled Agent and cloud workflow");
  const agent = (await owner.request("POST", `/spaces/${spaceID}/studio/agents`, {
    body: { name: manifest.agent.name, description: manifest.agent.description, instructions: manifest.agent.instructions, icon: "sparkles", enabled: true, status: "available", runtime_kind: "cloud" },
  })).data;
  const workflow = (await owner.request("POST", `/spaces/${spaceID}/studio/workflows`, {
    body: { name: manifest.workflow.name, description: manifest.workflow.description, definition: manifest.workflow.definition, enabled: true, schedules_enabled: false },
  })).data;
  report.finish(studioPhase, { agent_id: agent.id, workflow_id: workflow.id });

  const conversationPhase = report.start("seed Everyone and private collaborator conversations");
  const everyoneMessages = [];
  everyoneMessages.push(await sendEveryoneMessage(owner, spaceID, "I added the research brief and workflow map. The clearest pain is the time teams lose reconstructing context between storage, chat, and AI.", [assetIDs.brief, assetIDs["workflow-map"]]));
  everyoneMessages.push(await sendEveryoneMessage(collaborator, spaceID, "The interviews back that up. People are not missing tools—they are repeatedly locating, resending, and re-explaining the same work.", [assetIDs.synthesis, assetIDs.transcript]));
  everyoneMessages.push(await sendEveryoneMessage(owner, spaceID, "I want Summarizer to turn each new report or image into a short takeaway and reusable tags, while keeping the original evidence attached.", [assetIDs["research-board"], assetIDs.synthesis]));
  const agentMessage = await admin.request("POST", "/internal/demo/agent-messages", {
    body: { billing_user_id: ownerSession.user_id, space_id: spaceID, agent_id: agent.id, text: manifest.agentMessage },
  });
  everyoneMessages.push(await sendEveryoneMessage(collaborator, spaceID, "That summary is exactly the handoff we need. I’ll use the suggested tags to organize the next round of evidence without duplicating files.", [assetIDs["research-board"], assetIDs["session-video"]]));

  const privateConversation = (await owner.request("POST", `/spaces/${spaceID}/conversations`, {
    body: { title: "Maya + Jordan — Launch prep", member_ids: [collaboratorSession.user_id] },
  })).data;
  const privateMessages = [];
  privateMessages.push(await sendConversationMessage(owner, spaceID, privateConversation.id, "For the demo, let’s open with the workflow map before showing the cleaner research board. It makes the before-and-after obvious.", [assetIDs["workflow-map"], assetIDs["research-board"]]));
  privateMessages.push(await sendConversationMessage(collaborator, spaceID, privateConversation.id, "Agreed. I tightened the board around one message: never lose the thread of your work.", [assetIDs["research-board"]]));
  privateMessages.push(await sendConversationMessage(owner, spaceID, privateConversation.id, "Can you check whether the transcript is safe to show in the recording? I want the evidence to feel real without exposing anyone.", [assetIDs.transcript]));
  privateMessages.push(await sendConversationMessage(collaborator, spaceID, privateConversation.id, "Checked—it is fictional and demo-safe. I also kept the short session clip ready as the final proof point.", [assetIDs.transcript, assetIDs["session-video"]]));
  report.finish(conversationPhase, {
    private_conversation_id: privateConversation.id,
    everyone_message_ids: [...everyoneMessages.map((item) => item.id), agentMessage.data.message.id],
    private_message_ids: privateMessages.map((item) => item.id),
  });

  const workflowPhase = report.start("complete deterministic non-AI workflow run");
  const workflowRun = (await owner.request("POST", `/spaces/${spaceID}/studio/workflows/${workflow.id}/runs`, {
    body: { prompt: "Product Research Brief.pdf", input: { prompt: "Product Research Brief.pdf" } }, timeout: 120_000,
  })).data;
  assert(workflowRun.state === "completed", "deterministic workflow run completed");
  report.finish(workflowPhase, { workflow_run_id: workflowRun.id, state: workflowRun.state });

  const routes = demoRoutes(spaceID);
  const state = {
    scenario_version: manifest.scenarioVersion, target: report.data.target, server_url: root.baseURL,
    generated_at: new Date().toISOString(),
    accounts: { owner: { id: ownerSession.user_id, email: manifest.users.owner.email }, collaborator: { id: collaboratorSession.user_id, email: manifest.users.collaborator.email } },
    space_id: spaceID, invitation_id: invite.data.id, private_conversation_id: privateConversation.id,
    album_id: album.id, agent_id: agent.id, workflow_id: workflow.id, workflow_run_id: workflowRun.id,
    asset_ids: assetIDs, assets: Object.fromEntries(assets.map((asset) => [asset.key, { id: asset.item.id, sha256: asset.sha256, byte_size: asset.byte_size }])),
    routes,
  };
  await writePrivateJSON(statePath, state);
  Object.assign(report.data.created_ids, { space_id: spaceID, private_conversation_id: privateConversation.id, album_id: album.id, agent_id: agent.id, workflow_id: workflow.id, workflow_run_id: workflowRun.id, asset_ids: assetIDs });
  return { state, ownerSession, collaboratorSession };
}

async function previewItem(client, spaceID, itemID) {
  const response = await client.request("GET", `/spaces/${spaceID}/library/items/${itemID}/preview`, { raw: true, timeout: 120_000 });
  assert(response.data.length > 0, `preview ${itemID} is nonempty`);
  assert((response.headers.get("content-type") || "").startsWith("image/"), `preview ${itemID} is an image`);
}

export async function verifyScenario(baseURL, credentials, manifest, report, providedState = null) {
  const state = providedState || await readJSON(statePath);
  assert(state.scenario_version === manifest.scenarioVersion, "saved state version matches manifest");
  const root = new APIClient(baseURL, "", report);
  const ownerSession = await loginOrRegister(root, manifest.users.owner, credentials.ownerPassword, credentials.ownerToken);
  const owner = root.withToken(ownerSession.token);
  const phase = report.start("verify exact Product Research Hub state");
  const spaces = (await owner.request("GET", "/spaces")).data.spaces;
  assert(spaces.length === 1 && spaces[0].id === state.space_id, "one shared Space");
  const members = (await owner.request("GET", `/spaces/${state.space_id}/members`)).data.members;
  assert(members.length === manifest.expected.members, "exactly two Space members");
  assert(new Set(members.map((member) => member.email)).size === 2, "both real member identities are present");

  const items = (await owner.request("GET", `/spaces/${state.space_id}/library?limit=100`)).data.items;
  assert(items.length === manifest.expected.assets, "exactly six Library items");
  for (const asset of manifest.assets) {
    const expected = state.assets[asset.key];
    const item = items.find((candidate) => candidate.id === expected.id);
    assert(item && item.caption === asset.caption && item.favorite === asset.favorite, `${asset.key} metadata`);
    assert(item.added_by_user_id === state.accounts[asset.contributor].id, `${asset.key} contributor attribution`);
    const download = await owner.request("GET", `/spaces/${state.space_id}/library/items/${item.id}/download`, { raw: true, timeout: 120_000 });
    assert(download.data.length === expected.byte_size, `${asset.key} download size`);
    assert(createHash("sha256").update(download.data).digest("hex") === expected.sha256, `${asset.key} download checksum`);
    await previewItem(owner, state.space_id, item.id);
  }

  const albums = (await owner.request("GET", `/spaces/${state.space_id}/library/albums`)).data.albums;
  assert(albums.length === manifest.expected.albums && albums[0].id === state.album_id, "one Core Evidence album");
  const albumItems = (await owner.request("GET", `/spaces/${state.space_id}/library/albums/${state.album_id}/items`)).data.items;
  assert(albumItems.length === manifest.expected.assets, "album contains all six items");

  const everyoneMessages = (await owner.request("GET", `/spaces/${state.space_id}/messages?limit=100`)).data.messages;
  const everyoneHumanMessages = everyoneMessages.filter((message) => message.sender_kind !== "agent");
  const everyoneAgentMessages = everyoneMessages.filter((message) => message.sender_kind === "agent");
  assert(everyoneHumanMessages.length === manifest.expected.everyoneHumanMessages, "expected Everyone human message count");
  assert(new Set(everyoneHumanMessages.map((message) => message.sender_user_id)).size === 2, "Everyone has messages from both collaborators");
  assert(everyoneHumanMessages.every((message) => message.library_item_ids.length > 0), "every Everyone human message references Library items");
  assert(everyoneAgentMessages.length === manifest.expected.everyoneAgentMessages && everyoneAgentMessages[0].sender_agent_id === state.agent_id, "one attributed Summarizer response in Everyone");
  assert(everyoneAgentMessages[0].content.some((span) => span.text === manifest.agentMessage), "Summarizer response matches manifest");

  const conversations = (await owner.request("GET", `/spaces/${state.space_id}/conversations`)).data.conversations;
  assert(conversations.length === 1 && conversations[0].id === state.private_conversation_id, "one private Maya and Jordan conversation");
  const privateMessages = (await owner.request("GET", `/spaces/${state.space_id}/conversations/${state.private_conversation_id}/messages?limit=100`)).data.messages;
  assert(privateMessages.length === manifest.expected.privateHumanMessages, "expected private human message count");
  assert(new Set(privateMessages.map((message) => message.sender_user_id)).size === 2, "private chat has messages from both collaborators");
  assert(privateMessages.every((message) => message.sender_kind === "person" && message.library_item_ids.length > 0), "every private message is human and references Library items");

  const agents = (await owner.request("GET", `/spaces/${state.space_id}/studio/agents`)).data.resources;
  const workflows = (await owner.request("GET", `/spaces/${state.space_id}/studio/workflows`)).data.resources;
  const explicitWorkflows = workflows.filter((workflow) => workflow.stable_identifier.includes(".workflow."));
  assert(agents.length === manifest.expected.agents && agents[0].id === state.agent_id && agents[0].enabled && agents[0].name === manifest.agent.name, "one enabled Summarizer");
  assert(Boolean(agents[0].active_workflow_version_id), "Summarizer has an attached Agent workflow");
  assert(explicitWorkflows.length === manifest.expected.workflows && explicitWorkflows[0].id === state.workflow_id && explicitWorkflows[0].enabled, "one enabled standalone summarization intake workflow");
  const runs = (await owner.request("GET", `/spaces/${state.space_id}/studio/workflows/${state.workflow_id}/runs`)).data.runs;
  assert(runs.filter((run) => run.state === "completed").length === manifest.expected.completedWorkflowRuns, "one completed workflow run");
  report.finish(phase, { checks: 31, members: members.length, assets: items.length, everyone_messages: everyoneMessages.length, private_messages: privateMessages.length, completed_workflow_runs: 1 });
  return state;
}

export async function liveAgentCheck(baseURL, credentials, manifest, report) {
  const state = await readJSON(statePath);
  const root = new APIClient(baseURL, "", report);
  const session = await loginOrRegister(root, manifest.users.owner, credentials.ownerPassword, credentials.ownerToken);
  const owner = root.withToken(session.token);
  const phase = report.start("optional live Agent check");
  const status = await owner.request("GET", "/ai/status");
  if (!status.data.configured) {
    report.finish(phase, { result: "warning", warning: "Managed AI is not configured; deterministic demo remains valid." });
    return { ok: false, warning: "Managed AI is not configured." };
  }
  try {
    const run = await owner.request("POST", `/spaces/${state.space_id}/agents/${state.agent_id}/runs`, {
      body: { prompt: "Using this Space's evidence, state the core context-fragmentation pain in two sentences." }, timeout: 180_000,
    });
    assert(run.data.state === "completed", "live Agent run completed");
    report.finish(phase, { result: "passed", run_id: run.data.id });
    return { ok: true, run: run.data };
  } catch (error) {
    report.finish(phase, { result: "warning", warning: error.message });
    return { ok: false, warning: error.message };
  }
}
