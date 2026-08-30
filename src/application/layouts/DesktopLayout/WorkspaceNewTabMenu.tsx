import { routes } from "@/features/app-shell";
import { useAuth } from "@/features/auth";
import {
  preferredMistySpace,
  rememberedJournalRoute,
  rememberedPlannerRoute,
  socialProviderPath,
  useSpacesStore,
} from "@/features/spaces";
import {
  NAVIGATOR_APP_IDS,
  WORKSPACE_TOOLS_META,
  WorkspaceAppIcon,
  navigatorAppIdsForAccount,
  useNavigatorAppsStore,
  useWorkspaceStore,
  type NavigatorAppId,
  type WorkspaceSurfaceId,
} from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/shared/ui";
import { Plus, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface NewTabOption {
  appId: NavigatorAppId;
  surfaceId: WorkspaceSurfaceId;
  label: string;
  route: string;
  icon: LucideIcon;
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
    return {
      appId,
      surfaceId: app.surfaceId,
      label: app.label,
      route: newTabRoute(appId, spaceId, accountId),
      icon: app.icon,
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
  const enabledAppIds = useNavigatorAppsStore((state) =>
    navigatorAppIdsForAccount(state, accountId),
  );
  const spaces = useSpacesStore((state) => state.spaces);
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const scopedSpaceId = activeScopeKey.startsWith("space:") ? activeScopeKey.slice(6) : "";
  const activeSpaceId =
    spaces.find((space) => space.id === scopedSpaceId)?.id ?? preferredMistySpace(spaces)?.id;
  const options = useMemo(() => {
    const optionsById = new Map(
      createNewTabOptions({ spaceId: activeSpaceId, accountId }).map((option) => [
        option.appId,
        option,
      ]),
    );
    return enabledAppIds.flatMap((appId) => {
      const option = optionsById.get(appId);
      return option ? [option] : [];
    });
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
          className="grid size-7 place-items-center rounded text-cream-muted outline-none hover:bg-charcoal-card hover:text-cream focus:outline-none"
          aria-label="New tab"
          title="New tab"
        >
          <Plus size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
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
  return (
    <DropdownMenuItem onSelect={props.onSelect} className="h-8 min-w-0 gap-2 px-2 text-[13px]">
      <WorkspaceAppIcon appId={props.option.appId} size="picker" />
      <span className="truncate">{props.option.label}</span>
    </DropdownMenuItem>
  );
}

function newTabRoute(appId: NavigatorAppId, spaceId: string | undefined, accountId: string) {
  if (appId === "social") return spaceId ? socialProviderPath(spaceId, "misty") : routes.spaces;
  if (appId === "journal")
    return spaceId ? rememberedJournalRoute(accountId, spaceId) : routes.spaces;
  if (appId === "planner")
    return spaceId ? rememberedPlannerRoute(accountId, spaceId) : routes.spaces;
  if (appId === "library")
    return spaceId ? `/spaces/${encodeURIComponent(spaceId)}/library` : routes.spaces;
  return routes[appId];
}
