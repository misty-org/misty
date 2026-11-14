import { Target } from "lucide-react";
import { useState } from "react";
import {
  Button,
  IconButton,
  Popover,
  PopoverActions,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverText,
  PopoverTrigger,
  Textarea,
} from "@/shared/ui";
import { useSessionGoals } from "./sessionGoals";

/**
 * Sets the open chat's goal. While one is set the button stays pressed and the chat keeps its
 * agent going until the goal is met; clearing it lets the chat rest after each reply again.
 */
export function SessionGoalButton({ conversationId }: { conversationId: string }) {
  const goal = useSessionGoals((state) => state.goals[conversationId]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(goal?.text ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <IconButton
          label="Goal"
          tooltipSide="left"
          aria-pressed={Boolean(goal)}
          disabled={!conversationId}
          // While open, pressing this button must not move focus. WebKit doesn't focus a clicked
          // button, so focus falls to the workspace pane around the rail (tabIndex 0); the popover
          // reads that as focus leaving it and closes, and since the rail's reorder handler stops
          // the pointerdown Radix would otherwise use to recognise its own trigger, the click then
          // toggles it open again, or not, depending on whether React re-rendered in between.
          // Keeping focus in the popover leaves the click as the only thing that closes it.
          onMouseDown={(event) => {
            if (open) event.preventDefault();
          }}
        >
          <Target />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" size="lg">
        <PopoverHeader title="Session goal" />
        <PopoverText>What should be true when this chat is done?</PopoverText>
        <PopoverBody>
          <Textarea
            aria-label="Goal"
            className="min-h-24 resize-y"
            maxLength={2000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </PopoverBody>
        <PopoverActions>
          {goal ? (
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                useSessionGoals.getState().clear(conversationId);
                setOpen(false);
              }}
            >
              Clear goal
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={!draft.trim()}
            onClick={() => {
              useSessionGoals.getState().set(conversationId, draft);
              setOpen(false);
            }}
          >
            {goal ? "Update goal" : "Set goal"}
          </Button>
        </PopoverActions>
      </PopoverContent>
    </Popover>
  );
}
