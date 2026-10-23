import { useState } from "react";
import { Laptop, Monitor, MonitorSmartphone } from "lucide-react";
import { SyncModeControl, useSyncModeLabel } from "@/features/browser-sync/SyncModeControl";
import {
  deviceStatusLabel,
  useConnectedDevices,
  type DevicePeer,
} from "@/features/connected-devices";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button } from "@/shared/ui";
import { DesktopSettingsRow as Row } from "../../components/DesktopSettingsUI";
import { SwitchControl, TextControl } from "../../SettingsControls";

const readdNote =
  "Adding it again needs your sync password and secret or another device’s approval.";

function PlatformIcon({ platform }: { platform: string }) {
  const Icon =
    platform === "macos"
      ? Laptop
      : platform === "windows" || platform === "linux"
        ? Monitor
        : MonitorSmartphone;
  return <Icon size={16} aria-hidden="true" className="text-cream-muted" />;
}

function since(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function lastSeen(peer: DevicePeer): string {
  if (peer.isSelf || peer.online) return "Now";
  const seen = new Date(peer.lastSeenAt);
  if (Number.isNaN(seen.getTime())) return "Unknown";
  return seen.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** One device: its name, status and details, and its permissions. Only the
 * device itself can change its permissions; others show them read-only. */
export function DeviceSection({ peer, approvedBy }: { peer: DevicePeer; approvedBy?: string }) {
  const devices = useConnectedDevices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const syncDescription = useSyncModeLabel();
  const policy = peer.isSelf ? (devices.view?.policy ?? peer.policy) : peer.policy;
  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    void action()
      .catch(() => setError("The device could not be updated. Try again."))
      .finally(() => setBusy(false));
  };
  const setPolicy = (change: { clipboard: boolean }) => {
    if (!policy) return;
    run(() =>
      devices.setPolicy({
        // The signed policy still carries files and agent surfaces; keep them as they are.
        // Agents work only on the device a request was sent from, so other devices'
        // surfaces are no longer read.
        files: policy.files,
        clipboard: change.clipboard,
        agentSurfaces: policy.agentSurfaces,
      }),
    );
  };
  const readOnly = `Change this on ${peer.name}.`;
  const added = peer.admittedAt
    ? `Added ${since(peer.admittedAt)}${approvedBy ? ` · approved by ${approvedBy}` : " · with your sync password"}`
    : "Not added yet";

  return (
    <div className="py-2">
      <h3 className="pt-5 text-[15px] font-semibold leading-6 text-cream-bright">{peer.name}</h3>
      <Row label="Status" description={`${added} · Last seen ${lastSeen(peer)}`}>
        <span className="flex items-center gap-2 text-sm text-cream">
          <PlatformIcon platform={peer.platform} />
          {deviceStatusLabel(peer.status)}
        </span>
      </Row>
      <Row label="Name" description="Shown for this device across Misty.">
        <TextControl
          value={peer.name}
          disabled={busy || (!devices.view?.admitted && !peer.isSelf)}
          onCommit={(name) => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== peer.name) run(() => devices.rename(peer.id, trimmed));
          }}
        />
      </Row>
      {peer.isSelf && syncDescription ? (
        <Row label="Full sync" description={syncDescription}>
          <SyncModeControl />
        </Row>
      ) : null}
      <Row
        label="Clipboard"
        description={
          peer.isSelf
            ? "Share what you copy with your other devices, end-to-end encrypted. Clips last a day."
            : readOnly
        }
      >
        {peer.isSelf && policy ? (
          <SwitchControl
            checked={policy.clipboard}
            disabled={busy}
            onChange={(clipboard) => setPolicy({ clipboard })}
          />
        ) : (
          <span className="text-sm text-cream-muted">{policy?.clipboard ? "On" : "Off"}</span>
        )}
      </Row>
      <Row
        label="Remove device"
        description={
          devices.view?.canSign
            ? `${peer.name} loses sync and the shared clipboard. ${readdNote}`
            : "Unlock sync on this device to remove devices."
        }
      >
        <Button
          variant="outline"
          disabled={busy || !devices.view?.canSign}
          onClick={() =>
            void (async () => {
              if (!(await confirmAction(`Remove ${peer.name} from your devices?`, "Remove device")))
                return;
              run(() => devices.remove(peer.id));
            })()
          }
        >
          Remove
        </Button>
      </Row>
      {error ? (
        <p role="alert" className="py-2 text-sm text-cream-muted">
          {error}
        </p>
      ) : null}
    </div>
  );
}
