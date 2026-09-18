import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  Ban,
  CheckCircle2,
  DatabaseBackup,
  FolderPlus,
  HardDrive,
  RefreshCw,
  X,
} from "lucide-react";
import {
  connectMistyApp,
  type MistyAppSDK,
  type MistyBackupJob,
} from "@misty/sdk";
import { ActionButton, Field, StatusLine } from "../../shared/pluginChrome";

type Folder = { handle: string; name: string };
type Repository = {
  handle: string;
  folderName: string;
  repository: string;
  name: string;
};
type Snapshot = { id: string; time: string };

export function BackupsPlugin() {
  const sdk = useRef<MistyAppSDK | null>(null);
  const alive = useRef(true);
  const job = useRef("");
  const repositoryRef = useRef<Repository | null>(null);
  const sourcesRef = useRef<Folder[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [repository, setRepository] = useState<Repository | null>(null);
  const [sources, setSources] = useState<Folder[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [view, setView] = useState<"overview" | "setup" | "snapshots">(
    "overview",
  );
  const [name, setName] = useState("Misty Backups");
  const [message, setMessage] = useState(
    "Choose or create an encrypted repository.",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  repositoryRef.current = repository;
  sourcesRef.current = sources;

  useEffect(() => {
    alive.current = true;
    try {
      sdk.current = connectMistyApp();
      void sdk.current.backups.status().then(
        (status) => {
          if (!alive.current) return;
          setAvailable(status.available);
          if (!status.available)
            setError(
              status.message ?? "Backups are unavailable on this device.",
            );
        },
        (caught) => alive.current && setError(String(caught)),
      );
    } catch (caught) {
      setError(String(caught));
    }
    return () => {
      alive.current = false;
      if (job.current)
        void sdk.current?.backups.jobCancel(job.current).catch(() => undefined);
      const opened = repositoryRef.current;
      if (opened)
        void sdk.current?.backups
          .repositoryClose(opened.repository)
          .catch(() => undefined);
      if (opened)
        void sdk.current?.files.release(opened.handle).catch(() => undefined);
      for (const source of sourcesRef.current)
        void sdk.current?.files.release(source.handle).catch(() => undefined);
    };
  }, []);

  const poll = async (jobId: string): Promise<MistyBackupJob> => {
    while (alive.current && job.current === jobId) {
      const current = await sdk.current!.backups.jobStatus(jobId);
      if (current.status !== "running") return current;
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
    throw new Error("Backup operation cancelled.");
  };
  const run = async (start: () => Promise<{ jobId: string }>) => {
    if (!sdk.current || running) return null;
    setRunning(true);
    setError("");
    let jobId = "";
    try {
      jobId = (await start()).jobId;
      job.current = jobId;
      const result = await poll(jobId);
      if (result.status !== "completed")
        throw new Error(result.message || "Backup operation failed.");
      setMessage(result.message);
      return result.result ?? null;
    } catch (caught) {
      if (alive.current) setError(String(caught));
      return null;
    } finally {
      if (jobId)
        void sdk.current?.backups.jobClose(jobId).catch(() => undefined);
      if (job.current === jobId) job.current = "";
      if (alive.current) setRunning(false);
    }
  };
  const chooseFolder = async (write: boolean) =>
    sdk.current?.files.pickDirectory({ write }) ?? null;
  const openRepository = async (create: boolean) => {
    if (!sdk.current || busy || running) return;
    setBusy(true);
    setError("");
    let folder: Folder | null = null;
    try {
      folder = await chooseFolder(true);
      if (!folder) return;
      const opened = await sdk.current.backups.repositoryOpen({
        directory: folder.handle,
        create,
        name: create ? name : undefined,
      });
      if (!alive.current) return;
      if (repository) {
        await sdk.current.backups
          .repositoryClose(repository.repository)
          .catch(() => undefined);
        await sdk.current.files
          .release(repository.handle)
          .catch(() => undefined);
      }
      setRepository({
        handle: folder.handle,
        folderName: folder.name,
        repository: opened.repository,
        name: opened.name,
      });
      setSnapshots([]);
      setView("overview");
      setMessage(`${opened.name} is open.`);
      folder = null;
    } catch (caught) {
      if (alive.current) setError(String(caught));
    } finally {
      if (folder)
        void sdk.current?.files.release(folder.handle).catch(() => undefined);
      if (alive.current) setBusy(false);
    }
  };
  const addSource = async () => {
    if (!sdk.current || busy || running) return;
    setBusy(true);
    try {
      const folder = await chooseFolder(false);
      if (folder && alive.current)
        setSources((current) => [...current, folder].slice(0, 64));
    } catch (caught) {
      if (alive.current) setError(String(caught));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const removeSource = (handle: string) => {
    setSources((current) => current.filter((source) => source.handle !== handle));
    void sdk.current?.files.release(handle).catch(() => undefined);
  };
  const loadSnapshots = async () => {
    if (!repository) return;
    const result = await run(() =>
      sdk.current!.backups.snapshotsStart(repository.repository),
    );
    if (result?.snapshots && alive.current) {
      setSnapshots([...result.snapshots]);
      setView("snapshots");
      setMessage(
        `${result.snapshots.length} snapshot${result.snapshots.length === 1 ? "" : "s"} found.`,
      );
    }
  };
  const restore = async (snapshot: string) => {
    if (!repository || !sdk.current) return;
    const destination = await chooseFolder(true);
    if (!destination) return;
    const result = await run(() =>
      sdk.current!.backups.restoreStart(
        repository.repository,
        snapshot,
        destination.handle,
      ),
    );
    await sdk.current.files.release(destination.handle).catch(() => undefined);
    if (result?.folder)
      setMessage(`Restored into ${destination.name}/${result.folder}.`);
  };
  const cancel = () => {
    if (job.current) void sdk.current?.backups.jobCancel(job.current);
  };

  return (
    <div className="panel-stack backups-panel">
      <header className="panel-title">
        <h2>Backups</h2>
        <p>Encrypted snapshots using folders you explicitly choose.</p>
      </header>
      <nav className="subnav" aria-label="Backup sections">
        <button
          className={view === "overview" ? "active" : ""}
          onClick={() => setView("overview")}
        >
          Overview
        </button>
        <button
          className={view === "snapshots" ? "active" : ""}
          disabled={!repository}
          onClick={() => void loadSnapshots()}
        >
          Snapshots
        </button>
        <button
          className={view === "setup" ? "active" : ""}
          onClick={() => setView("setup")}
        >
          Repository
        </button>
      </nav>
      {view === "setup" ? (
        <section className="setup-form">
          <div className="callout">
            <HardDrive size={18} />
            <div>
              <strong>Local encrypted repository</strong>
              <span>
                Choose an empty folder to create one, or reselect a repository
                registered to this account.
              </span>
            </div>
          </div>
          <Field label="Repository name">
            <input
              className="text-input"
              value={name}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="action-row">
            <ActionButton
              disabled={!available || busy || running || !name.trim()}
              onClick={() => void openRepository(true)}
            >
              <FolderPlus size={16} />
              Create in empty folder
            </ActionButton>
            <ActionButton
              className="secondary-button"
              disabled={!available || busy || running}
              onClick={() => void openRepository(false)}
            >
              <HardDrive size={16} />
              Open existing
            </ActionButton>
          </div>
        </section>
      ) : null}
      {view === "overview" ? (
        <>
          <div className="repository-summary">
            <DatabaseBackup size={20} />
            <div>
              <strong>{repository?.name ?? "No repository open"}</strong>
              <span>
                {repository
                  ? `Chosen folder: ${repository.folderName}`
                  : "Open a repository to begin."}
              </span>
            </div>
          </div>
          <div className="source-box">
            <strong>Source folders</strong>
            {sources.length ? (
              <div className="source-list">
                {sources.map((source) => (
                  <span key={source.handle}>
                    {source.name}
                    <button
                      type="button"
                      aria-label={`Remove ${source.name}`}
                      disabled={running}
                      onClick={() => removeSource(source.handle)}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span>Choose local folders to include.</span>
            )}
          </div>
          <div className="action-row">
            <ActionButton
              className="secondary-button"
              disabled={busy || running || sources.length >= 64}
              onClick={() => void addSource()}
            >
              <FolderPlus size={16} />
              Add source
            </ActionButton>
            <ActionButton
              disabled={!repository || !sources.length || running}
              onClick={() =>
                void run(() =>
                  sdk.current!.backups.backupStart(
                    repository!.repository,
                    sources.map((source) => source.handle),
                  ),
                )
              }
            >
              <DatabaseBackup size={16} />
              Back up now
            </ActionButton>
            <ActionButton
              className="secondary-button"
              disabled={!repository || running}
              onClick={() =>
                void run(() =>
                  sdk.current!.backups.checkStart(repository!.repository),
                )
              }
            >
              <CheckCircle2 size={16} />
              Verify
            </ActionButton>
            <ActionButton
              className="secondary-button"
              disabled={!repository || running}
              onClick={() => void loadSnapshots()}
            >
              <RefreshCw size={16} />
              Snapshots
            </ActionButton>
          </div>
        </>
      ) : null}
      {view === "snapshots" ? (
        <section className="snapshot-list">
          {snapshots.length ? (
            snapshots.map((snapshot) => (
              <article key={snapshot.id}>
                <div>
                  <strong>{new Date(snapshot.time).toLocaleString()}</strong>
                  <small>{snapshot.id.slice(0, 12)}</small>
                </div>
                <ActionButton
                  className="secondary-button"
                  disabled={running}
                  onClick={() => void restore(snapshot.id)}
                >
                  <ArchiveRestore size={15} />
                  Restore…
                </ActionButton>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <ArchiveRestore size={24} />
              <strong>No snapshots yet</strong>
              <span>Create a backup to establish the first restore point.</span>
            </div>
          )}
        </section>
      ) : null}
      <StatusLine tone={error ? "error" : "neutral"}>
        {error || message}
      </StatusLine>
      {running ? (
        <ActionButton
          className="secondary-button cancel-button"
          onClick={cancel}
        >
          <Ban size={16} />
          Cancel current operation
        </ActionButton>
      ) : null}
    </div>
  );
}
