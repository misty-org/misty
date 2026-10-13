import type { SpaceRole } from "./common";

export type AgentAvatar =
  | { kind: "preset"; preset_id: string; accent: string }
  | { kind: "upload"; asset_id: string; version: number };

export interface SpaceMember {
  space_id: string;
  user_id: string;
  name: string;
  email: string;
  role: SpaceRole;
  joined_at: string;
  read_message_seq: number;
}
type SpaceTaskSourceRefKind = "library_item" | "task_attachment" | "chat_attachment";

export interface SpaceTaskSourceRef {
  kind: SpaceTaskSourceRefKind;
  resource_id: string;
  display_name?: string;
  version?: number;
  [key: string]: unknown;
}
