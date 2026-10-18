import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { canManageSpaceLifecycle, preferredDefaultSpace } from "../defaultSpace";
import { useSpacesStore } from "../store/useSpacesStore";
import { defaultSpaceRoute } from "../store/useSpacesTabsStore";

/* The state and permissions behind renaming, leaving and deleting a Space (its menu's dialogs). */
export function useSpaceSettingsController(spaceId: string) {
  const navigate = useNavigate();
  const { space, error, renameSpace, leaveSpace, deleteSpace, clearError } = useSpacesStore(
    useShallow((state) => ({
      space: state.spaces.find((item) => item.id === spaceId),
      error: state.error,
      renameSpace: state.renameSpace,
      leaveSpace: state.leaveSpace,
      deleteSpace: state.deleteSpace,
      clearError: state.clearError,
    })),
  );
  const [name, setName] = useState(space?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [dangerBusy, setDangerBusy] = useState(false);
  const isOwner = space?.role === "owner";
  const canRename = isOwner && canManageSpaceLifecycle(space, "rename");
  const canLeave = !isOwner && canManageSpaceLifecycle(space, "leave");
  const canDelete = isOwner && canManageSpaceLifecycle(space, "delete");
  useEffect(() => {
    setName(space?.name ?? "");
  }, [space?.name]);
  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!space || !canRename || !nextName || nextName === space.name || saving) return;
    clearError();
    setSaving(true);
    try {
      await renameSpace(spaceId, nextName);
    } finally {
      setSaving(false);
    }
  };
  const submitLeave = async () => {
    if (!space || !canLeave || dangerBusy) return;
    setDangerBusy(true);
    clearError();
    try {
      await leaveSpace(spaceId);
      const remainingSpaces = useSpacesStore.getState().spaces;
      const fallback = preferredDefaultSpace(remainingSpaces);
      navigate(fallback ? defaultSpaceRoute(fallback.id) : "/spaces", {
        replace: true,
        state: {
          spaceSwitch: true,
        },
      });
    } catch {
      /* The shared store error remains visible in the dialog. */
    } finally {
      setDangerBusy(false);
    }
  };
  const submitDelete = async () => {
    if (!space || !canDelete || deleteConfirmation !== space.name || dangerBusy) return;
    setDangerBusy(true);
    clearError();
    try {
      await deleteSpace(spaceId, deleteConfirmation);
      const remainingSpaces = useSpacesStore.getState().spaces;
      const fallback = preferredDefaultSpace(remainingSpaces);
      navigate(fallback ? defaultSpaceRoute(fallback.id) : "/spaces", {
        replace: true,
        state: {
          spaceSwitch: true,
        },
      });
    } catch {
      /* The shared store error remains visible in the dialog. */
    } finally {
      setDangerBusy(false);
    }
  };
  return {
    space,
    error,
    name,
    setName,
    saving,
    leaveOpen,
    setLeaveOpen,
    deleteOpen,
    setDeleteOpen,
    deleteConfirmation,
    setDeleteConfirmation,
    dangerBusy,
    isOwner,
    canRename,
    canLeave,
    canDelete,
    clearError,
    saveName,
    submitLeave,
    submitDelete,
  };
}

export type SpaceSettingsController = ReturnType<typeof useSpaceSettingsController>;
export type SpaceSettingsSpace = NonNullable<SpaceSettingsController["space"]>;
