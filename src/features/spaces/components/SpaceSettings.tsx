import { DesktopSettingsFrame, type DesktopSettingsNavEntry } from "@/features/settings/desktop";
import { SpaceMembers } from "@/features/spaces/members";
import { SkeletonList, WorkspaceOverlay } from "@/shared/ui";
import { Plug, Settings, UsersRound } from "lucide-react";
import { SpaceSettingsApps } from "./SpaceSettingsApps";
import { SpaceSettingsDangerDialogs } from "./SpaceSettingsDangerDialogs";
import { SpaceSettingsGeneral } from "./SpaceSettingsGeneral";
import { useSpaceSettingsController } from "./useSpaceSettingsController";
type SpaceSettingsSection = "general" | "members" | "apps";
const settingsItems: readonly DesktopSettingsNavEntry<SpaceSettingsSection>[] = [
  {
    id: "general",
    label: "General",
    icon: Settings,
  },
  {
    id: "members",
    label: "Members",
    icon: UsersRound,
  },
  {
    id: "apps",
    label: "Apps",
    icon: Plug,
  },
];
export function SpaceSettings({ spaceId, section }: { spaceId: string; section: string }) {
  const activeSection = isSpaceSettingsSection(section) ? section : "general";
  const settings = useSpaceSettingsController(spaceId);
  const { space, dismissSettings, navigateToSection } = settings;
  if (!space)
    return (
      <div className="flex h-full min-h-0 overflow-hidden">
        <div className="h-full w-56 shrink-0 border-r border-charcoal-border p-3">
          <SkeletonList label="Settings sections" rows={6} leading="icon" lines={1} />
        </div>
        <div className="min-w-0 flex-1 p-8">
          <SkeletonList
            label="Space settings"
            rows={5}
            leading="none"
            trailing
            className="max-w-3xl"
          />
        </div>
      </div>
    );
  return (
    <WorkspaceOverlay open ariaLabel={`${space.name} settings`} onClose={dismissSettings}>
      <>
        <DesktopSettingsFrame
          activeId={activeSection}
          ariaLabel={`${space.name} settings`}
          items={settingsItems}
          navigationLabel="Space settings sections"
          onClose={dismissSettings}
          onSelect={navigateToSection}
          presentation="overlay"
          title={settingsItems.find((item) => item.id === activeSection)?.label ?? "General"}
        >
          {activeSection === "general" ? (
            <SpaceSettingsGeneral spaceId={spaceId} space={space} controller={settings} />
          ) : null}

          {activeSection === "members" ? <SpaceMembers embedded spaceId={spaceId} /> : null}

          {activeSection === "apps" ? (
            <SpaceSettingsApps spaceId={spaceId} spaceName={space.name} />
          ) : null}
        </DesktopSettingsFrame>

        <SpaceSettingsDangerDialogs spaceName={space.name} controller={settings} />
      </>
    </WorkspaceOverlay>
  );
}
function isSpaceSettingsSection(value: string): value is SpaceSettingsSection {
  return settingsItems.some((item) => item.id === value);
}
