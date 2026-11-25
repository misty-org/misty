import type { MarkRender } from "@misty/ui";
import { useNavigate } from "react-router-dom";
import { appRoute } from "../apps/app_routes";
import { acceptsFile } from "../apps/space_app_files";
import { appEntry, catalogLogoUrl, runsHere } from "../apps/third_party_apps";
import { useInstalledApps } from "../apps/use_installed_apps";
import { mimeFromName, type DriveEntry } from "../drive";

export interface DriveOpenApp {
  id: string;
  name: string;
  logo: string;
  render?: MarkRender;
}

export function useDriveOpenWith() {
  const navigate = useNavigate();
  const { apps } = useInstalledApps();

  const appsFor = (entry: DriveEntry): DriveOpenApp[] => {
    const mime = mimeFromName(entry.name);
    return (apps ?? []).flatMap((app) => {
      const catalog = appEntry(app);
      if (!catalog || !runsHere(catalog)) return [];
      const declared: unknown = catalog.manifest.opens;
      const opens = Array.isArray(declared)
        ? declared.filter((kind): kind is string => typeof kind === "string")
        : [];
      if (!opens.length || !acceptsFile(opens, mime, entry.name)) return [];
      return [
        {
          id: app.app_id,
          name: catalog.name,
          logo: catalogLogoUrl(catalog),
          render: catalog.icon_render,
        },
      ];
    });
  };

  const openIn = (entry: DriveEntry, appId: string) =>
    navigate(`${appRoute(entry.space_id, appId)}?file=${encodeURIComponent(entry.id)}`);

  return { appsFor, openIn };
}
