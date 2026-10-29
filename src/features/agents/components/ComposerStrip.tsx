import type { ReactNode } from "react";
import "./agentComposerStrip.css";

/**
 * The composer's controls in one row under the message box, in the order a task is set up:
 * where it works (project), then how it works (mode, code). Every control is a quiet chip;
 * in a narrow panel the chips show only their icons (see agentComposerStrip.css).
 */
export function ComposerStrip(props: { project?: ReactNode; mode: ReactNode; code?: ReactNode }) {
  return (
    <div className="agent-composer-strip" role="group" aria-label="Message options">
      {props.project}
      {props.mode}
      {props.code}
    </div>
  );
}
