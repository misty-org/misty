import type { SpaceEvent } from "../api/dto/entities";
import type { MemberAgentStatus } from "./memberAgents";

/** Where in Misty a member is: the Studio, or the Lab (with the notebook's doc id). */
export type PresencePlace = "studio" | "lab";

export type SpacePresenceViewer = {
  user_id: string;
  active: boolean;
  place?: PresencePlace;
  /** The Lab notebook they have open, when `place` is "lab". */
  item_id?: string;
};

export type RealtimeEnvelope =
  | { type: "replay"; events: SpaceEvent[]; resync_required: boolean }
  | { type: "event"; event: SpaceEvent }
  | {
      type: "control";
      action: "member.removed" | "member.left" | "space.deleted";
      space_id: string;
    }
  | { type: "presence"; space_id: string; viewers: SpacePresenceViewer[] }
  | { type: "agents"; space_id: string; user_id: string; agents: MemberAgentStatus[] }
  | SpaceTypingEnvelope;

export type SpaceTypingEnvelope = {
  type: "typing";
  space_id: string;
  conversation_id: string;
  user_id: string;
  active: boolean;
};

export function spaceTypingScopeKey(spaceId: string, conversationId: string): string {
  return JSON.stringify([spaceId, conversationId]);
}
