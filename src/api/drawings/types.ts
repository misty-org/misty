export type DrawingRole = "creator" | "editor" | "viewer";

export interface SpaceDrawing {
  id: string;
  space_id: string;
  creator_user_id: string;
  title: string;
  lifecycle_state: "active" | "deleting";
  collaboration_revision: number;
  acl_version: number;
  created_at: string;
  updated_at: string;
  role: DrawingRole;
  can_delete: boolean;
}

export interface DrawingCollaborationTicket {
  ticket: string;
  room: string;
  url: string;
  role: DrawingRole;
  expires_at: string;
}
