import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth";
import { SyncUnlockForm } from "@/features/browser-sync/SyncAccountSettings";
import { useSyncController } from "@/features/browser-sync/useSyncController";
import { useConnectedDevices } from "@/features/connected-devices";
import type { AdmissionView } from "@/native/devices";
import { Button } from "@/shared/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../../components/DesktopSettingsUI";
import { SettingsNote } from "../../SettingsControls";

const addThisDeviceHelp =
  "Agents can already use this computer. Adding it once lets it sync and work with your other " +
  "devices: agents can reach it from them, and it shares your clipboard with them.";

const pollMs = 2000;

/**
 * Adding this device: once, with either proof that only you can give. Unlock
 * sync here with your sync password and secret, or approve it from a device
 * you already added after checking both show the same code.
 */
export function AddThisDevice() {
  const devices = useConnectedDevices();
  const { user } = useAuth();
  const sync = useSyncController(user?.id ?? "");
  const [approval, setApproval] = useState<AdmissionView | null>(null);
  const [error, setError] = useState("");
  const controller = useRef(devices);
  controller.current = devices;

  useEffect(() => {
    if (!approval || approval.admitted || ["denied", "expired"].includes(approval.state)) return;
    const timer = window.setTimeout(() => {
      void controller.current
        .approvalStatus(approval.requestId)
        .then(setApproval, () => setError("The approval status could not be checked. Try again."));
    }, pollMs);
    return () => window.clearTimeout(timer);
  }, [approval]);

  const start = () =>
    void devices.requestApproval().then(
      (view) => {
        setError("");
        setApproval(view);
      },
      () => setError("A device approval request could not be started. Try again."),
    );

  // A new account has no vault yet: creating one is what adds its first device.
  const firstDevice = sync.vault?.remote === false && !sync.vault.local;
  if (firstDevice)
    return (
      <>
        <Section title="Add this device" description={addThisDeviceHelp}>
          <SettingsNote>
            Set up Sync with a password and secret to add this device. Later devices join with them
            or with approval from this one.
          </SettingsNote>
        </Section>
        {sync.desktop && !sync.session ? (
          <SyncUnlockForm controller={sync} sectionTitle="Set up Sync" />
        ) : null}
      </>
    );

  return (
    <>
      <Section title="Add this device" description={addThisDeviceHelp}>
        <SettingsNote>
          Use your sync password and secret below, or approve this device from one you already
          added.
        </SettingsNote>
        <Row label="Approve from another device" description={approvalDescription(approval)}>
          {approval && !["denied", "expired"].includes(approval.state) && !approval.admitted ? (
            <Button
              variant="ghost"
              onClick={() => void devices.deny(approval.requestId).then(() => setApproval(null))}
            >
              Cancel
            </Button>
          ) : (
            <Button variant="outline" disabled={!devices.ready} onClick={start}>
              {approval ? "Start again" : "Ask for approval"}
            </Button>
          )}
        </Row>
        {approval?.code && !approval.admitted ? (
          <div className="py-3">
            <p className="text-[13px] text-cream-muted">Your other device must show this code:</p>
            <p className="mt-1 font-mono text-2xl tracking-[0.3em] text-cream" aria-live="polite">
              {approval.code.slice(0, 3)} {approval.code.slice(3)}
            </p>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="py-2 text-sm text-cream-muted">
            {error}
          </p>
        ) : null}
      </Section>
      {sync.desktop && !sync.session && sync.vault ? (
        <SyncUnlockForm controller={sync} sectionTitle="Use your sync password and secret" />
      ) : null}
    </>
  );
}

function approvalDescription(approval: AdmissionView | null): string {
  if (!approval)
    return "On a device you already added, open Settings, then Devices, and approve this one.";
  if (approval.admitted || approval.state === "approved") return "Approved. This device is added.";
  if (approval.state === "denied") return "The request was denied.";
  if (approval.state === "expired") return "The request expired. Start again.";
  if (approval.code) return "Check the code on both devices, then approve on the other one.";
  return "Waiting for another device to open the request.";
}
