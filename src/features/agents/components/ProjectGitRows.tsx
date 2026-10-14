import { GitBranch } from "lucide-react";
import { Button, Switch } from "@/shared/ui";
import type { AgentScope } from "../model/types";
import { useProjectReview } from "./changes/useProjectReview";

const pushHelp =
  "Agents can send this project’s commits to its GitHub repository on their own branches and open " +
  "pull requests. Anyone with access to that repository sees them.";
const defaultHelp =
  "Also lets agents push straight to the default branch (usually main) instead of opening a pull " +
  "request first.";

/** A project's Git rows on the Projects tab (docs/plans/agent-git-projects.md). */
export function ProjectGitRows({
  project,
  busy,
  onPush,
}: {
  project: AgentScope;
  busy: boolean;
  onPush(allow: boolean, allowDefault: boolean): void;
}) {
  const review = useProjectReview((s) => s.open);
  return (
    <>
      <div className="agent-integrations-row agent-integrations-account">
        <GitBranch size={15} aria-hidden="true" />
        <div className="agent-integrations-row-text">
          <strong>{project.git ? "Git" : "Not using Git"}</strong>
          <span className="agent-code-projects-help">
            {project.git
              ? "Review changes, commit, and push to or pull from GitHub."
              : "Turn on Git to keep history and put the project on GitHub."}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => review(project.id)}>
          {project.git ? "Review changes" : "Set up Git"}
        </Button>
      </div>
      {project.git ? (
        <>
          <label className="agent-integrations-row agent-integrations-account">
            <div className="agent-integrations-row-text">
              <strong>Agents can push</strong>
              <span className="agent-code-projects-help">{pushHelp}</span>
            </div>
            <Switch
              checked={Boolean(project.allowPush)}
              disabled={busy}
              aria-label={`Let agents push ${project.displayName}`}
              onCheckedChange={(allow) => onPush(allow, false)}
            />
          </label>
          {project.allowPush ? (
            <label className="agent-integrations-row agent-integrations-account agent-code-projects-indent">
              <div className="agent-integrations-row-text">
                <strong>Including the default branch</strong>
                <span className="agent-code-projects-help">{defaultHelp}</span>
              </div>
              <Switch
                checked={Boolean(project.allowPushDefault)}
                disabled={busy}
                aria-label={`Let agents push the default branch of ${project.displayName}`}
                onCheckedChange={(allowDefault) => onPush(true, allowDefault)}
              />
            </label>
          ) : null}
        </>
      ) : null}
    </>
  );
}
