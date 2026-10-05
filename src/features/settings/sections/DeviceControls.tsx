import {
  ConnectedDevicePairingDialog,
  deviceLink,
  peerIsOnline,
  sessionRemainingLabel,
  useConnectedDevices,
  type ServerConnectedPeer,
} from "@/features/connected-devices";
import { Button } from "@/shared/ui";
import { Fragment, useState } from "react";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { useSettingsProfiles } from "../profiles/store";
import { ChoiceControl, SwitchControl } from "../SettingsControls";
import { useSettingsStore } from "../store/useSettingsStore";

const sessionLengths = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

/** Paired devices: their sessions, and what each may do on this device. */
export function DeviceControls() {
  const devices = useConnectedDevices();
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState("");
  const store = useSettingsStore();
  const ready = useSettingsProfiles((s) => s.ready);
  const files = store.settings?.document.files as Record<string, unknown> | undefined;
  const sessionDays = String(files?.device_session_days ?? "30");
  const act = (action: () => Promise<unknown>) =>
    void action().then(
      () => setError(""),
      (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
    );

  return (
    <>
      <Section title="Sessions">
        <Row
          label="Keep devices connected for"
          description="After you connect a device, it reconnects on this network by itself until this ends. Then connect it again."
        >
          <ChoiceControl
            value={sessionDays}
            disabled={store.working || !ready}
            options={sessionLengths}
            onValueChange={(value) =>
              void store.updateSetting("files", "device_session_days", value)
            }
          />
        </Row>
      </Section>
      <Section title="Paired devices">
        <div className="flex gap-2 p-4">
          <Button variant="outline" onClick={() => setPairing(true)}>
            Pair device
          </Button>
          <Button variant="ghost" onClick={() => act(() => devices.refresh())}>
            Refresh
          </Button>
        </div>
        {devices.peers.map((peer) => (
          <Fragment key={peer.pairId}>
            <PeerSessionRow peer={peer} devices={devices} act={act} />
            <Row
              indent
              label="Allow changes to this device"
              description="Lets it create, rename, move and delete files on this device."
            >
              <SwitchControl
                checked={peer.filesAcceptWrites}
                disabled={!devices.ready}
                onChange={(enabled) => act(() => devices.setFileWrites(peer, enabled))}
              />
            </Row>
            <Row
              indent
              label="Share clipboard"
              description="Copying on either device makes it available on the other. Both devices need this on."
            >
              <SwitchControl
                checked={peer.clipboardCanSend}
                disabled={!devices.ready}
                onChange={(enabled) => act(() => devices.setClipboardConsent(peer, enabled))}
              />
            </Row>
          </Fragment>
        ))}
        {!devices.peers.length && (
          <p className="p-5 text-sm text-cream-muted">No devices paired for file sharing.</p>
        )}
        {(error || devices.error) && (
          <p role="alert" className="p-5 text-sm text-cream-muted">
            {error || devices.error}
          </p>
        )}
        <ConnectedDevicePairingDialog
          controller={devices}
          open={pairing}
          onOpenChange={setPairing}
        />
      </Section>
    </>
  );
}

function PeerSessionRow(props: {
  peer: ServerConnectedPeer;
  devices: ReturnType<typeof useConnectedDevices>;
  act: (action: () => Promise<unknown>) => void;
}) {
  const { peer, devices, act } = props;
  const link = deviceLink(peer, devices.snapshot);
  const access = peer.filesCanWrite ? "You can change its files" : "You can view its files";
  const status =
    link.state === "connected"
      ? `Connected, ${sessionRemainingLabel(link.expiresAt)}`
      : link.state === "reconnecting"
        ? `Reconnecting, ${sessionRemainingLabel(link.expiresAt)}`
        : link.state === "ended"
          ? "Session ended"
          : peerIsOnline(peer)
            ? "Connecting"
            : "Offline";
  const sessionActive = link.state === "connected" || link.state === "reconnecting";
  return (
    <Row label={peer.name} description={`${status} · ${access}`}>
      <div className="flex justify-end gap-2">
        {sessionActive ? (
          <Button variant="outline" onClick={() => act(() => devices.endSession(peer))}>
            Disconnect
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={!peerIsOnline(peer) || !devices.ready}
            onClick={() => act(() => devices.connectPeer(peer))}
          >
            Connect
          </Button>
        )}
        <Button variant="ghost" onClick={() => act(() => devices.unpair(peer))}>
          Unpair
        </Button>
      </div>
    </Row>
  );
}
