import type { AuthUser } from "@/features/auth";
import {
  acquireDrawingSession,
  releaseDrawingSession,
} from "../collaboration/drawingCollaboration";
import { useDrawingRoomView, type DrawingRoomServices } from "./useDrawingRoomView";
const owner: DrawingRoomServices = {
  acquire: acquireDrawingSession,
  release: releaseDrawingSession,
};
export function useDrawingRoom(
  spaceId: string,
  drawingId: string,
  user: AuthUser,
  options?: { publishPresence?: boolean },
) {
  return useDrawingRoomView(owner, spaceId, drawingId, user, options);
}
