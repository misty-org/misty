import { useEffect, type ComponentType } from "react";
import { HubAgentsPage } from "@/features/agents";
import { ChannelsSection } from "@/features/engine-config/channels";
import { ClisSection } from "@/features/engine-config/clis";
import { EnvironmentSection } from "@/features/engine-config/environment";
import { UsageSection } from "@/features/engine-config/usage";
import { startTour, useTours } from "@/features/onboarding";
import type { SettingsContentProps, SettingsSection } from "@/features/settings";

function TeamPage() {
  useEffect(() => {
    const tours = useTours.getState();
    if (tours.loaded && !tours.seen.includes("agents")) startTour("agents");
  }, []);
  return <HubAgentsPage />;
}

export const agentsSettingsSections: Partial<
  Record<SettingsSection, ComponentType<SettingsContentProps>>
> = {
  "agents-list": TeamPage,
  "engines-clis": () => <ClisSection />,
  "engines-channels": () => <ChannelsSection />,
  "engines-environment": () => <EnvironmentSection />,
  "engines-usage": () => <UsageSection />,
};
