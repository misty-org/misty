import { Plus } from "lucide-react";
import type { WorkspaceView } from "@/features/app-windows";
import { newWebTabRoute } from "@/features/browser";
import { useShortcutLabel } from "@/features/shortcuts";
import { useAppLauncher, useWindowSpace } from "@/features/spaces";
import { DropdownMenu, DropdownMenuContent, MenuItem, MenuTrigger, spaceIcons } from "@misty/ui";
import { openNewTab, openWorkspaceRouteIn } from "./space_navigation";

const filesRoute = "/agents?view=files";

export function NewTabMenu(props: { onOpen(view: WorkspaceView): void }) {
  const space = useWindowSpace();
  const chatKeys = useShortcutLabel("workspace.new_tab");
  const browserKeys = useShortcutLabel("app.open_browser");
  const filesKeys = useShortcutLabel("app.open_files");
  const appsKeys = useShortcutLabel("app.open_apps");
  const exploreKeys = useShortcutLabel("app.open_explore");
  const open = (route: string) => openWorkspaceRouteIn(route, "tab", props.onOpen);

  return (
    <DropdownMenu>
      <MenuTrigger label="New tab" icon={Plus} iconOnly />
      <DropdownMenuContent align="start">
        <MenuItem
          icon={spaceIcons.chat}
          label="Chat"
          shortcut={chatKeys}
          onSelect={() => openNewTab(props.onOpen)}
        />
        <MenuItem
          icon={spaceIcons.browser}
          label="Browser"
          shortcut={browserKeys}
          onSelect={() => open(newWebTabRoute())}
        />
        {space ? (
          <>
            <MenuItem
              icon={spaceIcons.files}
              label="Files"
              shortcut={filesKeys}
              onSelect={() => open(filesRoute)}
            />
            <MenuItem
              icon={spaceIcons.apps}
              label="Apps"
              shortcut={appsKeys}
              onSelect={() => useAppLauncher.getState().setOpen(true)}
            />
            <MenuItem
              icon={spaceIcons.explore}
              label="Explore"
              shortcut={exploreKeys}
              onSelect={() => open(`/spaces/${encodeURIComponent(space.id)}/explore`)}
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
