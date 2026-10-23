import { Button, EmptyState } from "@/shared/ui";
import { useEffect, type ReactNode } from "react";
import { InternalPageFrame } from "./InternalPageFrame";

/** The misty:// pages whose content moved into Settings, and where each one leads. */
const redirects = {
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
    section: "browser",
    title: "Browser settings",
    description: "Manage your browser preferences in Settings.",
    action: "Open Browser settings",
  },
} as const;

function openSettings(section: string) {
  window.dispatchEvent(new CustomEvent("misty:open-settings", { detail: { section } }));
}

/** Opens the page's Settings section on arrival, with a button to open it again. */
export function SettingsRedirectPage(props: { page: keyof typeof redirects; actions?: ReactNode }) {
  const redirect = redirects[props.page];
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
