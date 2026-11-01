import { openSettings, type SettingsSection } from "@/features/settings";
import { Button, EmptyState } from "@/shared/ui";
import { useEffect, type ReactNode } from "react";
import { InternalPageFrame } from "./InternalPageFrame";

/** The misty:// pages whose content moved into Settings, and where each one leads. */
export const settingsRedirects = {
  extensions: {
    section: "browser-extensions",
    title: "Extensions",
    description:
      "Add extensions from the Chrome Web Store or Firefox Add-ons, and manage them in Settings.",
    action: "Open Extensions settings",
  },
  passwords: {
    section: "passwords",
    title: "Passwords",
    description: "See, add and remove saved sign-ins in Settings.",
    action: "Open Passwords settings",
  },
  settings: {
    section: "general",
    title: "Settings",
    description: "Browser preferences live in Settings.",
    action: "Open Settings",
  },
} as const satisfies Record<
  string,
  { section: SettingsSection; title: string; description: string; action: string }
>;

/** Opens the page's Settings section on arrival, with a button to open it again. */
export function SettingsRedirectPage(props: {
  page: keyof typeof settingsRedirects;
  actions?: ReactNode;
}) {
  const redirect = settingsRedirects[props.page];
  useEffect(() => openSettings(redirect.section), [redirect.section]);
  return (
    <InternalPageFrame title={redirect.title} actions={props.actions}>
      <EmptyState
        title={redirect.title}
        description={redirect.description}
        action={
          <Button variant="primary" onClick={() => openSettings(redirect.section)}>
            {redirect.action}
          </Button>
        }
      />
    </InternalPageFrame>
  );
}
