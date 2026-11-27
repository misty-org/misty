import { useState } from "react";
import { Button, Textarea } from "@misty/ui";
import { useSessionGoals } from "./session_goals";

export function SessionGoalPanel({ conversationId }: { conversationId: string }) {
  const goal = useSessionGoals((state) => state.goals[conversationId]);
  const [draft, setDraft] = useState(goal?.text ?? "");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <Textarea
        aria-label="Goal"
        placeholder="What should be true when this chat is done?"
        className="min-h-24 resize-y"
        maxLength={2000}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex flex-none items-center justify-end gap-2">
        {goal ? (
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              useSessionGoals.getState().clear(conversationId);
              setDraft("");
            }}
          >
            Clear goal
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={!draft.trim() || draft.trim() === goal?.text}
          onClick={() => useSessionGoals.getState().set(conversationId, draft)}
        >
          {goal ? "Update goal" : "Set goal"}
        </Button>
      </div>
    </div>
  );
}
