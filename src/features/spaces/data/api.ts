import { spaceRequest } from "../api/api";
import type { ItemVisibility } from "../api/visibility";

/*
 * The workbook kind's server API (contract, "Server API"), the same paths as drawings under
 * `workbooks`. No editor or React code here: the gallery and the tool host import it alone.
 */

export type WorkbookRole = "creator" | "editor" | "viewer";

export interface SpaceWorkbook {
  id: string;
  space_id: string;
  creator_user_id: string;
  title: string;
  lifecycle_state: "active" | "deleting";
  collaboration_revision: number;
  acl_version: number;
  created_at: string;
  updated_at: string;
  role: WorkbookRole;
  can_delete: boolean;
  /** A private workbook opens only for its creator. */
  visibility?: ItemVisibility;
  /** The search projection: sheet names, header rows and text cells, at most 100k characters. */
  plain_text?: string;
  /** The room's snapshot size, counted toward storage. */
  content_bytes?: number;
}

export interface WorkbookCollaborationTicket {
  ticket: string;
  room: string;
  url: string;
  role: WorkbookRole;
  expires_at: string;
}

/** Where a Space's workbooks live, the key every screen listing them shares. */
export const spaceWorkbooksPath = (spaceId: string) =>
  `/spaces/${encodeURIComponent(spaceId)}/workbooks`;

function workbookPath(spaceId: string, workbookId?: string): string {
  const base = spaceWorkbooksPath(spaceId);
  return workbookId ? `${base}/${encodeURIComponent(workbookId)}` : base;
}

export const workbooksApi = {
  list: (spaceId: string) => spaceRequest<{ workbooks: SpaceWorkbook[] }>(workbookPath(spaceId)),
  create: (spaceId: string, title: string) =>
    spaceRequest<SpaceWorkbook>(workbookPath(spaceId), {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  get: (spaceId: string, workbookId: string) =>
    spaceRequest<SpaceWorkbook>(workbookPath(spaceId, workbookId)),
  rename: (spaceId: string, workbookId: string, title: string) =>
    spaceRequest<SpaceWorkbook>(workbookPath(spaceId, workbookId), {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  remove: (spaceId: string, workbookId: string) =>
    spaceRequest(workbookPath(spaceId, workbookId), { method: "DELETE" }),
  collaborationTicket: (spaceId: string, workbookId: string) =>
    spaceRequest<WorkbookCollaborationTicket>(
      `${workbookPath(spaceId, workbookId)}/collaboration-ticket`,
      { method: "POST" },
    ),
};
