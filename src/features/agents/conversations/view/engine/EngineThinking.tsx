import { Text } from "@/shared/ui";
import { WorkGroup } from "../../../progress/WorkGroup";

/** The engine's reasoning: open while it thinks, folded once its answer starts. */
export function EngineThinking({ text, answering }: { text: string; answering: boolean }) {
  if (!text.trim()) return null;
  return (
    <WorkGroup summary={answering ? "Thought it through" : "Thinking"} running={!answering}>
      <Text
        wrap
        size="meta"
        tone="muted"
        className="m-0 border-l-2 py-1 pl-3.5 leading-[1.6] whitespace-pre-wrap"
      >
        {text.trim()}
      </Text>
    </WorkGroup>
  );
}
