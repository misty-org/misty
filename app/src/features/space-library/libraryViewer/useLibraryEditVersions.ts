import { spacesApi } from "@/services/spaces/api";
import type { LibraryEditVersion, SpaceLibraryItem } from "@/services/spaces/dto/interfaces/types";
import type { LibraryEditDefinition } from "@/services/spaces/dto/types/types";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { defaultLibraryEdit, normalizeLibraryEdit } from "../SpaceLibraryViewerUtils";

const RENDITION_POLL_MS = 1500;

export interface LibraryEditVersionsState {
  editVersions: LibraryEditVersion[];
  setEditVersions: Dispatch<SetStateAction<LibraryEditVersion[]>>;
  editingAvailable: boolean;
  activeEdit: LibraryEditVersion | null;
  editDraft: LibraryEditDefinition;
  setEditDraft: Dispatch<SetStateAction<LibraryEditDefinition>>;
}

/**
 * Loads the item's edit history and polls while a rendition is being produced.
 *
 * Renditions are produced server-side, so the only way to learn one finished is
 * to re-read the version list. Polling stops as soon as nothing is in flight.
 */
export function useLibraryEditVersions(options: {
  spaceId: string;
  item: SpaceLibraryItem | null;
  reauthenticationToken: string;
  editable: boolean;
  onRenditionReady: () => void;
}): LibraryEditVersionsState {
  const { spaceId, item, reauthenticationToken, editable, onRenditionReady } = options;
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

  useEffect(() => {
    const pending = editVersions.some(
      (version) => version.rendition_state === "queued" || version.rendition_state === "processing",
    );
    if (!item || !pending) return;
    let current = true;
    const refresh = () =>
      void spacesApi
        .editVersions(spaceId, item.id, reauthenticationToken)
        .then((result) => {
          if (!current) return;
          const newlyReady = result.versions.some(
            (version) =>
              version.rendition_state === "ready" &&
              editVersions.some(
                (previous) => previous.id === version.id && previous.rendition_state !== "ready",
              ),
          );
          setEditVersions(result.versions);
          if (newlyReady) onRenditionReady();
        })
        .catch(() => undefined);
    const timer = window.setInterval(refresh, RENDITION_POLL_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [editVersions, item, onRenditionReady, reauthenticationToken, spaceId]);

  return {
    editVersions,
    setEditVersions,
    editingAvailable,
    activeEdit: editVersions.find((version) => version.is_current) ?? null,
    editDraft,
    setEditDraft,
  };
}
