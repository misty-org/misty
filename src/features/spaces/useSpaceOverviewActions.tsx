import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  ContextMenuAction,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  CollectionItemDialog,
} from "@/shared/ui";
import { notifyDrawingListChanged, closeDrawingCollaborationSession } from "@/features/journal";
import { useSpacesStore } from "./store/useSpacesStore";
import type { SpaceOverviewItem } from "./useSpaceOverview";

export function useSpaceOverviewActions(
  accountId: string,
  spaceId: string,
  items: SpaceOverviewItem[],
  refresh: () => void,
) {
  const navigate = useNavigate();
  const readOnly = useSpacesStore((state) => state.referenceOnly);
  const scope = `${accountId}:${spaceId}`;
  const [target, setTarget] = useState<{
    scope: string;
    item: SpaceOverviewItem;
    action: "rename" | "remove";
  }>();
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
  const menu = (item: SpaceOverviewItem, context = false) => {
    const Action = context ? ContextMenuAction : MenuItem;
    const renameDisabled = readOnly || (!item.rename && !item.renameRoute);
    const removeDisabled = readOnly || !item.remove;
    return (
      <>
        <Action icon={<ArrowUpRight />} label="Open" onSelect={() => navigate(item.route)} />
        <Action
          icon={<Pencil />}
          label="Rename"
          disabled={renameDisabled}
          title={
            renameDisabled ? "Renaming is unavailable with your access to this item." : undefined
          }
          onSelect={() => {
            if (item.renameRoute) navigate(item.renameRoute);
            else setTarget({ scope, item, action: "rename" });
          }}
        />
        <Action
          icon={<Trash2 />}
          label={removeLabel(item)}
          destructive
          disabled={removeDisabled}
          title={removeDisabled ? "You do not have permission to remove this item." : undefined}
          onSelect={() => setTarget({ scope, item, action: "remove" })}
        />
      </>
    );
  };
  const active = target?.scope === scope ? target : undefined;
  return {
    forItem: (item: SpaceOverviewItem) => ({
      contextMenu: menu(item, true),
      actions: (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton label={`More actions for ${item.title}`}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">{menu(item)}</DropdownMenuContent>
        </DropdownMenu>
      ),
    }),
    error: "",
    dialog: active && (
      <CollectionItemDialog
        key={`${scope}:${active.item.id}:${active.action}`}
        title={active.action === "rename" ? "Rename item" : `${removeLabel(active.item)}?`}
        initialName={active.action === "rename" ? active.item.title : undefined}
        description={
          active.action === "rename"
            ? undefined
            : active.item.kind === "file"
              ? `“${active.item.title}” will move to Trash, where it can be restored.`
              : `“${active.item.title}” will be permanently deleted for everyone. This cannot be undone.`
        }
        actionLabel={active.action === "rename" ? "Save" : removeLabel(active.item)}
        onClose={() => setTarget(undefined)}
        onConfirm={async (name) => {
          // Check the latest list capabilities before sending a mutation.
          const item = items.find((item) => item.id === active.item.id);
          if (readOnly || !item || !(active.action === "rename" ? item.rename : item.remove))
            throw new Error(
              "This item changed or you no longer have permission. Close this dialog and refresh.",
            );
          if (active.action === "rename") await item.rename!(name);
          else {
            await item.remove!();
            if (item.kind === "drawing") closeDrawingCollaborationSession(spaceId, sourceId(item));
          }
          changed(item);
        }}
      />
    ),
  };
}
