import { Monitor } from "lucide-react";
import { useEffect } from "react";
import { deviceStatusLabel, useOptionalConnectedDevices } from "@/features/connected-devices";
import { Button } from "@/shared/ui";
import { useAgentDeviceTargets } from "../store/useAgentDeviceTargets";

const staleAfterMs = 7 * 24 * 3600 * 1000;

/**
 * Which device the agent works on (docs/design/agents-on-devices/BRIEF.md):
 * this computer, or one of the person's other devices whose own policy lets
 * agents in. Offline devices are shown but can't be picked. The pick is signed
 * by this device when a request is sent, and the other device checks it
 * before opening anything.
 */
export function AgentDeviceTargets() {
  const devices = useOptionalConnectedDevices();
  const { targets, setTargets } = useAgentDeviceTargets();
  const candidates = (devices?.peers ?? []).filter(
    (peer) =>
      !peer.isSelf &&
      // An install unseen for a week (an old build, a wiped Mac) is not offered;
      // Settings › Devices still lists it for removal.
      (peer.online || Date.now() - Date.parse(peer.lastSeenAt) < staleAfterMs) &&
      peer.policy &&
      (peer.policy.agentSurfaces.includes("folders") ||
        peer.policy.agentSurfaces.includes("browser")),
  );
  // Keep the pick current with its device's latest policy; drop it when the
  // device is removed or goes offline.
  useEffect(() => {
    const next = targets.flatMap((target) => {
      const peer = candidates.find((candidate) => candidate.id === target.deviceId);
      return peer?.policy && peer.online
        ? [
            {
              deviceId: peer.id,
              name: peer.name,
              agentSurfaces: peer.policy.agentSurfaces,
              sharedFolders: peer.policy.sharedFolders,
            },
          ]
        : [];
    });
    if (JSON.stringify(next) !== JSON.stringify(targets)) setTargets(next);
  }, [candidates, targets, setTargets]);

  if (!devices?.view?.admitted || candidates.length === 0) return null;
  const picked = targets[0]?.deviceId;
  return (
    <div className="agent-context-chips" role="group" aria-label="Where the agent works">
      <Button
        variant="chip"
        size="chip"
        aria-pressed={!picked}
        title="The agent works on this computer"
        onClick={() => setTargets([])}
      >
        <Monitor size={13} aria-hidden="true" />
        <strong>This computer</strong>
      </Button>
      {candidates.map((peer) => (
        <Button
          key={peer.id}
          variant="chip"
          size="chip"
          aria-pressed={picked === peer.id}
          disabled={!peer.online}
          title={peer.online ? `The agent works on ${peer.name}` : `${peer.name} is offline`}
          onClick={() =>
            setTargets([
              {
                deviceId: peer.id,
                name: peer.name,
                agentSurfaces: peer.policy?.agentSurfaces ?? [],
                sharedFolders: peer.policy?.sharedFolders ?? [],
              },
            ])
          }
        >
          <Monitor size={13} aria-hidden="true" />
          <strong>{peer.name}</strong>
          {peer.online ? null : deviceStatusLabel(peer.status)}
        </Button>
      ))}
    </div>
  );
}
