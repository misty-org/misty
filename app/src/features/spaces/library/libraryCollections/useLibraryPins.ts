import { spacesApi } from "@/api/spaces/api";
import type { LibraryPinnedCollection } from "@/api/spaces/dto/interfaces/types";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";

type PinTargetKind = LibraryPinnedCollection["target_kind"];

/**
 * Pinned collections in the Library sidebar.
 *
 * The API takes the whole ordered list rather than single add/remove calls, so
 * both toggling and reordering rebuild the full set of targets.
 */
export function useLibraryPins(data: SpaceLibraryData) {
  const { spaceId, canEditLibrary, pins, setPins, setLocalError } = data;
  const targetsOf = (list: LibraryPinnedCollection[]) =>
    list.map((pin) => ({ kind: pin.target_kind, id: pin.target_id }));

  const isPinned = (kind: PinTargetKind, id: string) =>
    pins.some((pin) => pin.target_kind === kind && pin.target_id === id);

  const togglePin = async (kind: PinTargetKind, id: string) => {
    if (!canEditLibrary) return;
    const targets = isPinned(kind, id)
      ? targetsOf(pins.filter((pin) => pin.target_kind !== kind || pin.target_id !== id))
      : [...targetsOf(pins), { kind, id }];
    try {
      const result = await spacesApi.setLibraryPins(spaceId, targets);
      setPins(result.pins);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Pinned collections could not be updated.",
      );
    }
  };

  const movePin = async (pinID: string, delta: -1 | 1) => {
    if (!canEditLibrary) return;
    const index = pins.findIndex((pin) => pin.id === pinID);
    const destination = index + delta;
    if (index < 0 || destination < 0 || destination >= pins.length) return;

    const reordered = [...pins];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    setPins(reordered.map((pin, position) => ({ ...pin, position })));
    try {
      const result = await spacesApi.setLibraryPins(spaceId, targetsOf(reordered));
      setPins(result.pins);
    } catch (error) {
      setPins(pins);
      setLocalError(
        error instanceof Error ? error.message : "Pinned collections could not be reordered.",
      );
    }
  };

  return { isPinned, togglePin, movePin };
}
