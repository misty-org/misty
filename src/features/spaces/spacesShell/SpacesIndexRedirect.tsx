import { PanelsTopLeft, Plus, UsersRound } from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { SpacePageLoadingPlaceholder } from "../components/SpacesLoadingPlaceholder";
import type { SpacesShellOutletContext } from "./outletContext";

/**
 * The neutral surface for a blank Spaces tab.
 *
 * Unlike the previous landing redirect, this page intentionally leaves the tab
 * unassigned until someone opens or creates a Space.
 */
export function SpacesIndexRedirect() {
  const { openCreateSpaceDialog } = useOutletContext<SpacesShellOutletContext>();
  const { spaces, loading, error, load } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      loading: state.loading,
      error: state.error,
      load: state.load,
    })),
  );

  if (loading && spaces.length === 0) {
    return <SpacePageLoadingPlaceholder label="Loading your Spaces" />;
  }

  if (error && spaces.length === 0) {
    return (
      <SpacePageLoadingPlaceholder
        label="Loading Spaces"
        onRetry={() => {
          void load({ force: true });
        }}
      />
    );
  }

  if (spaces.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 py-10 text-center">
        <div className="max-w-md">
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-accent text-muted-foreground">
            <PanelsTopLeft size={20} strokeWidth={1.75} />
          </span>
          <h1 className="mb-0 mt-4 text-xl font-semibold">Create your first Space</h1>
          <p className="mb-0 mt-2 text-sm leading-6 text-muted-foreground">
            Bring conversations, plans, notes, and shared files together in one place.
          </p>
          <Button className="mt-5" type="button" onClick={openCreateSpaceDialog}>
            <Plus size={15} />
            Create Space
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background px-6 py-7">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="m-0 text-lg font-semibold">Open a Space</h1>
            <p className="mb-0 mt-1 text-sm text-muted-foreground">
              Choose where you want to work in this tab.
            </p>
          </div>
          <Button type="button" onClick={openCreateSpaceDialog}>
            <Plus size={15} />
            New Space
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {spaces.map((space) => (
            <Link
              key={space.id}
              className="group flex min-h-24 min-w-0 items-center gap-3 rounded-xl border border-border/65 bg-card/35 px-4 py-3 text-foreground no-underline outline-none transition-colors hover:border-border hover:bg-accent/45 focus-visible:ring-2 focus-visible:ring-ring"
              to={`/spaces/${encodeURIComponent(space.id)}/chat`}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-muted-foreground transition-colors group-hover:text-foreground">
                <PanelsTopLeft size={18} strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-sm font-semibold">{space.name}</strong>
                <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UsersRound size={13} strokeWidth={1.75} />
                  {space.member_count} member{space.member_count === 1 ? "" : "s"}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
