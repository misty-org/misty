import type * as Y from "yjs";
import type { WebsocketProvider } from "y-partyserver/provider";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { CollaborationAccess } from "../notes/createYjsProvider";
import type { DrawingAssetReference, DrawingRole } from "./drawingTypes";

/** Public view data only: authorization tickets and connection URLs remain in the host. */
export interface DrawingSession {
  key: string;
  role?: DrawingRole;
  doc: Y.Doc;
  elements: Y.Map<OrderedExcalidrawElement>;
  scene: Y.Map<unknown>;
  files: Y.Map<DrawingAssetReference>;
  provider: Pick<WebsocketProvider, "awareness" | "on" | "off" | "synced">;
  /** Whether this person can still reach the drawing; a view without it never loses access. */
  access?: Pick<CollaborationAccess, "lost" | "subscribe" | "retry">;
}
