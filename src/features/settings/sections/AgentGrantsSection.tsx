import { useCallback, useEffect, useState } from "react";
import {
  grantsApi,
  groupGrants,
  lastUsedText,
  type AgentGrant,
} from "@/features/agents";
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
  const revokeAll = async (agentId: string, agentName: string) => {
    if (
      !(await confirmAction(`Forget every approval you remembered for ${agentName}?`, "Revoke all"))
    )
      return;
    await run(
      agentId,
      () => grantsApi.revokeAll(agentId),
      "Misty couldn’t revoke those approvals.",
    );
  };
  const groups = groupGrants(grants ?? []);
  return (
    <>
      {error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null}
      {grants === null && !error ? (
        <Section title="Remembered approvals">
          <SkeletonList label="Remembered approvals" rows={3} leading="none" trailing />
        </Section>
      ) : null}
      {grants !== null && !groups.length ? (
        <Section
          title="Remembered approvals"
          description="When you choose Accept and remember on an agent’s request, it appears here. Remembered approvals apply only while a chat is in Auto."
        >
          {null}
        </Section>
      ) : null}
      {groups.map((group) => (
        <Section
          key={group.agentId}
          title={group.agentName}
          description="These skip the pause while a chat with this agent is in Auto. Ask always asks."
        >
          {group.grants.map((grant) => (
            <Row key={grant.id} label={grant.label} description={lastUsedText(grant)}>
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
          ))}
          <Row
            label="Revoke all"
            description={`Forget every approval remembered for ${group.agentName}.`}
          >
            <Button
              variant="outline"
              disabled={Boolean(working)}
              onClick={() => void revokeAll(group.agentId, group.agentName)}
            >
              Revoke all
            </Button>
          </Row>
        </Section>
      ))}
    </>
  );
}
