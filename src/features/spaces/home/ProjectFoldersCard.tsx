import { Folder, GitBranch, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  agentInFolder,
  currentSpaceKey,
  folderName,
  offerAgentForFolder,
  useContextPanel,
  usePersonalAgentsStore,
  useSpaceFolders,
} from "@/features/agents";
import { Button, OverflowFadeText, Text, useNotice } from "@/shared/ui";
import { useGitStatuses } from "./useOverviewData";
import { OverviewCard, OverviewEmpty, OverviewRow, OverviewRowsSkeleton } from "./OverviewCard";
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

  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  const link = () => {
    setError("");
    void useSpaceFolders
      .getState()
      .link(space)
      .then((path) => (path ? offerAgentForFolder(space, path) : undefined))
      .catch(() => setError("Couldn't link that folder. Try again."));
  };
  const open = (path: string) => {
    useSpaceFolders.getState().choose(space, path);
    // The agent working in this folder is the one whose chat shows it.
    void agentInFolder(path)
      .then((agent) => agent && usePersonalAgentsStore.getState().select(space, agent))
      .catch(() => undefined);
    useContextPanel.getState().show("files");
    navigate("/agents");
  };
  const linkButton = (
    <Button type="button" variant="quiet" icon={Plus} onClick={link}>
      Link a folder
    </Button>
  );

  return (
    <OverviewCard title="Project folders" action={linkButton}>
      {!loaded && !settled ? (
        <OverviewRowsSkeleton rows={2} kind="folder" trailing="w-20" />
      ) : folders.length ? (
        folders.map((path) => {
          const summary = gitSummary(git[path]);
          return (
            <OverviewRow
              key={path}
              kind="folder"
              leading={<Folder aria-hidden="true" />}
              title={folderName(path)}
              detail={<OverflowFadeText full>{shortPath(path)}</OverflowFadeText>}
              trailing={
                summary && (
                  <>
                    <span className="inline-flex max-w-40 items-center gap-1 overflow-hidden">
                      <GitBranch className="shrink-0" aria-hidden="true" />
                      <OverflowFadeText full>{summary.branch}</OverflowFadeText>
                    </span>
                    {summary.changed > 0 && (
                      <Text bare tone="changed">
                        {summary.changed} changed
                      </Text>
                    )}
                  </>
                )
              }
              onOpen={() => open(path)}
            />
          );
        })
      ) : (
        <OverviewEmpty>No folders linked</OverviewEmpty>
      )}
    </OverviewCard>
  );
}
