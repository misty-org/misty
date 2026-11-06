import { useCallback, useEffect, useState } from "react";
import { Button, Input, SkeletonList } from "@/shared/ui";
import { vaultNative, type VaultSession } from "@/features/vault";
import {
  DesktopSettingsNotice as Notice,
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../../components/DesktopSettingsUI";

function lastSeen(session: VaultSession): string {
  const at = session.last_seen_at ?? session.created_at;
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ""
    : `Last seen ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** Everywhere this account's vault is open. Removing one stops it at once, for good. */
export function SyncSessions(props: { thisSession: string; connected: boolean }) {
  const [sessions, setSessions] = useState<VaultSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    void vaultNative
      .sessions()
      .then((listed) => {
        setSessions(listed.filter((session) => !session.revoked_at));
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load, props.connected]);

  const act = (work: Promise<void>) => {
    setError("");
    void work
      .then(load)
      .catch((cause: unknown) =>
        setError(typeof cause === "string" ? cause : "That didn't work. Try again."),
      );
  };

  if (!sessions && failed) return null;
  if (!sessions)
    return (
      <Section title="Signed-in sessions">
        <SkeletonList label="Signed-in sessions" rows={2} leading="none" trailing />
      </Section>
    );
  return (
    <Section title="Signed-in sessions">
      {error ? <Notice>{error}</Notice> : null}
      {sessions.map((session) => {
        const here = session.session_id === props.thisSession;
        const name = session.name || "Unnamed computer";
        if (renaming?.id === session.session_id)
          return (
            <Row key={session.session_id} label={name}>
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  act(vaultNative.renameSession(renaming.id, renaming.name));
                  setRenaming(null);
                }}
              >
                <Input
                  aria-label="Name"
                  autoFocus
                  value={renaming.name}
                  maxLength={60}
                  onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
                />
                <Button type="submit" variant="secondary" disabled={!renaming.name.trim()}>
                  Save
                </Button>
                <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
              </form>
            </Row>
          );
        return (
          <Row
            key={session.session_id}
            label={here ? `${name} (this computer)` : name}
            description={here ? undefined : lastSeen(session)}
          >
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setRenaming({ id: session.session_id, name: session.name })}
              >
                Rename
              </Button>
              {here ? null : (
                <Button
                  variant="secondary"
                  onClick={() => act(vaultNative.removeSession(session.session_id))}
                >
                  Remove
                </Button>
              )}
            </div>
          </Row>
        );
      })}
    </Section>
  );
}
