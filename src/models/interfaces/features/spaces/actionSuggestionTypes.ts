export type SpaceActionSuggestionKind =
  | "task.create"
  | "calendar.event.create"
  | "journal.note.create"
  | "roadmap.item.create"
  | "conversation.follow_up.schedule";

export interface SpaceActionSuggestionItem {
  id: string;
  batch_id: string;
  action_kind: SpaceActionSuggestionKind;
  title: string;
  summary: string;
  proposed_input: Record<string, unknown>;
  approved_input?: Record<string, unknown>;
  required_capability: string;
  selected_agent_id?: string;
  status: "active" | "accepted" | "completed" | "failed" | "canceled" | "invalidated";
  ordinal: number;
}

export interface SpaceActionSuggestionBatch {
  id: string;
  space_id: string;
  scope: { kind: "everyone" | "conversation"; conversation_id?: string };
  anchor_message_id: string;
  status: "active" | "partial" | "resolved" | "invalidated" | "expired";
  version: number;
  expires_at: string;
  dismissed_by_me: boolean;
  items: SpaceActionSuggestionItem[];
}

export interface SpaceActionSuggestionSettings {
  space_id: string;
  enabled: boolean;
  weekly_limit: number;
  weekly_used: number;
  reset_at: string;
}
