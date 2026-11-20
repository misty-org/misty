import { useMemo, useState } from "react";
import { create } from "zustand";
import { AddAppTile, AppLauncher, AppLogoImage, AppTile } from "@misty/ui";
import { appRoute } from "./appRoutes";
import { appEntry, catalogLogoUrl } from "./thirdPartyApps";
import { useSpaceApps } from "./useSpaceApps";

/** Whether the apps launcher is open; the sidebar's Apps row opens it. */
export const useAppLauncher = create<{ open: boolean; setOpen(open: boolean): void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/**
 * A Space's apps in @misty/ui's AppLauncher: every open-source app a mod added, however many. A
 * search narrows them; an app opens where `onOpen` takes its route, and "Add app" takes a mod to
 * Explore's Apps list.
 */
export function SpaceAppsLauncher(props: {
  spaceId: string;
  isMod: boolean;
  onOpen(route: string): void;
}) {
  const open = useAppLauncher((state) => state.open);
  const setOpen = useAppLauncher((state) => state.setOpen);
  const [query, setQuery] = useState("");
  const { apps } = useSpaceApps(props.spaceId);
  const tiles = useMemo(() => {
    const added = (apps ?? []).map((app) => {
      const entry = appEntry(app);
      return {
        id: app.app_id,
        name: entry?.name ?? app.app_id,
        logo: entry ? catalogLogoUrl(entry) : "",
      };
    });
    const words = query.trim().toLocaleLowerCase();
    return added.filter((tile) => !words || tile.name.toLocaleLowerCase().includes(words));
  }, [apps, query]);
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const launch = (id: string) => {
    close();
    props.onOpen(appRoute(props.spaceId, id));
  };
  const canAdd = props.isMod && !query.trim();
  return (
    <AppLauncher
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      query={query}
      onQueryChange={setQuery}
      onSubmit={() => {
        const first = tiles[0];
        if (first) launch(first.id);
      }}
      empty={!tiles.length && !canAdd}
    >
      {tiles.map((tile) => (
        <AppTile
          key={tile.id}
          mark={<AppLogoImage src={tile.logo || undefined} name={tile.name} size="launcher" />}
          label={tile.name}
          onClick={() => launch(tile.id)}
        />
      ))}
      {canAdd ? (
        <AddAppTile
          onClick={() => {
            close();
            props.onOpen(`/spaces/${encodeURIComponent(props.spaceId)}/explore?tab=apps`);
          }}
        />
      ) : null}
    </AppLauncher>
  );
}
