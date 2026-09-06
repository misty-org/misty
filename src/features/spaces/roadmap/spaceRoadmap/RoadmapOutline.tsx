import type { SpaceRoadmapSnapshot } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from "@/shared/ui";
import { ChevronDown, ChevronRight, Circle, Flag, ListTree, Shapes } from "lucide-react";
import { useState } from "react";

export function RoadmapOutline({
  snapshot,
  selectedId,
  onSelect,
  onOpenTask,
  mobile = false,
}: {
  snapshot: SpaceRoadmapSnapshot;
  selectedId: string;
  onSelect: (id: string) => void;
  onOpenTask: (taskId: string) => void;
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(mobile);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("border-charcoal-border/70 bg-charcoal-bg", mobile ? "h-full" : "border-t")}
    >
      {!mobile ? (
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full justify-start gap-2 rounded-none px-3 text-[10px] font-semibold text-cream-muted"
          >
            <ListTree className="size-3.5" />
            Accessible outline
            <ChevronDown
              className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
            />
          </Button>
        </CollapsibleTrigger>
      ) : null}
      <CollapsibleContent>
        <nav
          className={cn(
            "overflow-auto p-2",
            mobile ? "h-full pb-[env(safe-area-inset-bottom)]" : "max-h-52 pt-0",
          )}
          aria-label="Roadmap outline"
        >
          {snapshot.milestones.map((milestone) => (
            <div key={milestone.id}>
              <Button
                className={cn(
                  mobile ? "min-h-12" : "h-8",
                  "w-full justify-start gap-2 rounded px-2 text-left text-xs hover:bg-charcoal-card",
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
                        mobile && "min-h-12",
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
                        className={cn(outlineItemClass, mobile && "min-h-12", "pl-12 text-[11px]")}
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
                      mobile && "min-h-12",
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
                  mobile ? "min-h-12" : "h-8",
                  "w-full justify-start gap-2 rounded px-2 text-left text-xs hover:bg-charcoal-card",
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
