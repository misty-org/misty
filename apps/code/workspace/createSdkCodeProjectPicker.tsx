import { useEffect } from "react";
import { create } from "zustand";
import { FolderOpen, Trash2 } from "lucide-react";
import type { MistyAppSDK } from "@misty/sdk";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui";
import type { createSdkCodeRuntime } from "./sdkCodeRuntime";

type Saved = Awaited<ReturnType<MistyAppSDK["files"]["listSavedDirectories"]>>[number];
type Project = ReturnType<ReturnType<typeof createSdkCodeRuntime>["project"]>;
export function createSdkCodeProjectPicker(
  runtime: ReturnType<typeof createSdkCodeRuntime>,
  misty: Pick<MistyAppSDK, "files">,
  options: { signal?: AbortSignal; report(error: unknown): void },
) {
  const store = create<{
    saved: readonly Saved[];
    loading: boolean;
    busy: boolean;
    error: string | null;
    notice: string | null;
  }>(() => ({ saved: [], loading: false, busy: false, error: null, notice: null }));
  let closed = false,
    listVersion = 0;
  let pending: AbortController | undefined;
  const assert = () => {
    if (closed || options.signal?.aborted) throw new Error("This Code project picker is closed.");
  };
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : "The project could not be opened.";
  const refresh = async () => {
    assert();
    const version = ++listVersion;
    store.setState({ loading: true, error: null });
    try {
      const saved = await misty.files.listSavedDirectories();
      if (!closed && version === listVersion)
        store.setState({ saved: [...saved].sort((a, b) => a.name.localeCompare(b.name)) });
    } catch (error) {
      if (!closed && version === listVersion) store.setState({ error: errorText(error) });
    } finally {
      if (!closed && version === listVersion) store.setState({ loading: false });
    }
  };
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    assert();
    if (pending) return;
    const operation = new AbortController();
    pending = operation;
    store.setState({ busy: true, error: null });
    try {
      await work(operation.signal);
    } catch (error) {
      if (!closed && !operation.signal.aborted) {
        store.setState({ error: errorText(error) });
        options.report(error);
      }
    } finally {
      if (pending === operation) {
        pending = undefined;
        if (!closed) store.setState({ busy: false });
      }
    }
  };
  const select = async (
    open: () => Promise<Project | null>,
    signal: AbortSignal,
    onSelect: (root: string) => void,
    remember: boolean,
  ) => {
    let project: Project | null = null,
      accepted = false;
    try {
      project = await open();
      if (!project) return;
      if (closed || signal.aborted) return;
      if (remember) {
        try {
          await project.remember();
        } catch (error) {
          if (!closed && !signal.aborted) {
            store.setState({
              notice:
                "This folder is open for this session. Its access could not be saved for next time.",
            });
            options.report(error);
          }
        }
      }
      if (closed || signal.aborted) return;
      onSelect(project.root);
      accepted = true;
      if (!closed) void refresh();
    } finally {
      if (project && !accepted) {
        // Remembering a newly chosen folder belongs to this selection too.
        // Cancelled selections must not leave an unwanted saved record behind.
        if (remember && project.reference())
          await project.forget().catch((error) => {
            if (!closed) options.report(error);
          });
        await runtime.discardUnopenedProject(project);
      }
    }
  };
  const choose = (onSelect: (root: string) => void) =>
    run((signal) =>
      select(() => runtime.openProject({ activate: false, signal }), signal, onSelect, true),
    );
  const openSaved = (saved: Saved, onSelect: (root: string) => void) =>
    run(async (signal) => {
      const existing = runtime
        .openProjects()
        .find((project) => project.reference()?.bookmarkId === saved.bookmarkId);
      if (existing) {
        onSelect(existing.root);
        return;
      }
      await select(
        () =>
          runtime.openProject({
            reference: {
              root: `/misty-project/${saved.bookmarkId}`,
              bookmarkId: saved.bookmarkId,
              write: saved.writable,
            },
            activate: false,
            signal,
          }),
        signal,
        onSelect,
        false,
      );
    });
  const forget = (saved: Saved) =>
    run(async () => {
      await misty.files.forgetDirectory(saved.bookmarkId);
      for (const project of runtime.openProjects()) project.invalidateReference(saved.bookmarkId);
      if (!closed) {
        store.setState((state) => ({
          saved: state.saved.filter((item) => item.bookmarkId !== saved.bookmarkId),
        }));
        await refresh();
      }
    });
  const cancelPending = () => pending?.abort();
  const close = () => {
    if (closed) return;
    closed = true;
    listVersion++;
    cancelPending();
    options.signal?.removeEventListener("abort", close);
    store.setState({ saved: [], loading: false, busy: false, error: null, notice: null });
  };
  options.signal?.addEventListener("abort", close, { once: true });
  if (options.signal?.aborted) close();
  function Picker({ onCancel, onSelect }: { onCancel(): void; onSelect(root: string): void }) {
    const state = store();
    useEffect(() => {
      if (!closed) void refresh();
      return cancelPending;
    }, []);
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            cancelPending();
            onCancel();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Open a project</DialogTitle>
            <DialogDescription>Choose a folder or return to a saved project.</DialogDescription>
          </DialogHeader>
          <Button type="button" disabled={state.busy} onClick={() => void choose(onSelect)}>
            <FolderOpen size={16} />
            Choose folder…
          </Button>
          <div className="max-h-72 overflow-auto" aria-busy={state.loading || state.busy}>
            {state.loading ? (
              <p className="py-3 text-sm text-cream-muted" role="status">
                Loading saved projects…
              </p>
            ) : null}
            {!state.loading && !state.saved.length ? (
              <p className="py-3 text-sm text-cream-muted">No saved projects yet.</p>
            ) : null}
            {state.saved.map((saved) => (
              <div
                key={saved.bookmarkId}
                className="flex items-center gap-1 rounded-md hover:bg-charcoal-hover"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm disabled:opacity-50"
                  disabled={state.busy}
                  onClick={() => void openSaved(saved, onSelect)}
                >
                  <FolderOpen size={17} className="shrink-0" />
                  <span className="min-w-0 truncate">{saved.name}</span>
                  {!saved.writable ? (
                    <span className="ml-auto shrink-0 text-xs text-cream-muted">Read-only</span>
                  ) : null}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={state.busy}
                  aria-label={`Forget ${saved.name}`}
                  onClick={() => void forget(saved)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
          </div>
          {state.error ? (
            <div className="text-sm text-cream-muted">
              <p role="alert">{state.error}</p>
              <Button variant="ghost" disabled={state.busy} onClick={() => void refresh()}>
                Refresh saved projects
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    );
  }
  return { Picker, store, refresh, choose, openSaved, forget, cancelPending, close };
}
