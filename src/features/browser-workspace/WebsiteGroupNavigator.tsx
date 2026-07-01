import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar,
  Globe,
  Library,
  Mail,
  MessagesSquare,
  NotebookPen,
  Plus,
  ArrowUpRight,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { activeLayoutView, parseBrowserTabState, useWorkspaceStore } from "@/features/workspace";
import {
  Button,
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
import { WebsiteIntegrationPicker } from "./WebsiteIntegrationPicker";
import {
  addWebsite,
  expandWebsiteGroup,
  openSavedWebsite,
  removeWebsite,
  removeWebsiteGroup,
  reorderWebsiteGroups,
} from "./navigation";

const icons = {
  mail: Mail,
  messages: MessagesSquare,
  notebook: NotebookPen,
  calendar: Calendar,
  library: Library,
  globe: Globe,
};
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
  const [editingGroup, setEditingGroup] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const activeWebsite =
    activeTab?.surfaceId === "browser"
      ? parseBrowserTabState(activeTab.state).websiteId
      : undefined;
  const openWebsite = (id: string, fresh = false) => {
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
      <div className="flex h-9 items-center justify-between px-2">
        <h2 className="text-xs font-medium text-cream-muted">Groups</h2>
        <Popover
          open={adding}
          onOpenChange={(open) => {
            setAdding(open);
            if (!open) setEditingGroup(undefined);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="nav-action"
              size="icon-sm"
              aria-label="Add to groups"
              title="Add to groups"
              className="[@media(hover:none)]:size-11"
            >
              <Plus size={16} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="center"
            sideOffset={12}
            aria-label="Groups and integrations"
            className="flex max-h-[min(520px,var(--radix-popover-content-available-height))] w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0"
          >
            <WebsiteIntegrationPicker
              groups={ordered(groups)}
              websites={websites}
              initialGroupId={editingGroup}
              onDone={() => {
                setAdding(false);
                setEditingGroup(undefined);
              }}
            />
          </PopoverContent>
        </Popover>
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
              onEdit={() => {
                setEditingGroup(group.id);
                setAdding(true);
              }}
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
  onEdit(): void;
  activeWebsite?: string;
  onOpen(id: string, fresh?: boolean): void;
}) {
  const { group, websites } = props;
  const Icon = icons[group.fields.icon as keyof typeof icons] ?? Globe;
  return (
    <Collapsible open={props.open} onOpenChange={(open) => expandWebsiteGroup(group.id, open)}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/app-row flex min-h-8 min-w-0 items-center rounded-md">
            <NavigationSectionButton
              icon={<Icon size={18} />}
              label={group.fields.label}
              open={props.open}
              aria-label={group.fields.label}
              aria-controls={`websites-${group.id}`}
              className="min-w-0 flex-1 !w-auto"
              title="Drag to reorder · Alt+Shift+↑/↓"
              onClick={() => expandWebsiteGroup(group.id, !props.open)}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={props.onEdit}>Edit group</ContextMenuItem>
          <ContextMenuItem onSelect={() => removeWebsiteGroup(group.id)}>
            Remove group
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CollapsibleContent id={`websites-${group.id}`}>
        {websites.map((website, index) => (
          <ContextMenu key={website.id}>
            <ContextMenuTrigger asChild>
              <div>
                <NavigationTreeItem
                  nested
                  last={index === websites.length - 1}
                  icon={<Globe size={14} />}
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
              <ContextMenuItem onSelect={() => removeWebsite(website.id)}>
                Remove saved website
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        {!websites.length && (
          <p className="ml-10 py-2 text-xs text-cream-muted">No integrations yet</p>
        )}
      </CollapsibleContent>
    </Collapsible>
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
  const [error, setError] = useState<string | null>(null);
  const page = tab?.surfaceId === "browser" ? parseBrowserTabState(tab.state) : null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={!page || !groups.length}
          className="text-xs text-cream-muted"
          aria-label="Save current page to group"
        >
          <ArrowUpRight size={14} />
          Save to group
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-[260px] p-1">
        {groups.map((group) => (
          <Button
            key={group.id}
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              try {
                if (!page) return;
                addWebsite(group.id, tab?.title ?? "", page.url);
                setOpen(false);
              } catch (failure) {
                setError(failure instanceof Error ? failure.message : String(failure));
              }
            }}
          >
            {group.fields.label}
          </Button>
        ))}
        {error && (
          <p role="alert" className="px-2 py-3 text-xs text-destructive">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
