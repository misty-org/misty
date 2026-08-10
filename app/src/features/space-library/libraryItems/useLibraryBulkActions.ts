import { spacesApi } from "@/services/spaces/api";
import type { BulkLibraryItemOptions } from "@/services/spaces/dto/interfaces/types";
import type { BulkLibraryItemAction } from "@/services/spaces/dto/types/types";
import { confirmAction } from "@/shared/lib/confirmAction";
import type { FormEvent } from "react";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";

export type MetadataDialogAction = "add_tags" | "remove_tags" | "set_date" | "set_location";

/** Actions that apply to the whole selection, including the bulk metadata dialog. */
export function useLibraryBulkActions(data: SpaceLibraryData, reload: () => Promise<void>) {
  const { spaceId, canEditLibrary, selectedItems, setSelectedItemIds } = data;
  const { bulkSaving, setBulkSaving, sensitiveCollectionToken, setLocalError } = data;
  const { metadataDialogAction, setMetadataDialogAction, metadataTags, setMetadataTags } = data;
  const { metadataDate, setMetadataDate, metadataLocationName, setMetadataLocationName } = data;
  const { metadataLatitude, setMetadataLatitude, metadataLongitude, setMetadataLongitude } = data;
  const plural = selectedItems.length === 1 ? "" : "s";

  const applyBulkAction = async (
    action: BulkLibraryItemAction,
    options: BulkLibraryItemOptions = {},
  ) => {
    if (!canEditLibrary || selectedItems.length === 0 || bulkSaving) return false;
    if (
      action === "trash" &&
      !(await confirmAction(
        `Move ${selectedItems.length} selected item${plural} to Recently Deleted?`,
      ))
    )
      return false;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.bulkLibraryItems(
        spaceId,
        selectedItems,
        action,
        options,
        sensitiveCollectionToken,
      );
      setSelectedItemIds([]);
      await reload();
      return true;
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Selected Library items could not be updated.",
      );
      return false;
    } finally {
      setBulkSaving(false);
    }
  };

  const openMetadataDialog = (action: MetadataDialogAction) => {
    setMetadataTags("");
    setMetadataDate("");
    setMetadataLocationName("");
    setMetadataLatitude("");
    setMetadataLongitude("");
    setMetadataDialogAction(action);
  };

  const locationOptions = (): BulkLibraryItemOptions | null => {
    const location: Record<string, unknown> = {};
    if (metadataLocationName.trim()) location.name = metadataLocationName.trim();
    if (metadataLatitude.trim()) {
      const latitude = Number(metadataLatitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        setLocalError("Latitude must be between -90 and 90.");
        return null;
      }
      location.latitude = latitude;
    }
    if (metadataLongitude.trim()) {
      const longitude = Number(metadataLongitude);
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        setLocalError("Longitude must be between -180 and 180.");
        return null;
      }
      location.longitude = longitude;
    }
    return Object.keys(location).length === 0 ? null : { locationOverride: location };
  };

  const saveBulkMetadata = async (event: FormEvent) => {
    event.preventDefault();
    if (!metadataDialogAction || bulkSaving) return;
    let options: BulkLibraryItemOptions;
    if (metadataDialogAction === "add_tags" || metadataDialogAction === "remove_tags") {
      const tags = metadataTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (tags.length === 0) return;
      options = { tags };
    } else if (metadataDialogAction === "set_date") {
      if (!metadataDate) return;
      options = { dateOverride: new Date(metadataDate).toISOString() };
    } else {
      const resolved = locationOptions();
      if (!resolved) return;
      options = resolved;
    }
    if (await applyBulkAction(metadataDialogAction, options)) setMetadataDialogAction("");
  };

  const clearBulkMetadata = async (action: "clear_date" | "clear_location", label: string) => {
    if (
      !(await confirmAction(`Clear ${label} from ${selectedItems.length} selected item${plural}?`))
    )
      return;
    await applyBulkAction(action);
  };

  return { applyBulkAction, openMetadataDialog, saveBulkMetadata, clearBulkMetadata };
}
