import { FolderOpen, FolderPlus } from "lucide-react";
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
import type { AgentScope } from "../model/types";
import { agentsDeviceSnapshot, chooseProject } from "../store/useAgentsStore";
import { useConversationProject } from "../store/useConversationProject";
import { NewProjectDialog } from "./ProjectDialogs";

const none = "none";

/**
 * The composer toolbar's project menu, beside the mode: the folder on this
 * computer the conversation works in, or none. Coding there runs in the person's own
 * coding tool (docs/plans/coding-runner-capabilities.md).
 * Only the chosen project travels with the chat; the next message uses a new
 * choice. Desktop only, since projects are folders on this computer.
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
  const [dialog, setDialog] = useState<"new" | null>(null);
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
  useEffect(() => {
    if (hasTauriInternals()) void load();
  }, [load]);
  if (!hasTauriInternals()) return null;
  const current = projects.find((project) => project.id === chosen);
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
        value={current?.displayName ?? "No project"}
        title="The folder this conversation works in"
        disabled={disabled}
        className="agent-mode-toggle h-7 max-w-48 px-2 text-xs font-normal text-cream-muted"
      />
      <DropdownMenuContent align="start" className="w-72" data-misty-layer-portal>
        <DropdownMenuRadioGroup
          value={current?.id ?? none}
          onValueChange={(next) => setProject(conversationId, next === none ? null : next)}
        >
          <DropdownMenuRadioItem value={none}>
            <span className="grid min-w-0 gap-0.5">
              <span>No project</span>
              <span className="text-xs text-cream-muted">The agent works without a folder</span>
            </span>
          </DropdownMenuRadioItem>
          {projects.map((project) => (
            <DropdownMenuRadioItem
              key={project.id}
              value={project.id}
              disabled={!project.available}
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate">{project.displayName}</span>
                <span className="text-xs text-cream-muted">
                  {!project.available
                    ? "Not found on this computer"
                    : project.kind === "project_folder"
                      ? "Your coding tool works here"
                      : "Read only"}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setDialog("new")}>
          <FolderPlus aria-hidden="true" />
          <span className="grid min-w-0 gap-0.5">
            <span>New project…</span>
            <span className="text-xs text-cream-muted">
              A new folder with Git, on this computer
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void add()}>
          <FolderOpen aria-hidden="true" />
          <span className="grid min-w-0 gap-0.5">
            <span>Add an existing folder…</span>
            <span className="text-xs text-cream-muted">
              {failed || "Choose a folder on this computer"}
            </span>
          </span>
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
    </>
  );
}
