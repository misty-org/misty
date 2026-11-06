import { currentApiBase, useServerChoice } from "@/api/deployment/serverChoice";
import { useAuth } from "@/features/auth/authState";
import { openSignInSheet, serverHost, useServerSwitch } from "@/features/auth/serverSetup";
import { Button } from "@/shared/ui";
import { useState } from "react";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";

/**
 * Settings › Server: which Misty server this device uses. The choice is a device setting and
 * never syncs. Changing it opens the setup wizard; leaving a server signs out of it.
 */
export function ServerSection() {
  const { user } = useAuth();
  const choice = useServerChoice((state) => state.choice);
  const { browseOnly } = useServerSwitch();
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const base = choice ? (choice.mode === "server" ? choice.url : "") : currentApiBase();
  const host = base ? serverHost(base) : "";
  const leave = async () => {
    setError("");
    setLeaving(true);
    try {
      await browseOnly();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Misty couldn't leave this server.");
    } finally {
      setLeaving(false);
    }
  };
  return (
    <>
      {error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null}
      <Section
        title="Connection"
        description="Your account, sync, Spaces and agent chats live on a Misty server. This choice stays on this computer."
      >
        <Row
          label="Misty server"
          description={
            host
              ? user
                ? `${host}. Signed in as ${user.email || user.username}.`
                : `${host}. Not signed in.`
              : "None. Misty is the browser only, and nothing is sent to a server."
          }
        >
          <Button variant="outline" size="sm" onClick={() => openSignInSheet("setup")}>
            {host ? "Change" : "Set up"}
          </Button>
        </Row>
        {host ? (
          <Row
            label="Browse only"
            description="Signs out and leaves this server. Your tabs and browsing stay on this computer."
          >
            <Button variant="outline" size="sm" disabled={leaving} onClick={() => void leave()}>
              Leave server
            </Button>
          </Row>
        ) : null}
      </Section>
    </>
  );
}
