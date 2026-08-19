import { githubCodeApi } from "@/api/integrations/github";
import { resolveSpacesApiBase } from "@/api/spaces/api";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui";
import { useEffect, useMemo, useState } from "react";
import { codeGitWorkspaceId } from "../native";
import { GitHubInstallations } from "./GitHubInstallations";
import { GitHubLinkedWorkspaces } from "./GitHubLinkedWorkspaces";
import { useGitHubCodeStore } from "./useGitHubCodeStore";

export function GitHubCodeSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootPath: string | null;
  onOpenRoot: (path: string) => void;
}) {
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const snapshotReady = useSpacesStore((state) => state.snapshotReady);
  const loadSpaces = useSpacesStore((state) => state.load);
  const loadGitHub = useGitHubCodeStore((state) => state.load);
  const resetGitHub = useGitHubCodeStore((state) => state.reset);
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [localWorkspaceId, setLocalWorkspaceId] = useState("");

  useEffect(() => {
    if (props.open && !snapshotReady) void loadSpaces({ accountId: user?.id });
  }, [loadSpaces, props.open, snapshotReady, user?.id]);

  useEffect(() => {
    if (!spaces.length) {
      setSelectedSpaceId("");
      return;
    }
    if (!spaces.some((space) => space.id === selectedSpaceId)) setSelectedSpaceId(spaces[0]!.id);
  }, [selectedSpaceId, spaces]);

  useEffect(() => {
    if (!props.rootPath) return void setLocalWorkspaceId("");
    let active = true;
    void codeGitWorkspaceId(props.rootPath)
      .then((value) => active && setLocalWorkspaceId(value))
      .catch(() => active && setLocalWorkspaceId(""));
    return () => {
      active = false;
    };
  }, [props.rootPath]);

  useEffect(() => {
    if (!props.open || !user?.id || !selectedSpaceId) return;
    void loadGitHub(user.id, selectedSpaceId);
  }, [loadGitHub, props.open, selectedSpaceId, user?.id]);

  useEffect(() => {
    if (!props.open || !user?.id || !selectedSpaceId) return;
    const refreshAfterGitHub = () => void loadGitHub(user.id, selectedSpaceId);
    window.addEventListener("focus", refreshAfterGitHub);
    return () => window.removeEventListener("focus", refreshAfterGitHub);
  }, [loadGitHub, props.open, selectedSpaceId, user?.id]);

  useEffect(() => () => resetGitHub(), [resetGitHub, user?.id]);

  const selectedSpace = useMemo(
    () => spaces.find((space) => space.id === selectedSpaceId),
    [selectedSpaceId, spaces],
  );
  const canManage = Boolean(
    selectedSpace &&
    (selectedSpace.role === "owner" || selectedSpace.permissions?.["integrations.manage"]),
  );

  const install = async () => {
    if (!selectedSpaceId || !canManage) return;
    const start = await githubCodeApi.beginInstall(selectedSpaceId, "/code");
    await openExternalLink(start.installation_url);
  };

  const redeemUrl = async (path: string) => {
    const base = await resolveSpacesApiBase();
    return new URL(path, `${base.replace(/\/+$/, "")}/`).toString();
  };

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="code-theme-overlay w-[min(680px,96vw)] overflow-y-auto bg-charcoal-bg sm:max-w-[680px]">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>GitHub for Code</SheetTitle>
          <SheetDescription>
            Link a repository, work locally, and choose exactly when Misty may push or open a pull
            request.
          </SheetDescription>
        </SheetHeader>

        <label className="mt-5 grid gap-1.5 text-xs text-cream-muted">
          Space
          <select
            value={selectedSpaceId}
            onChange={(event) => setSelectedSpaceId(event.target.value)}
            className="h-9 rounded-md border border-charcoal-border bg-charcoal-card px-3 text-sm text-cream outline-none focus:border-cream-muted"
          >
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>

        {!selectedSpace ? (
          <p className="mt-6 rounded-lg border border-charcoal-border bg-charcoal-card p-4 text-sm text-cream-muted">
            Create or join a Space before linking a GitHub repository.
          </p>
        ) : (
          <div className="mt-5 grid gap-5">
            <GitHubInstallations
              spaceId={selectedSpace.id}
              canManage={canManage}
              localWorkspaceId={localWorkspaceId}
              onInstall={install}
            />
            <GitHubLinkedWorkspaces
              spaceId={selectedSpace.id}
              canManage={canManage}
              rootPath={props.rootPath}
              localWorkspaceId={localWorkspaceId}
              onOpenRoot={props.onOpenRoot}
              resolveRedeemUrl={redeemUrl}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
