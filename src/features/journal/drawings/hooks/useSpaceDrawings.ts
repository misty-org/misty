import { drawingsApi } from "@/api/drawings/api";
import { notifyDrawingListChanged, subscribeToDrawingListChanges } from "../drawingEvents";
import { closeDrawingCollaborationSession } from "../collaboration/drawingCollaboration";
import { useSpaceDrawingsView, type DrawingsListServices } from "./useSpaceDrawingsView";
const services: DrawingsListServices = {
  ...drawingsApi,
  subscribe: subscribeToDrawingListChanges,
  changed: notifyDrawingListChanged,
  closeDocument: closeDrawingCollaborationSession,
};
export function useSpaceDrawings(spaceId: string) {
  return useSpaceDrawingsView(spaceId, services);
}
