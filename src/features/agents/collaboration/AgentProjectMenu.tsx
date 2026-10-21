import { Download, FolderOpen, FolderPlus, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  MenuTrigger,
} from "@/shared/ui";
import { CodingUpgradeNote } from "../coding/CodingUpgradeNote";
import { useCodingIncluded } from "../coding/useCodingIncluded";
import type { AgentScope } from "../model/types";
import { agentsDeviceSnapshot, chooseProject } from "../store/useAgentsStore";
import { projectRemote } from "../store/projectGitHub";
import { useConversationProject } from "../store/useConversationProject";
import { FromGitHubDialog, PublishDialog } from "./GitHubDialogs";
import { NewProjectDialog } from "./ProjectDialogs";

const none = "none";

/**
 * The composer toolbar's project menu, beside the mode: the folder on this
 * computer the conversation works in, or none. Coding there runs in the person's own
 * coding tool (docs/plans/coding-runner-capabilities.md).
 * Only the chosen project travels with the chat; the next message uses a new
 * choice. Desktop only, since projects are folders on this computer; with another
 * device picked, its own shared folders apply instead and the menu steps aside.
 * Plans without coding see an upgrade note instead, and no project travels.
 */
export function AgentProjectMenu({
  conversationId,
  disabled,
}: {
  conversationId?: string;
  disabled?: boolean;
}) {
  const [projects, setProjects] = useState<AgentScope[]>([]);
  const [failed, setFailed] = useState("");
  const [dialog, setDialog] = useState<"new" | "github" | "publish" | null>(null);
  /** The chosen project's GitHub remote, or "" when it has none yet. */
  const [remote, setRemote] = useState<string | null>(null);
  const chosen = useConversationProject((s) =>
    conversationId ? (s.byConversation[conversationId] ?? null) : s.draft,
  );
  const setProject = useConversationProject((s) => s.setProject);
  const load = useCallback(
    () =>
      agentsDeviceSnapshot()
        .then((snapshot) => setProjects(snapshot.scopes))
        .catch(() => undefined),
    [],
  );
  const included = useCodingIncluded(hasTauriInternals());
  useEffect(() => {
    if (hasTauriInternals() && included !== false) void load();
  }, [load, included]);
  // A project chosen before the plan changed would only be refused on send.
  useEffect(() => {
    if (included === false && chosen) setProject(conversationId, null);
  }, [included, chosen, conversationId, setProject]);
  useEffect(() => {
    setRemote(null);
    if (chosen && hasTauriInternals())
      void projectRemote(chosen).then((found) => setRemote(found ?? ""));
  }, [chosen]);
  if (!hasTauriInternals()) return null;
  if (included === false)
    return (
      <DropdownMenu>
        <MenuTrigger
          label="Project"
          icon={<FolderOpen aria-hidden className="size-4 shrink-0" />}
          value="Project"
          title="Projects are part of Misty Pro and above"
          chevron={false}
          disabled={disabled}
          className="agent-strip-chip max-w-40"
        />
        <DropdownMenuContent align="start" className="w-72" data-misty-layer-portal>
          <CodingUpgradeNote />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  const current = projects.find((project) => project.id === chosen);
  const canPublish = current?.kind === "project_folder" && current.available && remote === "";
  const add = async () => {
    setFailed("");
    try {
      const added = await chooseProject();
      await load();
      if (added) setProject(conversationId, added.id);
    } catch (error) {
      const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
      setFailed(text && !text.includes("_") ? text : "That folder couldn’t be added.");
    }
  };
  /** A project made from a dialog becomes this conversation's project. */
  const picked = (project: { id: string }) => {
    setDialog(null);
    void load();
    setProject(conversationId, project.id);
  };
  const menu = (
    <DropdownMenu onOpenChange={(open) => open && void load()}>
      <MenuTrigger
        label="Project"
        icon={<FolderOpen aria-hidden className="size-4 shrink-0" />}
        value={current?.displayName ?? "Project"}
        title={
          current ? `Project: ${current.displayName}` : "The folder this conversation works in"
        }
        chevron={false}
        disabled={disabled}
        className="agent-strip-chip max-w-40"
      />
      <DropdownMenuContent align="start" className="w-72" data-misty-layer-portal>
        <DropdownMenuRadioGroup
          value={current?.id ?? none}
          onValueChange={(next) => setProject(conversationId, next === none ? null : next)}
        >
          <DropdownMenuRadioItem value={none}>No project</DropdownMenuRadioItem>
          {projects.map((project) => (
            <DropdownMenuRadioItem
              key={project.id}
              value={project.id}
              disabled={!project.available}
            >
              <span className="min-w-0 flex-1 truncate">{project.displayName}</span>
              {(!project.available || project.kind !== "project_folder") && (
                <span className="text-xs text-cream-muted">
                  {!project.available ? "Not found" : "Read only"}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setDialog("new")}>
          <FolderPlus aria-hidden="true" />
          New project…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog("github")}>
          <Download aria-hidden="true" />
          From GitHub…
        </DropdownMenuItem>
        {canPublish ? (
          <DropdownMenuItem onSelect={() => setDialog("publish")}>
            <Upload aria-hidden="true" />
            Publish to GitHub…
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void add()}>
          <FolderOpen aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Add an existing folder…</span>
          {failed && <span className="max-w-32 truncate text-xs text-cream-muted">{failed}</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <>
      {menu}
      <NewProjectDialog
        open={dialog === "new"}
        onOpenChange={(open) => setDialog(open ? "new" : null)}
        onCreated={picked}
      />
      <FromGitHubDialog
        open={dialog === "github"}
        onOpenChange={(open) => setDialog(open ? "github" : null)}
        onCreated={picked}
      />
      {current ? (
        <PublishDialog
          open={dialog === "publish"}
          scopeId={current.id}
          suggestedName={current.displayName}
          onOpenChange={(open) => setDialog(open ? "publish" : null)}
          onPublished={setRemote}
        />
      ) : null}
    </>
  );
}
