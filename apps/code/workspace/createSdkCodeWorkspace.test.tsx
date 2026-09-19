import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { createMistyAppSDK } from "@misty/sdk";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import { createCodeTabState } from "@/features/workspace/model";
import { selectEditorPreferences } from "@/features/settings/store/preferences";
import { createAppRpcScope } from "@/features/apps/rpc/session";
import { createAppUiRpc } from "@/features/apps/rpc/appUi";
import { createAppUiBackend } from "@/features/apps/rpc/appUiBackend";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";
import { createSdkCodeRuntime } from "./sdkCodeRuntime";
import type { SdkCodeWorkspaceServices } from "./createSdkCodingWorkspace";
import { createSdkCodeEditor } from "./components/createSdkCodeEditor";
import { createSdkCodeWorkspace } from "./createSdkCodeWorkspace";
import { useCodeOverlayAppearance } from "./useCodeOverlayAppearance";
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
const dispose: Array<() => Promise<void>> = [];
afterEach(async () => {
  cleanup();
  for (const close of dispose.splice(0)) await close();
  useWorkspaceStore.getState().reset();
});

it("runs the Code UI with SDK files and actual host workspace RPC, including creating another tab", async () => {
  useWorkspaceStore.getState().reset();
  const tab = useWorkspaceStore
    .getState()
    .openSurface(workspaceSurfaceFromRoute("/apps/code?space=space-a")!);
  const scope = createAppRpcScope({
    identity: { appId: "code", accountId: "fixture", spaceId: "space-a", instanceId: tab.id },
    scopes: ["navigation.write"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const rpc = createAppUiRpc(scope, createAppUiBackend(scope)),
    fixture = createSdkCodeFileFixture();
  fixture.root.children!.set("second.ts", {
    name: "second.ts",
    kind: "file",
    text: "second document\n",
  });
  const request = vi.fn(async (message: { method: string; params?: unknown }) =>
    message.method.startsWith("workspace.") ? rpc.request(message) : fixture.request(message),
  );
  const sdk = createMistyAppSDK({ request, subscribe: rpc.subscribe });
  const runtime = createSdkCodeRuntime(sdk, scope.signal),
    project = (await runtime.openProject())!;
  const path = `${project.root}/src/${fixture.file.name}`;
  await runtime.openFile(project.root, path, tab.id);
  await sdk.workspace.update({
    viewId: tab.id,
    state: createCodeTabState({ rootPath: project.root, activeFilePath: path }) as never,
  });
  const events = new EventTarget(),
    preferences = { ...selectEditorPreferences(null), autosaveDelayMs: 0 };
  const editorOptions: Parameters<typeof createSdkCodeEditor>[1] = {
    events,
    usePreferences: () => preferences,
    useShortcutHandler: () => undefined,
    ErrorActivity: ({ error }) => <p role="alert">{error}</p>,
    lsp: {
      codeActions: async () => [],
      documentSymbols: async () => [],
      executeLspCommand: async () => undefined,
      formatDocument: async () => false,
      lspExtension: () => [],
      renameSymbol: async () => null,
      showSymbolInformation: async () => false,
      goToDefinition: async () => false,
    },
  };
  const editor = createSdkCodeEditor(runtime, editorOptions);
  const report = vi.fn();
  const services: Omit<SdkCodeWorkspaceServices, "workspace"> = {
    ...editor,
    events,
    usePreferences: () => preferences,
    useOverlayAppearance: useCodeOverlayAppearance,
    useShortcutTitle: (label) => label,
    registerShortcutHandler: () => () => undefined,
    updatePreference: () => undefined,
    ShortcutHint: () => null,
    FolderPicker: () => null,
    ErrorActivity: ({ error }) => <p role="alert">{error}</p>,
    openModelsSettings: () => undefined,
    report,
    retainLspRoot: () => () => undefined,
    findReferencesAt: async () => [],
    useCodeAiAdapter: () => undefined,
    InlineRewrite: () => null,
  };
  const workspace = await createSdkCodeWorkspace(
    runtime,
    sdk,
    { viewId: tab.id, spaceId: "space-a", signal: scope.signal },
    services,
  );
  dispose.push(async () => {
    workspace.close();
    editor.close();
    scope.close();
    rpc.close();
    await runtime.close();
  });
  const view = render(<workspace.Workspace />),
    ui = within(view.container);
  expect(view.container.querySelector(".cm-editor")).toBeTruthy();
  const previousEditor = EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!;
  const previousState = previousEditor.state;
  const lateBlurCallbacks = previousState.facet(EditorView.focusChangeEffect);
  fireEvent.click(await ui.findByRole("button", { name: "second.ts" }));
  await act(async () => {
    await vi.waitFor(() =>
      expect(editor.editorLocation(tab.id)?.path).toBe(`${project.root}/second.ts`),
    );
    await workspace.projection.settled();
  });
  expect(
    (await sdk.workspace.snapshot()).views.find((view) => view.viewId === tab.id)?.state,
  ).toMatchObject({ viewport: { activeFilePath: `${project.root}/second.ts` } });
  act(() => lateBlurCallbacks.forEach((callback) => callback(previousState, false)));
  fireEvent.click(ui.getByRole("button", { name: "src" }));
  const buffer = runtime.store.getState().projectBuffers[project.root][path];
  expect(buffer.contents).toBe(buffer.savedContents);
  expect(fixture.file.text).toBe("const value = 1;\r\n");
  const source = await ui.findByRole("button", { name: fixture.file.name });
  fireEvent.contextMenu(source);
  fireEvent.click(await screen.findByRole("menuitem", { name: /Open in new/i }));
  await act(async () => {
    await vi.waitFor(async () => expect((await sdk.workspace.snapshot()).views).toHaveLength(2));
    await workspace.projection.settled();
  });
  const views = (await sdk.workspace.snapshot()).views;
  expect(views.find((view) => view.viewId !== tab.id)?.state).toMatchObject({
    rootPath: project.root,
    viewport: { activeFilePath: path },
  });
  expect(editor.editorLocation(tab.id)?.path).toBe(`${project.root}/second.ts`);
  const nextView = views.find((view) => view.viewId !== tab.id)!;
  expect(nextView.state).toHaveProperty("projectHandoff");
  const secondScope = createAppRpcScope({
    identity: {
      appId: "code",
      accountId: "fixture",
      spaceId: "space-a",
      instanceId: nextView.viewId,
    },
    scopes: ["navigation.write"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const secondRpc = createAppUiRpc(secondScope, createAppUiBackend(secondScope));
  const secondFiles = fixture.fork();
  const secondSdk = createMistyAppSDK({
    request: (message) =>
      message.method.startsWith("workspace.")
        ? secondRpc.request(message)
        : secondFiles.request(message),
    subscribe: secondRpc.subscribe,
  });
  const secondRuntime = createSdkCodeRuntime(secondSdk, secondScope.signal);
  const secondEvents = new EventTarget();
  let saveSecond: () => unknown = () => undefined;
  const secondEditor = createSdkCodeEditor(secondRuntime, {
    ...editorOptions,
    events: secondEvents,
    useShortcutHandler: (id, run) => {
      if (id === "code.save") saveSecond = run;
    },
  });
  const secondWorkspace = await createSdkCodeWorkspace(
    secondRuntime,
    secondSdk,
    { viewId: nextView.viewId, spaceId: "space-a", signal: secondScope.signal },
    { ...services, ...secondEditor, events: secondEvents },
  );
  dispose.push(async () => {
    secondWorkspace.close();
    secondEditor.close();
    secondScope.close();
    secondRpc.close();
    await secondRuntime.close();
  });
  const secondRendered = render(<secondWorkspace.Workspace />);
  await vi.waitFor(() => expect(secondEditor.editorLocation(nextView.viewId)?.path).toBe(path));
  expect(
    secondFiles.request.mock.calls.some(([message]) => message.method === "files.pickDirectory"),
  ).toBe(false);
  expect(
    (await secondSdk.workspace.snapshot()).views.find((view) => view.viewId === nextView.viewId)
      ?.state,
  ).not.toHaveProperty("projectHandoff");
  expect(fixture.shares.size).toBe(0);
  act(() => scope.close());
  await runtime.close();
  expect(view.container.querySelector(".cm-editor")).toBeNull();
  expect(fixture.handles.size).toBe(0);
  expect(secondFiles.handles.size).toBeGreaterThan(0);
  const secondCm = EditorView.findFromDOM(secondRendered.container.querySelector(".cm-editor")!)!;
  act(() =>
    secondCm.dispatch({
      changes: { from: 0, to: secondCm.state.doc.length, insert: "survives source close\n" },
    }),
  );
  act(() => {
    saveSecond();
  });
  await vi.waitFor(() => expect(fixture.file.text).toBe("survives source close\r\n"));
  const reference = await secondRuntime.project(project.root).remember();
  act(() =>
    secondWorkspace.projection.store
      .getState()
      .updateTabState(
        nextView.viewId,
        createCodeTabState({ rootPath: project.root, activeFilePath: path }),
      ),
  );
  await secondWorkspace.projection.settled();
  expect(
    (await secondSdk.workspace.snapshot()).views.find((view) => view.viewId === nextView.viewId)
      ?.state,
  ).toHaveProperty("projectReference", reference);
  act(() => secondScope.close());
  await secondRuntime.close();
  expect(secondFiles.handles.size).toBe(0);
  const restoredScope = createAppRpcScope({
    identity: {
      appId: "code",
      accountId: "fixture",
      spaceId: "space-a",
      instanceId: nextView.viewId,
    },
    scopes: ["navigation.write"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const restoredRpc = createAppUiRpc(restoredScope, createAppUiBackend(restoredScope));
  const restoredFiles = fixture.fork();
  const restoredSdk = createMistyAppSDK({
    request: (message) =>
      message.method.startsWith("workspace.")
        ? restoredRpc.request(message)
        : restoredFiles.request(message),
    subscribe: restoredRpc.subscribe,
  });
  const restoredRuntime = createSdkCodeRuntime(restoredSdk, restoredScope.signal);
  const restoredEvents = new EventTarget();
  const restoredEditor = createSdkCodeEditor(restoredRuntime, {
    ...editorOptions,
    events: restoredEvents,
  });
  const restoredWorkspace = await createSdkCodeWorkspace(
    restoredRuntime,
    restoredSdk,
    { viewId: nextView.viewId, spaceId: "space-a", signal: restoredScope.signal },
    { ...services, ...restoredEditor, events: restoredEvents },
  );
  dispose.push(async () => {
    restoredWorkspace.close();
    restoredEditor.close();
    restoredScope.close();
    restoredRpc.close();
    await restoredRuntime.close();
  });
  const restoredView = render(<restoredWorkspace.Workspace />);
  await vi.waitFor(() => expect(restoredEditor.editorLocation(nextView.viewId)?.path).toBe(path));
  expect(
    EditorView.findFromDOM(
      restoredView.container.querySelector(".cm-editor")!,
    )!.state.doc.toString(),
  ).toBe("survives source close\n");
  expect(
    restoredFiles.request.mock.calls.some(([message]) => message.method === "files.pickDirectory"),
  ).toBe(false);
  expect(restoredRuntime.project(project.root).reference()).toEqual(reference);
  expect(report).not.toHaveBeenCalled();
});
