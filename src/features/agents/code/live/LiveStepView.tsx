import { Eye, Undo2, X } from "lucide-react";
import { useState } from "react";
import { ActionBar, CodeDiff, EmptyState, IconButton, ScrollArea, Text, TopBar } from "@misty/ui";
import { diffLines } from "./liveDiff";
import { useRoomView } from "./livePeople";
import type { LiveRoom } from "./liveRoom";
import { undoStep, textWithoutStep, type StepRecorder } from "./liveSteps";
import { useLiveStore } from "./liveStore";
import { authorKey, mainAuthor, type LiveStep } from "./liveTypes";

/**
 * One step in the main area: what it changed (the file without it, against the file now), with
 * Undo this step, which reverses it as a new change of the person's, and Show only, which
 * narrows the editor's author marks to the step's author.
 */
export function LiveStepView(props: { room: LiveRoom; recorder: StepRecorder; stepId: string }) {
  const { room, recorder, stepId } = props;
  const { steps } = useRoomView(room);
  const only = useLiveStore((state) => state.only);
  const [error, setError] = useState("");
  const step: LiveStep | undefined = steps.find((found) => found.id === stepId);
  const text = step ? room.files.get(step.path) : undefined;
  // Worked out on every render: the room's view renders again as the doc changes, so the diff
  // follows later edits to the file too.
  const lines = step && text ? diffLines(textWithoutStep(text, step), text.toString()) : [];
  const close = () => useLiveStore.getState().selectStep(null);
  if (!step) return null;

  const key = authorKey(step.author);
  const name = step.author.id === mainAuthor.id ? "main" : step.author.name;
  const showing = only === key;
  const undo = () => {
    setError("");
    if (!undoStep(room, recorder, step)) setError("Nothing of this step is left to undo.");
  };
  return (
    <div className="flex size-full min-h-0 flex-col">
      <TopBar
        aria-label="Step"
        divider
        start={
          <Text size="control" weight="medium">
            {step.summary}
          </Text>
        }
      >
        <ActionBar
          label="Step actions"
          width="content"
          items={[
            { id: "undo", icon: Undo2, label: "Undo this step", priority: 2, onSelect: undo },
            {
              id: "only",
              icon: Eye,
              label: showing ? "Show everyone" : `Show only ${name}`,
              priority: 1,
              pressed: showing,
              onSelect: () => useLiveStore.getState().showOnly(showing ? null : key),
            },
          ]}
        />
        <IconButton label="Close" onClick={close}>
          <X />
        </IconButton>
      </TopBar>
      {error ? (
        <Text size="meta" tone="danger" wrap className="px-4 pt-2">
          {error}
        </Text>
      ) : null}
      {lines.length ? (
        <ScrollArea className="min-h-0 flex-1">
          <CodeDiff label={`Changes in ${step.path}`} lines={lines} className="px-4 py-3" />
        </ScrollArea>
      ) : (
        <EmptyState title="Nothing of this step is left" line="Later edits replaced all of it." />
      )}
    </div>
  );
}
