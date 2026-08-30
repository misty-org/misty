import type {
  AppState,
  Collaborator,
  OnUserFollowedPayload,
  SocketId,
  UserToFollow,
} from "@excalidraw/excalidraw/types";

type AwarenessView = {
  getStates(): Map<number, Record<string, unknown>>;
};

/**
 * Excalidraw follows collaborators by the map key it calls a socket ID.
 * Yjs client IDs change when a document/provider is recreated, so use the
 * authenticated account ID whenever it is available.
 */
export function collaboratorsFromAwareness(
  awareness: AwarenessView,
  localClientId: number,
): Map<SocketId, Collaborator> {
  const collaborators = new Map<SocketId, Collaborator>();
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === localClientId) continue;
    const user = isRecord(state.user) ? state.user : {};
    const pointer = isRecord(state.pointer) ? state.pointer : undefined;
    const userId = nonEmptyString(user.id);
    const socketId = stableCollaboratorSocketId(userId, clientId);
    collaborators.set(socketId, {
      id: userId ?? String(clientId),
      username: nonEmptyString(user.name) ?? "Collaborator",
      color: isCollaboratorColor(user.color) ? user.color : undefined,
      pointer:
        pointer &&
        typeof pointer.x === "number" &&
        typeof pointer.y === "number" &&
        (pointer.tool === "pointer" || pointer.tool === "laser")
          ? { x: pointer.x, y: pointer.y, tool: pointer.tool }
          : undefined,
      button: state.button === "down" ? "down" : "up",
      selectedElementIds: isSelectedElementIds(state.selectedElementIds)
        ? state.selectedElementIds
        : undefined,
    });
  }
  return collaborators;
}

export class DrawingFollowTracker {
  private desiredFollow: UserToFollow | null = null;

  record(payload: OnUserFollowedPayload, collaborators: AppState["collaborators"]): void {
    if (payload.action === "FOLLOW") {
      this.desiredFollow = payload.userToFollow;
      return;
    }
    // Excalidraw emits UNFOLLOW both when the person leaves and when the user
    // deliberately stops following. Preserve only the interrupted case.
    if (collaborators.has(payload.userToFollow.socketId)) {
      this.desiredFollow = null;
    }
  }

  followToRestore(
    collaborators: Map<SocketId, Collaborator>,
    currentFollow: UserToFollow | null,
  ): UserToFollow | null {
    if (currentFollow || !this.desiredFollow) return null;
    const collaborator = collaborators.get(this.desiredFollow.socketId);
    if (!collaborator) return null;
    return {
      socketId: this.desiredFollow.socketId,
      username: collaborator.username?.trim() || this.desiredFollow.username,
    };
  }
}

function stableCollaboratorSocketId(userId: string | undefined, clientId: number): SocketId {
  return (userId ? `user:${userId}` : `yjs:${clientId}`) as SocketId;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCollaboratorColor(value: unknown): value is { background: string; stroke: string } {
  return (
    isRecord(value) && typeof value.background === "string" && typeof value.stroke === "string"
  );
}

function isSelectedElementIds(value: unknown): value is Readonly<Record<string, true>> {
  return isRecord(value) && Object.values(value).every((selected) => selected === true);
}
