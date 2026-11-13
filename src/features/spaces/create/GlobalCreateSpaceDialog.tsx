import type { ReactNode } from "react";
import { CreateSpaceDialog } from "./CreateSpaceDialog";
import { useCreateSpaceDialog } from "./useCreateSpaceDialog";
import { useSpacesStore } from "../list/useSpacesStore";

export function GlobalCreateSpaceDialog(props: {
  children: (openCreateSpaceDialog: () => void) => ReactNode;
}) {
  const createSpace = useSpacesStore((state) => state.createSpace);
  const clearError = useSpacesStore((state) => state.clearError);
  const dialog = useCreateSpaceDialog({ createSpace, clearError });

  return (
    <>
      {props.children(dialog.start)}
      <CreateSpaceDialog dialog={dialog} />
    </>
  );
}
