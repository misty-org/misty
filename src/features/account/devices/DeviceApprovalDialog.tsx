import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  notify,
  PaneLoading,
  PropertyList,
} from "@misty/ui";
import { ApiRequestError } from "@/api/client/errors";
import { useAuth } from "../sessions/auth_state";
import { closeDeviceApproval, useDeviceApprovalStore } from "./device_approval_store";
import { deviceCodePlaceholder, formatDeviceCode, isDeviceCode } from "./device_code";
import { deviceSignInApi, refreshSessions, type DeviceSignInRequest } from "./device_sign_in_api";

type Step =
  | { kind: "entry" }
  | { kind: "lookup"; code: string }
  | { kind: "confirm"; code: string; device: DeviceSignInRequest };

function lookupFailure(error: unknown): string {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500)
    return "That code is wrong or has expired.";
  return "The code couldn't be checked. Try again.";
}

export function DeviceApprovalDialog() {
  const request = useDeviceApprovalStore((state) => state.request);
  return <DeviceApproval key={request} />;
}

function DeviceApproval() {
  const open = useDeviceApprovalStore((state) => state.open);
  const linked = useDeviceApprovalStore((state) => state.code);
  const { user } = useAuth();
  const [typed, setTyped] = useState(linked);
  const [step, setStep] = useState<Step>(() =>
    isDeviceCode(linked) ? { kind: "lookup", code: linked } : { kind: "entry" },
  );
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const lookupCode = step.kind === "lookup" ? step.code : "";
  useEffect(() => {
    if (!lookupCode) return;
    let current = true;
    deviceSignInApi
      .lookup(lookupCode)
      .then((device) => {
        if (current) setStep({ kind: "confirm", code: lookupCode, device });
      })
      .catch((cause: unknown) => {
        if (!current) return;
        setError(lookupFailure(cause));
        setStep({ kind: "entry" });
      });
    return () => {
      current = false;
    };
  }, [lookupCode]);

  const cancel = () => {
    if (approving) return;
    if (step.kind === "confirm") void deviceSignInApi.refuse(step.code).catch(() => undefined);
    closeDeviceApproval();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isDeviceCode(typed)) return;
    setError("");
    setStep({ kind: "lookup", code: typed });
  };

  const approve = async () => {
    if (step.kind !== "confirm" || approving) return;
    setApproving(true);
    try {
      await deviceSignInApi.approve(step.code);
      closeDeviceApproval();
      notify({ message: `${step.device.name || "The device"} is signed in` });
      if (user?.id) void refreshSessions(user.id).catch(() => undefined);
    } catch {
      notify({ message: "The device couldn't be signed in. Try again.", tone: "error" });
    } finally {
      if (alive.current) setApproving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : cancel())}>
      <DialogContent
        size="sm"
        hideClose
        {...(step.kind === "confirm" ? {} : { "aria-describedby": undefined })}
      >
        {step.kind === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle>Sign in this device?</DialogTitle>
              <DialogDescription>Check that the device shows the same code.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <PropertyList
                layout="grouped"
                label="Device"
                items={[
                  { label: "Device", value: step.device.name || "Unnamed device" },
                  { label: "Code", value: step.code },
                ]}
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="quiet" size="lg" disabled={approving} onClick={cancel}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={approving}
                onClick={() => void approve()}
              >
                Approve
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Sign in a device</DialogTitle>
            </DialogHeader>
            <DialogBody>
              {step.kind === "lookup" ? (
                <PaneLoading inline label="Finding the device" />
              ) : (
                <Field label="Code" error={error}>
                  <Input
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder={deviceCodePlaceholder}
                    maxLength={deviceCodePlaceholder.length}
                    value={typed}
                    onChange={(event) => {
                      setTyped(formatDeviceCode(event.target.value));
                      setError("");
                    }}
                  />
                </Field>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="quiet" size="lg" onClick={cancel}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={step.kind === "lookup" || !isDeviceCode(typed)}
              >
                Continue
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
