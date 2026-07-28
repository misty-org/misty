import { spaceRequest } from "@/stores/spaces/useSpacesBackendStore";
import type { DrawingCollaborationTicket, SpaceDrawing } from "../types";

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
    spaceRequest(drawingPath(spaceId, drawingId), {
      method: "DELETE",
    }),

  collaborationTicket: (spaceId: string, drawingId: string) =>
    spaceRequest<DrawingCollaborationTicket>(
      `${drawingPath(spaceId, drawingId)}/collaboration-ticket`,
      { method: "POST" },
    ),
};
