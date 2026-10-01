import { subscribeAccountEvents } from "@/api/accountEvents";
import { useAuth } from "@/features/auth";
import { libraryApi as spacesApi } from "../LibraryRuntime";
import type { LibraryEditVersion, SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import type { LibraryEditDefinition } from "@/api/spaces/dto/types/types";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { defaultLibraryEdit, normalizeLibraryEdit } from "../SpaceLibraryViewerUtils";

export interface LibraryEditVersionsState {
  editVersions: LibraryEditVersion[];
  setEditVersions: Dispatch<SetStateAction<LibraryEditVersion[]>>;
  editingAvailable: boolean;
  activeEdit: LibraryEditVersion | null;
  editDraft: LibraryEditDefinition;
  setEditDraft: Dispatch<SetStateAction<LibraryEditDefinition>>;
}

/**
 * Loads the item's edit history and re-reads it while a rendition is being
 * produced. The server reports each rendition outcome to the edit's author
 * ("library-renditions" account event); the Space's Library events cover other
 * members. Nothing is re-read once no rendition is in flight.
 */
export function useLibraryEditVersions(options: {
  spaceId: string;
  item: SpaceLibraryItem | null;
  reauthenticationToken: string;
  editable: boolean;
  onRenditionReady: () => void;
}): LibraryEditVersionsState {
  const { spaceId, item, reauthenticationToken, editable, onRenditionReady } = options;
  const accountId = useAuth().user?.id ?? "";
  const [editVersions, setEditVersions] = useState<LibraryEditVersion[]>([]);
  const [editingAvailable, setEditingAvailable] = useState(false);
  const [editDraft, setEditDraft] = useState<LibraryEditDefinition>(() => defaultLibraryEdit());

  useEffect(() => {
    if (!item || !editable) {
      setEditVersions([]);
      setEditingAvailable(false);
      return;
    }
    let current = true;
    void spacesApi
      .editVersions(spaceId, item.id, reauthenticationToken)
      .then((result) => {
        if (!current) return;
        setEditVersions(result.versions);
        setEditingAvailable(true);
        setEditDraft(
          normalizeLibraryEdit(
            result.versions.find((version) => version.is_current)?.edit_definition,
          ),
        );
      })
      .catch(() => {
        if (!current) return;
        setEditVersions([]);
        setEditingAvailable(false);
      });
    return () => {
      current = false;
    };
  }, [editable, item, reauthenticationToken, spaceId]);

  const pending = editVersions.some(
    (version) => version.rendition_state === "queued" || version.rendition_state === "processing",
  );
  // Read inside event handlers without re-subscribing on every version list.
  const latestVersions = useRef(editVersions);
  useEffect(() => {
    latestVersions.current = editVersions;
  }, [editVersions]);

  useEffect(() => {
    if (!item || !pending) return;
    let current = true;
    const refresh = () =>
      void spacesApi
        .editVersions(spaceId, item.id, reauthenticationToken)
        .then((result) => {
          if (!current) return;
          const previousVersions = latestVersions.current;
          const newlyReady = result.versions.some(
            (version) =>
              version.rendition_state === "ready" &&
              previousVersions.some(
                (previous) => previous.id === version.id && previous.rendition_state !== "ready",
              ),
          );
          setEditVersions(result.versions);
          if (newlyReady) onRenditionReady();
        })
        .catch(() => undefined);
    const stopEvents = subscribeAccountEvents(accountId, (event) => {
      if (event.topic === "library-renditions" || event.topic === "reset") refresh();
    });
    const onLibraryEvent = (event: Event) => {
      if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === spaceId) refresh();
    };
    window.addEventListener("misty:space-library-event", onLibraryEvent);
    // A rendition can finish between the version read and this subscription.
    refresh();
    return () => {
      current = false;
      stopEvents();
      window.removeEventListener("misty:space-library-event", onLibraryEvent);
    };
  }, [accountId, item, onRenditionReady, pending, reauthenticationToken, spaceId]);

  return {
    editVersions,
    setEditVersions,
    editingAvailable,
    activeEdit: editVersions.find((version) => version.is_current) ?? null,
    editDraft,
    setEditDraft,
  };
}
