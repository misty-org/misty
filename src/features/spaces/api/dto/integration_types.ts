export type SpaceIntegrationAccess = "rooms.read" | "rooms.write";

export interface SpaceIntegration {
  id: string;
  name: string;
  avatar?: string | null;
  access: SpaceIntegrationAccess[];
  key_prefix?: string | null;
  created_by: string;
  created_at: string;
  last_used_at?: string | null;
}

export interface SpaceIntegrationMember {
  id: string;
  name: string;
  avatar?: string | null;
  access?: SpaceIntegrationAccess[];
  key_prefix?: string | null;
}

export interface SpaceIntegrationInput {
  name: string;
  access: SpaceIntegrationAccess[];
  key_prefix?: string;
}
