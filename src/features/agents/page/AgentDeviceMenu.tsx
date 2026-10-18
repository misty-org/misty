import { Check, Laptop, Plus } from "lucide-react";
import { useEffect } from "react";
import { deviceStatusLabel, useOptionalConnectedDevices } from "@/features/connected-devices";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MenuTrigger,
} from "@/shared/ui";
import { useAgentDeviceTargets } from "../store/useAgentDeviceTargets";

const staleAfterMs = 7 * 24 * 3600 * 1000;

/**
 * Which device the agent works on (docs/design/agents-on-devices/BRIEF.md): this computer,
 * or one of the person's other devices whose own policy lets agents in. Offline devices are
 * shown but can't be picked. The pick is signed by this device when a request is sent, and
 * the other device checks it before opening anything. Desktop only.
 */
export function AgentDeviceMenu({ disabled }: { disabled?: boolean }) {
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
  if (!hasTauriInternals()) return null;
  const picked = targets[0]?.deviceId;
  const name = targets[0]?.name ?? "This computer";
  return (
    <DropdownMenu>
      <MenuTrigger
        label="Device"
        title={`The agent works on ${picked ? name : "this computer"}`}
        icon={<Laptop aria-hidden className="size-4 shrink-0" />}
        value={name}
        chevron={false}
        disabled={disabled}
        className="agent-strip-chip"
      />
      <DropdownMenuContent align="start" className="w-64" data-misty-layer-portal>
        <DropdownMenuItem onSelect={() => setTargets([])}>
          <Laptop aria-hidden />
          <span className="min-w-0 flex-1 truncate">This computer</span>
          {!picked && <Check aria-label="Selected" />}
        </DropdownMenuItem>
        {candidates.map((peer) => (
          <DropdownMenuItem
            key={peer.id}
            disabled={!peer.online}
            onSelect={() =>
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
            <Laptop aria-hidden />
            <span className="min-w-0 flex-1 truncate">{peer.name}</span>
            {picked === peer.id ? (
              <Check aria-label="Selected" />
            ) : (
              !peer.online && (
                <span className="text-xs text-cream-muted">{deviceStatusLabel(peer.status)}</span>
              )
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            window.dispatchEvent(
              new CustomEvent("misty:open-settings", { detail: { section: "devices" } }),
            )
          }
        >
          <Plus aria-hidden />
          Add a device
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
