export type { DrawingCollaborationTicket, DrawingRole, SpaceDrawing } from "./api/drawingApiTypes";

export type DrawingConnectionState = "connecting" | "connected" | "disconnected" | "error";

export interface DrawingAssetReference {
  assetId: string;
  fileId: string;
  mimeType: string;
  created: number;
}
