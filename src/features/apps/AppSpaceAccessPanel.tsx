import { useState } from "react";
import { type OfficialApp } from "@/api/apps";
import { useSpacesStore } from "@/features/spaces/core";
import { useAppsStore, canManageSpaceApps } from "./useAppsStore";
export type SpaceAccessChange = { spaceId: string; enabled: boolean };

export function AppSpaceAccessPanel({
  app,
  onSelect,
}: {
  app: OfficialApp;
  onSelect: (changes: SpaceAccessChange[]) => void;
}) {
  const spaces = useSpacesStore((state) => state.spaces);
  const bySpace = useAppsStore((state) => state.bySpace);
  const errors = useAppsStore((state) => state.bySpaceErrors);
  const prefetch = useAppsStore((state) => state.prefetchSpaceAccess);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const failed = spaces
    .filter((space) => !bySpace[space.id] && errors[space.id])
    .map((space) => space.id);
  const loading = spaces.some((space) => !bySpace[space.id] && !errors[space.id]);
  const added = Object.fromEntries(
    spaces.flatMap((space) => {
      const installations = bySpace[space.id];
      if (!installations) return [];
      const installation = installations.find((item) => item.app_id === app.id);
      return [[space.id, installation?.state === "installed"]];
    }),
  );
  const changes = spaces
    .filter(
      (space) =>
        space.id in selected && space.id in added && selected[space.id] !== added[space.id],
    )
    .map((space) => ({ spaceId: space.id, enabled: selected[space.id] }));
  const error = failed.length
    ? "Some Spaces could not be loaded. You can still choose the others."
    : "";
  return (
    <>
      <h3 className="discover-space-picker-title">Add to spaces</h3>
      {loading ? (
        <p role="status">Loading Spaces…</p>
      ) : (
        <ul className="discover-space-list">
          {spaces.map((space) => (
            <li key={space.id}>
              <label>
                <span>
                  <strong>{space.name}</strong>
                  {!canManageSpaceApps(space.id) && <small>A Space manager controls access</small>}
                </span>
                {failed.includes(space.id) ? (
                  <small>Could not load</small>
                ) : (
                  <input
                    type="checkbox"
                    aria-label={space.name}
                    disabled={!(space.id in added) || !canManageSpaceApps(space.id)}
                    checked={selected[space.id] ?? added[space.id] ?? false}
                    onChange={(event) =>
                      setSelected((current) => ({ ...current, [space.id]: event.target.checked }))
                    }
                  />
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
      {!loading && !spaces.length && <p>Join or create a Space to use this app.</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => void prefetch(true)}>
            Retry
          </button>
        </p>
      )}
      <div className="discover-space-picker-actions">
        <button
          type="button"
          className="discover-action discover-action-primary"
          disabled={loading || !changes.length}
          onClick={() => onSelect(changes)}
        >
          Save
        </button>
      </div>
    </>
  );
}
