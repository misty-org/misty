import { FolderCode, FolderPlus, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Switch } from "@/shared/ui";
import type { AgentDevice, AgentScope } from "../model/interfaces/types";
import {
  agentsDeviceSnapshot,
  codeAllowProjectChanges,
  codeCheckpoints,
  codeChooseProject,
  codeRemoveProject,
  codeSetProjectInstalls,
  codeUndo,
  type CodeCheckpoint,
} from "../store/useAgentsStore";

const description =
  "Folders on this computer that agents can work in. Pick one in a chat’s Project menu: the " +
  "agent can then edit files and run commands in it, in a sandbox that can’t read the rest of " +
  "your computer, change .git or open your .env files. Each chat’s changes can be undone. " +
  "Your other devices can read projects but never change them.";

const readOnlyHelp =
  "Shared before projects: agents can only read it. Allow changes to let agents edit it and " +
  "run commands in it.";

const installsHelp =
  "Lets commands download packages from npm, PyPI and GitHub. Anything in this project could " +
  "be sent out through those sites, so allow it only for projects without private data.";

const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Folders on this computer shared as projects (docs/plans/agent-code-projects.md).
 * Agents never pick the folder; the person chooses it in the system picker.
 * Folders shared read-only before projects are listed too, until the person
 * allows changes; they never gain write access on their own.
 */
export function useCodeProjects() {
  const [projects, setProjects] = useState<AgentScope[]>();
  const [device, setDevice] = useState<AgentDevice>();
  const [checkpoints, setCheckpoints] = useState<Record<string, CodeCheckpoint[]>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const snapshot = await agentsDeviceSnapshot();
    setDevice(snapshot.device ?? undefined);
    const next = snapshot.scopes;
    setProjects(next);
    const entries = await Promise.all(
      next
        .filter((scope) => scope.kind === "project_folder")
        .map(async (project) => [project.id, await codeCheckpoints(project.id).catch(() => [])]),
    );
    setCheckpoints(Object.fromEntries(entries));
  }, []);
  useEffect(() => {
    if (hasTauriInternals()) void load().catch(() => setMessage("Projects couldn’t load."));
  }, [load]);
  const run = async (action: () => Promise<unknown>, failure: string, done = "") => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await load();
      setMessage(done);
    } catch (error) {
      const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
      // Native refusals explain themselves ("System folders can't be projects.").
      setMessage(text && text.length < 200 && !text.includes("_") ? text : failure);
    } finally {
      setBusy(false);
    }
  };
  return {
    available: hasTauriInternals(),
    device,
    projects,
    checkpoints,
    busy,
    message,
    add: () => void run(() => codeChooseProject(), "That folder couldn’t be shared as a project."),
    remove: (project: AgentScope) =>
      void run(() => codeRemoveProject(project.id), "That project couldn’t be removed."),
    allowChanges: (project: AgentScope) =>
      void run(
        () => codeAllowProjectChanges(project.id),
        "That folder couldn’t be made a project.",
        `Agents can now change ${project.displayName}.`,
      ),
    setInstalls: (project: AgentScope, allow: boolean) =>
      void run(() => codeSetProjectInstalls(project.id, allow), "That setting couldn’t be saved."),
    undo: (project: AgentScope, checkpoint: CodeCheckpoint) =>
      void run(
        () => codeUndo(project.id, checkpoint.runId),
        "Those changes couldn’t be undone.",
        `Undid the changes to ${project.displayName} from ${time.format(checkpoint.createdAt * 1000)}.`,
      ),
  };
}

export function CodeProjectsSection({
  projects: state,
}: {
  projects: ReturnType<typeof useCodeProjects>;
}) {
  if (!state.available) return null;
  return (
    <section aria-labelledby="code-projects-heading" className="agent-integrations-section">
      <header>
        <h2 id="code-projects-heading">Projects</h2>
      </header>
      <p className="agent-integrations-description">{description}</p>
      {state.projects?.length ? (
        <div className="agent-integrations-list">
          {state.projects.map((project) => (
            <div key={project.id}>
              <div className="agent-integrations-row">
                <FolderCode size={18} aria-hidden="true" />
                <div className="agent-integrations-row-text">
                  <strong>{project.displayName}</strong>
                  <span>
                    {!project.available
                      ? "Not found on this computer"
                      : project.kind === "project_folder"
                        ? "Edit and run commands"
                        : "Read only"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={state.busy}
                  aria-label={`Stop sharing ${project.displayName} as a project`}
                  onClick={() => state.remove(project)}
                >
                  Remove
                </Button>
              </div>
              {project.kind === "local_folder" ? (
                <div className="agent-integrations-row agent-integrations-account">
                  <div className="agent-integrations-row-text">
                    <span className="agent-code-projects-help">{readOnlyHelp}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={state.busy}
                    aria-label={`Allow agents to change ${project.displayName}`}
                    onClick={() => state.allowChanges(project)}
                  >
                    Allow changes
                  </Button>
                </div>
              ) : null}
              {project.kind === "project_folder" ? (
                <label className="agent-integrations-row agent-integrations-account">
                  <div className="agent-integrations-row-text">
                    <strong>Package installs</strong>
                    <span className="agent-code-projects-help">{installsHelp}</span>
                  </div>
                  <Switch
                    checked={Boolean(project.allowInstalls)}
                    disabled={state.busy}
                    aria-label={`Allow package installs in ${project.displayName}`}
                    onCheckedChange={(allow) => state.setInstalls(project, allow)}
                  />
                </label>
              ) : null}
              {(state.checkpoints[project.id] ?? []).slice(0, 5).map((checkpoint) => (
                <div
                  key={checkpoint.runId}
                  className="agent-integrations-row agent-integrations-account"
                >
                  <div className="agent-integrations-row-text">
                    <strong>Changes from {time.format(checkpoint.createdAt * 1000)}</strong>
                    <span>
                      {checkpoint.complete
                        ? "Undo puts the project back the way it was before this chat."
                        : "Too large to undo: the project was over 20,000 files or 1 GB."}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={state.busy || !checkpoint.complete}
                    aria-label={`Undo changes to ${project.displayName} from ${time.format(checkpoint.createdAt * 1000)}`}
                    onClick={() => state.undo(project, checkpoint)}
                  >
                    <Undo2 size={14} aria-hidden="true" />
                    Undo
                  </Button>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : state.projects ? (
        <p className="agent-integrations-description">No projects yet.</p>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className="agent-integrations-add"
        disabled={state.busy}
        onClick={state.add}
      >
        <FolderPlus size={14} />
        Add a project
      </Button>
      {state.message ? (
        <p role="status" className="agent-integrations-description">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
