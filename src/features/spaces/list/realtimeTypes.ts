import type { SpaceEvent } from "../api/dto/entities";
import type { MemberAgentStatus } from "./memberAgents";

export type SpacePresenceViewer = { user_id: string; active: boolean };

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
