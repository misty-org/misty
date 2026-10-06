import { Monitor } from "lucide-react";
import { useEffect } from "react";
import { deviceStatusLabel, useOptionalConnectedDevices } from "@/features/connected-devices";
import { Button } from "@/shared/ui";
import { useAgentDeviceTargets } from "../store/useAgentDeviceTargets";

/**
 * Which of the person's other devices the agent may also work on
 * (docs/design/devices/BRIEF.md). Only devices whose own policy lets agents in
 * are listed; each pick is signed by this device when a request is sent, and
 * the other device checks it before acting.
 */
export function AgentDeviceTargets() {
  const devices = useOptionalConnectedDevices();
  const { targets, setTargets } = useAgentDeviceTargets();
  const candidates = (devices?.peers ?? []).filter(
    (peer) =>
      !peer.isSelf &&
      peer.policy &&
      (peer.policy.agentSurfaces.includes("folders") ||
        peer.policy.agentSurfaces.includes("browser")),
  );
  // Keep picks current with each device's latest policy; drop removed ones.
  useEffect(() => {
    const next = targets.flatMap((target) => {
      const peer = candidates.find((candidate) => candidate.id === target.deviceId);
      return peer?.policy
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
  return (
    <div className="agent-context-chips" aria-label="Other devices this agent can use">
      {candidates.map((peer) => {
        const picked = targets.some((target) => target.deviceId === peer.id);
        return (
          <Button
            key={peer.id}
            variant={picked ? "outline" : "chip"}
            size="chip"
            aria-pressed={picked}
            title={
              peer.online
                ? `Let the agent use ${peer.name}`
                : `${peer.name} is offline; work there waits until it's back`
            }
            onClick={() =>
              setTargets(
                picked
                  ? targets.filter((target) => target.deviceId !== peer.id)
                  : [
                      ...targets,
                      {
                        deviceId: peer.id,
                        name: peer.name,
                        agentSurfaces: peer.policy?.agentSurfaces ?? [],
                        sharedFolders: peer.policy?.sharedFolders ?? [],
                      },
                    ],
              )
            }
          >
            <Monitor size={13} aria-hidden="true" />
            <strong>{peer.name}</strong>
            {picked ? "Included" : deviceStatusLabel(peer.status)}
          </Button>
        );
      })}
    </div>
  );
}
