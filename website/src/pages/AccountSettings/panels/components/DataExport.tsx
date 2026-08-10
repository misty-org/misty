import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { requestExportManifest } from "../../api";
import { customRowClass } from "../../components/SettingsRows";

/**
 * Password-gated because the manifest names everything the account holds. The
 * archive is built lazily so its zip dependency stays out of the main bundle —
 * most visitors never open this section.
 */
export function DataExport() {
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function download() {
    if (working || !password) return;
    setWorking(true);
    setError("");
    setDone(false);
    try {
      const manifest = await requestExportManifest(password);
      const { buildAccountExportArchive } = await import("../../exportAccountData");
      await buildAccountExportArchive(manifest);
      setPassword("");
      setDone(true);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Could not export your data.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={`${customRowClass} flex flex-col gap-3`}>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Download a copy of your account data as a zip archive. Confirm your
        password to continue.
      </p>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <label
            htmlFor="account-export-password"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Password
          </label>
          <Input
            id="account-export-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={working || !password}
          aria-busy={working}
          onClick={() => void download()}
        >
          {working ? <Spinner aria-hidden="true" /> : null}
          {working ? "Preparing…" : "Download my data"}
        </Button>
      </div>
      {done ? (
        <p className="text-xs text-[var(--settings-success)]" role="status">
          Your download has started.
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
