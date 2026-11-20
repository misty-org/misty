import { useEffect, type ComponentType } from "react";
import {
  HubAgentsPage,
} from "@/features/agents";
import { ChannelsSection } from "@/features/engine-config/channels";
import { ClisSection } from "@/features/engine-config/clis";
import { EnvironmentSection } from "@/features/engine-config/environment";
import { UsageSection } from "@/features/engine-config/usage";
import { startTour, useTours } from "@/features/onboarding";
import type { SettingsContentProps, SettingsSection } from "@/features/settings";

/**
 * The person's agents, as Settings › Agents › Team. The first time it opens, its tour shows
 * around, as the Agents window's did.
 */
function TeamPage() {
  useEffect(() => {
    const tours = useTours.getState();
    if (tours.loaded && !tours.seen.includes("agents")) startTour("agents");
  }, []);
  return <HubAgentsPage />;
}

/**
 * What was the Agents window, as pages of Settings: the person's agents and the engines' CLIs,
 * channels, environment and usage. The personas, plugins, skills, prompts, connectors and apps
 * are the Agents page's tabs. Each is the one place its subject lives. None reads Settings'
 * own document: each saves as it goes, as it did in the window.
 */
export const agentsSettingsSections: Partial<
  Record<SettingsSection, ComponentType<SettingsContentProps>>
> = {
  "agents-list": TeamPage,
  "engines-clis": () => <ClisSection />,
  "engines-channels": () => <ChannelsSection />,
  "engines-environment": () => <EnvironmentSection />,
  "engines-usage": () => <UsageSection />,
};
