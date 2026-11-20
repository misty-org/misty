import { invoke } from "@tauri-apps/api/core";
import { ApiRequestError } from "@/api/client";
import { spacesGateway, type AgentArtifactProvenance } from "../../spaces-gateway/spacesGateway";
import type { LocalToolHandler, LocalToolRequest } from "../host";
import { loadRunEntry } from "../runContexts";
import { refuse } from "./api";
import { text } from "./args";
import { routedTool } from "./routing";

/**
 * Media between a Space and the chat's folder. An agent brings its own tools for the heavy work
 * (splitting a voice from music, upscaling, making an image): `media.fetch` puts a Media file in
 * the chat's folder for them, and `file.upload` adds what they made back to Media. Native code
 * keeps both inside the chat's own folder (`engines/chat_media.rs`).
 */

const UNAVAILABLE = "Files can't be reached from here.";

async function chatOf(request: LocalToolRequest) {
  const run = await loadRunEntry(request.runId).catch(() => null);
  if (!run?.conversationId)
    throw refuse("Only a chat's agent has a folder to fetch media into.", "not_allowed");
  return run;
}

const fetchMedia = routedTool("read", async (request, space) => {
  const itemId = text(request.input, "item_id", { max: 200 }).trim();
  if (!itemId) throw refuse("item_id is required");
  const gateway = spacesGateway.maybe();
  if (!gateway) throw refuse(UNAVAILABLE, "unavailable");
  const run = await chatOf(request);
  const file = await gateway.libraryFile(space.id, itemId);
  const path = await invoke<string>("chat_media_save", new Uint8Array(await file.arrayBuffer()), {
    headers: {
      "x-account": encodeURIComponent(run.account),
      "x-conversation": encodeURIComponent(run.conversationId),
      "x-file-name": encodeURIComponent(file.name),
    },
  });
  return { path, name: file.name, type: file.type, bytes: file.size };
});

const upload = routedTool("change", async (request, space) => {
  const path = text(request.input, "path", { max: 4000 }).trim();
  if (!path) throw refuse("path is required");
  const gateway = spacesGateway.maybe();
  if (!gateway) throw refuse(UNAVAILABLE, "unavailable");
  const run = await chatOf(request);
  let bytes: ArrayBuffer;
  try {
    bytes = await invoke<ArrayBuffer>("chat_media_load", {
      account: run.account,
      conversation: run.conversationId,
      path,
    });
  } catch (error) {
    throw refuse(typeof error === "string" ? error : "That file can't be read.");
  }
  const name =
    text(request.input, "name", { max: 200 }).trim() || path.split(/[\\/]/).pop() || "file";
  const credit: AgentArtifactProvenance | undefined =
    run.agentId && run.spaceId === space.id
      ? {
          agent_id: run.agentId,
          conversation_id: run.conversationId,
          run_id: request.runId,
          kind: "file",
        }
      : undefined;
  const blob = new Blob([bytes]);
  const send = (agent?: AgentArtifactProvenance) =>
    gateway.uploadLibraryBlob(space.id, blob, name, "library", agent ? { agent } : undefined);
  let result;
  try {
    result = await send(credit);
  } catch (error) {
    // A Space that doesn't list the agent refuses the credit before storing anything.
    if (credit && error instanceof ApiRequestError && error.status === 403) result = await send();
    else throw error;
  }
  return { saved: name, item_id: result.item?.id ?? null, bytes: blob.size };
});

export const mediaTools: Record<string, LocalToolHandler> = {
  "media.fetch": fetchMedia,
  "file.upload": upload,
};
