import { AppWindowMac, PackagePlus, Trash2 } from "lucide-react";
import {
  installSiteApp,
  launchSiteApp,
  uninstallSiteApp,
  useSiteApps,
} from "@/features/bookmarks/siteApps";
import { SavedWebsiteIcon } from "@/features/browser-workspace/SavedWebsiteIcon";
import { DropdownMenuSeparator, MenuItem, MenuSubmenu } from "@/shared/ui";

function showActiveWindow() {
  window.dispatchEvent(new Event("misty:workspace-projection-applied"));
}

/** Install this site as an app, or open an installed app in its own window. */
export function SiteAppsMenu(props: {
  url: string;
  title: string;
  /** The app this tab was opened as, if any. */
  bookmarkId?: string;
  /** Private and non-web pages can't be installed. */
  installable: boolean;
}) {
  const apps = useSiteApps();
  const current = apps.find((app) => app.id === props.bookmarkId);
  return (
    <MenuSubmenu icon={<AppWindowMac />} label="Apps" width="md">
      {current ? (
        <MenuItem
          icon={<Trash2 />}
          label={`Uninstall ${current.title}`}
          onSelect={() => uninstallSiteApp(current.id)}
        />
      ) : (
        <MenuItem
          icon={<PackagePlus />}
          label="Install this site as an app"
          disabled={!props.installable}
          onSelect={() => {
            const name = props.title.trim() || new URL(props.url).hostname;
            const id = installSiteApp(props.url, name);
            const app = { id, title: name, url: props.url, folderId: "", order: 0 };
            launchSiteApp(app);
            showActiveWindow();
          }}
        />
      )}
      {apps.length ? <DropdownMenuSeparator /> : null}
      {apps.map((app) => (
        <MenuItem
          key={app.id}
          icon={<SavedWebsiteIcon url={app.url} />}
          label={app.title}
          onSelect={() => {
            launchSiteApp(app);
            showActiveWindow();
          }}
        />
      ))}
    </MenuSubmenu>
  );
}
