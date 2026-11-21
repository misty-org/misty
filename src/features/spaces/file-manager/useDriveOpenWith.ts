import { useNavigate } from "react-router-dom";
import { appRoute } from "../apps/appRoutes";
import { acceptsFile } from "../apps/spaceAppFiles";
import { appEntry, catalogLogoUrl, runsHere } from "../apps/thirdPartyApps";
import { useSpaceApps } from "../apps/useSpaceApps";
import { mimeFromName, type DriveEntry } from "../drive";

/** An added app that opens a drive file, as Open with lists it. */
export interface DriveOpenApp {
  id: string;
  name: string;
  logo: string;
}

/**
 * Open with for a Space drive's files: the apps added to that Space that say they open the file's kind,
 * and opening it in one (`/spaces/<id>/app/<appId>?file=<item id>`), as the Space's own Files does.
 */
export function useDriveOpenWith(spaceId: string | undefined) {
  const navigate = useNavigate();
  const { apps } = useSpaceApps(spaceId ?? "");

  const appsFor = (entry: DriveEntry): DriveOpenApp[] => {
    const mime = mimeFromName(entry.name);
    return (apps ?? []).flatMap((app) => {
      const catalog = appEntry(app);
      if (!catalog || !runsHere(catalog)) return [];
      const declared: unknown = catalog.manifest.opens;
      const opens = Array.isArray(declared)
        ? declared.filter((kind): kind is string => typeof kind === "string")
        : [];
      // An app that names no kinds opens none from Files: it hasn't said what it reads.
      if (!opens.length || !acceptsFile(opens, mime, entry.name)) return [];
      return [{ id: app.app_id, name: catalog.name, logo: catalogLogoUrl(catalog) }];
    });
  };

  const openIn = (entry: DriveEntry, appId: string) =>
    navigate(`${appRoute(entry.space_id, appId)}?file=${encodeURIComponent(entry.id)}`);

  return { appsFor, openIn };
}
