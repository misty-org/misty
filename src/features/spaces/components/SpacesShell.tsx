import { useEffect, useRef, useState, type ComponentType, type FormEvent } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Input } from "@/ui";
import { Skeleton } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { openExternalLink } from "@/platform/openExternalLink";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  ProviderConnectionAvailability,
  SpaceIntegrationProvider,
  SpaceTemplate,
} from "@/models/interfaces/features/spaces/types";
import { SpacePanelContent } from "./SpacePanelContent";
import { SpacePageFrame } from "./SpacePageLayout";

export default function SpacesShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createStep, setCreateStep] = useState(0);
  const [templates, setTemplates] = useState<SpaceTemplate[]>([]);
  const [templateId, setTemplateId] = useState("blank");
  const [providers, setProviders] = useState<SpaceIntegrationProvider[]>([]);
  const [providerAvailability, setProviderAvailability] = useState<
    ProviderConnectionAvailability[]
  >([]);
  const [templateError, setTemplateError] = useState("");
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
  const activeSpaceId = detailRouteActive ? (routeParts[1] ?? "") : "";

  useEffect(() => {
    void load();
    // Re-fires on account switch so Spaces reloads for the new account
    // instead of leaving whatever was last fetched (or was in flight) for
    // the previous one sitting in the shared store.
  }, [load, user?.id]);
  useEffect(() => {
    try {
      window.localStorage.setItem("misty:spaces-panel-visible", String(panelVisible));
    } catch {
      /* storage can be unavailable in private contexts */
    }
  }, [panelVisible]);
  useEffect(() => {
    if (!createOpen || templates.length) return;
    let active = true;
    spacesApi
      .templates()
      .then(({ templates: loaded, providers: available }) => {
        if (active) {
          setTemplates(loaded);
          setProviderAvailability(available ?? []);
        }
      })
      .catch(() => {
        if (active)
          setTemplateError("Templates could not be loaded. You can still create a Blank Space.");
      });
    return () => {
      active = false;
    };
  }, [createOpen, templates.length]);

  const closeCreateDialog = () => {
    if (creating) return;
    clearError();
    setCreateOpen(false);
    restoreDocumentInteractivityAfterModalClose();
    setCreateName("");
    setCreateStep(0);
    setTemplateId("blank");
    setProviders([]);
    setProviderAvailability([]);
    setTemplateError("");
  };
  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = createName.trim();
    if (!name || creating || createStep < 2) return;
    setCreating(true);
    try {
      const firstProvider = providers[0];
      const created = await createSpace({
        name,
        template_id: templateId,
        integration_providers: providers,
      });
      setCreateName("");
      setCreateOpen(false);
      restoreDocumentInteractivityAfterModalClose();
      setCreateStep(0);
      setTemplateId("blank");
      setProviders([]);
      navigate(`/spaces/${encodeURIComponent(created.space.id)}/chat?created=1`);
      if (firstProvider) {
        void spacesApi
          .beginProviderConnection(
            created.space.id,
            firstProvider,
            `/spaces/${created.space.id}/settings/integrations`,
          )
          .then((start) => openExternalLink(start.authorization_url))
          .catch(() => {
            // The resumable setup card remains available in Chat and Settings.
          });
      }
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
        <aside className="col-start-1 row-start-1 flex min-h-0 flex-col overflow-hidden border-r border-sidebar-border/60 bg-[var(--misty-app-panel-bg,transparent)] p-4 text-sm text-sidebar-foreground">
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
        className={`${panelVisible ? "col-start-2" : "col-start-1"} relative row-start-1 min-h-0 min-w-0 overflow-hidden bg-background`}
      >
        {detailRouteActive ? (
          <SpacePageFrame>
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
        <DialogContent className="max-w-lg">
          <form onSubmit={(event) => void onCreate(event)}>
            <DialogHeader>
              <DialogTitle>Create a Space</DialogTitle>
              <DialogDescription>
                Get your team organized in a few seconds. Everything can be changed later.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 flex gap-1.5" aria-label={`Step ${createStep + 1} of 3`}>
              {[0, 1, 2].map((step) => (
                <span
                  key={step}
                  className={`h-1 flex-1 rounded-full ${step <= createStep ? "bg-primary" : "bg-muted"}`}
                />
              ))}
            </div>
            {createStep === 0 ? (
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
            ) : null}
            {createStep === 1 ? (
              <section className="mt-5">
                <p className="m-0 text-sm font-medium">Choose a template</p>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">
                  Optional starter content—nothing is locked in.
                </p>
                <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {(templates.length ? templates : blankTemplateFallback).map((template) => (
                    <button
                      key={template.id}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        templateId === template.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/55"
                      }`}
                      type="button"
                      onClick={() => setTemplateId(template.id)}
                    >
                      <span className="block text-sm font-medium">{template.name}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {template.description}
                      </span>
                    </button>
                  ))}
                </div>
                {templateError ? (
                  <p className="mb-0 mt-2 text-xs text-muted-foreground">{templateError}</p>
                ) : null}
              </section>
            ) : null}
            {createStep === 2 ? (
              <section className="mt-5">
                <p className="m-0 text-sm font-medium">Connect tools your team already uses</p>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">
                  Optional. Setup can be closed and resumed at any time.
                </p>
                <div className="grid gap-2">
                  {integrationChoices.map((choice) => {
                    const selected = providers.includes(choice.id);
                    const availability = providerAvailability.find(
                      (provider) => provider.provider === choice.id,
                    );
                    const unavailable = availability?.configured === false;
                    const Icon = choice.icon;
                    return (
                      <button
                        key={choice.id}
                        className={`flex items-center gap-3 rounded-lg border p-3 text-left ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/55"
                        }`}
                        type="button"
                        aria-pressed={selected}
                        disabled={unavailable}
                        onClick={() =>
                          setProviders((current) =>
                            selected
                              ? current.filter((provider) => provider !== choice.id)
                              : [...current, choice.id],
                          )
                        }
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        <span className="flex-1 text-sm font-medium">
                          {choice.name}
                          {unavailable ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              Unavailable
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={`grid size-5 place-items-center rounded-full border ${
                            selected ? "border-primary bg-primary text-primary-foreground" : ""
                          }`}
                        >
                          {selected ? <Check size={12} /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
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
                onClick={() =>
                  createStep === 0 ? closeCreateDialog() : setCreateStep((step) => step - 1)
                }
              >
                {createStep === 0 ? (
                  "Cancel"
                ) : (
                  <>
                    <ChevronLeft size={14} /> Back
                  </>
                )}
              </Button>
              {createStep < 2 ? (
                <Button
                  type="button"
                  disabled={createStep === 0 && !createName.trim()}
                  onClick={() => setCreateStep((step) => step + 1)}
                >
                  Continue <ChevronRight size={14} />
                </Button>
              ) : (
                <Button type="submit" disabled={creating || !createName.trim()}>
                  {creating ? "Creating..." : "Create Space"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SpacesIndexRedirect() {
  const { user } = useAuth();
  const { spaces, loading, error, load, clearError } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      loading: state.loading,
      error: state.error,
      load: state.load,
      clearError: state.clearError,
    })),
  );
  const lastActiveSpaceId = readLastActiveSpaceId(user?.id);
  const firstSpace = spaces.find((space) => space.id === lastActiveSpaceId) ?? spaces[0];
  const [skeletonVisible] = useMinimumSpin(!firstSpace);
  const attemptedLoad = useRef(false);
  const attemptedLoadForUserId = useRef(user?.id);
  if (attemptedLoadForUserId.current !== user?.id) {
    attemptedLoadForUserId.current = user?.id;
    attemptedLoad.current = false;
  }
  useEffect(() => {
    if (!firstSpace && !loading && !attemptedLoad.current) {
      attemptedLoad.current = true;
      void load();
    }
  }, [firstSpace, load, loading]);
  if (firstSpace && !skeletonVisible)
    return <Navigate to={`/spaces/${encodeURIComponent(firstSpace.id)}/chat`} replace />;
  if (error && !loading && !skeletonVisible)
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
  if (!loading && !skeletonVisible && spaces.length === 0)
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-sm">
          <h1 className="m-0 text-xl font-semibold">Create your first Space</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Chat, tasks, notes, and files for your team—ready in under a minute.
          </p>
        </div>
      </div>
    );
  return (
    <div className="h-full min-h-0 overflow-hidden p-6" aria-busy="true" role="status">
      <span className="sr-only">Loading your Spaces</span>
      <div
        className="grid gap-3.5"
        style={{ gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))" }}
      >
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div className="grid gap-2" key={index}>
            <Skeleton className="aspect-square w-full rounded-lg" />
            <Skeleton className="h-3.5 w-3/4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

const blankTemplateFallback: SpaceTemplate[] = [
  {
    id: "blank",
    name: "Blank Space",
    description: "Start with a clean Space.",
    version: 1,
    recommended_integrations: [],
    seed_summary: { task_count: 0, note_count: 0, collection_count: 0 },
  },
];

const integrationChoices: Array<{
  id: SpaceIntegrationProvider;
  name: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "google", name: "Google Calendar", icon: CalendarDays },
  { id: "discord", name: "Discord", icon: SiDiscord },
  { id: "notion", name: "Notion", icon: FileText },
];

function readLastActiveSpaceId(userId?: string) {
  if (!userId) return "";
  try {
    return window.localStorage.getItem(`misty:last-active-space:${userId}`) ?? "";
  } catch {
    return "";
  }
}

function restoreDocumentInteractivityAfterModalClose(): void {
  if (typeof window === "undefined") return;
  const restore = () => {
    const modalOpen =
      document.querySelector("[data-slot='dialog-content'][data-state='open']") ||
      document.querySelector("[data-slot='alert-dialog-content'][data-state='open']");
    if (!modalOpen && document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
  };
  window.setTimeout(restore, 0);
  window.setTimeout(restore, 250);
}
