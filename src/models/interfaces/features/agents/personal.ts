import type { AgentCapabilityGrant } from "@/models/interfaces/features/spaces/agentArchitectureTypes";

export type ReasoningEffort = "" | "low" | "medium" | "high";

export interface PersonalAgent {
  id: string;
  owner_user_id: string;
  name: string;
  /** Public professional role shown anywhere the Agent appears as a teammate. */
  role?: string;
  description: string;
  avatar?: AgentAvatar;
  icon: string;
  instructions: string;
  model_mode: "automatic" | "pinned";
  model_id?: string;
  /** Reasoning effort for reasoning-capable models: "", "low", "medium", or "high". */
  reasoning_effort?: ReasoningEffort;
  context_permissions: Record<string, boolean>;
  tool_permissions: {
    read: boolean;
    write: boolean;
    integrations: string[];
    grants?: AgentCapabilityGrant[];
  };
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export type AgentAvatar =
  | { kind: "preset"; preset_id: string; accent: string }
  | { kind: "upload"; asset_id: string; version: number };

export interface PersonalAgentGrant {
  id: string;
  agent_id: string;
  space_id: string;
  space_name: string;
  all_members: boolean;
  member_user_ids: string[];
  space_role?: string;
  created_at: string;
  updated_at: string;
}

export interface GatewayModel {
  id: string;
  name: string;
  capabilities: string[];
}

export interface GlobalSpaceLibraryHit {
  space_id: string;
  space_name: string;
  item: import("@/models/interfaces/features/spaces/types").SpaceLibraryItem;
  deep_link: string;
}
