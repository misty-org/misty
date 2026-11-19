import { useCallback, useEffect } from "react";
import { useSpaceResource } from "../api/spaceResource";
import { spaceWorkbooksPath, workbooksApi, type SpaceWorkbook } from "./api";
import { closeWorkbookCollaborationSession } from "./session";

const listChangedEvent = "misty:space-workbooks-changed";
const realtimeEvent = "misty:space-workbook-event";

/** Tells every view of a Space's workbooks that the list changed here. */
export function notifyWorkbookListChanged(spaceId: string): void {
  window.dispatchEvent(new CustomEvent(listChangedEvent, { detail: { spaceId } }));
}

export function subscribeToWorkbookListChanges(spaceId: string, listener: () => void): () => void {
  const local = (event: Event) => {
    if ((event as CustomEvent<{ spaceId?: string }>).detail?.spaceId === spaceId) listener();
  };
  const remote = (event: Event) => {
    if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === spaceId) listener();
  };
  window.addEventListener(listChangedEvent, local);
  window.addEventListener(realtimeEvent, remote);
  return () => {
    window.removeEventListener(listChangedEvent, local);
    window.removeEventListener(realtimeEvent, remote);
  };
}

/** A Space's workbooks, from the shared cache first; `spaceId` empty holds off. */
export function useSpaceWorkbookList(spaceId: string) {
  return useSpaceResource<SpaceWorkbook[]>(spaceId ? spaceWorkbooksPath(spaceId) : null, () =>
    workbooksApi.list(spaceId).then((result) => result.workbooks),
  );
}

const noWorkbooks: SpaceWorkbook[] = [];

/** The list with the changes the workbook page makes: rename and delete. */
export function useSpaceWorkbooks(spaceId: string) {
  const resource = useSpaceWorkbookList(spaceId);
  const { reload, set } = resource;
  useEffect(() => subscribeToWorkbookListChanges(spaceId, () => void reload()), [reload, spaceId]);

  const rename = useCallback(
    async (workbookId: string, title: string) => {
      const workbook = await workbooksApi.rename(spaceId, workbookId, title);
      set((current = []) => current.map((item) => (item.id === workbookId ? workbook : item)));
      notifyWorkbookListChanged(spaceId);
      return workbook;
    },
    [set, spaceId],
  );

  const remove = useCallback(
    async (workbookId: string) => {
      await workbooksApi.remove(spaceId, workbookId);
      set((current = []) => current.filter((item) => item.id !== workbookId));
      notifyWorkbookListChanged(spaceId);
      closeWorkbookCollaborationSession(spaceId, workbookId);
    },
    [set, spaceId],
  );

  return {
    workbooks: resource.data ?? noWorkbooks,
    loading: resource.loading,
    error:
      resource.error && !resource.data
        ? resource.error instanceof Error
          ? resource.error.message
          : "Could not load data."
        : null,
    reload,
    rename,
    remove,
  };
}
