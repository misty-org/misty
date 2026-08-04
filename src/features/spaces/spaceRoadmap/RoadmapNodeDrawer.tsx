import { useMemo, useState } from "react";
import { GripVertical, PanelLeftClose, Pin, Search, Settings2, X } from "lucide-react";
import type { SpaceRoadmapNodeDefinition } from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import { Button, Input, cn } from "@/ui";
import { RoadmapNodeDefinitionManager } from "./RoadmapNodeDefinitionManager";
import { roadmapNodeColors, roadmapPalette, type RoadmapPaletteItem } from "./roadmapNodeCatalog";

const categories: RoadmapPaletteItem["category"][] = ["Structure", "Planning", "Context", "Custom"];
export function RoadmapNodeDrawer(props: {
  open: boolean;
  pinned: boolean;
  canManage: boolean;
  definitions: SpaceRoadmapNodeDefinition[];
  onClose: () => void;
  onPinnedChange: (value: boolean) => void;
  onAdd: (item: RoadmapPaletteItem) => void;
  onCreateDefinition: (value: Partial<SpaceRoadmapNodeDefinition>) => Promise<void>;
  onUpdateDefinition: (value: SpaceRoadmapNodeDefinition) => Promise<void>;
  onArchiveDefinition: (value: SpaceRoadmapNodeDefinition) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const items = useMemo(
    () =>
      roadmapPalette(props.definitions).filter((item) =>
        `${item.label} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [props.definitions, query],
  );
  if (!props.open) return null;
  return (
    <aside
      className={cn(
        "absolute bottom-3 left-3 top-3 z-20 flex w-64 flex-col overflow-hidden rounded-xl",
        "border border-border/70 bg-background/95 shadow-xl backdrop-blur",
        props.pinned &&
          cn(
            "xl:relative xl:bottom-auto xl:left-auto xl:top-auto xl:z-auto xl:h-full xl:w-64",
            "xl:shrink-0 xl:rounded-none xl:border-y-0 xl:border-l-0 xl:shadow-none",
          ),
      )}
      aria-label="Roadmap node library"
    >
      <header className="flex h-11 items-center gap-2 border-b border-border/60 px-3">
        <strong className="text-xs">Add node</strong>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-7 hidden xl:grid"
          aria-label={props.pinned ? "Unpin node library" : "Pin node library"}
          onClick={() => props.onPinnedChange(!props.pinned)}
        >
          {props.pinned ? <PanelLeftClose className="size-3.5" /> : <Pin className="size-3.5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Close node library"
          onClick={props.onClose}
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="relative m-2">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
        <Input
          className="h-8 pl-8 text-xs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search nodes"
        />
      </div>
      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-auto px-2 pb-2">
        {categories.map((category) => {
          const categoryItems = items.filter((item) => item.category === category);
          if (!categoryItems.length) return null;
          return (
            <section className="mb-3" key={category}>
              <h3 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </h3>
              <div className="grid gap-0.5">
                {categoryItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 w-full cursor-grab justify-start gap-2 px-2 text-xs font-normal"
                      key={item.id}
                      draggable={props.canManage}
                      disabled={!props.canManage}
                      title={item.description}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData("application/x-misty-roadmap-node", item.id);
                      }}
                      onClick={() => props.onAdd(item)}
                    >
                      <GripVertical className="size-3 text-muted-foreground" />
                      <span
                        className={cn(
                          "grid size-6 place-items-center rounded",
                          roadmapNodeColors[item.color].soft,
                          roadmapNodeColors[item.color].accent,
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </Button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {props.canManage ? (
        <Button
          type="button"
          variant="ghost"
          className="m-2 h-8 justify-start gap-2 text-xs"
          onClick={() => setManagerOpen(true)}
        >
          <Settings2 className="size-3.5" />
          Manage custom nodes
        </Button>
      ) : null}
      <RoadmapNodeDefinitionManager
        open={managerOpen}
        definitions={props.definitions}
        onOpenChange={setManagerOpen}
        onCreate={props.onCreateDefinition}
        onUpdate={props.onUpdateDefinition}
        onArchive={props.onArchiveDefinition}
      />
    </aside>
  );
}
