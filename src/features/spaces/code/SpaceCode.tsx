import { useAuth } from "@/features/auth";
import { codeProjectsApi } from "@/api/spaces/code-projects";
import {
  CodingUpgradeNote,
  ProjectReviewSheet,
  useCodingIncluded,
  useProjectReview,
} from "@/features/agents";
import { useWorkspaceViewTitle } from "@/features/workspace";
import { openInNewBrowserTab } from "@/features/browser-sync/searchTargets";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { useRangeSelection } from "@/shared/hooks/useRangeSelection";
import {
  Button,
  CollectionHeading,
  CollectionItems,
  CollectionPage,
  CollectionSkeleton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  itemTones,
  CollectionSelectionBar,
} from "@/shared/ui";
import { FileCode2, FolderPlus, MoreHorizontal } from "lucide-react";
import { useSpacesStore } from "../store/useSpacesStore";
import { useSpaceCodeProjects } from "./useSpaceCodeProjects";

/**
 * The Space's Code section: projects people linked here. Files stay on the
 * owner's computer; the Space shows what exists, whose it is and its GitHub
 * repository. On the owner's computer a project opens its changes and history.
 */
export function SpaceCode({
  spaceId,
  workspaceTabId,
}: {
  spaceId: string;
  workspaceTabId?: string;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const code = useSpaceCodeProjects(spaceId);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const openReview = useProjectReview((state) => state.open);
  // Linking a project is coding, which is Pro and above; seeing the Space's projects is not.
  const codingIncluded = useCodingIncluded();
  useWorkspaceViewTitle(workspaceTabId, `${space?.name ?? "Space"} Code`);
  const linked = new Set(
    (code.projects ?? [])
      .filter((project) => project.owner_user_id === user?.id)
      .map((project) => project.project_id),
  );
  const linkable = code.local.filter((scope) => scope.available && !linked.has(scope.id));
  const onThisComputer = new Set(code.local.map((scope) => scope.id));
  const items = (code.projects ?? []).map((project) => {
    const mine = project.owner_user_id === user?.id;
    const here = mine && onThisComputer.has(project.project_id);
    const github = project.github_repo ? `https://github.com/${project.github_repo}` : "";
    const open = () => {
      if (here) openReview(project.project_id);
      else if (github) openInNewBrowserTab(github, navigate);
    };
    return {
      id: project.id,
      title: project.name,
      category: "Project",
      icon: <FileCode2 size={18} />,
      tone: itemTones.code,
      creator: mine ? "You" : project.owner_name,
      metadata: {
        GitHub: project.github_repo || "—",
        Linked: new Date(project.linked_at).toLocaleDateString(),
      },
      sortValues: { Linked: Date.parse(project.linked_at) },
      updatedAt: project.updated_at,
      updated: new Date(project.updated_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      onOpen: open,
      selectable: mine || space?.role === "owner",
      actions:
        mine || space?.role === "owner" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`More actions for ${project.name}`}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {here ? (
                <DropdownMenuItem onSelect={() => openReview(project.project_id)}>
                  Review changes
                </DropdownMenuItem>
              ) : null}
              {github ? (
                <DropdownMenuItem onSelect={() => openInNewBrowserTab(github, navigate)}>
                  Open on GitHub
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => void code.unlink(project.id)}>
                Unlink from this Space
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined,
    };
  });
  const selection = useRangeSelection(items.filter((item) => item.selectable).map((item) => item.id));
  const deleteSelected = async () => {
    if (bulkDeleting || !selection.selectedIds.length) return;
    if (
      !(await confirmAction(
        `Unlink ${selection.selectedIds.length} selected ${selection.selectedIds.length === 1 ? "project" : "projects"} from this Space? Their files stay on their owners' computers.`,
      ))
    ) return;
    setBulkDeleting(true);
    setBulkError("");
    try {
      for (const id of selection.selectedIds) await codeProjectsApi.unlink(spaceId, id);
      selection.clear();
      code.reload();
    } catch {
      setBulkError("Some selected projects couldn't be unlinked. Try again.");
    } finally {
      setBulkDeleting(false);
    }
  };
  return (
    <CollectionPage>
      <CollectionHeading
        title="Code"
        actions={
          linkable.length || codingIncluded === false ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="primary" className="px-4">
                  <FolderPlus />
                  Link a project
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={codingIncluded === false ? "w-72" : ""}>
                {codingIncluded === false ? (
                  <CodingUpgradeNote />
                ) : (
                  linkable.map((scope) => (
                    <DropdownMenuItem key={scope.id} onSelect={() => void code.link(scope)}>
                      {scope.displayName}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />
      {code.error ? (
        <p role="alert" className="m-0 text-sm text-cream-muted">
          {code.error}
        </p>
      ) : null}
      <CollectionSelectionBar
        count={selection.selectedIds.length}
        busy={bulkDeleting}
        label="Unlink"
        onClear={selection.clear}
        onDelete={() => void deleteSelected()}
      />
      {bulkError && <p role="alert" className="text-sm text-cream-muted">{bulkError}</p>}
      {!code.projects ? (
        <CollectionSkeleton label="Projects" view="list" />
      ) : items.length ? (
        <CollectionItems
          columnSetId="space-code"
          fields={["GitHub", "Linked"]}
          categoryLabel="Type"
          creatorLabel="Owner"
          view="list"
          items={items}
          selectedIds={selection.selectedIds}
          onSelect={selection.select}
        />
      ) : (
        <EmptyState
          title="No projects yet"
          description="Link a coding project from this computer. Its files stay here; the Space sees its name, owner and GitHub repository."
        />
      )}
      <ProjectReviewSheet />
    </CollectionPage>
  );
}
