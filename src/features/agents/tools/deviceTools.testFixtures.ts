// The mocks and helpers every `deviceTools.*.test.ts` shares. Import this before anything else in a test,
// so the mocks are in place when the tools load.
import { vi } from "vitest";
import type {
  AiInvocationDeviceContext,
  AiInvocationRequest,
} from "@/features/agents/runs/invocations/invocationTypes";
import { deviceTools } from "./deviceTools";
import { rememberRun } from "./runContexts";

const mocks = vi.hoisted(() => ({
  settings: { revision: 0, state: null as unknown },
  execute: vi.fn(),
  missing: vi.fn(),
  apiRequest: vi.fn(),
}));

vi.mock("@/shared/platform/nativeInvoke", () => ({
  invoke: async (command: string, args: { revision: number; document: unknown; host: string }) => {
    if (command === "settings_session_state") {
      return { revision: mocks.settings.revision, state: mocks.settings.state };
    }
    if (command === "settings_session_commit") {
      mocks.settings.revision++;
      mocks.settings.state = args.document;
      return {};
    }
    if (command === "agent_host_missing") return mocks.missing(args.host);
    throw new Error(`unexpected ${command}`);
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(),
}));
vi.mock("../runs/jobs/workerExecute", () => ({
  executeWorkflowNodeOnDevice: mocks.execute,
  abortable: <T>(work: Promise<T>, signal: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      work.then(resolve, reject);
    }),
}));
vi.mock("@/api/client", () => ({ apiRequest: mocks.apiRequest, apiBlobRequest: vi.fn() }));
vi.mock("../personal/useAgentsStore", () => ({
  agentsDeviceSnapshot: async () => ({ device: { displayName: "Mac" } }),
}));
vi.mock("../tabs/agentTabs", () => ({ agentTab: () => undefined }));
vi.mock("../personal/personalAgentsStore", () => ({
  usePersonalAgentsStore: { getState: () => ({ agents: [] }) },
}));

export const scope = "agent-scope-1";
export const grant = { payload: "p", signature: "s" };
export const tab = (
  ref = scope,
  metadata: Record<string, string | boolean> = {},
): AiInvocationDeviceContext => ({
  deviceId: "device",
  kind: "browser_tab",
  opaqueRef: ref,
  displayName: "Browser",
  capabilities: [
    "browser.snapshot",
    "browser.steps",
    "browser.navigate",
    "browser.act",
    "browser.extract",
    "browser.inspect",
  ],
  metadata: { app_id: "browser", window_label: "main", ...metadata },
  runGrant: grant,
});
export const workspace: AiInvocationDeviceContext = {
  deviceId: "device",
  kind: "workspace",
  opaqueRef: "workspace:device",
  displayName: "Misty browser",
  capabilities: ["browser.session", "browser.run", "shell.run"],
  metadata: { source: "desktop" },
  runGrant: grant,
};

export async function start(
  request: Partial<AiInvocationRequest> = {},
  contexts = [tab(), workspace],
) {
  await rememberRun(
    "run",
    "conversation",
    {
      agentId: "agent",
      windowLabel: "main",
      permissionMode: "auto",
      ...request,
    } as AiInvocationRequest,
    contexts,
  );
}

export const call = (
  name: string,
  input: Record<string, unknown>,
  signal = new AbortController().signal,
) => deviceTools[name]({ runId: "run", callId: "call", name, input, signal });

export const lastJob = () => mocks.execute.mock.calls[mocks.execute.mock.calls.length - 1][0];

export const failure = async (work: Promise<unknown>) =>
  work.then(
    () => {
      throw new Error("it succeeded");
    },
    (error: Error) => error,
  );

export { mocks };

export function resetDeviceTools() {
  mocks.settings.revision = 0;
  mocks.settings.state = null;
  vi.resetAllMocks();
  mocks.apiRequest.mockResolvedValue({ settings: { screen_location: "window" }, grants: [] });
  mocks.missing.mockResolvedValue(false);
  mocks.execute.mockResolvedValue({ ok: true });
}
