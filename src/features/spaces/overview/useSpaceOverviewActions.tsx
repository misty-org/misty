import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Pencil, Trash2 } from "lucide-react";
import { MenuItem, RenameItemDialog, useConfirmDelete } from "@/shared/ui";
import { notifyDrawingListChanged, closeDrawingCollaborationSession } from "../journal";
import { useSpacesStore } from "../list/useSpacesStore";
import type { SpaceOverviewItem } from "./useSpaceOverview";

const changedError =
  "This item changed or you no longer have permission. Close this dialog and refresh.";

export function useSpaceOverviewActions(
  accountId: string,
  spaceId: string,
  items: SpaceOverviewItem[],
  refresh: () => void,
) {
  const navigate = useNavigate();
  const readOnly = useSpacesStore((state) => state.referenceOnly);
  const scope = `${accountId}:${spaceId}`;
  const [renaming, setRenaming] = useState<{ scope: string; item: SpaceOverviewItem }>();
  const { confirm, dialog: deleteDialog } = useConfirmDelete();
  const sourceId = (item: SpaceOverviewItem) => item.id.slice(item.id.indexOf(":") + 1);
  const changed = (item: SpaceOverviewItem) => {
    if (item.kind === "drawing") notifyDrawingListChanged(spaceId);
    const kind =
      item.kind === "file" ? "library" : item.kind === "chat" ? "conversation" : item.kind;
    window.dispatchEvent(
      new CustomEvent(`misty:space-${kind}-event`, { detail: { space_id: spaceId } }),
    );
    refresh();
  };
  const removeLabel = (item: SpaceOverviewItem) =>
    item.kind === "file" ? "Move to Trash" : "Delete";
  // Check the latest list capabilities before sending a mutation.
  const latest = (target: SpaceOverviewItem, can: "rename" | "remove") => {
    const item = items.find((candidate) => candidate.id === target.id);
    if (readOnly || !item || !item[can]) throw new Error(changedError);
    return item;
  };
  const remove = (target: SpaceOverviewItem) =>
    void confirm({
      title: `${removeLabel(target)}?`,
      what:
        target.kind === "file"
          ? `“${target.title}” will move to Trash, where it can be restored.`
          : `“${target.title}” will be permanently deleted for everyone. This cannot be undone.`,
      confirmLabel: removeLabel(target),
      onConfirm: async () => {
        const item = latest(target, "remove");
        await item.remove!();
        if (item.kind === "drawing") closeDrawingCollaborationSession(spaceId, sourceId(item));
        changed(item);
      },
    });
  // The same rows open from the item's ⋯ and from a right-click on it.
  const menu = (item: SpaceOverviewItem) => {
    const renameDisabled = readOnly || (!item.rename && !item.renameRoute);
    const removeDisabled = readOnly || !item.remove;
    return (
      <>
        <MenuItem icon={ArrowUpRight} label="Open" onSelect={() => navigate(item.route)} />
        <MenuItem
          icon={Pencil}
          label="Rename"
          disabled={renameDisabled}
          reason="Renaming is unavailable with your access to this item."
          onSelect={() => {
            if (item.renameRoute) navigate(item.renameRoute);
            else setRenaming({ scope, item });
          }}
        />
        <MenuItem
          icon={Trash2}
          label={removeLabel(item)}
          danger
          disabled={removeDisabled}
          reason="You do not have permission to remove this item."
          onSelect={() => remove(item)}
        />
      </>
    );
  };
  const active = renaming?.scope === scope ? renaming : undefined;
  return {
    forItem: (item: SpaceOverviewItem) => ({
      menu: menu(item),
      menuLabel: `More actions for ${item.title}`,
    }),
    error: "",
    dialog: (
      <>
        {active && (
          <RenameItemDialog
            key={`${scope}:${active.item.id}:rename`}
            title="Rename item"
            initialName={active.item.title}
            onClose={() => setRenaming(undefined)}
            onConfirm={async (name) => {
              const item = latest(active.item, "rename");
              await item.rename!(name);
              changed(item);
            }}
          />
        )}
        {deleteDialog}
      </>
    ),
  };
}
