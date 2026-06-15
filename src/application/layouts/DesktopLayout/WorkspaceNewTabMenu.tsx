import { useAuth } from "@/features/auth";
import {
  officialAppIdForNavigator,
  officialAppRoute,
  useInstalledNavigatorAppIds,
} from "@/features/apps";
import {
  preferredDefaultSpace,
  useSpacesStore,
} from "@/features/spaces";
import {
  NAVIGATOR_APP_IDS,
  WORKSPACE_TOOLS_META,
  WorkspaceAppIcon,
  useWorkspaceStore,
  type NavigatorAppId,
  type WorkspaceGroupKey,
  type WorkspaceSurfaceId,
} from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { Plus, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface NewTabOption {
  appId?: NavigatorAppId;
  surfaceId: WorkspaceSurfaceId;
  label: string;
  route: string;
  icon: LucideIcon;
  groupKey?: WorkspaceGroupKey;
  instancePolicy?: "single" | "multiple";
}

export function createNewTabOptions({
  spaceId,
  accountId = "",
}: {
  spaceId?: string;
  accountId?: string;
} = {}): NewTabOption[] {
  return NAVIGATOR_APP_IDS.map((appId) => {
    const app = WORKSPACE_TOOLS_META[appId];
    const route = newTabRoute(appId, spaceId, accountId);
    return {
      appId,
      surfaceId: "official-app" as const,
      label: app.label,
      route,
      icon: app.icon,
      groupKey: `app:${officialAppIdForNavigator(appId)}` as const,
      instancePolicy: "multiple" as const,
    };
  });
}

export const NEW_TAB_OPTIONS: NewTabOption[] = createNewTabOptions();
export const GENERAL_TAB_OPTIONS = NEW_TAB_OPTIONS;

interface Props {
  paneId: string;
  onOpenNewTab: (option: NewTabOption, paneId: string) => void;
}

export function WorkspaceNewTabMenu({ paneId, onOpenNewTab }: Props) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const enabledAppIds = useInstalledNavigatorAppIds();
  const spaces = useSpacesStore((state) => state.spaces);
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const scopedSpaceId = activeScopeKey.startsWith("space:") ? activeScopeKey.slice(6) : "";
  const activeSpaceId =
    spaces.find((space) => space.id === scopedSpaceId)?.id ?? preferredDefaultSpace(spaces)?.id;
  const options = useMemo(() => {
    const optionsById = new Map(
      createNewTabOptions({ spaceId: activeSpaceId, accountId }).map((option) => [
        option.appId,
        option,
      ]),
    );
    const enabledApps = enabledAppIds.flatMap((appId) => {
      const option = optionsById.get(appId);
      return option ? [option] : [];
    });
    return enabledApps;
  }, [accountId, activeSpaceId, enabledAppIds]);

  useEffect(() => {
    const openPicker = (event: Event) => {
      if ((event as CustomEvent<{ paneId?: string }>).detail?.paneId === paneId) setOpen(true);
    };
    window.addEventListener("misty:open-new-tab-picker", openPicker);
    return () => window.removeEventListener("misty:open-new-tab-picker", openPicker);
  }, [paneId]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "grid size-7 place-items-center rounded text-cream-muted outline-none",
            "hover:bg-charcoal-card hover:text-cream focus:outline-none",
            "focus-visible:ring-1 focus-visible:ring-cream-muted",
          )}
          aria-label="New tab"
          title="New tab"
        >
          <Plus size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        className="w-[min(360px,calc(100vw-16px))] p-1.5"
        style={{ maxHeight: "none", overflow: "visible" }}
      >
        <DropdownMenuGroup aria-label="Apps">
          <DropdownMenuLabel className="px-2 pb-1 pt-1 text-[11px]">Apps</DropdownMenuLabel>
          {options.length ? (
            <div className="grid grid-cols-2 gap-0.5">
              {options.map((option) => (
                <NewTabMenuItem
                  key={`${option.surfaceId}:${option.label}`}
                  option={option}
                  onSelect={() => onOpenNewTab(option, paneId)}
                />
              ))}
            </div>
          ) : (
            <p className="px-2 py-4 text-center text-xs text-cream-muted">
              No apps enabled. Add apps from the sidebar.
            </p>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NewTabMenuItem(props: { option: NewTabOption; onSelect: () => void }) {
  const Icon = props.option.icon;
  return (
    <DropdownMenuItem onSelect={props.onSelect} className="h-8 min-w-0 gap-2 px-2 text-[13px]">
      {props.option.appId ? (
        <WorkspaceAppIcon appId={props.option.appId} size="picker" />
      ) : (
        <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.8} />
      )}
      <span className="truncate">{props.option.label}</span>
    </DropdownMenuItem>
  );
}

function newTabRoute(appId: NavigatorAppId, spaceId: string | undefined, accountId: string) {
  return officialAppRoute(officialAppIdForNavigator(appId), spaceId, accountId);
}
