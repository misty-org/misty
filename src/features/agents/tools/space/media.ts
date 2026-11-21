import { invoke } from "@tauri-apps/api/core";
import { agentFolderOf } from "../../artifacts/agentArtifacts";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import type { LocalToolHandler, LocalToolRequest } from "../host";
import { loadRunEntry } from "../runContexts";
import { refuse } from "./api";
import { text } from "./args";
import { routedTool } from "./routing";

/**
 * Media between a Space's drive and the chat's folder. An agent brings its own tools for the heavy
 * work (splitting a voice from music, upscaling, making an image): `media.fetch` puts one of the
 * Space's files in the chat's folder for them, and `file.upload` saves what they made back into the
 * agent's folder of the drive (`/Agents/<agent name>/`). Native code keeps both inside the chat's own
 * folder (`engines/chat_media.rs`).
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
  const file = await gateway.driveFile(space.id, itemId);
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
  const saved = await gateway.saveToDrive(space.id, agentFolderOf(run.agentId), name, bytes);
  return { saved: saved.name, path: saved.path, item_id: saved.id, bytes: bytes.byteLength };
});

export const mediaTools: Record<string, LocalToolHandler> = {
  "media.fetch": fetchMedia,
  "file.upload": upload,
};
