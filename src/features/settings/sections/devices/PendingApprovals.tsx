import { useEffect, useRef, useState } from "react";
import { useConnectedDevices } from "@/features/connected-devices";
import type { AdmissionView } from "@/native/devices";
import { Button } from "@/shared/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../../components/DesktopSettingsUI";
import { SettingsNote } from "../../SettingsControls";

const pollMs = 2000;

/**
 * Devices waiting to be added. Approving compares a six-digit code shown on
 * both devices; only on a match does this device sign the grant and seal the
 * vault key to the new device. Shown only while a request is open.
 */
export function PendingApprovals() {
  const devices = useConnectedDevices();
  const controller = useRef(devices);
  controller.current = devices;
  const [active, setActive] = useState<AdmissionView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active || active.code || ["denied", "expired", "approved"].includes(active.state)) return;
    const timer = window.setTimeout(() => {
      void controller.current.approveStatus(active.requestId).then(setActive, (cause: unknown) => {
        setActive(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    }, pollMs);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!devices.pending.length && !active) return null;
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  return (
    <Section title="Waiting for approval">
      {!devices.view?.canSign ? (
        <SettingsNote>Unlock sync on this device to approve another one.</SettingsNote>
      ) : null}
      {devices.pending.map((request) => {
        const current = active?.requestId === request.requestId ? active : null;
        return (
          <div key={request.requestId}>
            <Row
              label={request.deviceName || "New device"}
              description={
                current?.code
                  ? `Approve only if ${request.deviceName || "the new device"} shows this code.`
                  : current
                    ? "Waiting for the new device to answer."
                    : "Wants to be added to your devices."
              }
            >
              {current?.code ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void devices
                        .approveConfirm(request.requestId)
                        .then(() => setActive(null), fail)
                    }
                  >
                    Codes match
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void devices.deny(request.requestId).then(() => setActive(null), fail)
                    }
                  >
                    They don’t match
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    disabled={!devices.view?.canSign || Boolean(active)}
                    onClick={() => {
                      setError("");
                      void devices.approveStart(request.requestId).then(setActive, fail);
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void devices.deny(request.requestId).catch(fail)}
                  >
                    Deny
                  </Button>
                </>
              )}
            </Row>
            {current?.code ? (
              <div className="border-b border-charcoal-border px-5 py-4">
                <p className="font-mono text-2xl tracking-[0.3em] text-cream" aria-live="polite">
                  {current.code.slice(0, 3)} {current.code.slice(3)}
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
      {error ? (
        <p role="alert" className="px-5 py-3 text-sm text-cream">
          {error}
        </p>
      ) : null}
    </Section>
  );
}
