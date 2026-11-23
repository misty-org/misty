import { currentApiBase, useServerChoice } from "@/api/deployment/server_choice";
import { useAuth } from "../sessions/auth_state";
import { openSignInSheet, serverHost } from "../setup/server_setup";
import { Button } from "@misty/ui";
import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";

export function ServerSection() {
  const { user } = useAuth();
  const choice = useServerChoice((state) => state.choice);
  const base = choice ? (choice.mode === "server" ? choice.url : "") : currentApiBase();
  const host = base ? serverHost(base) : "";
  return (
    <Section
      title="Connection"
      description="Your account and Spaces live on a Misty server. This choice stays on this computer."
    >
      <Row
        label="Misty server"
        description={
          host
            ? user
              ? `${host}. Signed in as ${user.email || user.username}.`
              : `${host}. Not signed in.`
            : "None chosen yet."
        }
      >
        <Button variant="secondary" onClick={() => openSignInSheet("setup")}>
          {host ? "Change" : "Set up"}
        </Button>
      </Row>
    </Section>
  );
}
