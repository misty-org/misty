import { Target } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, Textarea } from "@/shared/ui";
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
        <IconButton label="Goal" aria-pressed={Boolean(goal)} disabled={!conversationId}>
          <Target size={16} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-3">
        <Textarea
          aria-label="Goal"
          className="min-h-24 resize-y"
          maxLength={2000}
          placeholder="What should be true when this chat is done?"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!draft.trim()}
            onClick={() => {
              useSessionGoals.getState().set(conversationId, draft);
              setOpen(false);
            }}
          >
            {goal ? "Update goal" : "Set goal"}
          </Button>
          {goal ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                useSessionGoals.getState().clear(conversationId);
                setOpen(false);
              }}
            >
              Clear goal
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
