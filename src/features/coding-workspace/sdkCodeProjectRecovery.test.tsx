import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
async function fixture(state: unknown = createCodeTabState({})) {
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
    files = createSdkCodeFileFixture();
  const request = vi.fn(async (message: { method: string; params?: unknown }) =>
    message.method.startsWith("workspace.") ? rpc.request(message) : files.request(message),
  );
  const sdk = createMistyAppSDK({ request, subscribe: rpc.subscribe });
  await sdk.workspace.update({ viewId: tab.id, state: state as never });
  const runtime = createSdkCodeRuntime(sdk, scope.signal),
    events = new EventTarget();
  const preferences = { ...selectEditorPreferences(null), autosaveDelayMs: 0 };
  const editor = createSdkCodeEditor(runtime, {
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
  });
  const report = vi.fn();
  const workspace = await createSdkCodeWorkspace(
    runtime,
    sdk,
    { viewId: tab.id, spaceId: "space-a", signal: scope.signal },
    {
      ...editor,
      events,
      usePreferences: () => preferences,
      useOverlayAppearance: useCodeOverlayAppearance,
      useShortcutTitle: (label) => label,
      registerShortcutHandler: () => () => undefined,
      updatePreference: () => undefined,
      ShortcutHint: () => null,
      ErrorActivity: ({ error }) => <p role="alert">{error}</p>,
      openModelsSettings: () => undefined,
      report,
      retainLspRoot: () => () => undefined,
      findReferencesAt: async () => [],
      useCodeAiAdapter: () => undefined,
      InlineRewrite: () => null,
    },
  );
  dispose.push(async () => {
    workspace.close();
    editor.close();
    scope.close();
    rpc.close();
    await runtime.close();
  });
  const current = async () =>
    (await sdk.workspace.snapshot()).views.find((view) => view.viewId === tab.id)!.state;
  return { tab, scope, request, files, sdk, runtime, editor, report, workspace, current };
}
it("opens a blank Code view through the real SDK picker and persists saved access with its document", async () => {
  const f = await fixture(),
    view = render(<f.workspace.Workspace />);
  fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose folder…" }));
  await vi.waitFor(() => expect(f.runtime.openProjects()).toHaveLength(1));
  const root = f.runtime.openProjects()[0].root;
  fireEvent.click(await within(view.container).findByRole("button", { name: "src" }));
  fireEvent.click(await within(view.container).findByRole("button", { name: f.files.file.name }));
  await vi.waitFor(() =>
    expect(f.editor.editorLocation(f.tab.id)?.path).toBe(`${root}/src/${f.files.file.name}`),
  );
  await f.workspace.projection.settled();
  expect(await f.current()).toMatchObject({
    rootPath: root,
    projectReference: { root },
    viewport: { activeFilePath: `${root}/src/${f.files.file.name}` },
  });
  expect(view.container.querySelector(".cm-editor")).toBeTruthy();
});
it("recovers a temporarily unavailable saved folder and preserves its document", async () => {
  const bookmarkId = crypto.randomUUID(),
    root = `/misty-project/${crypto.randomUUID()}`;
  const f = await fixture({
    ...createCodeTabState({ rootPath: root, activeFilePath: `${root}/src/日本語 #?.ts` }),
    projectReference: { root, bookmarkId, write: true },
  });
  const view = render(<f.workspace.Workspace />);
  expect(screen.getByText("Project unavailable")).toBeTruthy();
  expect(view.container.querySelector(".cm-editor")).toBeNull();
  f.files.bookmarks.set(bookmarkId, { node: f.files.root, write: true });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await vi.waitFor(() =>
    expect(f.editor.editorLocation(f.tab.id)?.path).toBe(`${root}/src/${f.files.file.name}`),
  );
  expect(screen.queryByText("Project unavailable")).toBeNull();
  expect(f.request.mock.calls.some(([m]) => m.method === "files.pickDirectory")).toBe(false);
});
it.each(["expired handoff", "legacy path"])(
  "offers a replacement for %s without carrying old file paths",
  async (kind) => {
    const root = `/misty-project/${crypto.randomUUID()}`;
    const f = await fixture({
      ...createCodeTabState({ rootPath: root, activeFilePath: `${root}/private-old.ts` }),
      ...(kind === "expired handoff"
        ? { projectHandoff: { root, ticket: crypto.randomUUID(), write: true } }
        : {}),
    });
    render(<f.workspace.Workspace />);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    fireEvent.click(
      await within(await screen.findByRole("dialog")).findByRole("button", {
        name: "Choose folder…",
      }),
    );
    await vi.waitFor(() => expect(f.workspace.recovery.getState().error).toBeNull());
    const saved = await f.current();
    expect(saved).not.toHaveProperty("projectHandoff");
    expect(saved).toMatchObject({ viewport: { kind: "file", activeFilePath: null } });
    expect(saved).toHaveProperty("projectReference");
    expect((saved as { rootPath: string }).rootPath).not.toBe(root);
  },
);
it.each(["forgotten", "vault unavailable"])(
  "uses a live handoff when saved access is %s in another view",
  async (kind) => {
    const f = await fixture();
    const project = (await f.runtime.openProject())!;
    const reference = await project.remember();
    if (kind === "forgotten") await f.sdk.files.forgetDirectory(reference.bookmarkId);
    else {
      const base = f.request.getMockImplementation()!;
      f.request.mockImplementation((message) =>
        message.method === "files.listSavedDirectories"
          ? Promise.reject(new Error("Vault unavailable"))
          : base(message),
      );
    }
    const next = await f.workspace.projection.store.getState().openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      route: "/apps/code",
      title: "Project",
      instancePolicy: "multiple",
      state: createCodeTabState({ rootPath: project.root }),
    });
    const state = (await f.sdk.workspace.snapshot()).views.find(
      (view) => view.viewId === next.id,
    )!.state;
    expect(state).toHaveProperty("projectHandoff");
    expect(state).not.toHaveProperty("projectReference");
    if (kind === "forgotten") expect(project.reference()).toBeUndefined();
  },
);
it("does not recover or render a late saved-folder reply after the owner closes", async () => {
  const root = `/misty-project/${crypto.randomUUID()}`,
    bookmarkId = crypto.randomUUID();
  const f = await fixture({
    ...createCodeTabState({ rootPath: root }),
    projectReference: { root, bookmarkId, write: true },
  });
  const view = render(<f.workspace.Workspace />);
  f.files.bookmarks.set(bookmarkId, { node: f.files.root, write: true });
  let release!: () => void;
  const base = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (message) => {
    const result = await base(message);
    if (message.method === "files.reopenDirectory")
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return result;
  });
  const retry = f.workspace.retry();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  act(() => f.scope.close());
  release();
  await retry;
  await f.runtime.close();
  expect(view.container.firstChild).toBeNull();
  expect(f.files.handles.size).toBe(0);
  expect(f.files.watchers.size).toBe(0);
});
