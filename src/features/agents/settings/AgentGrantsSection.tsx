import { useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { grantsApi, groupGrants, lastUsedText } from "../grants/api";
import { confirmAction } from "@/shared/lib/confirm_action";
import { Button } from "@misty/ui";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as Row,
  DesktopSettingsRowSkeleton,
} from "@/features/settings";

export function AgentGrantsSection() {
  const listing = useCachedResource("agents/grants", () => grantsApi.list(), { persist: "device" });
  const grants = listing.data?.grants ?? null;
  const [working, setWorking] = useState("");
  const [actionError, setError] = useState("");
  const error =
    actionError ||
    (listing.error && !listing.refreshing
      ? "Misty couldn’t load your remembered approvals. Try again later."
      : "");
  const refresh = listing.reload;
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
          <Button variant="quiet" onClick={() => void refresh()}>
            Retry
          </Button>
        }
      >
        {error}
      </DesktopSettingsNotice>
    );
  return (
    <>
      {error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null}
      {listing.loading ? (
        <DesktopSettingsRowSkeleton label="Approvals" rows={3} description control="button" />
      ) : null}
      {grants !== null && !groups.length ? (
        <Row
          label="No remembered approvals"
          description="When you choose Accept and remember on an agent's request, it shows here."
        >
          {null}
        </Row>
      ) : null}
      {groups.flatMap((group) =>
        group.grants.map((grant) => (
          <Row
            key={grant.id}
            label={grant.label}
            description={`For ${group.agentName}, ${lastUsedText(grant).toLowerCase()}`}
          >
            <Button
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
        <Row label="Revoke all">
          <Button disabled={Boolean(working)} onClick={() => void revokeAll()}>
            Revoke all
          </Button>
        </Row>
      ) : null}
    </>
  );
}
