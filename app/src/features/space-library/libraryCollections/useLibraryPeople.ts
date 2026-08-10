import { spacesApi } from "@/services/spaces/api";
import { confirmAction } from "@/shared/lib/confirmAction";
import type { FormEvent } from "react";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";
import type { SelectCollection } from "./useLibraryCollectionRoute";

const personLabel = (person: { name: string; kind: string }) =>
  person.name || (person.kind === "pet" ? "Unnamed pet" : "Unnamed person");

/** People and pets: create, edit, merge, delete, and assigning selected items. */
export function useLibraryPeople(data: SpaceLibraryData, selectCollection: SelectCollection) {
  const { spaceId, canEditLibrary, people, setPeople, currentPerson, setLocalError } = data;
  const { personDialogMode, setPersonDialogMode, personName, setPersonName } = data;
  const { personKind, setPersonKind, personCoverItemId, setPersonCoverItemId } = data;
  const { personSaving, setPersonSaving } = data;
  const { selectedItems, setSelectedItemIds, bulkSaving, setBulkSaving, setReloadKey } = data;

  const openCreatePerson = (kind: "person" | "pet") => {
    if (!canEditLibrary) return;
    setPersonKind(kind);
    setPersonName("");
    setPersonCoverItemId("");
    setPersonDialogMode("create");
  };

  const openEditPerson = () => {
    if (!canEditLibrary || !currentPerson) return;
    setPersonKind(currentPerson.kind);
    setPersonName(currentPerson.name);
    setPersonCoverItemId(currentPerson.cover_item_id ?? "");
    setPersonDialogMode("edit");
  };

  const savePerson = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditLibrary || personSaving) return;
    setPersonSaving(true);
    try {
      if (personDialogMode === "edit" && currentPerson) {
        const saved = await spacesApi.updatePerson(spaceId, currentPerson, {
          name: personName.trim(),
          cover_item_id: personCoverItemId,
        });
        setPeople((current) => current.map((person) => (person.id === saved.id ? saved : person)));
      } else {
        const saved = await spacesApi.createPerson(spaceId, personKind, personName.trim());
        setPeople((current) => [...current, saved]);
        selectCollection("people", saved.id);
      }
      setPersonDialogMode("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Person or pet could not be saved.");
    } finally {
      setPersonSaving(false);
    }
  };

  const deleteCurrentPerson = async () => {
    if (
      !canEditLibrary ||
      !currentPerson ||
      !(await confirmAction(
        `Remove “${personLabel(currentPerson)}" from People & Pets? Library items will not be deleted.`,
      ))
    )
      return;
    try {
      await spacesApi.deletePerson(spaceId, currentPerson);
      setPeople((current) => current.filter((person) => person.id !== currentPerson.id));
      selectCollection("people");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Person or pet could not be removed.");
    }
  };

  const mergeCurrentPerson = async (targetID: string) => {
    if (!canEditLibrary || !currentPerson || !targetID) return;
    const target = people.find((person) => person.id === targetID);
    if (
      !target ||
      !(await confirmAction(
        `Merge “${currentPerson.name || "Unnamed"}” into “${target.name || "Unnamed"}”?`,
      ))
    )
      return;
    try {
      const saved = await spacesApi.mergePeople(spaceId, currentPerson, target);
      setPeople((current) =>
        current
          .filter((person) => person.id !== currentPerson.id)
          .map((person) => (person.id === saved.id ? saved : person)),
      );
      selectCollection("people", saved.id);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "People could not be merged.");
    }
  };

  const applyPersonItems = async (personID: string, remove = false) => {
    if (!canEditLibrary || selectedItems.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    try {
      const itemIds = selectedItems.map((item) => item.id);
      const saved = remove
        ? await spacesApi.removePersonItems(spaceId, personID, itemIds)
        : await spacesApi.addPersonItems(spaceId, personID, itemIds);
      setPeople((current) => current.map((person) => (person.id === saved.id ? saved : person)));
      setSelectedItemIds([]);
      setReloadKey((current) => current + 1);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Selected items could not be assigned.",
      );
    } finally {
      setBulkSaving(false);
    }
  };

  return {
    openCreatePerson,
    openEditPerson,
    savePerson,
    deleteCurrentPerson,
    mergeCurrentPerson,
    applyPersonItems,
  };
}
