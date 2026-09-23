import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SlidersHorizontal, Plus, ArrowUpRight } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { activeLayoutView, parseBrowserTabState, useWorkspaceStore } from "@/features/workspace";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  Collapsible,
  CollapsibleContent,
  NavigationSectionButton,
  NavigationTreeItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/ui";
import type { SharedRecord } from "./model";
import { GroupIcon } from "./groupIcons";
import { WebsiteGroupsManager } from "./WebsiteGroupsManager";
import { SavedWebsiteIcon } from "./SavedWebsiteIcon";
import { WebsiteSitePicker } from "./WebsiteSitePicker";
import {
  expandWebsiteGroup,
  openSavedWebsite,
  removeWebsite,
  reorderWebsiteGroups,
} from "./navigation";

const ordered = <T extends SharedRecord<"group"> | SharedRecord<"website">>(items: T[]) =>
  [...items].sort((a, b) => a.fields.order - b.fields.order || a.id.localeCompare(b.id));
export function WebsiteGroupNavigator({ onOpen }: { onOpen?: () => void } = {}) {
  const { groups, websites, expanded, activeTab } = useWorkspaceStore(
    useShallow((state) => ({
      groups: state.websiteGroups,
      websites: state.savedWebsites,
      expanded: state.expandedWebsiteGroups,
      activeTab: activeLayoutView(state.layout),
    })),
  );
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const activeWebsite =
    activeTab?.surfaceId === "browser"
      ? parseBrowserTabState(activeTab.state).websiteId
      : undefined;
  const openWebsite = (id: string, fresh = true) => {
    try {
      const tab = openSavedWebsite(id, fresh);
      navigate(tab.route, { replace: true });
      onOpen?.();
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const move = (id: string, target: string) => {
    const ids = ordered(groups).map((group) => group.id);
    const from = ids.indexOf(id),
      to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    reorderWebsiteGroups(ids);
  };
  return (
    <div
      className="grid min-w-0 content-start gap-1"
      data-website-navigation="true"
      data-tour-target="website-groups"
    >
      <div className="group/groups-header flex h-9 items-center justify-between px-2">
        <h2 className="text-xs font-medium text-cream-muted">Groups</h2>
        <div className="flex items-center opacity-0 group-hover/groups-header:opacity-100 group-focus-within/groups-header:opacity-100 [@media(hover:none)]:opacity-100">
          <Popover
            open={adding}
            onOpenChange={(open) => {
              setAdding(open);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add site"
                title="Add site"
                className="text-cream-muted [@media(hover:none)]:size-11"
              >
                <Plus className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="center"
              sideOffset={12}
              aria-label="Sites"
              className="flex max-h-[min(520px,var(--radix-popover-content-available-height))] w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0"
            >
              <WebsiteSitePicker
                groups={ordered(groups)}
                websites={websites}
                onDone={() => {
                  setAdding(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <Dialog open={configuring} onOpenChange={setConfiguring}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Configure groups"
                title="Configure groups"
                className="text-cream-muted"
              >
                <SlidersHorizontal className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent
              aria-describedby={undefined}
              className="w-[820px] max-w-[calc(100vw-24px)] gap-0 overflow-hidden p-0 sm:max-w-[820px]"
            >
              <div className="border-b border-charcoal-border px-4 py-3">
                <DialogTitle className="text-sm font-medium">Groups</DialogTitle>
              </div>
              <div className="max-h-[80vh] overflow-y-auto">
                <WebsiteGroupsManager />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {ordered(groups)
        .filter((group) => !group.fields.hidden)
        .map((group) => (
          <div
            key={group.id}
            draggable
            onDragStart={(event) => {
              if ((event.target as HTMLElement).closest("input")) {
                event.preventDefault();
                return;
              }
              setDragged(group.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", group.id);
            }}
            onDragOver={(event) => {
              if (dragged && dragged !== group.id) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged) move(dragged, group.id);
              setDragged(null);
            }}
            onDragEnd={() => setDragged(null)}
            onKeyDown={(event) => {
              if (!event.altKey || !event.shiftKey || !["ArrowUp", "ArrowDown"].includes(event.key))
                return;
              event.preventDefault();
              const list = ordered(groups);
              const index = list.findIndex((item) => item.id === group.id);
              const target = list[index + (event.key === "ArrowUp" ? -1 : 1)];
              if (target) move(group.id, target.id);
            }}
          >
            <WebsiteGroupRow
              group={group}
              websites={ordered(websites.filter((website) => website.fields.group_id === group.id))}
              open={expanded[group.id] ?? false}
              activeWebsite={activeWebsite}
              onOpen={openWebsite}
            />
          </div>
        ))}
      <div className="mt-2 px-1">
        <SavePageToGroup
          groups={ordered(groups).filter((group) => !group.fields.hidden)}
          tab={activeTab}
        />
      </div>
      {error && !adding && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
function WebsiteGroupRow(props: {
  group: SharedRecord<"group">;
  websites: SharedRecord<"website">[];
  open: boolean;
  activeWebsite?: string;
  onOpen(id: string, fresh?: boolean): void;
}) {
  const { group, websites } = props;
  const [deleting, setDeleting] = useState<SharedRecord<"website"> | null>(null);
  return (
    <>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogTitle>Delete “{deleting?.fields.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the saved site from this group. This cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) removeWebsite(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Collapsible open={props.open} onOpenChange={(open) => expandWebsiteGroup(group.id, open)}>
        <NavigationSectionButton
          icon={<GroupIcon name={group.fields.icon} />}
          label={group.fields.label}
          open={props.open}
          showChevron={false}
          aria-label={group.fields.label}
          aria-controls={`websites-${group.id}`}
          className="min-w-0 !w-auto max-w-full hover:bg-transparent active:bg-transparent active:text-cream-bright"
          title="Drag to reorder · Alt+Shift+↑/↓"
          onClick={() => expandWebsiteGroup(group.id, !props.open)}
        />
        <CollapsibleContent id={`websites-${group.id}`}>
          {websites.map((website, index) => (
            <ContextMenu key={website.id}>
              <ContextMenuTrigger asChild>
                <div>
                  <NavigationTreeItem
                    nested
                    last={index === websites.length - 1}
                    icon={<SavedWebsiteIcon url={website.fields.url} />}
                    label={website.fields.title}
                    selected={props.activeWebsite === website.id}
                    onClick={() => props.onOpen(website.id)}
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => props.onOpen(website.id, true)}>
                  Open in new tab
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => setDeleting(website)}>Remove site</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {!websites.length && (
            <p className="ml-[calc(20px_+_var(--navigation-primary-icon-slot,18px))] py-2 text-xs text-cream-muted/60">
              No sites
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
function SavePageToGroup({
  groups,
  tab,
}: {
  groups: SharedRecord<"group">[];
  tab: ReturnType<typeof activeLayoutView>;
}) {
  const [open, setOpen] = useState(false);
  const page = tab?.surfaceId === "browser" ? parseBrowserTabState(tab.state) : null;
  const websites = useWorkspaceStore((state) => state.savedWebsites);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={!page}
          className="text-xs text-cream-muted"
          aria-label="Save current page to group"
        >
          <ArrowUpRight size={14} /> Save to group
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        aria-label="Add to group"
        className="flex max-h-[min(520px,var(--radix-popover-content-available-height))] w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0"
      >
        {page && (
          <WebsiteSitePicker
            groups={groups}
            websites={websites}
            initialSite={{ title: tab?.title || "Current site", url: page.url }}
            onDone={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
