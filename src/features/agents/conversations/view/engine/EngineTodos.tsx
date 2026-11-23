import { ListChecks } from "lucide-react";
import { ComposerStatusRow } from "@misty/ui";
import { useEngineTurnStore } from "./engine_turn_store";

export function EngineTodoLane({ runId }: { runId?: string }) {
  const todos = useEngineTurnStore((state) => (runId ? state.byRun[runId]?.todos : undefined));
  if (!todos?.length) return null;
  const done = todos.filter((todo) => todo.status === "complete").length;
  const current =
    todos.find((todo) => todo.status === "active") ??
    todos.find((todo) => todo.status !== "complete" && todo.status !== "dropped");
  return (
    <ComposerStatusRow icon={ListChecks} label={`Tasks ${done} of ${todos.length}`}>
      {current?.content ?? "All done"}
    </ComposerStatusRow>
  );
}
