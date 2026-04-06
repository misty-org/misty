import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Check, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSpacesStore } from "../../../stores/useSpacesStore";
import { SpacePanelContent } from "./SpacePanelContent";
import { SpacePageFrame } from "./SpacePageLayout";

export default function SpacesShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [panelVisible, setPanelVisible] = useState(() => {
    try {
      return window.localStorage.getItem("misty:spaces-panel-visible") !== "false";
    } catch {
      return true;
    }
  });
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
  const routeParts = location.pathname.split("/").filter(Boolean);
  const detailRouteActive = routeParts[0] === "spaces" && routeParts.length >= 3;
  const activeSpace = spaces.find((space) => space.id === routeParts[1]);
  const pageSection = routeParts[2] === "files" ? "library" : (routeParts[2] ?? "chat");

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    try {
      window.localStorage.setItem("misty:spaces-panel-visible", String(panelVisible));
    } catch {
      /* storage can be unavailable in private contexts */
    }
  }, [panelVisible]);

  const closeCreateDialog = () => {
    if (creating) return;
    clearError();
    setCreateOpen(false);
    setCreateName("");
  };
  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = createName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await createSpace(name);
      setCreateName("");
      setCreateOpen(false);
      navigate(`/spaces/${encodeURIComponent(created.id)}/library`);
    } catch {
      /* the dialog renders the store error */
    } finally {
      setCreating(false);
    }
  };
  return (
    <div
      className={`grid h-full min-h-0 grid-rows-[minmax(0,1fr)_32px] overflow-hidden bg-background ${panelVisible ? "grid-cols-[280px_minmax(0,1fr)] max-[900px]:grid-cols-[252px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"}`}
    >
      {panelVisible ? (
        <aside className="col-start-1 row-start-1 flex min-h-0 flex-col overflow-hidden border-r border-sidebar-border/60 bg-sidebar p-4 text-sm text-sidebar-foreground">
          {error && !detailRouteActive && !createOpen ? (
            <Button
              className="mb-3 h-auto w-full justify-start whitespace-normal border border-destructive/25 bg-destructive/10 px-3 py-2 text-left text-xs leading-relaxed text-destructive shadow-none hover:bg-destructive/15 hover:text-destructive"
              variant="ghost"
              type="button"
              onClick={clearError}
            >
              {error}
            </Button>
          ) : null}
          <SpacePanelContent
            spaces={spaces}
            limits={limits}
            loading={loading}
            onAddSpace={() => {
              clearError();
              setCreateOpen(true);
            }}
            notices={
              invitations.length > 0 ? (
                <section
                  className="grid gap-1.5 rounded-md bg-sidebar-accent/35 p-2"
                  aria-label="Space invitations"
                >
                  <p className="m-0 px-1 text-xs font-semibold text-muted-foreground">
                    Invitations
                  </p>
                  {invitations.map((invite) => (
                    <article
                      key={invite.id}
                      className="rounded-md bg-sidebar-accent/60 p-2.5 text-sm"
                    >
                      <p className="m-0 truncate font-medium text-sidebar-accent-foreground">
                        {invite.space_name}
                      </p>
                      <div className="mt-2 flex gap-1">
                        <Button
                          className="h-8 px-2 text-xs"
                          size="sm"
                          variant="secondary"
                          type="button"
                          onClick={() => void respondInvite(invite.id, true)}
                        >
                          <Check size={13} />
                          Accept
                        </Button>
                        <Button
                          className="h-8 px-2 text-xs"
                          size="sm"
                          variant="ghost"
                          type="button"
                          onClick={() => void respondInvite(invite.id, false)}
                        >
                          Decline
                        </Button>
                      </div>
                    </article>
                  ))}
                </section>
              ) : null
            }
          />
        </aside>
      ) : null}
      <main
        className={`${panelVisible ? "col-start-2" : "col-start-1"} row-start-1 min-h-0 min-w-0 bg-background`}
      >
        {detailRouteActive ? (
          <SpacePageFrame section={pageSection} spaceName={activeSpace?.name}>
            <Outlet />
          </SpacePageFrame>
        ) : (
          <Outlet />
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
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (open) setCreateOpen(true);
          else closeCreateDialog();
        }}
      >
        <DialogContent className="max-w-sm">
          <form onSubmit={(event) => void onCreate(event)}>
            <DialogHeader>
              <DialogTitle>Create a Space</DialogTitle>
              <DialogDescription>
                It starts private. You can own three Spaces total, including your personal Space.
              </DialogDescription>
            </DialogHeader>
            <label className="mt-5 grid gap-2 text-xs font-medium text-muted-foreground">
              Space name
              <Input
                autoFocus
                maxLength={80}
                placeholder="Design team"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </label>
            <p className="mb-0 mt-3 text-[11px] text-muted-foreground">
              {limits
                ? `${limits.owned} of ${limits.owned_limit} ownership slots used · ${limits.remaining_owned} remaining`
                : "Checking ownership slots..."}
            </p>
            {error ? (
              <p
                className="mb-0 mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <DialogFooter className="mt-5">
              <Button
                variant="outline"
                type="button"
                disabled={creating}
                onClick={closeCreateDialog}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !createName.trim()}>
                {creating ? "Creating..." : "Create Space"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PersonalSpaceRedirect() {
  const { spaces, loading, error, load, clearError } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      loading: state.loading,
      error: state.error,
      load: state.load,
      clearError: state.clearError,
    })),
  );
  const personal = spaces.find((space) => space.is_personal);
  const attemptedLoad = useRef(false);
  useEffect(() => {
    if (!personal && !loading && !attemptedLoad.current) {
      attemptedLoad.current = true;
      void load();
    }
  }, [load, loading, personal]);
  if (personal)
    return <Navigate to={`/spaces/${encodeURIComponent(personal.id)}/library`} replace />;
  if (error && !loading)
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="m-0 text-sm text-muted-foreground">{error}</p>
          <Button
            className="mt-4"
            variant="outline"
            type="button"
            onClick={() => {
              attemptedLoad.current = false;
              clearError();
              void load();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">
      Loading your personal Space...
    </div>
  );
}
