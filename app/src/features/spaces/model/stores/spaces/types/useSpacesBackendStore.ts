import type { SpaceEvent } from "@/services/spaces/dto/interfaces/types";

export type SpacePresenceViewer = { user_id: string; active: boolean };

export type RealtimeEnvelope =
  | { type: "replay"; events: SpaceEvent[]; resync_required: boolean }
  | { type: "event"; event: SpaceEvent }
  | {
      type: "control";
      action: "member.removed" | "member.left" | "space.deleted";
      space_id: string;
    }
  | { type: "presence"; space_id: string; viewers: SpacePresenceViewer[] };
