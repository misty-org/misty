import type { RefObject } from "react";
import { usePointerDropTarget } from "@/shared/hooks/usePointerReorder";

/** How a sidebar place takes dragged conversations: the shared scope, where each
 * conversation is filed now ("" for Recents), and the filing itself. */
export type ConversationDrop = {
  scope: string;
  folderOf(conversationId: string): string | undefined;
  file(conversationIds: string[], folderId: string): void;
};

/** Makes a folder, or Recents with an empty id, a drop target for dragged conversations. */
export function useConversationDrop(
  ref: RefObject<HTMLElement | null>,
  drop: ConversationDrop,
  folderId: string,
) {
  usePointerDropTarget(ref, {
    scope: drop.scope,
    hit(_x, _y, drag) {
      const ids = drag.ids ?? [drag.id];
      // Dropping back where everything already is changes nothing, so show nothing.
      if (!ref.current || ids.every((id) => drop.folderOf(id) === folderId)) return null;
      return {
        id: folderId,
        after: false,
        rect: ref.current.getBoundingClientRect(),
        axis: "y",
        box: true,
      };
    },
    drop: (drag) => drop.file(drag.ids ?? [drag.id], folderId),
  });
}
