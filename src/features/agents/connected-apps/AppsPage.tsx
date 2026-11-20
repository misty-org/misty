import { DesktopSettingsSection as Section } from "@/features/settings";
import { EngineConnectors } from "../marketplace/EngineConnectors";
import { DirectApps } from "./DirectApps";

/**
 * Explore › Connected apps: the apps agents sign in to, in two settings panels. First what Claude
 * Code already reaches under the person's own sign-in, then the apps whose makers run their own
 * sign-in, which Misty connects directly. Any other app is used through its web page.
 */
export function AppsPage() {
  return (
    <>
      <EngineConnectors />
      <Section title="Connect an app">
        <DirectApps />
      </Section>
    </>
  );
}
