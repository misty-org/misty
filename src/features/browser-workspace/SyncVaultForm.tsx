import { useState, type FormEvent } from "react";
import { Button, Checkbox, Input } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSection,
} from "@/features/settings/desktop";
import { SettingsNote } from "@/features/settings/settingsControls";

export interface VaultUnlockRequest {
  password: string | null;
  syncSecret: string | null;
  remember: boolean;
}
export function SyncVaultForm(props: {
  create: boolean;
  local: boolean;
  onGenerateSecret(): Promise<string>;
  onUnlock(request: VaultUnlockRequest): Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [secret, setSecret] = useState("");
  const [saved, setSaved] = useState(false);
  // The OS credential store is the normal path: users unlock a device once,
  // while still being able to opt out on shared or temporary machines.
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const unlock = async (remembered = false) => {
    if (busy) return;
    setError(null);
    if (!remembered) {
      const bytes = new TextEncoder().encode(password).length;
      if (bytes < 12 || bytes > 1024) {
        setError("Use a sync password between 12 and 1,024 bytes long.");
        return;
      }
      if (props.create && password !== confirmation) {
        setError("The sync passwords do not match.");
        return;
      }
      if (!/^[A-Za-z0-9+/]{43}=$/.test(secret.trim())) {
        setError("Enter the complete sync secret saved when you created this vault.");
        return;
      }
      if (props.create && !saved) {
        setError("Save your sync secret before creating the vault.");
        return;
      }
    }
    setBusy(true);
    try {
      await props.onUnlock({
        password: remembered ? null : password,
        syncSecret: remembered ? null : secret.trim(),
        remember: remembered ? false : remember,
      });
      setPassword("");
      setConfirmation("");
      setSecret("");
      setSaved(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSecret(await props.onGenerateSecret());
      setSaved(false);
      setReveal(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void unlock();
  };
  return (
    <form onSubmit={submit} className="ph-no-capture" data-private="true">
      <SettingsSection
        title={props.create ? "Create your sync vault" : "Unlock your sync vault"}
        description={
          props.create
            ? "Choose a separate sync password. Your password and sync secret unlock this workspace on your other devices."
            : "Use the sync password and secret from your first device. Your Misty account password does not unlock the vault."
        }
      >
        <SettingsRow label="Sync password">
          <Input
            aria-label="Sync password"
            type="password"
            autoComplete={props.create ? "new-password" : "current-password"}
            value={password}
            maxLength={1024}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full max-w-[320px]"
          />
        </SettingsRow>
        {props.create && (
          <SettingsRow label="Confirm sync password">
            <Input
              aria-label="Confirm sync password"
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
        <SettingsRow
          label="Sync secret"
          description={
            props.create
              ? "Save this secret in your password manager. Misty cannot recover it for you."
              : "Paste the secret you saved when you created your vault."
          }
        >
          <div className="grid w-full max-w-[320px] gap-2">
            <Input
              aria-label="Sync secret"
              type={reveal ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              readOnly={props.create}
              value={secret}
              disabled={busy}
              onChange={(event) => setSecret(event.target.value)}
              className="font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              {props.create && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || Boolean(secret)}
                  onClick={() => void generate()}
                >
                  Generate secret
                </Button>
              )}
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
        {props.create && (
          <SettingsRow
            label="Keep your recovery details"
            description="Losing both your unlock details and your unlocked devices means losing access to encrypted sync data."
          >
            <label className="flex items-center gap-2 text-sm text-cream">
              <Checkbox
                checked={saved}
                disabled={busy || !secret}
                onCheckedChange={(checked) => setSaved(checked === true)}
              />
              I saved my sync secret
            </label>
          </SettingsRow>
        )}
        <SettingsRow
          label="Remember on this device"
          description="Keep the vault key in this device’s operating-system credential store."
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
          <p role="alert" className="px-5 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 px-5 pb-4">
          {props.local && !props.create && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void unlock(true)}
            >
              Use saved device key
            </Button>
          )}
          <Button type="submit" disabled={busy || (props.create && (!saved || !secret))}>
            {busy ? "Opening vault…" : props.create ? "Create sync vault" : "Unlock sync"}
          </Button>
        </div>
      </SettingsSection>
    </form>
  );
}
