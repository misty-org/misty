import { Ellipsis, Check, Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { switchSpaceWindow } from "@/features/app-windows";
import {
  GlobalCreateSpaceDialog,
  SpaceAvatar,
  useSpacesStore,
  useWindowSpace,
  type Space,
} from "@/features/spaces";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  CountMark,
  MenuCheckItem,
  PickerList,
  PickerSearch,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Pressable,
  rowShape,
  SectionHeading,
  Separator,
  SpaceDock,
  SpaceDockItem,
  StateMark,
  Text,
} from "@misty/ui";
import { useAttentionCounts, type PlaceMark } from "./attention";
import { useSharedSpaces } from "./place_store";

const dockSize = 5;
const rowClass = cn(rowShape, "w-full text-left");

const useKeptInDock = createDeviceSetting<string[]>({
  scope: "sidebar-space-dock",
  defaults: [],
  normalize: (stored) =>
    Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [],
});

function setKept(spaceId: string, keep: boolean) {
  const kept = useKeptInDock.getState().value.filter((id) => id !== spaceId);
  useKeptInDock.getState().set(keep ? [...kept, spaceId] : kept);
}

function useDockSpaces(shared: Space[], openId: string | undefined) {
  const kept = useKeptInDock((state) => state.value);
  return useMemo(() => {
    const byId = new Map(shared.map((space) => [space.id, space]));
    const ordered = [
      ...kept.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
      ...shared.filter((space) => !kept.includes(space.id)),
    ];
    const dock = ordered.slice(0, dockSize);
    const open = openId ? byId.get(openId) : undefined;
    if (open && !dock.includes(open)) dock[dockSize - 1] = open;
    const rest = ordered.filter((space) => !dock.includes(space));
    return { dock, rest, kept };
  }, [shared, kept, openId]);
}

function SpaceMark({ mark }: { mark?: PlaceMark }) {
  if (mark?.count) return <CountMark count={mark.count} label={`${mark.count} unread`} />;
  if (mark?.state) return <StateMark kind={mark.state} />;
  return null;
}

function KeepMenu({ space, kept, children }: { space: Space; kept: boolean; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuCheckItem
          label="Keep in dock"
          checked={kept}
          closeOnSelect
          onCheckedChange={(on) => setKept(space.id, on)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SpaceListRow({
  space,
  open,
  kept,
  mark,
  onPick,
}: {
  space: Space;
  open: boolean;
  kept: boolean;
  mark?: PlaceMark;
  onPick(): void;
}) {
  return (
    <KeepMenu space={space} kept={kept}>
      <Pressable
        role="option"
        aria-selected={open}
        wash="control"
        className={rowClass}
        onClick={onPick}
      >
        <SpaceAvatar space={space} className="size-6" />
        <Text tone="default" className="flex-1">
          {space.name}
        </Text>
        <SpaceMark mark={mark} />
        {open ? (
          <Text bare tone="bright">
            <Check aria-label="Open" />
          </Text>
        ) : null}
      </Pressable>
    </KeepMenu>
  );
}

export function SpaceDockNav() {
  const shared = useSharedSpaces();
  const space = useWindowSpace();
  const openId = space && !space.is_default ? space.id : undefined;
  const counts = useAttentionCounts();
  const invitations = useSpacesStore((state) => state.invitations.length);
  const { dock, rest, kept } = useDockSpaces(shared, openId);
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState("");
  const restMark = rest.reduce<PlaceMark>(
    (mark, item) => {
      const held = counts.bySpace.get(item.id);
      return {
        count: mark.count + (held?.count ?? 0),
        state: mark.state === "waiting" ? "waiting" : (held?.state ?? mark.state),
      };
    },
    { count: invitations },
  );
  const needle = query.trim().toLowerCase();
  const matches = (item: Space) => !needle || item.name.toLowerCase().includes(needle);
  const pick = (item: Space) => {
    setListOpen(false);
    setQuery("");
    if (item.id !== openId) switchSpaceWindow(item.id, false);
  };
  const listRow = (item: Space) => (
    <SpaceListRow
      key={item.id}
      space={item}
      open={item.id === openId}
      kept={kept.includes(item.id)}
      mark={counts.bySpace.get(item.id)}
      onPick={() => pick(item)}
    />
  );
  const inDock = dock.filter(matches);
  const more = rest.filter(matches);

  return (
    <SpaceDock label="Spaces" className="mt-2">
      {dock.map((item) => {
        const mark = counts.bySpace.get(item.id);
        return (
          <KeepMenu key={item.id} space={item} kept={kept.includes(item.id)}>
            <SpaceDockItem
              label={item.name}
              selected={item.id === openId}
              count={mark?.count}
              state={mark?.state}
              onSelect={() => switchSpaceWindow(item.id, false)}
            >
              <SpaceAvatar space={item} />
            </SpaceDockItem>
          </KeepMenu>
        );
      })}
      <Popover
        open={listOpen}
        onOpenChange={(next) => {
          setListOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <SpaceDockItem label="All Spaces" count={restMark.count} state={restMark.state}>
            <Ellipsis aria-hidden="true" />
          </SpaceDockItem>
        </PopoverTrigger>
        <PopoverContent kind="flush" side="top" align="start" aria-label="All Spaces">
          <PickerSearch
            autoFocus
            aria-label="Find a Space"
            placeholder="Find a Space"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const first = [...inDock, ...more][0];
              if (first) pick(first);
            }}
          />
          <PickerList role="listbox" aria-label="Spaces">
            {inDock.length ? <SectionHeading kind="label" title="In your dock" /> : null}
            {inDock.map(listRow)}
            {more.length ? <SectionHeading kind="label" title="More Spaces" /> : null}
            {more.map(listRow)}
            {!inDock.length && !more.length ? (
              <Text as="p" size="meta" tone="muted" className="px-2 py-1.5">
                No Spaces match
              </Text>
            ) : null}
            <Separator className="my-1" />
            <GlobalCreateSpaceDialog>
              {(create) => (
                <Pressable
                  wash="control"
                  className={rowClass}
                  onClick={() => {
                    setListOpen(false);
                    create();
                  }}
                >
                  <Plus aria-hidden="true" />
                  <Text tone="default" className="flex-1">
                    New Space
                  </Text>
                  <CountMark count={invitations} label={`${invitations} invitations`} />
                </Pressable>
              )}
            </GlobalCreateSpaceDialog>
          </PickerList>
        </PopoverContent>
      </Popover>
    </SpaceDock>
  );
}
