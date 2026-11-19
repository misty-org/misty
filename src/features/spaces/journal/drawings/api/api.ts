import { spaceRequest } from "../../../api/api";
import type {
  DrawingCollaborationTicket,
  DrawingSceneChange,
  DrawingSceneResult,
  DrawingSceneState,
  SpaceDrawing,
} from "./drawingApiTypes";

function drawingPath(spaceId: string, drawingId?: string): string {
  const base = `/spaces/${encodeURIComponent(spaceId)}/drawings`;
  return drawingId ? `${base}/${encodeURIComponent(drawingId)}` : base;
}

export const drawingsApi = {
  list: (spaceId: string) => spaceRequest<{ drawings: SpaceDrawing[] }>(drawingPath(spaceId)),
  create: (spaceId: string, title: string) =>
    spaceRequest<SpaceDrawing>(drawingPath(spaceId), {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  get: (spaceId: string, drawingId: string) =>
    spaceRequest<SpaceDrawing>(drawingPath(spaceId, drawingId)),
  rename: (spaceId: string, drawingId: string, title: string) =>
    spaceRequest<SpaceDrawing>(drawingPath(spaceId, drawingId), {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  remove: (spaceId: string, drawingId: string) =>
    spaceRequest(drawingPath(spaceId, drawingId), { method: "DELETE" }),
  collaborationTicket: (spaceId: string, drawingId: string) =>
    spaceRequest<DrawingCollaborationTicket>(
      `${drawingPath(spaceId, drawingId)}/collaboration-ticket`,
      { method: "POST" },
    ),
  /** The live scene and its content hash, the route `drawing.read` reads. */
  readScene: (spaceId: string, drawingId: string) =>
    spaceRequest<DrawingSceneState>(
      `${drawingPath(spaceId, drawingId)}/scene?include_deleted=false`,
    ),
  /**
   * Applies a scene change in the room, the route `drawing.apply` uses. With `idempotencyKey`, a
   * retried change answers from the room's record instead of applying twice.
   */
  applyScene: (
    spaceId: string,
    drawingId: string,
    change: DrawingSceneChange,
    idempotencyKey?: string,
  ) =>
    spaceRequest<DrawingSceneResult>(`${drawingPath(spaceId, drawingId)}/scene`, {
      method: "POST",
      body: JSON.stringify(change),
      ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
    }),
};
