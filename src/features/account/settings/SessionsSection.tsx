import { useState } from "react";
import { Button, ErrorState, notify } from "@misty/ui";
import { useCachedResource } from "@/api/cache/cached_resource";
import { useNow } from "@/shared/hooks/use_now";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection as Section,
} from "@/features/settings";
import { useAuth } from "../sessions/auth_state";
import { openSignOutSheet } from "../sign-in-sheet/SignOutSheet";
import { deviceSignInApi, sessionsKey, type AccountSession } from "../devices/device_sign_in_api";
import { sessionLine, sessionName, sortSessions } from "../devices/session_lines";

export function SessionsSection() {
  const { user } = useAuth();
  const listing = useCachedResource(
    user ? sessionsKey(user.id) : null,
    deviceSignInApi.sessions,
    { persist: "account" },
  );
  const now = useNow();
  const [signingOut, setSigningOut] = useState("");
  if (!user) return null;
  const sessions = listing.data;

  const signOut = async (session: AccountSession) => {
    if (session.current) return openSignOutSheet();
    setSigningOut(session.id);
    try {
      await deviceSignInApi.signOutSession(session.id);
      listing.set((previous) => (previous ?? []).filter((item) => item.id !== session.id));
    } catch {
      notify({
        message: `${sessionName(session)} couldn't be signed out. Try again.`,
        tone: "error",
      });
    } finally {
      setSigningOut("");
    }
  };

  if (!sessions && !listing.loading && listing.error)
    return (
      <Section title="Sessions">
        <ErrorState
          inline
          title="Sessions couldn't load"
          action={{ label: "Try again", onClick: () => void listing.reload() }}
        />
      </Section>
    );
  if (!sessions)
    return (
      <Section title="Sessions">
        <DesktopSettingsRowSkeleton label="Sessions" rows={2} description control="button" />
      </Section>
    );
  return (
    <Section title="Sessions">
      {sortSessions(sessions).map((session) => (
        <Row
          key={session.id}
          label={sessionName(session)}
          description={sessionLine(session, now) || undefined}
        >
          <Button
            variant="secondary"
            disabled={signingOut === session.id}
            onClick={() => void signOut(session)}
          >
            {session.current ? "Sign out…" : "Sign out"}
          </Button>
        </Row>
      ))}
    </Section>
  );
}
