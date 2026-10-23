import { useState, type FormEvent } from "react";
import { Button, Checkbox, Input } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSection,
} from "@/features/settings/desktop";
import { SettingsNote } from "@/features/settings/SettingsControls";

export interface VaultUnlockRequest {
  password: string | null;
  /** Only a vault made before account passwords needs one; null otherwise. */
  syncSecret: string | null;
  remember: boolean;
}

/**
 * Sync is sealed under the Misty password, so it is the only thing to type. A
 * vault made before that (`legacy`) still opens with a sync password and the
 * secret saved when it was created, until it is moved to the Misty password.
 */
export function SyncVaultForm(props: {
  create: boolean;
  local: boolean;
  /** The vault still needs a sync secret to unlock. */
  legacy?: boolean;
  /** Setting up needs a password the server has not seen; this account must choose one first. */
  needsNewPassword?: boolean;
  onChooseNewPassword?(): void;
  /** A Google account has no Misty password: setting one up asks twice. */
  confirmPassword?: boolean;
  sectionTitle?: string;
  compact?: boolean;
  /** The server rejected this device's identity; unlocking registers it again. */
  reenroll?: boolean;
  onUnlock(request: VaultUnlockRequest): Promise<void>;
}) {
  const legacy = Boolean(props.legacy) && !props.create;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [secret, setSecret] = useState("");
  // The OS credential store is the normal path: users unlock a device once,
  // while still being able to opt out on shared or temporary machines.
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const density = props.compact ? "compact" : "normal";
  const unlock = async (remembered = false) => {
    if (busy) return;
    setError(null);
    if (!remembered) {
      if (!password) {
        setError(legacy ? "Enter your sync password." : "Enter your Misty password.");
        return;
      }
      if (props.create && props.confirmPassword && password !== confirmation) {
        setError("The passwords do not match.");
        return;
      }
      if (legacy && !/^[A-Za-z0-9+/]{43}=$/.test(secret.trim())) {
        setError("Enter the complete sync secret saved when you created this vault.");
        return;
      }
    }
    setBusy(true);
    try {
      await props.onUnlock({
        password: remembered ? null : password,
        syncSecret: remembered || !legacy ? null : secret.trim(),
        remember: remembered ? false : remember,
      });
      setPassword("");
      setConfirmation("");
      setSecret("");
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message && props.create
          ? cause.message
          : legacy
            ? "Sync could not be opened with those details. Check the password and secret, then try again."
            : "Sync could not be opened with that password. Check it, then try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void unlock();
  };
  const title =
    props.sectionTitle ??
    (props.create
      ? "Turn on sync"
      : props.reenroll
        ? "Reconnect this device"
        : "Unlock your sync vault");
  const description = props.create
    ? "Your synced data is encrypted on this device with your Misty password."
    : props.reenroll
      ? "Restore this device’s access without changing your existing vault data."
      : legacy
        ? "Enter the sync password and secret you use on your other devices."
        : "Enter your Misty password.";
  if (props.create && props.needsNewPassword)
    return (
      <SettingsSection title={title} description={description} density={density}>
        <SettingsRow
          label="Choose a new password"
          description="Sync is encrypted with your Misty password, and Misty has only seen yours in plain form. Choose a new one so only this device knows it."
          density={density}
        >
          <Button type="button" onClick={props.onChooseNewPassword}>
            Choose password…
          </Button>
        </SettingsRow>
      </SettingsSection>
    );
  return (
    <form onSubmit={submit} className="ph-no-capture" data-private="true">
      <SettingsSection title={title} description={description} density={density}>
        <SettingsRow
          label={legacy ? "Sync password" : "Misty password"}
          description={
            legacy
              ? "The password you chose when you created this vault."
              : props.create && props.confirmPassword
                ? "Choose a password for sync. Misty cannot recover it for you."
                : "The password you sign in to Misty with."
          }
          density={density}
        >
          <Input
            aria-label={legacy ? "Sync password" : "Misty password"}
            type="password"
            autoComplete={props.create && props.confirmPassword ? "new-password" : "current-password"}
            value={password}
            maxLength={1024}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full max-w-[320px]"
          />
        </SettingsRow>
        {props.create && props.confirmPassword && (
          <SettingsRow
            label="Confirm password"
            description="Enter the same password again."
            density={density}
          >
            <Input
              aria-label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              maxLength={1024}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
              className="w-full max-w-[320px]"
            />
          </SettingsRow>
        )}
        {legacy && (
          <SettingsRow
            label="Sync secret"
            density={density}
            description="Paste the secret you saved when you created your vault."
          >
            <div className="grid w-full max-w-[320px] gap-2">
              <Input
                aria-label="Sync secret"
                type={reveal ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={secret}
                disabled={busy}
                onChange={(event) => setSecret(event.target.value)}
                className="font-mono text-xs"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!secret || busy}
                  onClick={() => setReveal(!reveal)}
                >
                  {reveal ? "Hide secret" : "Show secret"}
                </Button>
              </div>
            </div>
          </SettingsRow>
        )}
        <SettingsRow
          label="Remember on this device"
          description="Keep the vault key in this device’s secure credential store."
          density={density}
        >
          <label className="flex items-center gap-2 text-sm text-cream">
            <Checkbox
              checked={remember}
              disabled={busy}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            Remember vault key
          </label>
        </SettingsRow>
        <SettingsNote>
          Workspace content is encrypted on your device before upload. The server can still see
          account, device, connection and sync timing metadata.
        </SettingsNote>
        {error && (
          <p role="alert" className="py-3 text-sm text-cream">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-3">
          {props.local && !props.create && !props.reenroll && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void unlock(true)}
            >
              Use saved device key
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {busy
              ? "Opening vault…"
              : props.create
                ? "Turn on sync"
                : props.reenroll
                  ? "Reconnect device"
                  : "Unlock sync"}
          </Button>
        </div>
      </SettingsSection>
    </form>
  );
}
