import type { ReactNode } from "react";
import "./agentComposerStrip.css";

/**
 * The composer's controls in one row under the message box, in the order a task is set up:
 * where it works (project), how it works (mode, code), then the usage
 * ring at the far end. Every control is a quiet chip; in a narrow
 * panel the chips show only their icons (see agentComposerStrip.css).
 */
export function ComposerStrip(props: {
  project?: ReactNode;
  mode: ReactNode;
  code?: ReactNode;
  usage?: ReactNode;
}) {
  return (
    <div className="agent-composer-strip" role="group" aria-label="Message options">
      {props.project}
      {props.mode}
      {props.code}
      <span className="agent-composer-strip-end">{props.usage}</span>
    </div>
  );
}
