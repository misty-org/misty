import type * as Y from "yjs";
import type { WebsocketProvider } from "y-partyserver/provider";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { DrawingAssetReference, DrawingRole } from "./types";

/** Public view data only: authorization tickets and connection URLs remain in the host. */
export interface DrawingSession {
  key: string;
  role?: DrawingRole;
  doc: Y.Doc;
  elements: Y.Map<OrderedExcalidrawElement>;
  scene: Y.Map<unknown>;
  files: Y.Map<DrawingAssetReference>;
  provider: Pick<WebsocketProvider, "awareness" | "on" | "off" | "synced">;
}
