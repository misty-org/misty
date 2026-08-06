import { useState } from "react";
import { ChevronDown, ChevronRight, Circle, Flag, ListTree, Shapes } from "lucide-react";
import type { SpaceRoadmapSnapshot } from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from "@/ui";

export function RoadmapOutline({
  snapshot,
  selectedId,
  onSelect,
  onOpenTask,
}: {
  snapshot: SpaceRoadmapSnapshot;
  selectedId: string;
  onSelect: (id: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-t border-charcoal-border/70 bg-charcoal-bg"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-start gap-2 rounded-none px-3 text-[10px] font-semibold uppercase tracking-wider text-cream-muted"
        >
          <ListTree className="size-3.5" />
          Accessible outline
          <ChevronDown
            className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <nav className="max-h-52 overflow-auto p-2 pt-0" aria-label="Roadmap outline">
          {snapshot.milestones.map((milestone) => (
            <div key={milestone.id}>
              <Button
                className={cn(
                  "h-8 w-full justify-start gap-2 rounded px-2 text-left text-xs hover:bg-charcoal-card",
                  selectedId === milestone.id && "bg-charcoal-card",
                )}
                type="button"
                variant="ghost"
                onClick={() => onSelect(milestone.id)}
              >
                <Flag className="size-3.5" />
                <span className="truncate font-medium">{milestone.title}</span>
                <span className="ml-auto text-[10px] text-cream-muted">
                  {milestone.goal_done}/{milestone.goal_total}
                </span>
              </Button>
              {snapshot.goals
                .filter((goal) => goal.milestone_id === milestone.id)
                .map((goal) => (
                  <div key={goal.id}>
                    <Button
                      className={cn(
                        outlineItemClass,
                        "pl-7 text-xs",
                        selectedId === goal.id && "bg-charcoal-card text-cream",
                      )}
                      type="button"
                      variant="ghost"
                      onClick={() => onSelect(goal.id)}
                    >
                      <ChevronRight className="size-3" />
                      <Circle className="size-2.5" />
                      <span className="truncate">{goal.title}</span>
                    </Button>
                    {goal.tasks.map((task) => (
                      <Button
                        className={cn(outlineItemClass, "pl-12 text-[11px]")}
                        type="button"
                        variant="ghost"
                        key={task.id}
                        onClick={() => onOpenTask(task.id)}
                      >
                        <Circle className="size-2" />
                        <span className="truncate">{task.title}</span>
                      </Button>
                    ))}
                  </div>
                ))}
              {snapshot.nodes
                .filter((node) => node.milestone_id === milestone.id)
                .map((node) => (
                  <Button
                    className={cn(
                      outlineItemClass,
                      "pl-7 text-xs",
                      selectedId === node.id && "bg-charcoal-card text-cream",
                    )}
                    type="button"
                    variant="ghost"
                    key={node.id}
                    onClick={() => onSelect(node.id)}
                  >
                    <Shapes className="size-3" />
                    <span className="truncate">{node.title}</span>
                  </Button>
                ))}
            </div>
          ))}
          {snapshot.nodes
            .filter((node) => !node.milestone_id)
            .map((node) => (
              <Button
                className={cn(
                  "h-8 w-full justify-start gap-2 rounded px-2 text-left text-xs hover:bg-charcoal-card",
                  selectedId === node.id && "bg-charcoal-card",
                )}
                type="button"
                variant="ghost"
                key={node.id}
                onClick={() => onSelect(node.id)}
              >
                <Shapes className="size-3.5" />
                <span className="truncate">{node.title}</span>
              </Button>
            ))}
        </nav>
      </CollapsibleContent>
    </Collapsible>
  );
}

const outlineItemClass = [
  "h-7 w-full justify-start gap-2 rounded pr-2 text-left font-normal",
  "text-cream-muted hover:bg-charcoal-card hover:text-cream",
].join(" ");
