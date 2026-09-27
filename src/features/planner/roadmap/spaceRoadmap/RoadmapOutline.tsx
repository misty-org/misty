import type { SpaceRoadmapSnapshot } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { cn, Collapsible, CollapsibleContent, CollapsibleTrigger, Pressable } from "@/shared/ui";
import { ChevronDown, ChevronRight, Circle, Flag, ListTree, Shapes } from "lucide-react";
import { useState } from "react";
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
      className={cn("border-charcoal-border/70 bg-charcoal-bg", "border-t")}
    >
      {
        <CollapsibleTrigger asChild>
          <Pressable className="flex items-center hover:bg-cream/[0.045] h-9 w-full gap-2 rounded-none px-3 text-[10px] font-semibold text-cream-muted">
            <ListTree className="size-3.5" />
            Accessible outline
            <ChevronDown
              className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
            />
          </Pressable>
        </CollapsibleTrigger>
      }
      <CollapsibleContent>
        <nav className={cn("overflow-auto p-2", "max-h-52 pt-0")} aria-label="Roadmap outline">
          {snapshot.milestones.map((milestone) => (
            <div key={milestone.id}>
              <Pressable
                className={cn(
                  "h-8",
                  "w-full gap-2 rounded px-2 text-xs hover:bg-charcoal-card",
                  selectedId === milestone.id && "bg-charcoal-card",
                )}
                onClick={() => onSelect(milestone.id)}
              >
                <Flag className="size-3.5" />
                <span className="truncate font-medium">{milestone.title}</span>
                <span className="ml-auto text-[10px] text-cream-muted">
                  {milestone.goal_done}/{milestone.goal_total}
                </span>
              </Pressable>
              {snapshot.goals
                .filter((goal) => goal.milestone_id === milestone.id)
                .map((goal) => (
                  <div key={goal.id}>
                    <Pressable
                      className={cn(
                        outlineItemClass,
                        false,
                        "pl-7 text-xs",
                        selectedId === goal.id && "bg-charcoal-card text-cream",
                      )}
                      onClick={() => onSelect(goal.id)}
                    >
                      <ChevronRight className="size-3" />
                      <Circle className="size-2.5" />
                      <span className="truncate">{goal.title}</span>
                    </Pressable>
                    {goal.tasks.map((task) => (
                      <Pressable
                        className={cn(outlineItemClass, false, "pl-12 text-[11px]")}
                        key={task.id}
                        onClick={() => onOpenTask(task.id)}
                      >
                        <Circle className="size-2" />
                        <span className="truncate">{task.title}</span>
                      </Pressable>
                    ))}
                  </div>
                ))}
              {snapshot.nodes
                .filter((node) => node.milestone_id === milestone.id)
                .map((node) => (
                  <Pressable
                    className={cn(
                      outlineItemClass,
                      false,
                      "pl-7 text-xs",
                      selectedId === node.id && "bg-charcoal-card text-cream",
                    )}
                    key={node.id}
                    onClick={() => onSelect(node.id)}
                  >
                    <Shapes className="size-3" />
                    <span className="truncate">{node.title}</span>
                  </Pressable>
                ))}
            </div>
          ))}
          {snapshot.nodes
            .filter((node) => !node.milestone_id)
            .map((node) => (
              <Pressable
                className={cn(
                  "h-8",
                  "w-full gap-2 rounded px-2 text-xs hover:bg-charcoal-card",
                  selectedId === node.id && "bg-charcoal-card",
                )}
                key={node.id}
                onClick={() => onSelect(node.id)}
              >
                <Shapes className="size-3.5" />
                <span className="truncate">{node.title}</span>
              </Pressable>
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
