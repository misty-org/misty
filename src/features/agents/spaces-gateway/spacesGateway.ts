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
}

export const spacesGateway = createPort<SpacesGateway>("Spaces for agents");
