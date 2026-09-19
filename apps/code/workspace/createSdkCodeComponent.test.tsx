import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { createAppRpcScope } from "@/features/apps/rpc/session";
import { createAppUiRpc } from "@/features/apps/rpc/appUi";
import { createAppUiBackend } from "@/features/apps/rpc/appUiBackend";
import { mountAppComponent } from "@/features/apps/rpc/component";
import {
  componentSessionKey,
  createComponentSessionRegistry,
} from "@/features/apps/rpc/componentSessions";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import { createCodeTabState } from "@/features/workspace/model";
import { selectEditorPreferences } from "@/features/settings/store/preferences";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";
import { createSdkCodeComponent } from "./createSdkCodeComponent";
import { createSdkCodeEditor } from "./components/createSdkCodeEditor";
import { useCodeOverlayAppearance } from "./useCodeOverlayAppearance";
import type { createSdkCodeRuntime } from "./sdkCodeRuntime";
import { pathToUri } from "./lsp/client";
import { createMistyAppSDK } from "@misty/sdk";

vi.mock("react-resizable-panels", async () =>
  vi.importActual(
    "../../../node_modules/react-resizable-panels/dist/react-resizable-panels.browser.development.esm.js",
  ),
);
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = vi.fn();
});
const dispose: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await act(async () => {
    for (const close of dispose.splice(0)) await close();
  });
  cleanup();
  useWorkspaceStore.getState().reset();
});

it("closes late service factories once and allocates separate data for separate component sessions", async () => {
  const pending: Array<
    (value: Awaited<ReturnType<Parameters<typeof createSdkCodeComponent>[0]>>) => void
  > = [];
  const runtimes: Array<ReturnType<typeof createSdkCodeRuntime>> = [];
  const definition = createSdkCodeComponent(async ({ runtime }) => {
    runtimes.push(runtime);
    return new Promise((resolve) => pending.push(resolve));
  });
  const a = await definition.createSession!({ signal: new AbortController().signal });
  const b = await definition.createSession!({ signal: new AbortController().signal });
  const misty = createMistyAppSDK({
    request: async () => {
      throw new Error("No workspace should mount after closure");
    },
  });
  const context = {
    instanceId: "same-view",
    route: "/apps/code",
    active: true,
    appearance: { mode: "dark" as const },
  };
  const first = a.mount({ root: document.createElement("div"), misty, context });
  const second = b.mount({ root: document.createElement("div"), misty, context });
  const firstRejected = expect(first).rejects.toThrow("closed"),
    secondRejected = expect(second).rejects.toThrow("closed");
  expect(runtimes[0].store).not.toBe(runtimes[1].store);
  runtimes[0].editor.getState().setProjectDiagnostics("root", "path", []);
  expect(runtimes[1].editor.getState().projectDiagnostics).toEqual({});
  await a.close();
  await a.close();
  await b.close();
  const closeA = vi.fn(),
    closeB = vi.fn();
  pending[0]({ services: {} as never, close: closeA });
  pending[1]({ services: {} as never, close: closeB });
  await Promise.all([firstRejected, secondRejected]);
  expect(closeA).toHaveBeenCalledOnce();
  expect(closeB).toHaveBeenCalledOnce();
  expect(runtimes[0].editor.getState().projectDiagnostics).toEqual({});
});

it("opens a rename review in another real Code component mount, preserves unsaved text and saves with the peer's SDK after source closure", async () => {
  useWorkspaceStore.getState().reset();
  const tab = useWorkspaceStore
    .getState()
    .openSurface(workspaceSurfaceFromRoute("/apps/code?space=space-a")!);
  const files = createSdkCodeFileFixture();
  const sessions = createComponentSessionRegistry({ idleMs: 1000 });
  dispose.push(() => sessions.closeAll());
  const runtimes = new Map<string, ReturnType<typeof createSdkCodeRuntime>>();
  const commands = new Map<string, Map<string, () => unknown>>();
  const report = vi.fn();
  let projectRoot = "",
    path = "";
  const definition = createSdkCodeComponent(async ({ runtime, misty, context }) => {
    runtimes.set(context.instanceId, runtime);
    if (!projectRoot) {
      const project = (await runtime.openProject())!;
      projectRoot = project.root;
      path = `${projectRoot}/src/${files.file.name}`;
      await runtime.openFile(projectRoot, path, context.instanceId);
      await misty.workspace.update({
        viewId: context.instanceId,
        state: createCodeTabState({ rootPath: projectRoot, activeFilePath: path }) as never,
      });
    }
    const events = new EventTarget(),
      shortcuts = new Map<string, () => unknown>();
    commands.set(context.instanceId, shortcuts);
    const preferences = { ...selectEditorPreferences(null), autosaveDelayMs: 0 };
    const editor = createSdkCodeEditor(runtime, {
      events,
      usePreferences: () => preferences,
      useShortcutHandler: (id, run) => {
        shortcuts.set(id, run);
      },
      ErrorActivity: ({ error }) => <p role="alert">{error}</p>,
      lsp: {
        codeActions: async () => [],
        documentSymbols: async () => [],
        executeLspCommand: async () => undefined,
        formatDocument: async () => false,
        lspExtension: () => [],
        renameSymbol: async (_view, file, _root, newName) => ({
          changes: {
            [pathToUri(file)]: [
              {
                range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
                newText: newName,
              },
            ],
          },
        }),
        showSymbolInformation: async () => false,
        goToDefinition: async () => false,
      },
    });
    return {
      spaceId: "space-a",
      close: editor.close,
      services: {
        ...editor,
        events,
        usePreferences: () => preferences,
        useOverlayAppearance: useCodeOverlayAppearance,
        useShortcutTitle: (label) => label,
        registerShortcutHandler: (id, run) => {
          shortcuts.set(id, run);
          return () => {
            if (shortcuts.get(id) === run) shortcuts.delete(id);
          };
        },
        updatePreference() {},
        ShortcutHint: () => null,
        ErrorActivity: ({ error }) => <p role="alert">{error}</p>,
        openModelsSettings() {},
        report,
        retainLspRoot: () => () => undefined,
        findReferencesAt: async () => [],
        useCodeAiAdapter() {},
        InlineRewrite: () => null,
      },
    };
  });
  async function mount(viewId: string, filesystem: typeof files, packageHash = "verified-code") {
    const scope = createAppRpcScope({
      identity: { appId: "code", accountId: "fixture", spaceId: "space-a", instanceId: viewId },
      scopes: ["navigation.write"],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    const rpc = createAppUiRpc(scope, createAppUiBackend(scope));
    const root = document.createElement("div");
    document.body.append(root);
    const component = mountAppComponent({
      definition,
      root,
      scope,
      sessions,
      sessionKey: componentSessionKey({
        appId: "code",
        accountId: "fixture",
        spaceId: "space-a",
        serverBase: "https://fixture.test",
        packageHash,
        scopes: ["files.read", "files.write"],
      }),
      context: {
        instanceId: viewId,
        route: "/apps/code?space=space-a",
        active: true,
        appearance: { mode: "dark" },
      },
      transport: {
        request: (message) =>
          message.method.startsWith("workspace.")
            ? rpc.request(message)
            : filesystem.request(message),
        subscribe: rpc.subscribe,
      },
      release: () => {
        rpc.close();
        // Controlled file backend models native scope teardown; expired app SDKs
        // cannot call cleanup methods after the host has revoked their authority.
        filesystem.handles.clear();
        filesystem.watchers.clear();
      },
    });
    dispose.push(async () => {
      await component.close();
      root.remove();
    });
    await act(async () => {
      await component.ready;
    });
    return { root, component, scope };
  }
  const source = await mount(tab.id, files);
  const first = runtimes.get(tab.id)!;
  await vi.waitFor(() => expect(source.root.querySelector(".cm-editor")).toBeTruthy());
  const cm = EditorView.findFromDOM(source.root.querySelector(".cm-editor")!)!;
  act(() =>
    cm.dispatch({
      changes: { from: cm.state.doc.length, insert: "// unsaved\n" },
      selection: { anchor: 8 },
    }),
  );
  expect(first.store.getState().projectBuffers[projectRoot][path].contents).toContain("// unsaved");
  first.editor.getState().setProjectDiagnostics(projectRoot, path, [
    {
      path,
      fromLine: 1,
      fromCharacter: 0,
      toLine: 1,
      toCharacter: 1,
      severity: "warning",
      message: "Shared warning",
    },
  ]);
  act(() => commands.get(tab.id)!.get("code.rename")!());
  fireEvent.change(await screen.findByRole("textbox", { name: "New symbol name" }), {
    target: { value: "renamed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview rename" }));
  let peerId = "";
  await act(async () => {
    await vi.waitFor(() => {
      const views = Object.keys(first.store.getState().views);
      // The newly requested tab exists in the real host store before its component mounts.
      const pane = useWorkspaceStore.getState().layout.root;
      expect(pane).toBeTruthy();
      expect(views).toContain(tab.id);
      const layout = JSON.stringify(pane);
      expect(layout).toContain("multibuffer");
    });
  });
  const { dockLeaves } = await import("@/features/workspace/dockTree");
  peerId = dockLeaves(useWorkspaceStore.getState().layout.root)
    .flatMap((p) => p.tabs)
    .find((t) => t.groupKey === "app:code" && t.id !== tab.id)!.id;
  const peerFiles = files.fork(),
    peer = await mount(peerId, peerFiles);
  const second = runtimes.get(peerId)!;
  expect(second.store).toBe(first.store);
  expect(second.editor).toBe(first.editor);
  expect(second.editor.getState().projectDiagnostics[projectRoot][path][0].message).toBe(
    "Shared warning",
  );
  const apply = await within(peer.root).findByRole("button", { name: "Apply" });
  expect(
    EditorView.findFromDOM(peer.root.querySelector(".cm-editor")!)!.state.doc.toString(),
  ).toContain("renamed");
  await act(async () => {
    await source.component.close();
  });
  expect(files.handles.size).toBe(0);
  expect(peerFiles.handles.size).toBeGreaterThan(0);
  expect(first.store.getState().views[tab.id]).toBeUndefined();
  expect(second.editor.getState().projectDiagnostics[projectRoot][path]).toHaveLength(1);
  fireEvent.click(apply);
  expect(second.store.getState().projectBuffers[projectRoot][path].contents).toBe(
    "const renamed = 1;\n// unsaved\n",
  );
  expect(files.file.text).toBe("const value = 1;\r\n");
  await act(async () => {
    commands.get(peerId)!.get("code.save")!();
  });
  await vi.waitFor(() => expect(files.file.text).toBe("const renamed = 1;\r\n// unsaved\r\n"));
  expect(files.request.mock.calls.some(([m]) => m.method === "files.writeText")).toBe(false);
  expect(peerFiles.request.mock.calls.some(([m]) => m.method === "files.writeText")).toBe(true);
  await expect(first.saveFile(projectRoot, path)).rejects.toThrow("closed");
  const blank = useWorkspaceStore.getState().openSurface({
    ...workspaceSurfaceFromRoute("/apps/code?space=space-a")!,
    forceNew: true,
  });
  const empty = await mount(blank.id, files.fork());
  expect(empty.root.querySelector(".cm-editor")).toBeNull();
  expect(runtimes.get(blank.id)!.openProjects()).toHaveLength(0);
  expect(runtimes.get(blank.id)!.store.getState().views[blank.id].rootPath).toBe("");
  expect(report).not.toHaveBeenCalled();
  await act(async () => {
    await sessions.closeAll();
  });
  expect(second.store.getState().projectBuffers).toEqual({});
  expect(second.editor.getState().projectDiagnostics).toEqual({});
  expect(peerFiles.handles.size).toBe(0);
});
