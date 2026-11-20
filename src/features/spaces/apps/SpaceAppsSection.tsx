import { useNavigate } from "react-router-dom";
import { AddAppTile, AppLogoImage, AppTile, homeAppsClass, officialApps } from "@misty/ui";
import { useTasksDueCount } from "../home/useTasksDue";
import { appRoute, officialAppRoute } from "./appRoutes";
import { catalogApps, catalogLogoUrl } from "./thirdPartyApps";
import { useSpaceApps } from "./useSpaceApps";

/**
 * The Space home's apps: Misty's own, built into every Space, one tile each in the order the directory
 * lists them. Each installed app opens from its tile; "Add app" takes a mod to Explore's Apps list.
 */
export function SpaceAppsSection({ spaceId, isMod }: { spaceId: string; isMod: boolean }) {
  const navigate = useNavigate();
  const plannerDue = useTasksDueCount(spaceId);
  const { apps } = useSpaceApps(spaceId);
  // What a mod added from the directory, after Misty's own; a maker's own logo shows once its bundle is here, until then its initial.
  const added = (apps ?? []).filter(
    (app) => !officialApps.some((official) => official.id === app.app_id),
  );

  return (
    <section aria-label="Apps">
      <div className={homeAppsClass}>
        {officialApps.map((app) => (
          <AppTile
            key={app.id}
            app={app.id}
            label={app.name}
            badge={app.id === "planner" ? plannerDue : undefined}
            onClick={() => navigate(officialAppRoute(spaceId, app.id))}
          />
        ))}
        {added.map((app) => {
          const entry = catalogApps.find((candidate) => candidate.id === app.app_id);
          const name = entry?.name ?? app.app_id;
          return (
            <AppTile
              key={app.app_id}
              mark={
                <AppLogoImage src={entry && catalogLogoUrl(entry)} name={name} size="launcher" />
              }
              label={name}
              onClick={() => navigate(appRoute(spaceId, app.app_id))}
            />
          );
        })}
        {isMod ? (
          <AddAppTile
            onClick={() => navigate(`/spaces/${encodeURIComponent(spaceId)}/explore?tab=apps`)}
          />
        ) : null}
      </div>
    </section>
  );
}
