import { createPort } from "@/shared/lib/seams";

/** Who made a Library item, for the credit line on it. */
export interface AgentArtifactProvenance {
  agent_id: string;
  conversation_id?: string;
  run_id?: string;
  kind: "download" | "file" | "image" | "document";
}

type Uploaded = Promise<{ item?: { id: string } }>;

/** What agents ask of Spaces. Spaces sits above agents, so it fills this in once at startup. */
interface SpacesGateway {
  uploadLibraryPath(
    spaceId: string,
    path: string,
    purpose: "library" | "attachment",
    options?: { agent?: AgentArtifactProvenance },
  ): Uploaded;
  uploadLibraryBlob(spaceId: string, blob: Blob, filename: string): Uploaded;
  /** Makes a drawing in a Space and puts these Excalidraw elements on it. */
  createDrawing(
    spaceId: string,
    title: string,
    elements: readonly unknown[],
  ): Promise<{ id: string }>;
  /** The window's Space when other people are in it, where a reply can be handed to one of them. */
  sharedWindowSpace(): { id: string; name: string } | undefined;
  /** The other people in a Space. */
  otherMembers(spaceId: string): Promise<{ userId: string; name: string }[]>;
  /**
   * Sends words the person reviewed to one member, as the person's own message. Never called
   * with text nobody read: the agent's reply is only the draft the person edits and sends.
   */
  sendHandoff(spaceId: string, userId: string, text: string): Promise<void>;
}

export const spacesGateway = createPort<SpacesGateway>("Spaces for agents");
