import { create } from "zustand";
import { FolderOpen, X } from "lucide-react";
import { Button } from "@/shared/ui";
import { createCodeTabState, parseCodeTabState } from "@/features/workspace/model";
import { parseSdkCodeProjectReference } from "./sdkCodeProjectReference";
import { parseSdkCodeProjectHandoff } from "./sdkCodeProjectHandoff";
import { MistyViewStateSchema, type MistyAppSDK } from "@misty/sdk";
import { dockLeaves } from "@/features/workspace/dockTree";
import type { createSdkCodeRuntime } from "./sdkCodeRuntime";
import {
  createSdkCodingWorkspace,
  type SdkCodeWorkspaceServices,
} from "./createSdkCodingWorkspace";
import { createSdkCodeWorkspaceProjection } from "./sdkCodeWorkspaceProjection";
import { createSdkCodeProjectPicker } from "./createSdkCodeProjectPicker";

/** Owns this mount's workspace RPC projection, project picker and UI assembly.
 * Its editor, project runtime and language/AI services retain the caller's lifetime. */
export async function createSdkCodeWorkspace(
  runtime: ReturnType<typeof createSdkCodeRuntime>,
  misty: Pick<MistyAppSDK, "workspace" | "files">,
  options: { viewId: string; spaceId?: string; signal?: AbortSignal },
  services: Omit<SdkCodeWorkspaceServices, "workspace" | "FolderPicker">,
) {
  runtime.ownView(options.viewId);
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const assert = () => {
    if (lifetime.signal.aborted) throw new Error("This Code workspace is closed.");
  };
  const recovery = create<{ error: string | null; busy: boolean; picker: boolean }>(() => ({
    error: null,
    busy: false,
    picker: false,
  }));
  const fail = (error: unknown) => {
    if (lifetime.signal.aborted) return;
    recovery.setState({
      error: error instanceof Error ? error.message : "The project is unavailable.",
    });
    services.report(error);
  };
  const projects = createSdkCodeProjectPicker(runtime, misty, {
    signal: lifetime.signal,
    report: services.report,
  });
  const serializeState = (state: unknown) => {
    const code = parseCodeTabState(state);
    const reference =
      code.rootPath && runtime.hasProject(code.rootPath)
        ? runtime.project(code.rootPath).reference()
        : undefined;
    return MistyViewStateSchema.parse({
      ...code,
      ...(reference ? { projectReference: reference } : {}),
    });
  };
  const projection = createSdkCodeWorkspaceProjection(misty, {
    ...options,
    signal: lifetime.signal,
    report: services.report,
    serializeState,
    async prepareOpen(state) {
      const code = parseCodeTabState(state);
      if (!code.rootPath) return { state, cancel: async () => undefined };
      const project = runtime.project(code.rootPath);
      const reference = project.reference();
      if (reference) {
        // A different view may have forgotten this record. Live access still
        // permits a short-lived handoff even when saved access is unavailable.
        try {
          const saved = await misty.files.listSavedDirectories();
          assert();
          if (saved.some((entry) => entry.bookmarkId === reference.bookmarkId))
            return { state: serializeState(state), cancel: async () => undefined };
          project.invalidateReference(reference.bookmarkId);
        } catch {
          assert();
        }
      }
      const handoff = await project.share();
      return {
        state: MistyViewStateSchema.parse({ ...code, projectHandoff: handoff }),
        cancel: () => project.cancelShare(handoff.ticket),
      };
    },
  });
  let assembly: ReturnType<typeof createSdkCodingWorkspace> | undefined;
  const close = () => {
    options.signal?.removeEventListener("abort", abort);
    lifetime.signal.removeEventListener("abort", close);
    lifetime.abort();
    assembly?.close();
    projects.close();
    projection.close();
  };
  lifetime.signal.addEventListener("abort", close, { once: true });
  try {
    await projection.ready;
    assert();
    const initial = projection.viewState(options.viewId);
    const restore = async () => {
      assert();
      const root = parseCodeTabState(initial).rootPath;
      if (!root) return;
      if (initial && typeof initial === "object" && !Array.isArray(initial)) {
        if (initial.projectReference && initial.projectHandoff)
          throw new Error("This project has conflicting saved access. Choose the folder again.");
        if (initial.projectReference) {
          const reference = parseSdkCodeProjectReference(initial.projectReference);
          if (root !== reference.root)
            throw new Error("The saved Code project does not match its view.");
          if (!runtime.hasProject(root))
            await runtime.openProject({ reference, activate: false, signal: lifetime.signal });
        } else if (initial.projectHandoff) {
          const handoff = parseSdkCodeProjectHandoff(initial.projectHandoff);
          if (root !== handoff.root)
            throw new Error("This Code folder handoff does not match its view.");
          if (!runtime.hasProject(root))
            await runtime.openProject({ handoff, activate: false, signal: lifetime.signal });
          assert();
          await misty.workspace.update({ viewId: options.viewId, state: serializeState(initial) });
          await projection.refresh();
        }
      }
      assert();
      if (!runtime.hasProject(root))
        throw new Error("Folder access is no longer available. Choose the project folder again.");
    };
    const retry = async () => {
      if (lifetime.signal.aborted || recovery.getState().busy) return;
      recovery.setState({ busy: true });
      try {
        await restore();
        assert();
        recovery.setState({ error: null });
      } catch (error) {
        fail(error);
      } finally {
        if (!lifetime.signal.aborted) recovery.setState({ busy: false });
      }
    };
    await retry();
    assert();
    assembly = createSdkCodingWorkspace(runtime, {
      ...services,
      workspace: projection.store,
      FolderPicker: projects.Picker,
    });
    const Assembly = assembly.Workspace;
    const selectRoot = (root: string) => {
      recovery.setState({ picker: false, busy: true });
      void (async () => {
        try {
          assert();
          runtime.project(root);
          // Selecting a replacement never carries file paths from the old folder.
          await misty.workspace.update({
            viewId: options.viewId,
            state: serializeState(createCodeTabState({ rootPath: root })),
          });
          await projection.refresh();
          assert();
          recovery.setState({ error: null });
        } catch (error) {
          fail(error);
        } finally {
          if (!lifetime.signal.aborted) recovery.setState({ busy: false });
        }
      })();
    };
    function Workspace() {
      const status = recovery();
      const notice = projects.store((state) => state.notice);
      const tab = projection.store((state) =>
        dockLeaves(state.layout.root)
          .flatMap((pane) => pane.tabs)
          .find((tab) => tab.id === options.viewId),
      );
      if (!tab || lifetime.signal.aborted) return null;
      return (
        <div className="flex h-full min-h-0 flex-col">
          {notice ? (
            <div
              role="status"
              className="flex items-center gap-2 border-b border-charcoal-border px-3 py-2 text-sm text-cream-muted"
            >
              <span className="flex-1">{notice}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Dismiss project notice"
                onClick={() => projects.store.setState({ notice: null })}
              >
                <X size={14} />
              </Button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            {status.error ? (
              <section className="grid h-full place-items-center p-6 text-cream">
                <div className="w-full max-w-md space-y-3">
                  <h1 className="text-lg font-medium">Project unavailable</h1>
                  <p role="alert" className="text-sm text-cream-muted">
                    {status.error}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      disabled={status.busy}
                      onClick={() => recovery.setState({ picker: true })}
                    >
                      <FolderOpen size={16} />
                      Choose folder…
                    </Button>
                    <Button variant="ghost" disabled={status.busy} onClick={() => void retry()}>
                      Try again
                    </Button>
                  </div>
                </div>
              </section>
            ) : (
              <Assembly tab={tab} />
            )}
          </div>
          {status.picker ? (
            <projects.Picker
              onCancel={() => recovery.setState({ picker: false })}
              onSelect={selectRoot}
            />
          ) : null}
        </div>
      );
    }
    return { Workspace, projection, projects, recovery, retry, close };
  } catch (error) {
    close();
    throw error;
  }
}
