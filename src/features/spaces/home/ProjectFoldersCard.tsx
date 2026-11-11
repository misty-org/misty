import { Folder, GitBranch, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { currentSpaceKey, folderName, useContextPanel, useSpaceFolders } from "@/features/agents";
import { Button, ErrorNotification } from "@/shared/ui";
import { useGitStatuses } from "./useOverviewData";
import { OverviewCard, OverviewRow, OverviewRowsSkeleton } from "./OverviewCard";
import { gitSummary, shortPath } from "./overviewData";

const noFolders: string[] = [];

/**
 * The folders linked to this Space on this computer, each with its Git branch and how many files
 * changed. Picking one opens the Agents page with its files beside the chat.
 */
export function ProjectFoldersCard() {
  const navigate = useNavigate();
  const space = currentSpaceKey();
  const folders = useSpaceFolders((state) => state.folders[space] ?? noFolders);
  const loaded = useSpaceFolders((state) => state.folders[space] !== undefined);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState("");
  const git = useGitStatuses(folders);
  useEffect(() => {
    let live = true;
    void useSpaceFolders
      .getState()
      .load(space)
      .catch(() => undefined)
      .then(() => live && setSettled(true));
    return () => {
      live = false;
    };
  }, [space]);

  const link = () => {
    setError("");
    void useSpaceFolders
      .getState()
      .link(space)
      .catch(() => setError("Couldn't link that folder. Try again."));
  };
  const open = (path: string) => {
    useSpaceFolders.getState().choose(space, path);
    useContextPanel.getState().show("files");
    navigate("/agents");
  };
  const linkButton = (
    <Button type="button" variant="ghost" size="sm" onClick={link}>
      <Plus aria-hidden="true" />
      Link a folder
    </Button>
  );

  return (
    <OverviewCard title="Project folders" action={folders.length ? linkButton : undefined}>
      {!loaded && !settled ? (
        <OverviewRowsSkeleton rows={2} />
      ) : folders.length ? (
        folders.map((path) => {
          const summary = gitSummary(git[path]);
          return (
            <OverviewRow
              key={path}
              kind="folder"
              leading={<Folder className="size-4" aria-hidden="true" />}
              title={folderName(path)}
              detail={<span className="truncate">{shortPath(path)}</span>}
              trailing={
                summary && (
                  <>
                    <span className="overview-git">
                      <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{summary.branch}</span>
                    </span>
                    {summary.changed > 0 && (
                      <span className="overview-git-changed">{summary.changed} changed</span>
                    )}
                  </>
                )
              }
              onOpen={() => open(path)}
            />
          );
        })
      ) : (
        <div className="overview-card-empty">{linkButton}</div>
      )}
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </OverviewCard>
  );
}
