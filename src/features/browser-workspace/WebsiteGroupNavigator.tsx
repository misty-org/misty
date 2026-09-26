import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings2 } from "lucide-react";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/ui";
import type { SharedRecord } from "./model";
import { userWebsiteGroups } from "./navigationDefaults";
import { GroupIcon } from "./groupIcons";
import { WebsiteGroupsManager } from "./WebsiteGroupsManager";
import { SavedWebsiteIcon } from "./SavedWebsiteIcon";
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
  useEffect(() => {
    const retained = userWebsiteGroups(groups, websites);
    if (retained.length !== groups.length) useWorkspaceStore.setState({ websiteGroups: retained });
  }, [groups, websites]);
  const navigate = useNavigate();
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
      <div className="group/groups-header flex h-10 items-center justify-between pl-2.5">
        <h2 className="text-[13px] font-medium text-cream-muted">Groups</h2>
        <div className="flex items-center">
          <Dialog open={configuring} onOpenChange={setConfiguring}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Configure groups"
                title="Configure groups"
                className="misty-navigator-icon-target size-8 text-cream-muted hover:text-cream-bright"
              >
                <Settings2 className="size-4" size={16} aria-hidden="true" />
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
      {error && (
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
          data-active={websites.some((website) => website.id === props.activeWebsite) || undefined}
          title="Drag to reorder · Alt+Shift+↑/↓"
          onClick={() => expandWebsiteGroup(group.id, !props.open)}
        />
        <CollapsibleContent id={`websites-${group.id}`}>
          {websites.map((website) => (
            <ContextMenu key={website.id}>
              <ContextMenuTrigger asChild>
                <div>
                  <NavigationTreeItem
                    nested
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
            <p className="ml-3 px-2.5 py-2 text-xs text-cream-muted/60">
              No sites
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
