import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button, PermissionState } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { SpacePanelContent } from "./SpacePanelContent";
import { SpacePageFrame } from "./SpacePageLayout";
import { SpacesAppLoadingPlaceholder } from "./SpacesLoadingPlaceholder";
import { CreateSpaceDialog } from "../spacesShell/CreateSpaceDialog";
import { SpaceInvitationsNotice } from "../spacesShell/SpaceInvitationsNotice";
import { useCreateSpaceDialog } from "../spacesShell/useCreateSpaceDialog";
import { readPanelVisible, writePanelVisible } from "../spacesShell/spacesShellStorage";
import type { SpacesShellOutletContext } from "../spacesShell/outletContext";

export { SpacesIndexRedirect } from "../spacesShell/SpacesIndexRedirect";

export default function SpacesShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, transitioning } = useAuth();
  const [panelVisible, setPanelVisible] = useState(readPanelVisible);
  const {
    spaces,
    invitations,
    limits,
    loading,
    error,
    load,
    createSpace,
    respondInvite,
    clearError,
  } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      invitations: state.invitations,
      limits: state.limits,
      loading: state.loading,
      error: state.error,
      load: state.load,
      createSpace: state.createSpace,
      respondInvite: state.respondInvite,
      clearError: state.clearError,
    })),
  );
  const dialog = useCreateSpaceDialog({ createSpace, clearError });

  const routeParts = location.pathname.split("/").filter(Boolean);
  const detailRouteActive = routeParts[0] === "spaces" && routeParts.length >= 3;

  useEffect(() => {
    if (!user) return;
    void load();
    // Re-fires on account switch so Spaces reloads for the new account
    // instead of leaving whatever was last fetched (or was in flight) for
    // the previous one sitting in the shared store.
  }, [load, user?.id]);
  useEffect(() => {
    if (!user) clearError();
  }, [clearError, user]);
  useEffect(() => writePanelVisible(panelVisible), [panelVisible]);

  if (transitioning) return <SpacesAppLoadingPlaceholder />;

  if (!user)
    return (
      <PermissionState
        className="h-full"
        title="Sign in to use Spaces"
        description="Spaces need an active Misty session before they can load messages, notes, tasks, and Library items."
        action={
          <Button
            type="button"
            onClick={() =>
              navigate("/signin", {
                state: { from: `${location.pathname}${location.search}${location.hash}` },
              })
            }
          >
            Sign in
          </Button>
        }
      />
    );

  const outletContext = {
    openCreateSpaceDialog: dialog.start,
  } satisfies SpacesShellOutletContext;

  return (
    <div
      className={`grid h-full min-h-0 grid-rows-[minmax(0,1fr)_32px] overflow-hidden bg-background ${panelVisible ? "grid-cols-[280px_minmax(0,1fr)] max-[900px]:grid-cols-[252px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"}`}
    >
      {panelVisible ? (
        <aside className="col-start-1 row-start-1 flex min-h-0 flex-col overflow-hidden border-r border-sidebar-border/60 bg-[var(--misty-app-panel-bg,transparent)] p-4 text-sm text-sidebar-foreground">
          <SpacePanelContent
            spaces={spaces}
            limits={limits}
            loading={loading}
            onAddSpace={dialog.start}
            notices={
              <SpaceInvitationsNotice
                invitations={invitations}
                onRespond={(id, accept) => void respondInvite(id, accept)}
              />
            }
          />
        </aside>
      ) : null}

      <main
        className={`${panelVisible ? "col-start-2" : "col-start-1"} relative row-start-1 min-h-0 min-w-0 overflow-hidden bg-background`}
      >
        {detailRouteActive ? (
          <SpacePageFrame>
            <Outlet context={outletContext} />
          </SpacePageFrame>
        ) : (
          <Outlet context={outletContext} />
        )}
      </main>

      <footer className="col-span-full row-start-2 flex min-h-8 items-center border-t border-border/60 bg-background px-2">
        <Button
          className={`size-8 rounded-md p-0 ${panelVisible ? "bg-accent text-accent-foreground" : ""}`}
          size="icon"
          variant="ghost"
          type="button"
          onClick={() => setPanelVisible((visible) => !visible)}
          title={panelVisible ? "Hide Spaces panel" : "Show Spaces panel"}
          aria-label={panelVisible ? "Hide Spaces panel" : "Show Spaces panel"}
          aria-pressed={panelVisible}
        >
          {panelVisible ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </Button>
      </footer>

      <CreateSpaceDialog dialog={dialog} error={error ?? ""} />
    </div>
  );
}
