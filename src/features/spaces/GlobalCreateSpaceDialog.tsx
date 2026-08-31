import type { ReactNode } from "react";
import { CreateSpaceDialog } from "./spacesShell/CreateSpaceDialog";
import { useCreateSpaceDialog } from "./spacesShell/useCreateSpaceDialog";
import { useSpacesStore } from "./store/useSpacesStore";

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
