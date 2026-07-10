import type { Space } from "@/api/spaces/dto/interfaces/types";
import { SystemErrorActivity } from "@/features/activity";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
} from "@/shared/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { canManageSpaceLifecycle, preferredDefaultSpace } from "../defaultSpace";
import { useSpacesStore } from "../store/useSpacesStore";
import { defaultSpaceRoute } from "../store/useSpacesTabsStore";

export type SpaceLifecycleAction = "leave" | "delete";

/** Which destructive action, if any, the current user may take on a Space. */
export function spaceLifecycleAction(space: Space | undefined): SpaceLifecycleAction | null {
  if (!space) return null;
  const isOwner = space.role === "owner";
  if (isOwner && canManageSpaceLifecycle(space, "delete")) return "delete";
  if (!isOwner && canManageSpaceLifecycle(space, "leave")) return "leave";
  return null;
}

/**
 * Confirmation for leaving or deleting a Space. Deleting requires typing the
 * Space name; both land on the user's preferred remaining Space afterwards.
 */
export function SpaceLifecycleDialog(props: {
  space: Space;
  action: SpaceLifecycleAction | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { error, leaveSpace, deleteSpace, clearError } = useSpacesStore(
    useShallow((state) => ({
      error: state.error,
      leaveSpace: state.leaveSpace,
      deleteSpace: state.deleteSpace,
      clearError: state.clearError,
    })),
  );
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const { space, action } = props;
  const deleting = action === "delete";

  const close = () => {
    if (busy) return;
    setConfirmation("");
    props.onClose();
  };

  const submit = async () => {
    if (!action || busy || (deleting && confirmation !== space.name)) return;
    setBusy(true);
    clearError();
    try {
      if (deleting) await deleteSpace(space.id, confirmation);
      else await leaveSpace(space.id);
      const fallback = preferredDefaultSpace(useSpacesStore.getState().spaces);
      setConfirmation("");
      props.onClose();
      navigate(fallback ? defaultSpaceRoute(fallback.id) : "/spaces", {
        replace: true,
        state: { spaceSwitch: true },
      });
    } catch {
      /* The shared store error remains visible in the dialog. */
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={action !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-cream-bright">
            {deleting ? "Delete" : "Leave"} {space.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deleting
              ? "This removes member access immediately and schedules permanent deletion. Type the Space name exactly to continue."
              : "You will immediately lose access. Another member must invite you to regain it."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleting ? (
          <label className="grid gap-2 text-xs font-medium text-cream-muted">
            Space name
            <Input
              autoFocus
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <SystemErrorActivity
            error={error}
            scope="spaces:settings:danger"
            title="Space action could not be completed"
          />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-charcoal-active text-cream-bright hover:bg-charcoal-active"
            disabled={busy || (deleting && confirmation !== space.name)}
            onClick={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {deleting ? (busy ? "Deleting…" : "Delete Space") : busy ? "Leaving…" : "Leave Space"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
