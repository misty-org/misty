import { WorkGroup } from "../../../progress/WorkGroup";

/** The engine's reasoning: open while it thinks, folded once its answer starts. */
export function EngineThinking({ text, answering }: { text: string; answering: boolean }) {
  if (!text.trim()) return null;
  return (
    <WorkGroup summary={answering ? "Thought it through" : "Thinking"} running={!answering}>
      <p className="engine-thinking">{text.trim()}</p>
    </WorkGroup>
  );
}
