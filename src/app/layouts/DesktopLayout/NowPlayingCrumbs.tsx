import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { WorkspaceView } from "@/features/workspace/model";
import { cn, IconButton, Pressable } from "@/shared/ui";

/**
 * Which of several playing sources a player shows. A source that has stopped hands the card to
 * the first one still playing.
 */
export function useChosenSource(sources: WorkspaceView[]) {
  const [chosen, setChosen] = useState<string | null>(null);
  const index = Math.max(
    0,
    sources.findIndex((view) => view.id === chosen),
  );
  return { index, current: sources[index], choose: setChosen };
}

/** Breadcrumbs at a player's foot, dots between arrows, that switch between its sources. */
export function NowPlayingCrumbs(props: {
  sources: WorkspaceView[];
  index: number;
  onChoose(id: string): void;
}) {
  const { sources, index } = props;
  if (sources.length < 2) return null;
  const step = (delta: number) =>
    props.onChoose(sources[(index + delta + sources.length) % sources.length]!.id);
  return (
    <div role="tablist" aria-label="Playing sources" className="misty-now-playing-crumbs">
      <IconButton size="xs" tooltip={false} label="Previous source" onClick={() => step(-1)}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </IconButton>
      <div>
        {sources.map((view, position) => (
          <Pressable
            key={view.id}
            role="tab"
            aria-selected={position === index}
            aria-label={`${view.title || "Untitled page"} (${position + 1} of ${sources.length})`}
            title={view.title || undefined}
            className={cn("misty-now-playing-crumb", position === index && "is-selected")}
            onClick={() => props.onChoose(view.id)}
          />
        ))}
      </div>
      <IconButton size="xs" tooltip={false} label="Next source" onClick={() => step(1)}>
        <ChevronRight className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  );
}
