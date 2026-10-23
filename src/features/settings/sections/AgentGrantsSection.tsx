import { useCallback, useEffect, useState } from "react";
import { grantsApi, groupGrants, lastUsedText, type AgentGrant } from "@/features/agents";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, SkeletonList } from "@/shared/ui";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";

/**
 * Approvals you remembered, grouped by agent. Each lets one agent skip the pause
 * for one action on one of your resources while a chat is in Auto; Ask always
 * asks. Revoking applies to the agent's next action.
 */
export function AgentGrantsSection() {
  const [grants, setGrants] = useState<AgentGrant[] | null>(null);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(
    () =>
      grantsApi
        .list()
        .then((result) => setGrants(result.grants))
        .catch(() => setError("Misty couldn’t load your remembered approvals. Try again later.")),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const run = async (key: string, operation: () => Promise<unknown>, failure: string) => {
    if (working) return;
    setWorking(key);
    setError("");
    try {
      await operation();
      await refresh();
    } catch {
      setError(failure);
    } finally {
      setWorking("");
    }
  };
  const groups = groupGrants(grants ?? []);
  const revokeAll = async () => {
    if (!(await confirmAction("Forget every approval you remembered for any agent?", "Revoke all")))
      return;
    await run(
      "all",
      () => Promise.all(groups.map((group) => grantsApi.revokeAll(group.agentId))),
      "Misty couldn’t revoke those approvals.",
    );
  };
  if (error && grants === null)
    return (
      <DesktopSettingsNotice
        action={
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        }
      >
        {error}
      </DesktopSettingsNotice>
    );
  if (grants !== null && !groups.length) return null;
  return (
    <>
      {error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null}
      <Section
        title="Remembered approvals"
        description="When you choose Accept and remember on an agent’s request, it appears here and skips the pause while a chat is in Auto. Ask always asks."
      >
        {grants === null && !error ? (
          <SkeletonList label="Remembered approvals" rows={3} leading="none" trailing />
        ) : null}
        {groups.flatMap((group) =>
          group.grants.map((grant) => (
            <Row
              key={grant.id}
              label={grant.label}
              description={`${group.agentName} · ${lastUsedText(grant)}`}
            >
              <Button
                variant="outline"
                disabled={Boolean(working)}
                onClick={() =>
                  void run(
                    grant.id,
                    () => grantsApi.revoke(grant.id),
                    "Misty couldn’t revoke that approval.",
                  )
                }
              >
                Revoke
              </Button>
            </Row>
          )),
        )}
        {(grants?.length ?? 0) > 1 ? (
          <Row label="Revoke all" description="Forget every remembered approval for every agent.">
            <Button variant="outline" disabled={Boolean(working)} onClick={() => void revokeAll()}>
              Revoke all
            </Button>
          </Row>
        ) : null}
      </Section>
    </>
  );
}
