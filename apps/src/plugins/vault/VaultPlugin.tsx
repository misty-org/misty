import { useState } from "react";
import { FolderOpen, Play, ShieldCheck } from "lucide-react";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";
import type { PluginPanelProps } from "../types";

export function VaultPlugin({ context }: PluginPanelProps) {
  const [repository, setRepository] = useState("");
  const [backupRoot, setBackupRoot] = useState(context.selectedPaths[0] ?? "");
  const [status, setStatus] = useState("Configure a restic repository and backup root.");
  const [tone, setTone] = useState<"neutral" | "success" | "error">("neutral");

  async function checkRepository() {
    const result = await context.runHostCommand<{ ok?: boolean; message?: string }>(
      "vault.checkRepository",
      { repository },
    );
    const ok = result.ok !== false;
    setTone(ok ? "success" : "error");
    setStatus(result.message ?? (ok ? "Repository check requested." : "Repository check requires the Misty host bridge."));
    context.notify(ok ? "success" : "error", "Vault", result.message ?? "Repository check requested.");
  }

  async function startBackup() {
    const result = await context.runHostCommand<{ ok?: boolean; message?: string }>(
      "vault.startBackup",
      { repository, backupRoot },
    );
    const ok = result.ok !== false;
    setTone(ok ? "success" : "error");
    setStatus(result.message ?? (ok ? "Backup job requested." : "Backup jobs require the Misty host bridge."));
    context.notify(ok ? "success" : "error", "Vault", result.message ?? "Backup job requested.");
  }

  return (
    <div className="panel-stack">
      <div className="panel-title">
        <h2>Vault</h2>
        <p>Restic backup controls live here as a web plugin surface.</p>
      </div>

      <div className="control-grid">
        <Field label="Repository">
          <input
            className="text-input"
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            placeholder="sftp:user@host:/backups/misty"
          />
        </Field>
        <Field label="Backup root">
          <input
            className="text-input"
            value={backupRoot}
            onChange={(event) => setBackupRoot(event.target.value)}
            placeholder="/Users/me/Documents"
          />
        </Field>
      </div>

      <div className="action-row">
        <ActionButton type="button" onClick={checkRepository} disabled={!repository.trim()}>
          <ShieldCheck size={16} aria-hidden="true" />
          Check
        </ActionButton>
        <ActionButton type="button" onClick={startBackup} disabled={!repository.trim() || !backupRoot.trim()}>
          <Play size={16} aria-hidden="true" />
          Start Backup
        </ActionButton>
        <ActionButton
          type="button"
          className="secondary-button"
          onClick={() => setBackupRoot(context.selectedPaths[0] ?? "")}
        >
          <FolderOpen size={16} aria-hidden="true" />
          Use Selection
        </ActionButton>
      </div>

      <StatusLine tone={tone}>{status}</StatusLine>
    </div>
  );
}
