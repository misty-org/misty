import type { ItemVisibility } from "../../../api/visibility";

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
  /** A private drawing opens only for its creator. */
  visibility?: ItemVisibility;
}

export interface DrawingCollaborationTicket {
  ticket: string;
  room: string;
  url: string;
  role: DrawingRole;
  expires_at: string;
}

/** A drawing's live scene, as its room reads it. */
export interface DrawingSceneState {
  ok: boolean;
  revision: number;
  content_hash: string;
  elements: Array<Record<string, unknown>>;
  scene?: Record<string, unknown>;
  drawing?: SpaceDrawing;
}

/** A change to a drawing's scene: elements to add or edit (merge) or the whole scene (replace). */
export interface DrawingSceneChange {
  /** The content hash the change was made against; the room refuses it if the scene moved on. */
  base_hash?: string;
  mode: "merge" | "replace";
  elements?: ReadonlyArray<Record<string, unknown>>;
  delete_element_ids?: string[];
  scene?: Record<string, unknown>;
}

/** What the room answers a scene change with. */
export interface DrawingSceneResult {
  ok: boolean;
  revision: number;
  content_hash: string;
  changed: number;
  deleted: number;
  element_count: number;
  replayed?: boolean;
  drawing?: SpaceDrawing;
}
