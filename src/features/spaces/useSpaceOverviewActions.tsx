import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Archive,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Star,
  Trash2,
} from "lucide-react";
import {
  ContextMenuAction,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  CollectionItemDialog,
} from "@/shared/ui";
import { useLocalPinnedIds } from "@/shared/hooks/useLocalPinnedIds";
import { notifyDrawingListChanged, closeDrawingCollaborationSession } from "@/features/journal";
import { useSpacesStore } from "./store/useSpacesStore";
import type { SpaceOverviewItem } from "./useSpaceOverview";

export function useSpaceOverviewActions(
  accountId: string,
  spaceId: string,
  items: SpaceOverviewItem[],
  refresh: () => void,
  notePins?: { pinnedIdSet: Set<string>; togglePinned: (id: string) => void },
) {
  const navigate = useNavigate();
  const readOnly = useSpacesStore((state) => state.referenceOnly);
  const scope = `${accountId}:${spaceId}`;
  // The overview is a partial result set; never prune pins for items absent from it.
  const notes = useLocalPinnedIds(`misty:note-pins:${scope}`, [], true);
  const drawings = useLocalPinnedIds(`misty:drawing-pins:${scope}`, [], true);
  const [target, setTarget] = useState<{
    scope: string;
    item: SpaceOverviewItem;
    action: "rename" | "remove";
  }>();
  const [error, setError] = useState<{ scope: string; message: string }>();
  const [busyId, setBusyId] = useState("");
  const pins = (item: SpaceOverviewItem) =>
    item.kind === "note" ? (notePins ?? notes) : item.kind === "drawing" ? drawings : undefined;
  const sourceId = (item: SpaceOverviewItem) => item.id.slice(item.id.indexOf(":") + 1);
  const pinId = (item: SpaceOverviewItem) =>
    item.kind === "note" ? `misty:${sourceId(item)}` : sourceId(item);
  const isPinned = (item: SpaceOverviewItem) => Boolean(pins(item)?.pinnedIdSet.has(pinId(item)));
  const changed = (item: SpaceOverviewItem) => {
    if (item.kind === "drawing") notifyDrawingListChanged(spaceId);
    const kind =
      item.kind === "file" ? "library" : item.kind === "chat" ? "conversation" : item.kind;
    window.dispatchEvent(
      new CustomEvent(`misty:space-${kind}-event`, { detail: { space_id: spaceId } }),
    );
    if (item.kind === "task")
      window.dispatchEvent(
        new CustomEvent("misty:space-coordination-event", { detail: { space_id: spaceId } }),
      );
    refresh();
  };
  const removeLabel = (item: SpaceOverviewItem) =>
    item.kind === "task" ? "Archive" : item.kind === "file" ? "Move to Trash" : "Delete";
  const menu = (item: SpaceOverviewItem, context = false) => {
    const Action = context ? ContextMenuAction : MenuItem;
    const renameDisabled = readOnly || (!item.rename && !item.renameRoute);
    const removeDisabled = readOnly || !item.remove;
    return (
      <>
        <Action icon={<ArrowUpRight />} label="Open" onSelect={() => navigate(item.route)} />
        {pins(item) && (
          <Action
            icon={isPinned(item) ? <PinOff /> : <Pin />}
            label={isPinned(item) ? "Unpin" : "Pin"}
            onSelect={() => pins(item)?.togglePinned(pinId(item))}
          />
        )}
        {item.toggleFavorite && (
          <Action
            icon={<Star />}
            label={item.favorite ? "Remove from favorites" : "Add to favorites"}
            disabled={readOnly || !item.toggleFavorite || busyId === item.id}
            onSelect={() => {
              if (!item.toggleFavorite || readOnly) return;
              setBusyId(item.id);
              setError(undefined);
              void item
                .toggleFavorite()
                .then(() => undefined)
                .catch((cause) =>
                  setError({
                    scope,
                    message: cause instanceof Error ? cause.message : "Could not update favorite.",
                  }),
                )
                .finally(() => setBusyId(""));
            }}
          />
        )}
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
          icon={item.kind === "task" ? <Archive /> : <Trash2 />}
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
    isPinned,
    forItem: (item: SpaceOverviewItem) => ({
      marker: isPinned(item) ? (
        <Pin size={13} aria-label="Pinned" />
      ) : item.favorite ? (
        <Star size={13} aria-label="Favorite" />
      ) : undefined,
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
    error: error?.scope === scope ? error.message : "",
    dialog: active && (
      <CollectionItemDialog
        key={`${scope}:${active.item.id}:${active.action}`}
        title={active.action === "rename" ? "Rename item" : `${removeLabel(active.item)}?`}
        initialName={active.action === "rename" ? active.item.title : undefined}
        description={
          active.action === "rename"
            ? undefined
            : active.item.kind === "task"
              ? `“${active.item.title}” will be archived.`
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
