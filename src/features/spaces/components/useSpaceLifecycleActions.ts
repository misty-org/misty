import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { canManageSpaceLifecycle, preferredDefaultSpace } from "../defaultSpace";
import { useSpacesStore } from "../store/useSpacesStore";
import { defaultSpaceRoute } from "../defaultSpaceRoute";

/* The state and permissions behind leaving and deleting a Space (its menu's confirmations). */
export function useSpaceLifecycleActions(spaceId: string) {
  const navigate = useNavigate();
  const { space, error, leaveSpace, deleteSpace, clearError } = useSpacesStore(
    useShallow((state) => ({
      space: state.spaces.find((item) => item.id === spaceId),
      error: state.error,
      leaveSpace: state.leaveSpace,
      deleteSpace: state.deleteSpace,
      clearError: state.clearError,
    })),
  );
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [dangerBusy, setDangerBusy] = useState(false);
  const isOwner = space?.role === "owner";
  const canLeave = !isOwner && canManageSpaceLifecycle(space, "leave");
  const canDelete = isOwner && canManageSpaceLifecycle(space, "delete");
  const openFallbackSpace = () => {
    const fallback = preferredDefaultSpace(useSpacesStore.getState().spaces);
    navigate(fallback ? defaultSpaceRoute(fallback.id) : "/spaces", {
      replace: true,
      state: {
        spaceSwitch: true,
      },
    });
  };
  const submitLeave = async () => {
    if (!space || !canLeave || dangerBusy) return;
    setDangerBusy(true);
    clearError();
    try {
      await leaveSpace(spaceId);
      openFallbackSpace();
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
      openFallbackSpace();
    } catch {
      /* The shared store error remains visible in the dialog. */
    } finally {
      setDangerBusy(false);
    }
  };
  return {
    error,
    leaveOpen,
    setLeaveOpen,
    deleteOpen,
    setDeleteOpen,
    deleteConfirmation,
    setDeleteConfirmation,
    dangerBusy,
    clearError,
    submitLeave,
    submitDelete,
  };
}

export type SpaceLifecycleActions = ReturnType<typeof useSpaceLifecycleActions>;
